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

    /** Unique request code counter for PendingIntents (per-process). */
    private final AtomicInteger requestCodeSeq = new AtomicInteger(1000);
    /** Dynamically registered receiver for sent/delivery intents. */
    private SmsDeliveryReceiver deliveryReceiver;
    private boolean receiverRegistered = false;

    /** Track which SIM to use next when dual SIM is enabled (0=SIM1, 1=SIM2). */
    private int simAlternateIndex = 0;

    /** Synchronization lock for collecting parallel send results. */
    private final Object parallelLock = new Object();

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
            main.postDelayed(this, POLL_INTERVAL_MS);
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
            if (!obj.optBoolean("success", false)) return;
            messages = obj.optJSONArray("messages");
        } catch (Exception e) {
            Log.w(TAG, "Claim failed: " + e.getMessage());
            return;
        }
        if (messages == null || messages.length() == 0) return;

        JSONArray results = new JSONArray();
        String simMode = SmsSender.getSimMode(context);
        boolean dualSim = SmsSender.getSim2SubId(context) >= 0;

        if (SmsSender.SIM_MODE_PARALLEL.equals(simMode) && dualSim && messages.length() > 1) {
            // ── PARALLEL MODE: split messages into two halves, send concurrently ──
            int mid = messages.length() / 2;
            final JSONArray parallelResults = new JSONArray();
            final java.util.concurrent.atomic.AtomicInteger threadsDone = new java.util.concurrent.atomic.AtomicInteger(0);

            // Thread 1: SIM 1 handles [0..mid)
            new Thread(() -> {
                for (int i = 0; i < mid && running; i++) {
                    JSONObject m = messages.optJSONObject(i);
                    if (m == null) continue;
                    String id  = m.optString("id", "");
                    String to  = m.optString("to", "");
                    String msg = m.optString("message", "");
                    if (id.isEmpty() || to.isEmpty()) continue;

                    int rc = SmsSender.sendViaSubId(context, to, msg, SmsSender.getSim1SubId(context));
                    String status = (rc == SmsSender.RESULT_OK) ? "sent" : "failed";
                    String error  = (rc != SmsSender.RESULT_OK) ? "SMS send error" : "";

                    synchronized (parallelLock) {
                        try {
                            JSONObject r = new JSONObject();
                            r.put("id", id); r.put("status", status); r.put("sim_slot", 1);
                            if (!error.isEmpty()) r.put("error", error);
                            parallelResults.put(r);
                        } catch (Exception ignored) {}
                    }

                    MessageLog.add(context, new MessageLog.Entry(
                            to, msg, status.equals("sent") ? "ok" : "error",
                            status.equals("sent") ? "Sent (parallel-SIM1)" : ("Failed: " + error)));
                    context.sendBroadcast(new Intent("com.flashsms.LOG_UPDATED"));

                    try { Thread.sleep(SEND_GAP_MS); } catch (InterruptedException ie) { break; }
                }
                threadsDone.incrementAndGet();
            }).start();

            // Thread 2: SIM 2 handles [mid..end)
            new Thread(() -> {
                for (int i = mid; i < messages.length() && running; i++) {
                    JSONObject m = messages.optJSONObject(i);
                    if (m == null) continue;
                    String id  = m.optString("id", "");
                    String to  = m.optString("to", "");
                    String msg = m.optString("message", "");
                    if (id.isEmpty() || to.isEmpty()) continue;

                    int rc = SmsSender.sendViaSubId(context, to, msg, SmsSender.getSim2SubId(context));
                    String status = (rc == SmsSender.RESULT_OK) ? "sent" : "failed";
                    String error  = (rc != SmsSender.RESULT_OK) ? "SMS send error" : "";

                    synchronized (parallelLock) {
                        try {
                            JSONObject r = new JSONObject();
                            r.put("id", id); r.put("status", status); r.put("sim_slot", 2);
                            if (!error.isEmpty()) r.put("error", error);
                            parallelResults.put(r);
                        } catch (Exception ignored) {}
                    }

                    MessageLog.add(context, new MessageLog.Entry(
                            to, msg, status.equals("sent") ? "ok" : "error",
                            status.equals("sent") ? "Sent (parallel-SIM2)" : ("Failed: " + error)));
                    context.sendBroadcast(new Intent("com.flashsms.LOG_UPDATED"));

                    try { Thread.sleep(SEND_GAP_MS); } catch (InterruptedException ie) { break; }
                }
                threadsDone.incrementAndGet();
            }).start();

            // Wait for both threads to finish (max 30s)
            try {
                for (int i = 0; i < 60 && threadsDone.get() < 2; i++) Thread.sleep(500);
            } catch (InterruptedException ignored) {}

            results = parallelResults;
        } else if (SmsSender.SIM_MODE_SIM2_ONLY.equals(simMode) && dualSim) {
            // ── SIM 2 ONLY MODE: all messages via SIM 2 ──
            int subId = SmsSender.getSim2SubId(context);
            for (int i = 0; i < messages.length() && running; i++) {
                JSONObject m = messages.optJSONObject(i);
                if (m == null) continue;
                String id  = m.optString("id", "");
                String to  = m.optString("to", "");
                String msg = m.optString("message", "");
                if (id.isEmpty() || to.isEmpty()) continue;

                String status = "sent";
                String error  = "";

                try {
                    int rc = SmsSender.sendViaSubId(context, to, msg, subId);
                    if (rc != SmsSender.RESULT_OK) { status = "failed"; error = "SMS send error"; }
                } catch (Exception e) {
                    status = "failed";
                    error  = e.getMessage() != null ? e.getMessage() : "send exception";
                }

                try {
                    JSONObject r = new JSONObject();
                    r.put("id", id); r.put("status", status); r.put("sim_slot", 2);
                    if (!error.isEmpty()) r.put("error", error);
                    results.put(r);
                } catch (Exception ignored) {}

                MessageLog.add(context, new MessageLog.Entry(
                        to, msg, status.equals("sent") ? "ok" : "error",
                        status.equals("sent") ? "Sent (SIM2 only)" : ("Failed: " + error)));
                context.sendBroadcast(new Intent("com.flashsms.LOG_UPDATED"));

                try { Thread.sleep(SEND_GAP_MS); } catch (InterruptedException ie) { return; }
            }
        } else {
            // ── SIM 1 (DEFAULT/SINGLE) / ROUND-ROBIN MODE: sequential sending ──
            for (int i = 0; i < messages.length() && running; i++) {
                JSONObject m = messages.optJSONObject(i);
                if (m == null) continue;
                String id  = m.optString("id", "");
                String to  = m.optString("to", "");
                String msg = m.optString("message", "");
                if (id.isEmpty() || to.isEmpty()) continue;

                // Determine which SIM slot to use
                int simSlot;
                int subId;

                if (SmsSender.SIM_MODE_ROUND_ROBIN.equals(simMode) && dualSim) {
                    // Round-robin: alternate SIM1 → SIM2 → SIM1
                    simAlternateIndex = 1 - simAlternateIndex;
                    if (simAlternateIndex == 0) {
                        subId = SmsSender.getSim1SubId(context);
                        simSlot = 1;
                    } else {
                        subId = SmsSender.getSim2SubId(context);
                        simSlot = 2;
                    }
                } else if (SmsSender.SIM_MODE_SIM2_ONLY.equals(simMode)) {
                    // SIM 2 only (fallback: single SIM path)
                    subId = SmsSender.getSim2SubId(context);
                    simSlot = 2;
                } else {
                    // SIM 1 only (single/sim1/default): use SIM 1
                    subId = SmsSender.getSim1SubId(context);
                    simSlot = 1;
                }

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
