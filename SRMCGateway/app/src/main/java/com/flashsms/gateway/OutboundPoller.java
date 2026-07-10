package com.flashsms.gateway;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.core.content.ContextCompat;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * OutboundPoller — pull-based outbound sending.
 *
 * Instead of the server pushing each message to this phone (which only works on
 * a LAN), the phone PULLS its queued messages from the central server, sends
 * each via SMS, then ACKs the results. Works across any network since the phone
 * only makes outbound HTTPS calls.
 *
 *   GET  {base}/api/gateway/outbound?max=N   (Bearer inbound token)
 *   POST {base}/api/gateway/outbound/ack     { results: [{id,status,error}] }
 *
 * Mirrors the lifecycle of ServerStatsPoller (start/stop with the gateway).
 */
public class OutboundPoller {

    private static final String TAG        = "OutboundPoller";
    private static final int    TIMEOUT_MS = 12_000;

    /** How often to poll for new outbound work (ms). */
    public static final long POLL_INTERVAL_MS = 5_000;
    /** Max messages to claim per poll. */
    private static final int  BATCH_MAX = 10;
    /** Pause between individual sends so the SIM/carrier isn't flooded (ms). */
    private static final long SEND_GAP_MS = 1_200;

    /** Exponential backoff: max poll interval when server is unreachable (ms). */
    private static final long MAX_BACKOFF_MS = 30_000;
    private long currentBackoffMs = 0;
    private int consecutiveFailures = 0;

    /** Unique request code counter for PendingIntents (per-process). */
    private final AtomicInteger requestCodeSeq = new AtomicInteger(1000);
    /** Dynamically registered receiver for sent/delivery intents. */
    private SmsDeliveryReceiver deliveryReceiver;
    private boolean receiverRegistered = false;

    private final Context         context;
    private final Handler         main    = new Handler(Looper.getMainLooper());
    private       ExecutorService executor;
    private       boolean         running = false;

    private final Runnable pollRunnable = new Runnable() {
        @Override public void run() {
            if (!running) return;
            if (executor != null && !executor.isShutdown()) {
                executor.execute(OutboundPoller.this::pollOnce);
            }
            // Use backoff interval if we've had consecutive failures
            long interval = currentBackoffMs > 0 ? currentBackoffMs : POLL_INTERVAL_MS;
            main.postDelayed(this, interval);
        }
    };

    public OutboundPoller(Context context) {
        this.context = context.getApplicationContext();
    }

    public void start() {
        if (running) return;
        running  = true;
        executor = Executors.newSingleThreadExecutor();
        registerDeliveryReceiver();
        main.post(pollRunnable);
        Log.d(TAG, "Outbound poller started");
    }

    public void stop() {
        running = false;
        main.removeCallbacks(pollRunnable);
        unregisterDeliveryReceiver();
        if (executor != null) { executor.shutdownNow(); executor = null; }
        Log.d(TAG, "Outbound poller stopped");
    }

    private void registerDeliveryReceiver() {
        if (receiverRegistered) return;
        deliveryReceiver = new SmsDeliveryReceiver();
        IntentFilter filter = new IntentFilter();
        filter.addAction(SmsDeliveryReceiver.ACTION_SENT);
        filter.addAction(SmsDeliveryReceiver.ACTION_DELIVERY);
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                ? ContextCompat.RECEIVER_EXPORTED
                : 0;
        ContextCompat.registerReceiver(context, deliveryReceiver, filter, flags);
        receiverRegistered = true;
        Log.d(TAG, "Delivery receiver registered");
    }

    private void unregisterDeliveryReceiver() {
        if (!receiverRegistered || deliveryReceiver == null) return;
        try {
            context.unregisterReceiver(deliveryReceiver);
        } catch (Exception e) {
            Log.w(TAG, "Unregister receiver: " + e.getMessage());
        }
        deliveryReceiver = null;
        receiverRegistered = false;
        Log.d(TAG, "Delivery receiver unregistered");
    }

    // ── One poll cycle: claim → send → ack ────────────────────────────

