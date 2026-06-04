package com.flashsms.gateway;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
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
        main.post(pollRunnable);
        Log.d(TAG, "Outbound poller started");
    }

    public void stop() {
        running = false;
        main.removeCallbacks(pollRunnable);
        if (executor != null) { executor.shutdownNow(); executor = null; }
        Log.d(TAG, "Outbound poller stopped");
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
                int rc = FlashSmsSender.send(context, to, msg, false);
                if (rc != FlashSmsSender.RESULT_OK) { status = "failed"; error = "SMS send error"; }
            } catch (Exception e) {
                status = "failed";
                error  = e.getMessage() != null ? e.getMessage() : "send exception";
            }

            try {
                JSONObject r = new JSONObject();
                r.put("id", id);
                r.put("status", status);
                if (!error.isEmpty()) r.put("error", error);
                results.put(r);
            } catch (Exception ignored) {}

            // Log on the phone UI.
            MessageLog.add(context, new MessageLog.Entry(
                    to, msg, false, status.equals("sent") ? "ok" : "error",
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
