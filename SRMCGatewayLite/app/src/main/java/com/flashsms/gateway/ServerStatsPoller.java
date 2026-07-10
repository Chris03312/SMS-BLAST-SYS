package com.flashsms.gateway;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URI;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Polls the SRMC SMS Server for live dashboard data.
 *
 * Global endpoints (admin-level):
 *   GET /api/admin/stats  → { totalSent, totalFailed, totalQueued, totalUsers }
 *   GET /api/status       → { canceled, message }
 *
 * User-scoped endpoint (per logged-in user):
 *   GET /api/user/stats/:userId
 *     → { success: true, data: { userId, userName, sentToday, phone } }
 *
 * Results are always delivered on the main thread via the Callback.
 */
public class ServerStatsPoller {

    private static final String TAG        = "ServerStatsPoller";
    private static final int    TIMEOUT_MS = 6_000;

    /** How often to re-poll while the gateway is running (ms). */
    public static final long POLL_INTERVAL_MS = 15_000;

    // ── Data model ────────────────────────────────────────────────────

    public static class Stats {
        public int     totalSent      = 0;
        public int     totalFailed    = 0;
        public int     totalQueued    = 0;
        public int     totalUsers     = 0;
        public boolean sendingActive  = true;
        public String  sendingMessage = "";

        /** Number of SMS sent TODAY by the currently logged-in user. */
        public int     userSentToday   = 0;
        /** Number of SMS failed TODAY by the currently logged-in user. */
        public int     userFailedToday = 0;
        /** Number of SMS queued for the currently logged-in user. */
        public int     userQueuedToday = 0;
        /** Active phone number for the logged-in user (may be empty). */
        public String  userPhone       = "";

        public boolean fetchError     = false;
        public String  errorMessage   = "";
    }

    public interface Callback {
        void onStats(Stats stats);
    }

    // ── Internal state ────────────────────────────────────────────────

    private final Context         context;
    private final Callback        callback;
    private final Handler         main     = new Handler(Looper.getMainLooper());
    private       ExecutorService executor;
    private       boolean         running  = false;

    /** Set by MainActivity after login — used to fetch user-scoped stats. */
    private String userId = "";

    private final Runnable pollRunnable = new Runnable() {
        @Override public void run() {
            if (!running) return;
            fetchAndDeliver();
            main.postDelayed(this, POLL_INTERVAL_MS);
        }
    };

    public ServerStatsPoller(Context context, Callback callback) {
        this.context  = context.getApplicationContext();
        this.callback = callback;
    }

    // ── Public API ────────────────────────────────────────────────────

    /** Set the logged-in user ID before calling start(). */
    public void setUserId(String userId) {
        this.userId = (userId != null) ? userId.trim() : "";
    }

    public void start() {
        if (running) return;
        running  = true;
        executor = Executors.newSingleThreadExecutor();
        main.post(pollRunnable);
    }

    public void stop() {
        running = false;
        main.removeCallbacks(pollRunnable);
        if (executor != null) {
            executor.shutdownNow();
            executor = null;
        }
    }

    public void pollNow() {
        if (executor == null || executor.isShutdown()) {
            executor = Executors.newSingleThreadExecutor();
        }
        executor.execute(this::fetchAndDeliver);
    }

    // ── Fetch logic ───────────────────────────────────────────────────

    private void fetchAndDeliver() {
        Stats  stats = new Stats();
        String base  = ServerConfig.getBaseUrl(context);

        try {
            // 1. Sending status
            String statusJson = httpGet(base + "/api/stats/status");
            JSONObject statusObj = new JSONObject(statusJson);
            stats.sendingActive  = !statusObj.optBoolean("canceled", false);
            stats.sendingMessage = statusObj.optString("message", "");

            // 2. User-scoped stats — sent, failed, queued for THIS user only
            if (!userId.isEmpty()) {
                try {
                    String userJson = httpGet(base + "/api/stats/user/stats/" + userId);
                    JSONObject userObj = new JSONObject(userJson);
                    if (userObj.optBoolean("success", false)) {
                        JSONObject uData = userObj.getJSONObject("data");
                        stats.userSentToday   = uData.optInt("sentToday",   0);
                        stats.userFailedToday = uData.optInt("failedToday", 0);
                        stats.userQueuedToday = uData.optInt("queuedToday", 0);
                        stats.userPhone       = uData.optString("phone",    "");
                        // Mirror into total fields so MainActivity display code works unchanged
                        stats.totalSent   = stats.userSentToday;
                        stats.totalFailed = stats.userFailedToday;
                        stats.totalQueued = stats.userQueuedToday;
                    } else {
                        stats.fetchError   = true;
                        stats.errorMessage = userObj.optString("message", "Stats unavailable");
                    }
                } catch (Exception userEx) {
                    Log.w(TAG, "User stats fetch failed: " + userEx.getMessage());
                    stats.fetchError   = true;
                    stats.errorMessage = userEx.getMessage();
                }
            }

        } catch (Exception e) {
            Log.w(TAG, "Poll failed for base=" + base + " | " + e.getMessage());
            stats.fetchError   = true;
            stats.errorMessage = e.getMessage();
        }

        final Stats finalStats = stats;
        main.post(() -> callback.onStats(finalStats));
    }

    // ── HTTP helper ───────────────────────────────────────────────────

    private String httpGet(String url) throws Exception {
        HttpURLConnection conn =
                (HttpURLConnection) new URI(url).toURL().openConnection();
        conn.setRequestMethod("GET");
        conn.setConnectTimeout(TIMEOUT_MS);
        conn.setReadTimeout(TIMEOUT_MS);
        conn.connect();

        int code = conn.getResponseCode();
        if (code != 200) throw new Exception("HTTP " + code);

        BufferedReader reader = new BufferedReader(
                new InputStreamReader(conn.getInputStream()));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) sb.append(line);
        conn.disconnect();
        return sb.toString();
    }
}
