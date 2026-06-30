package com.flashsms.gateway;

import android.content.Context;
import android.content.SharedPreferences;

import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;

import java.lang.reflect.Type;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

public class MessageLog {

    private static final String PREFS_NAME = "sms_log";
    private static final String KEY_LOG    = "log";
    private static final int    MAX_ENTRIES = 100;

    private static final Gson gson = new Gson();

    // ── Entry model ──────────────────────────────────────────────────

    public static class Entry {
        public String to;
        public String message;
        public String status;   // "ok" | "error"
        public String note;
        public String timestamp;

        public Entry(String to, String message, String status, String note) {
            this.to        = to;
            this.message   = message;
            this.status    = status;
            this.note      = note;
            this.timestamp = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault())
                                 .format(new Date());
        }
    }

    // ── Read / Write ─────────────────────────────────────────────────

    public static List<Entry> load(Context ctx) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String json = prefs.getString(KEY_LOG, "[]");
        Type type = new TypeToken<List<Entry>>(){}.getType();
        List<Entry> list = gson.fromJson(json, type);
        return list != null ? list : new ArrayList<>();
    }

    public static void add(Context ctx, Entry entry) {
        List<Entry> list = load(ctx);
        list.add(0, entry); // newest first
        if (list.size() > MAX_ENTRIES) list = list.subList(0, MAX_ENTRIES);
        save(ctx, list);
    }

    public static void clear(Context ctx) {
        save(ctx, new ArrayList<>());
    }

    private static void save(Context ctx, List<Entry> list) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_LOG, gson.toJson(list)).apply();
    }

    // ── JSON for HTTP API ────────────────────────────────────────────

    public static String toJson(Context ctx) {
        return gson.toJson(load(ctx));
    }
}
