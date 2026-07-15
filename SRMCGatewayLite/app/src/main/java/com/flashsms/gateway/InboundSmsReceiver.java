package com.flashsms.gateway;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.telephony.SmsMessage;
import android.util.Log;

import org.json.JSONObject;



import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * InboundSmsReceiver
 * ─────────────────────────────────────────────────────────────────────────────
 * Intercepts every incoming SMS on the device and forwards it to the server
 * server so it can be stored and shown in the agent/admin dashboards.
 *
 * URL: ALWAYS uses the LAN URL (http://<serverIp>:<serverPort>/api/inbound).
 *      The stored inbound_webhook_url (returned by heartbeat when ngrok is
 *      active) is meant for the SERVER to reach the PHONE for outbound push,
 *      NOT for the phone to reach the server. Always using the LAN URL avoids
 *      stale / misconfigured ngrok URLs and 401 auth issues.
 *
 * AUTH: No auth required. The Lite app sends the unauthenticated format
 *       { from, body, gateway_id } and the server skips auth validation.
 */
public class InboundSmsReceiver extends BroadcastReceiver {

    private static final String TAG = "InboundSmsReceiver";

    // SharedPreference keys (written by LoginActivity after login)
    public static final String PREF_INBOUND_TOKEN   = "inbound_token";
    public static final String PREF_INBOUND_WEBHOOK = "inbound_webhook_url";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!"android.provider.Telephony.SMS_RECEIVED".equals(intent.getAction())) return;

        Bundle bundle = intent.getExtras();
        if (bundle == null) return;

        Object[] pdus = (Object[]) bundle.get("pdus");
        if (pdus == null || pdus.length == 0) return;

        String format = bundle.getString("format");
        boolean useNewApi = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && format != null;

        StringBuilder body = new StringBuilder();
        String sender = null;

        // Detect which SIM received this SMS. Android puts the subscription ID
        // (1 = SIM1, 2 = SIM2) directly in the SMS_RECEIVED intent extras.
        int subscriptionId = bundle.getInt("subscription", 0);

        for (Object pdu : pdus) {
            SmsMessage msg = useNewApi
                ? SmsMessage.createFromPdu((byte[]) pdu, format)
                : SmsMessage.createFromPdu((byte[]) pdu);
            if (msg == null) continue;
            if (sender == null) sender = msg.getDisplayOriginatingAddress();
            body.append(msg.getMessageBody());
        }

        if (sender == null || body.length() == 0) return;

        final String finalSender  = sender;
        final String finalMessage = body.toString();
        final int finalSubId      = subscriptionId;

        Log.d(TAG, "📨 Inbound SMS from " + finalSender + " (SIM" + (finalSubId >= 1 ? finalSubId : "?") + ") — forwarding to server");

        // Always use a background thread in BroadcastReceiver
        new Thread(() -> forwardToServer(context, finalSender, finalMessage, finalSubId)).start();

        // Show toast so user can see on screen that SMS was intercepted
        String shortMsg = finalMessage.length() > 30 ? finalMessage.substring(0, 30) + "…" : finalMessage;
        android.widget.Toast.makeText(context.getApplicationContext(),
                "📨 Forwarding: " + finalSender + " — " + shortMsg,
                android.widget.Toast.LENGTH_SHORT).show();
    }

    private void forwardToServer(Context context, String sender, String message, int simSlot) {
        SharedPreferences prefs = context.getSharedPreferences("settings", Context.MODE_PRIVATE);

        String token = prefs.getString(PREF_INBOUND_TOKEN, "");

        // Always use the LAN URL for forwarding inbound SMS to the server.
        // The stored inbound_webhook_url (e.g. ngrok URL) is for the server to
        // reach the phone (outbound push), NOT for the phone to reach the server.
        // Using the LAN URL avoids stale URLs, misconfiguration, and auth issues.
        String webhookUrl = ServerConfig.getBaseUrl(context) + "/api/inbound";

        Log.d(TAG, "→ POST " + webhookUrl);

        try {
            JSONObject payload = new JSONObject();
            byte[] bodyBytes;

            // Two payload formats supported by the server:
            //   1. Authenticated (requires Bearer token): { sender, message }
            //   2. Unauthenticated (no token needed):      { from, body }
            //
            // The Lite gateway has no login flow, so it never gets an inbound_token.
            // Use the unauthenticated format ({ from, body }) when no token is stored.
            // When a token IS available (e.g. configured via external setup), use the
            // authenticated format for better security.
            if (token.isEmpty()) {
                // No token — use unauthenticated format (server skips auth validation)
                payload.put("from",    sender);
                payload.put("body",    message);
                // Send the device ID as gateway_id so the server can link the
                // inbound message to the gateway's owner (agent who added it).
                String deviceId = prefs.getString("device_id", "");
                payload.put("gateway_id", deviceId.isEmpty() ? "" : deviceId);
                if (simSlot >= 1) payload.put("sim_slot", simSlot);
                Log.d(TAG, "No inbound token — using unauthenticated format with gateway_id=" + (deviceId.isEmpty() ? "" : deviceId.substring(0, 8) + "…"));
            } else {
                // Token available — use authenticated format
                payload.put("sender",  sender);
                payload.put("message", message);
                if (simSlot >= 1) payload.put("sim_slot", simSlot);
            }
            bodyBytes = payload.toString().getBytes(StandardCharsets.UTF_8);

            HttpURLConnection conn = (HttpURLConnection) new URL(webhookUrl).openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            if (!token.isEmpty()) {
                conn.setRequestProperty("Authorization", "Bearer " + token);
            }
            conn.setDoOutput(true);
            conn.setConnectTimeout(15_000);
            conn.setReadTimeout(15_000);

            try (OutputStream os = conn.getOutputStream()) {
                os.write(bodyBytes);
            }

            int code = conn.getResponseCode();
            String responseBody = code >= 400 ? readErrorBody(conn) : "";
            if (code < 400) {
                Log.d(TAG, "✅ Server responded HTTP " + code);
                // Toast success
                showToast(context, "✅ SMS forwarded to server (HTTP " + code + ")");
            } else {
                Log.w(TAG, "⚠ Server responded HTTP " + code + " — " + responseBody);
                showToast(context, "❌ Server returned HTTP " + code);
            }
            conn.disconnect();

        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to forward inbound SMS: " + e.getMessage(), e);
            showToast(context, "❌ Failed: " + e.getMessage());
        }
    }

    /** Show a brief toast on the UI thread. */
    private void showToast(Context context, String message) {
        try {
            android.os.Handler mainHandler = new android.os.Handler(context.getMainLooper());
            mainHandler.post(() -> android.widget.Toast.makeText(context, message, android.widget.Toast.LENGTH_SHORT).show());
        } catch (Exception ignored) {}
    }

    /** Read error stream for debug logging. */
    private String readErrorBody(HttpURLConnection conn) {
        try {
            java.io.BufferedReader reader = new java.io.BufferedReader(
                    new java.io.InputStreamReader(conn.getErrorStream(), StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) sb.append(line);
            reader.close();
            return sb.toString().length() > 200 ? sb.substring(0, 200) : sb.toString();
        } catch (Exception e) {
            return "";
        }
    }
}
