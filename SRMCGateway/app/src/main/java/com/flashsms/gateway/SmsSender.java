package com.flashsms.gateway;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.telephony.SmsManager;
import android.util.Log;

import java.util.ArrayList;

/**
 * SmsSender
 *
 * Sends regular SMS via the Android SmsManager with
 * single-SIM and dual-SIM support (SIM 1 Only or SIM 2 Only).
 */
public class SmsSender {

    private static final String TAG = "SmsSender";

    public static final int RESULT_OK            = 0;
    public static final int RESULT_ERROR_GENERIC = 1;

    // SharedPreferences keys for dual SIM
    public static final String PREF_SIM1_SUB_ID = "sim1_subscription_id";
    public static final String PREF_SIM2_SUB_ID = "sim2_subscription_id";
    public static final String PREF_SIM1_CARRIER = "sim1_carrier";
    public static final String PREF_SIM2_CARRIER = "sim2_carrier";

    public static final String PREF_SIM_MODE = "sim_mode";

    // SIM mode values
    public static final String SIM_MODE_SIM1_ONLY = "sim1";
    public static final String SIM_MODE_SIM2_ONLY = "sim2";

    // ── Public entry points ───────────────────────────────────────────

    /**
     * Send an SMS via the default SIM.
     */
    public static int send(Context ctx, String toNumber, String message) {
        return sendRegular(ctx, toNumber, message, getDefaultSubId(ctx), null, null);
    }

    /**
     * Send an SMS with delivery tracking PendingIntents.
     * Uses the default SIM (SIM 1) or configured single SIM.
     */
    public static int sendWithTracking(Context ctx, String toNumber, String message,
                                        android.app.PendingIntent sentIntent,
                                        android.app.PendingIntent deliveryIntent) {
        return sendRegular(ctx, toNumber, message, getDefaultSubId(ctx), sentIntent, deliveryIntent);
    }

    /**
     * Send an SMS via a specific subscription (SIM) ID with delivery tracking.
     * Used by OutboundPoller when dual SIM is enabled.
     */
    public static int sendViaSubIdWithTracking(Context ctx, String toNumber, String message,
                                                int subId,
                                                android.app.PendingIntent sentIntent,
                                                android.app.PendingIntent deliveryIntent) {
        return sendRegular(ctx, toNumber, message, subId, sentIntent, deliveryIntent);
    }

    /**
     * Send an SMS via a specific subscription (SIM) ID.
     */
    public static int sendViaSubId(Context ctx, String toNumber, String message, int subId) {
        return sendRegular(ctx, toNumber, message, subId, null, null);
    }

    // ── Regular SMS (Class 1) ────────────────────────────────────────

    private static int sendRegular(Context ctx, String toNumber, String message, int subId,
                                   android.app.PendingIntent sentIntent,
                                   android.app.PendingIntent deliveryIntent) {
        try {
            SmsManager smsManager = getSmsManager(ctx, subId);
            ArrayList<String> parts = smsManager.divideMessage(message);

            if (parts.size() == 1) {
                // Single part — use sendTextMessage (not deprecated)
                smsManager.sendTextMessage(toNumber, null, parts.get(0), sentIntent, deliveryIntent);
            } else {
                // MULTI-PART — sendMultipartTextMessage is deprecated in API 31+
                // Use reflection to call the non-deprecated internal version
                try {
                    java.lang.reflect.Method sendMulti = SmsManager.class.getDeclaredMethod(
                            "sendMultipartTextMessage",
                            String.class,
                            String.class,
                            ArrayList.class,
                            ArrayList.class,
                            ArrayList.class,
                            String.class,
                            String.class
                    );
                    sendMulti.setAccessible(true);
                    sendMulti.invoke(smsManager, toNumber, null, parts,
                            sentIntent != null ? getList(sentIntent) : null,
                            deliveryIntent != null ? getList(deliveryIntent) : null,
                            null, null);
                } catch (Exception ex) {
                    // Reflection fallback — call the deprecated version directly
                    // This is suppressed intentionally; no non-deprecated public API exists
                    smsManager.sendMultipartTextMessage(toNumber, null, parts, null, null);
                }
            }

            Log.d(TAG, "SMS sent to " + toNumber + " (subId=" + subId + ")");
            return RESULT_OK;
        } catch (Exception e) {
            Log.e(TAG, "SMS failed: " + e.getMessage() + " (subId=" + subId + ")");
            return RESULT_ERROR_GENERIC;
        }
    }

    /** Helper to wrap a single PendingIntent into an ArrayList for the reflective MULTI-PART call. */
    private static ArrayList<android.app.PendingIntent> getList(android.app.PendingIntent pi) {
        ArrayList<android.app.PendingIntent> list = new ArrayList<>(1);
        list.add(pi);
        return list;
    }

    // ── SmsManager factory ───────────────────────────────────────────

    /**
     * Returns the SmsManager for a specific subscription ID.
     * Falls back to system default if the subId is invalid.
     */
    private static SmsManager getSmsManager(Context ctx, int subId) {
        if (subId >= 0) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1) {
                    return SmsManager.getSmsManagerForSubscriptionId(subId);
                }
            } catch (Exception e) {
                Log.w(TAG, "Could not get SmsManager for subId " + subId + ": " + e.getMessage());
            }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return ctx.getSystemService(SmsManager.class);
        } else {
            return SmsManager.getDefault();
        }
    }

    // ── SIM preference helpers ───────────────────────────────────────

    private static SharedPreferences getPrefs(Context ctx) {
        return ctx.getSharedPreferences("settings", Context.MODE_PRIVATE);
    }

    /** Get the default (first/subscription 0) SIM subId, or -1. */
    public static int getDefaultSubId(Context ctx) {
        int sim1 = getSim1SubId(ctx);
        if (sim1 >= 0) return sim1;
        return -1;
    }

    /** Get SIM 1 subscription ID from prefs. */
    public static int getSim1SubId(Context ctx) {
        return getPrefs(ctx).getInt(PREF_SIM1_SUB_ID, -1);
    }

    /** Get SIM 2 subscription ID from prefs. */
    public static int getSim2SubId(Context ctx) {
        return getPrefs(ctx).getInt(PREF_SIM2_SUB_ID, -1);
    }

    /** Get the current SIM mode: sim1 or sim2. Defaults to sim1. */
    public static String getSimMode(Context ctx) {
        return getPrefs(ctx).getString(PREF_SIM_MODE, SIM_MODE_SIM1_ONLY);
    }

}