package com.flashsms.gateway;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import java.net.HttpURLConnection;
import java.net.URI;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Pings the SRMC SMS Server at GET /api/ping.
 * The callback is always delivered on the main thread.
 */
public class ServerChecker {

    private static final String TAG        = "ServerChecker";
    private static final int    TIMEOUT_MS = 5_000;

    public interface Callback {
        void onResult(boolean online, String message);
    }

    public static void check(Context ctx, Callback callback) {
        String pingUrl = ServerConfig.getPingUrl(ctx);
        ExecutorService exec = Executors.newSingleThreadExecutor();
        Handler main = new Handler(Looper.getMainLooper());

        exec.execute(() -> {
            boolean online = false;
            String  msg    = "Server unreachable";
            try {
                // URI.toURL() avoids the deprecated new URL(String) constructor
                HttpURLConnection conn =
                        (HttpURLConnection) new URI(pingUrl).toURL().openConnection();
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(TIMEOUT_MS);
                conn.setReadTimeout(TIMEOUT_MS);
                conn.connect();
                int code = conn.getResponseCode();
                if (code == 200) {
                    online = true;
                    msg    = "Server online (" + ServerConfig.getBaseUrl(ctx) + ")";
                } else {
                    msg = "Server returned HTTP " + code;
                }
                conn.disconnect();
            } catch (Exception e) {
                Log.w(TAG, "Ping failed: " + e.getMessage());
                msg = "Cannot reach " + pingUrl;
            }
            final boolean fo = online;
            final String  fm = msg;
            main.post(() -> callback.onResult(fo, fm));
        });

        exec.shutdown();
    }
}
