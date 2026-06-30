package com.flashsms.gateway;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.telephony.SmsManager;
import android.util.Log;
import android.app.Activity;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * SmsDeliveryReceiver
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles delivery report intents fired by {@link android.telephony.SmsManager}
 * when the carrier sends back a status for a sent SMS.
 *
 * Delivery reports are unreliable — many carriers don't send them or only send
 * them for certain traffic types. But when they DO arrive, this receiver logs
 * the result and POSTs it to the server so the dashboard can show real
 * delivery status instead of assuming "sent" means "delivered".
 *
 * Registered dynamically by OutboundPoller with a per-message unique request
 * code so results can be mapped back to the original message.
 *
 * Intent extras:
 *   message_id  — the server-side message UUID
 *   to_number   — the recipient phone number
 *   sim_slot    — 1 or 2, which SIM slot was used
 */
public class SmsDeliveryReceiver extends BroadcastReceiver {

    private static final String TAG = "SmsDeliveryReceiver";

    public static final String ACTION_SENT     = "com.flashsms.SMS_SENT";
    public static final String ACTION_DELIVERY = "com.flashsms.SMS_DELIVERED";

    @Override
    public void onReceive(Context context, Intent intent) {
        final String action = intent.getAction();
        final String messageId = intent.getStringExtra("message_id");
        final String toNumber  = intent.getStringExtra("to_number");
        final int simSlot      = intent.getIntExtra("sim_slot", 1);
        final String gwId      = intent.getStringExtra("gateway_id");

        if (messageId == null) return;

        final int resultCode = getResultCode();

        if (ACTION_SENT.equals(action)) {
            // Sent intent — message was handed to the carrier's SMSC.
            // This fires for every SMS regardless of SIM load.
            // Only report if there's an actual send failure.
            if (resultCode != Activity.RESULT_OK) {
                String err = describeError(resultCode);
                Log.w(TAG, "⚠ Send failed for " + messageId + " → " + toNumber + ": " + err);
                reportToServer(context, messageId, toNumber, "failed", err, simSlot);
            }
        } else if (ACTION_DELIVERY.equals(action)) {
            // Delivery intent — carrier confirmed delivery or failure.
            // This is the one that matters for detecting no-load SIMs.
            if (resultCode == Activity.RESULT_OK) {
                Log.d(TAG, "✅ Delivered " + messageId + " → " + toNumber);
                reportToServer(context, messageId, toNumber, "delivered", null, simSlot);
            } else {
                String err = describeError(resultCode);
                Log.w(TAG, "❌ Delivery failed for " + messageId + " → " + toNumber + ": " + err);
                reportToServer(context, messageId, toNumber, "delivery_failed", err, simSlot);
            }
        }
    }

    private String describeError(int code) {
        switch (code) {
            case SmsManager.RESULT_ERROR_GENERIC_FAILURE: return "generic_failure";
            case SmsManager.RESULT_ERROR_NO_SERVICE:      return "no_service";
            case SmsManager.RESULT_ERROR_NULL_PDU:        return "null_pdu";
            case SmsManager.RESULT_ERROR_RADIO_OFF:       return "radio_off";
            default: return "code_" + code;
        }
    }

    private void reportToServer(Context context, String messageId, String toNumber,
                                 String status, String error, int simSlot) {
        try {
            SharedPreferences prefs = context.getSharedPreferences("settings", Context.MODE_PRIVATE);
            String token = prefs.getString(InboundSmsReceiver.PREF_INBOUND_TOKEN, "");
            if (token.isEmpty()) {
                Log.w(TAG, "No token — cannot report delivery");
                return;
            }
            String baseUrl = ServerConfig.getBaseUrl(context);
            if (baseUrl.isEmpty()) return;

            JSONObject body = new JSONObject();
            body.put("message_id", messageId);
            body.put("to_number", toNumber);
            body.put("status", status);
            if (error != null) body.put("error", error);
            body.put("sim_slot", simSlot);

            byte[] bodyBytes = body.toString().getBytes(StandardCharsets.UTF_8);

            HttpURLConnection conn = (HttpURLConnection)
                    new URL(baseUrl + "/api/gateway/delivery-report").openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Authorization", "Bearer " + token);
            conn.setDoOutput(true);
            conn.setConnectTimeout(10_000);
            conn.setReadTimeout(10_000);

            try (OutputStream os = conn.getOutputStream()) {
                os.write(bodyBytes);
            }

            int code = conn.getResponseCode();
            if (code != 200) {
                Log.w(TAG, "Delivery report HTTP " + code + " for " + messageId);
            }
            conn.disconnect();

        } catch (Exception e) {
            Log.e(TAG, "Failed to report delivery: " + e.getMessage());
        }
    }
}
