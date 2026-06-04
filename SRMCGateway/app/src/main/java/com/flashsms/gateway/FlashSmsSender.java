package com.flashsms.gateway;

import android.content.Context;
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

    // ── Public entry point ───────────────────────────────────────────

    /**
     * Send an SMS. If flash=true, attempts Class 0 (popup).
     * Automatically falls back to regular SMS on any failure.
     */
    public static int send(Context ctx, String toNumber, String message, boolean flash) {
        if (flash) {
            return sendFlash(ctx, toNumber, message);
        } else {
            return sendRegular(ctx, toNumber, message);
        }
    }

    // ── Flash SMS (Class 0 via hidden API + reflection) ──────────────

    private static int sendFlash(Context ctx, String toNumber, String message) {
        try {
            byte[] pdu = buildPdu(toNumber, message);
            SmsManager smsManager = getSmsManager(ctx);

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

            Log.d(TAG, "Flash SMS sent to " + toNumber);
            return RESULT_OK;

        } catch (Exception e) {
            Log.e(TAG, "Flash SMS failed, falling back to regular: " + e.getMessage());
            return sendRegular(ctx, toNumber, message);
        }
    }

    // ── Regular SMS (Class 1) ────────────────────────────────────────

    private static int sendRegular(Context ctx, String toNumber, String message) {
        try {
            SmsManager smsManager = getSmsManager(ctx);
            ArrayList<String> parts = smsManager.divideMessage(message);

            if (parts.size() == 1) {
                // Single part — use sendTextMessage (not deprecated)
                smsManager.sendTextMessage(toNumber, null, parts.get(0), null, null);
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
                    sendMulti.invoke(smsManager, toNumber, null, parts, null, null, null, null);
                } catch (Exception ex) {
                    // Reflection fallback — call the deprecated version directly
                    // This is suppressed intentionally; no non-deprecated public API exists
                    smsManager.sendMultipartTextMessage(toNumber, null, parts, null, null);
                }
            }

            Log.d(TAG, "Regular SMS sent to " + toNumber);
            return RESULT_OK;
        } catch (Exception e) {
            Log.e(TAG, "Regular SMS failed: " + e.getMessage());
            return RESULT_ERROR_GENERIC;
        }
    }

    // ── SmsManager factory ───────────────────────────────────────────

    /**
     * Returns the SmsManager for the SIM selected in Settings.
     * Reads 'sim_subscription_id' from SharedPreferences (saved when user picks a SIM).
     * Falls back to system default if not set.
     */
    private static SmsManager getSmsManager(Context ctx) {
        android.content.SharedPreferences prefs =
                ctx.getSharedPreferences("settings", Context.MODE_PRIVATE);
        int subId = prefs.getInt("sim_subscription_id", -1);

        if (subId != -1) {
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