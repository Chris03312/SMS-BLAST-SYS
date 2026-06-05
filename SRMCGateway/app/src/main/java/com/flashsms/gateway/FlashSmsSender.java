package com.flashsms.gateway;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.telephony.SmsManager;
import android.util.Log;

import java.lang.reflect.Method;
import java.util.ArrayList;

/**
 * FlashSmsSender
 *
 * Sends flash SMS (Class 0) by building a raw GSM PDU with the
 * Data Coding Scheme (DCS) byte set to 0x10, then invoking the
 * hidden sendRawPdu method on SmsManager via reflection.
 *
 * PDU format: GSM 03.40 / 3GPP TS 23.040
 *
 * DCS byte 0x10 breakdown:
 *   Bit 7-6 : 00  = General Data Coding
 *   Bit 5   : 0   = no compression
 *   Bit 4   : 1   = message class present
 *   Bit 3-2 : 00  = GSM 7-bit default alphabet
 *   Bit 1-0 : 00  = Class 0 (flash - show popup, do not save)
 *
 * Falls back to regular Class 1 SMS if reflection fails.
 */
public class FlashSmsSender {

    private static final String TAG = "FlashSmsSender";

    public static final int RESULT_OK            = 0;
    public static final int RESULT_ERROR_GENERIC = 1;

    // SharedPreferences keys for dual SIM
    public static final String PREF_SIM1_SUB_ID = "sim1_subscription_id";
    public static final String PREF_SIM2_SUB_ID = "sim2_subscription_id";
    public static final String PREF_SIM1_CARRIER = "sim1_carrier";
    public static final String PREF_SIM2_CARRIER = "sim2_carrier";
    public static final String PREF_SIM_ALTERNATE_INDEX = "sim_alternate_index";
    public static final String PREF_DUAL_SIM_ENABLED = "dual_sim_enabled";

    // ── Public entry points ───────────────────────────────────────────

    /**
     * Send an SMS. If flash=true, attempts Class 0 (popup).
     * Uses the default SIM (SIM 1) or configured single SIM.
     */
    public static int send(Context ctx, String toNumber, String message, boolean flash) {
        if (flash) {
            return sendFlash(ctx, toNumber, message, getDefaultSubId(ctx));
        } else {
            return sendRegular(ctx, toNumber, message, getDefaultSubId(ctx), null, null);
        }
    }

    /**
     * Send an SMS with delivery tracking PendingIntents.
     * Uses the default SIM (SIM 1) or configured single SIM.
     */
    public static int sendWithTracking(Context ctx, String toNumber, String message,
                                        boolean flash,
                                        android.app.PendingIntent sentIntent,
                                        android.app.PendingIntent deliveryIntent) {
        if (flash) {
            return sendFlash(ctx, toNumber, message, getDefaultSubId(ctx));
        } else {
            return sendRegular(ctx, toNumber, message, getDefaultSubId(ctx), sentIntent, deliveryIntent);
        }
    }

    /**
     * Send an SMS via a specific subscription (SIM) ID.
     */
    public static int sendViaSubId(Context ctx, String toNumber, String message, boolean flash, int subId) {
        if (flash) {
            return sendFlash(ctx, toNumber, message, subId);
        } else {
            return sendRegular(ctx, toNumber, message, subId, null, null);
        }
    }

    /**
     * Automatically alternate between SIM 1 and SIM 2 for each call.
     */
    public static int sendAlternating(Context ctx, String toNumber, String message, boolean flash) {
        int subId = getAlternatingSubId(ctx);
        if (flash) {
            return sendFlash(ctx, toNumber, message, subId);
        } else {
            return sendRegular(ctx, toNumber, message, subId);
        }
    }

    /**
     * Send two messages concurrently — one via SIM 1, one via SIM 2.
     * Returns results array: [sim1Result, sim2Result]
     */
    public static int[] sendBothSims(Context ctx, String to1, String msg1, String to2, String msg2, boolean flash) {
        final int[] results = new int[2];
        final Thread t1 = new Thread(() -> {
            int subId1 = getSim1SubId(ctx);
            results[0] = flash ? sendFlash(ctx, to1, msg1, subId1) : sendRegular(ctx, to1, msg1, subId1);
        });
        final Thread t2 = new Thread(() -> {
            int subId2 = getSim2SubId(ctx);
            results[1] = flash ? sendFlash(ctx, to2, msg2, subId2) : sendRegular(ctx, to2, msg2, subId2);
        });
        t1.start();
        t2.start();
        try { t1.join(30000); } catch (InterruptedException e) { results[0] = RESULT_ERROR_GENERIC; }
        try { t2.join(30000); } catch (InterruptedException e) { results[1] = RESULT_ERROR_GENERIC; }
        return results;
    }