    private void pollOnce() {
        final String base  = ServerConfig.getBaseUrl(context);
        final String token = token();
        if (token.isEmpty()) {
            Log.w(TAG, "No inbound token yet — skipping outbound poll");
            return;
        }

        JSONArray messages;
        try {
            String json = httpGet(base + "/api/gateway/outbound?max=" + BATCH_MAX, token);
            JSONObject obj = new JSONObject(json);
            if (!obj.optBoolean("success", false)) {
                recordFailure();
                return;
            }
            messages = obj.optJSONArray("messages");
        } catch (Exception e) {
            Log.w(TAG, "Claim failed: " + e.getMessage());
            recordFailure();
            return;
        }
        // Success — reset backoff
        consecutiveFailures = 0;
        currentBackoffMs = 0;
        if (messages == null || messages.length() == 0) return;

        JSONArray results = new JSONArray();

        // ── Sequential sending with tracking ──
        // SIM mode (sim1/sim2) is determined per-message from the server,
        // not from the phone's local setting.
        for (int i = 0; i < messages.length() && running; i++) {
            JSONObject m = messages.optJSONObject(i);
            if (m == null) continue;
            String id  = m.optString("id", "");
            String to  = m.optString("to", "");
            String msg = m.optString("message", "");
            if (id.isEmpty() || to.isEmpty()) continue;

            // Use the sim_mode from the server (per-broadcast setting)
            boolean useSim2 = SmsSender.SIM_MODE_SIM2_ONLY.equals(m.optString("sim_mode", "sim1"));
            int subId = useSim2 ? SmsSender.getSim2SubId(context) : SmsSender.getSim1SubId(context);
            int simSlot = useSim2 ? 2 : 1;

            String status = "sent";
            String error  = "";

            try {
                int reqCode = requestCodeSeq.incrementAndGet();

                Intent sentIntent = new Intent(SmsDeliveryReceiver.ACTION_SENT);
                sentIntent.putExtra("message_id", id);
                sentIntent.putExtra("to_number", to);
                sentIntent.putExtra("sim_slot", simSlot);

                Intent deliveryIntent = new Intent(SmsDeliveryReceiver.ACTION_DELIVERY);
                deliveryIntent.putExtra("message_id", id);
                deliveryIntent.putExtra("to_number", to);
                deliveryIntent.putExtra("sim_slot", simSlot);

                int piFlags = PendingIntent.FLAG_UPDATE_CURRENT |
                        (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);

                PendingIntent sPi = PendingIntent.getBroadcast(context, reqCode, sentIntent, piFlags);
                PendingIntent dPi = PendingIntent.getBroadcast(context, reqCode + 10000, deliveryIntent, piFlags);

                int rc;
                if (subId >= 0) {
                    rc = SmsSender.sendViaSubIdWithTracking(context, to, msg, subId, sPi, dPi);
                } else {
                    rc = SmsSender.sendWithTracking(context, to, msg, sPi, dPi);
                }
                if (rc != SmsSender.RESULT_OK) { status = "failed"; error = "SMS send error"; }
            } catch (Exception e) {
                status = "failed";
                error  = e.getMessage() != null ? e.getMessage() : "send exception";
            }

            try {
                JSONObject r = new JSONObject();
                r.put("id", id);
                r.put("status", status);
                r.put("sim_slot", simSlot);
                if (!error.isEmpty()) r.put("error", error);
                results.put(r);
            } catch (Exception ignored) {}

            // Log on the phone UI.
            MessageLog.add(context, new MessageLog.Entry(
                    to, msg, status.equals("sent") ? "ok" : "error",
                    status.equals("sent") ? "Sent (pulled)" : ("Failed: " + error)));
            context.sendBroadcast(new Intent("com.flashsms.LOG_UPDATED"));

            try { Thread.sleep(SEND_GAP_MS); } catch (InterruptedException ie) { return; }
        }

        // ACK everything we attempted.
        if (results.length() > 0) {
            try {
                JSONObject body = new JSONObject();
                body.put("results", results);
                httpPost(base + "/api/gateway/outbound/ack", token, body.toString());
            } catch (Exception e) {
                Log.w(TAG, "Ack failed: " + e.getMessage());
            }
        }
    }

    /**
     * Called by GatewayService when network becomes available after a drop.
     * Resets the backoff timer so the next poll happens immediately.
     */
    public void onNetworkAvailable() {
        if (consecutiveFailures > 0) {
            Log.d(TAG, "Network restored — resetting backoff");
            consecutiveFailures = 0;
            currentBackoffMs = 0;
        }
    }

    private void recordFailure() {
        consecutiveFailures++;
        // Exponential backoff: 5s -> 10s -> 20s -> 30s (max)
        long backoff = POLL_INTERVAL_MS * (long) Math.pow(2, Math.min(consecutiveFailures - 1, 3));
        currentBackoffMs = Math.min(backoff, MAX_BACKOFF_MS);
        Log.w(TAG, consecutiveFailures + " consecutive failure(s), backoff=" + currentBackoffMs + "ms");
    }

    private String token() {
        SharedPreferences prefs = context.getSharedPreferences("settings", Context.MODE_PRIVATE);
        return prefs.getString(InboundSmsReceiver.PREF_INBOUND_TOKEN, "");
    }

    // ── HTTP helpers ──────────────────────────────────────────────────

    private String httpGet(String url, String token) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URI(url).toURL().openConnection();
        conn.setRequestMethod("GET");
        conn.setRequestProperty("Authorization", "Bearer " + token);
        conn.setConnectTimeout(TIMEOUT_MS);
        conn.setReadTimeout(TIMEOUT_MS);
        conn.connect();
        int code = conn.getResponseCode();
        if (code != 200) { conn.disconnect(); throw new Exception("HTTP " + code); }
        String out = readBody(conn);
        conn.disconnect();
        return out;
    }

    private void httpPost(String url, String token, String jsonBody) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URI(url).toURL().openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Authorization", "Bearer " + token);
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setDoOutput(true);
        conn.setConnectTimeout(TIMEOUT_MS);
        conn.setReadTimeout(TIMEOUT_MS);
        try (OutputStream os = conn.getOutputStream()) {
            os.write(jsonBody.getBytes(StandardCharsets.UTF_8));
        }
        int code = conn.getResponseCode();
        conn.disconnect();
        if (code != 200) throw new Exception("HTTP " + code);
    }

    private String readBody(HttpURLConnection conn) throws Exception {
        BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) sb.append(line);
        reader.close();
        return sb.toString();
    }
}