    // ── Flash SMS (Class 0 via hidden API + reflection) ──────────────

    private static int sendFlash(Context ctx, String toNumber, String message, int subId) {
        try {
            byte[] pdu = buildPdu(toNumber, message);
            SmsManager smsManager = getSmsManager(ctx, subId);

            Method sendRaw = SmsManager.class.getDeclaredMethod(
                    "sendRawPdu",
                    byte[].class,
                    byte[].class,
                    android.app.PendingIntent.class,
                    android.app.PendingIntent.class,
                    boolean.class
            );
            sendRaw.setAccessible(true);
            // smsc=null uses SIM default, persistMessage=false keeps it out of inbox
            sendRaw.invoke(smsManager, null, pdu, null, null, false);

            Log.d(TAG, "Flash SMS sent to " + toNumber + " (subId=" + subId + ")");
            return RESULT_OK;

        } catch (Exception e) {
            Log.e(TAG, "Flash SMS failed, falling back to regular: " + e.getMessage());
            return sendRegular(ctx, toNumber, message, subId);
        }
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
                // Multi-part — sendMultipartTextMessage is deprecated in API 31+
                // Use reflection to call the non-deprecated internal version
                try {
                    Method sendMulti = SmsManager.class.getDeclaredMethod(
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

            Log.d(TAG, "Regular SMS sent to " + toNumber + " (subId=" + subId + ")");
            return RESULT_OK;
        } catch (Exception e) {
            Log.e(TAG, "Regular SMS failed: " + e.getMessage() + " (subId=" + subId + ")");
            return RESULT_ERROR_GENERIC;
        }
    }

    /** Helper to wrap a single PendingIntent into an ArrayList for the reflective multi-part call. */
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

    /** Check if dual SIM is enabled in prefs. */
    public static boolean isDualSimEnabled(Context ctx) {
        return getPrefs(ctx).getBoolean(PREF_DUAL_SIM_ENABLED, false)
                && getSim2SubId(ctx) >= 0;
    }

    /**
     * Get the next alternating subscription ID (round-robin).
     * Every call returns the opposite SIM from the previous call.
     */
    public static int getAlternatingSubId(Context ctx) {
        SharedPreferences prefs = getPrefs(ctx);
        int sim1 = prefs.getInt(PREF_SIM1_SUB_ID, -1);
        int sim2 = prefs.getInt(PREF_SIM2_SUB_ID, -1);

        if (sim2 < 0) return sim1; // No SIM 2 configured
        if (sim1 < 0) return sim2; // No SIM 1 configured

        int idx = prefs.getInt(PREF_SIM_ALTERNATE_INDEX, 0);
        int next = (idx % 2 == 0) ? sim1 : sim2;
        prefs.edit().putInt(PREF_SIM_ALTERNATE_INDEX, idx + 1).apply();
        return next;
    }

    // ── PDU Builder ──────────────────────────────────────────────────

    /**
     * Builds a GSM PDU byte array for a Class 0 (flash) SMS.
     *
     * Structure:
     *   [SMSC len=0] [PDU-TYPE] [MR] [DA len] [DA TOA] [DA digits BCD]
     *   [PID] [DCS=0x10] [VP] [UDL] [UD packed 7-bit]
     */
    private static byte[] buildPdu(String number, String message) {
        String digits = number.startsWith("+") ? number.substring(1) : number;
        byte[] da  = encodeAddress(digits);
        byte[] ud  = encodeGsm7bit(message);
        int    udl = message.length(); // septets, not bytes

        // PDU-TYPE 0x11:
        //   bit 1-0 = 01  SMS-SUBMIT
        //   bit 4-3 = 10  relative validity period present
        byte pduType = 0x11;
        byte mr      = 0x00;         // message reference - carrier assigns
        byte pid     = 0x00;         // protocol identifier - plain SMS
        byte dcs     = 0x10;         // data coding scheme - Class 0 flash
        byte vp      = (byte) 0xAA;  // validity period - ~1 day relative

        int totalLen = 1 + 1 + 1 + da.length + 1 + 1 + 1 + 1 + ud.length;
        byte[] pdu = new byte[totalLen];
        int i = 0;

        pdu[i++] = 0x00; // SMSC length = 0 (use SIM default)
        pdu[i++] = pduType;
        pdu[i++] = mr;
        for (byte b : da) pdu[i++] = b;
        pdu[i++] = pid;
        pdu[i++] = dcs;
        pdu[i++] = vp;
        pdu[i++] = (byte) udl;
        for (byte b : ud) pdu[i++] = b;

        return pdu;
    }

    /**
     * Encode phone number digits into GSM PDU address bytes.
     * Format: [length in digits] [type-of-address] [BCD swapped pairs]
     */
    private static byte[] encodeAddress(String digits) {
        byte toa = (byte) 0x91; // international format

        // Pad to even length with 'F' filler nibble
        String padded = (digits.length() % 2 == 0) ? digits : digits + "F";
        byte[] bcd    = new byte[padded.length() / 2];

        for (int i = 0; i < padded.length(); i += 2) {
            int lo = digitVal(padded.charAt(i));
            int hi = digitVal(padded.charAt(i + 1));
            bcd[i / 2] = (byte) ((hi << 4) | lo);
        }

        byte[] result = new byte[2 + bcd.length];
        result[0] = (byte) digits.length();
        result[1] = toa;
        System.arraycopy(bcd, 0, result, 2, bcd.length);
        return result;
    }

    private static int digitVal(char c) {
        if (c == 'F' || c == 'f') return 0x0F;
        return Character.digit(c, 10);
    }

    /**
     * Pack a String into GSM 7-bit septets.
     * 8 characters pack into 7 bytes.
     */
    private static byte[] encodeGsm7bit(String text) {
        if (text.length() > 160) text = text.substring(0, 160);

        int len    = text.length();
        int packed = (len * 7 + 7) / 8;
        byte[] out = new byte[packed];

        int carry     = 0;
        int carryBits = 0;
        int outIdx    = 0;

        for (int i = 0; i < len; i++) {
            int septet = gsm7bitCode(text.charAt(i));
            carry     |= (septet << carryBits);
            carryBits += 7;

            if (carryBits >= 8) {
                out[outIdx++] = (byte) (carry & 0xFF);
                carry       >>= 8;
                carryBits    -= 8;
            }
        }

        if (carryBits > 0 && outIdx < packed) {
            out[outIdx] = (byte) (carry & 0xFF);
        }

        return out;
    }

    /**
     * Map a Unicode character to its GSM 03.38 default alphabet index.
     * Characters not in the table are replaced with '?' (0x3F).
     */
    private static int gsm7bitCode(char c) {
        // GSM 03.38 default alphabet - index = GSM code point value
        final char[] TABLE = {
                '@',      '\u00a3', '$',      '\u00a5', '\u00e8', '\u00e9', '\u00f9', '\u00ec',
                '\u00f2', '\u00c7', '\n',     '\u00d8', '\u00f8', '\r',     '\u00c5', '\u00e5',
                '\u0394', '_',      '\u03a6', '\u0393', '\u039b', '\u03a9', '\u03a0', '\u03a8',
                '\u03a3', '\u0398', '\u039e', '\u001b', '\u00c6', '\u00e6', '\u00df', '\u00c9',
                ' ',      '!',      '"',      '#',      '\u00a4', '%',      '&',      '\'',
                '(',      ')',      '*',      '+',      ',',      '-',      '.',      '/',
                '0',      '1',      '2',      '3',      '4',      '5',      '6',      '7',
                '8',      '9',      ':',      ';',      '<',      '=',      '>',      '?',
                '\u00a1', 'A',      'B',      'C',      'D',      'E',      'F',      'G',
                'H',      'I',      'J',      'K',      'L',      'M',      'N',      'O',
                'P',      'Q',      'R',      'S',      'T',      'U',      'V',      'W',
                'X',      'Y',      'Z',      '\u00c4', '\u00d6', '\u00d1', '\u00dc', '\u00a7',
                '\u00bf', 'a',      'b',      'c',      'd',      'e',      'f',      'g',
                'h',      'i',      'j',      'k',      'l',      'm',      'n',      'o',
                'p',      'q',      'r',      's',      't',      'u',      'v',      'w',
                'x',      'y',      'z',      '\u00e4', '\u00f6', '\u00f1', '\u00fc', '\u00e0'
        };

        for (int i = 0; i < TABLE.length; i++) {
            if (TABLE[i] == c) return i;
        }
        return 0x3F; // '?' for characters outside GSM alphabet
    }
}