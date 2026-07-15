package com.flashsms.gateway;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

public class GatewayService extends Service {

    private static final String TAG      = "GatewayService";
    private static final String CHANNEL  = "gateway_channel";
    private static final int    NOTIF_ID = 1;

    public static final String ACTION_SERVER_OFFLINE  = "com.flashsms.SERVER_OFFLINE";
    public static final String ACTION_GATEWAY_STARTED = "com.flashsms.GATEWAY_STARTED";

    private OutboundPoller      outboundPoller;
    private GatewayHttpServer    httpServer;
    private NotificationManager notificationManager;
    private PowerManager.WakeLock wakeLock;
    private ConnectivityManager.NetworkCallback networkCallback;
    private Handler wakeLockHandler;
    private Runnable wakeLockRenewRunnable;

    // Periodic heartbeat for Lite app (no login, but needs keepalive)
    private Handler heartbeatHandler;
    private Runnable heartbeatRunnable;
    private static final long HEARTBEAT_INTERVAL_MS = 60_000;

    public static volatile boolean isRunning = false;
    private static volatile String sHttpUrl = "";

    /** The URL where this gateway's HTTP server is reachable, e.g. http://192.168.1.5:8088 */
    public static String getHttpUrl() { return sHttpUrl; }

    @Override
    public void onCreate() {
        super.onCreate();
        notificationManager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            createNotificationChannel();
        }
        acquireWakeLock();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Call startForeground immediately — must happen within 5 seconds of service start.
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIF_ID,
                        buildNotification("Starting gateway\u2026"),
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(NOTIF_ID, buildNotification("Starting gateway\u2026"));
            }
        } catch (Exception e) {
            Log.e(TAG, "startForeground failed: " + e.getMessage(), e);
            try { startForeground(NOTIF_ID, buildNotification("Starting gateway\u2026")); }
            catch (Exception ignored) {}
        }

        if (!isRunning) {
            try {
                isRunning = true;

                // ── Start PULL outbound poller ───────────────────────────
                outboundPoller = new OutboundPoller(getApplicationContext());
                outboundPoller.start();

                // ── Start PUSH HTTP server ────────────────────────────────
                startHttpServer();

                // ── Start periodic heartbeat ──────────────────────────────
                startHeartbeat();

                updateNotification("\u2713 Gateway running");
                Log.d(TAG, "Gateway started — push + pull mode");
                sendBroadcast(new Intent(ACTION_GATEWAY_STARTED));
            } catch (Exception e) {
                Log.e(TAG, "Failed to start gateway: " + e.getMessage(), e);
                isRunning = false;
                updateNotification("\u26a0 Failed: " + e.getMessage());
                stopSelf();
            }
        }

        registerConnectivityReceiver();

        return START_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        Log.d(TAG, "Task removed \u2014 scheduling gateway restart");

        Intent restartIntent = new Intent(getApplicationContext(), GatewayService.class);

        // FLAG_IMMUTABLE is required on Android 12+ (API 31+)
        int flags = PendingIntent.FLAG_ONE_SHOT |
                (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);

        PendingIntent pi = PendingIntent.getService(
                getApplicationContext(), 1, restartIntent, flags);

        AlarmManager am = (AlarmManager) getSystemService(ALARM_SERVICE);
        if (am != null) {
            am.set(AlarmManager.ELAPSED_REALTIME,
                    SystemClock.elapsedRealtime() + 1000L, pi);
        }
    }

    @Override
    public void onDestroy() {
        stopWakeLockRenewal();
        stopHeartbeat();
        unregisterConnectivityReceiver();
        if (outboundPoller != null) {
            outboundPoller.stop();
            outboundPoller = null;
        }
        if (httpServer != null) {
            httpServer.stop();
            httpServer = null;
        }
        isRunning = false;
        sHttpUrl = "";
        releaseWakeLock();
        super.onDestroy();
        Log.d(TAG, "Gateway stopped");
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    private void acquireWakeLock() {
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm == null) return;
        if (wakeLock == null || !wakeLock.isHeld()) {
            if (wakeLock == null) {
                wakeLock = pm.newWakeLock(
                        PowerManager.PARTIAL_WAKE_LOCK,
                        "SMSGateway::GatewayWakeLock");
            }
            // Acquire permanently — renewal timer re-acquires every 5 minutes
            // as a safety net against OS-induced release.
            wakeLock.acquire();
            Log.d(TAG, "WakeLock acquired (permanent)");
        }
        startWakeLockRenewal();
    }

    private void startWakeLockRenewal() {
        stopWakeLockRenewal();
        wakeLockHandler = new Handler(Looper.getMainLooper());
        wakeLockRenewRunnable = () -> {
            if (wakeLock != null && wakeLock.isHeld()) {
                try {
                    wakeLock.release();
                } catch (Exception ignored) {}
            }
            acquireWakeLock();
            wakeLockHandler.postDelayed(wakeLockRenewRunnable, 5 * 60 * 1000L);
        };
        wakeLockHandler.postDelayed(wakeLockRenewRunnable, 5 * 60 * 1000L);
        Log.d(TAG, "WakeLock renewal scheduled (every 5 min)");
    }

    private void stopWakeLockRenewal() {
        if (wakeLockHandler != null) {
            wakeLockHandler.removeCallbacks(wakeLockRenewRunnable);
            wakeLockHandler = null;
        }
    }

    private void releaseWakeLock() {
        stopWakeLockRenewal();
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
            wakeLock = null;
            Log.d(TAG, "WakeLock released");
        }
    }

    private void createNotificationChannel() {
        if (notificationManager == null) return;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel ch = new NotificationChannel(
                CHANNEL, "SMS Gateway", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("SMS Gateway service");
        ch.setShowBadge(false);
        notificationManager.createNotificationChannel(ch);
    }

    private Notification buildNotification(String text) {
        Intent tap = new Intent(this, MainActivity.class);

        // FLAG_IMMUTABLE required on Android 12+ (API 31+)
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT |
                (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);

        PendingIntent pi = PendingIntent.getActivity(this, 0, tap, piFlags);

        return new NotificationCompat.Builder(this, CHANNEL)
                .setContentTitle("SMS Gateway")
                .setContentText(text)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentIntent(pi)
                .setOngoing(true)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                .build();
    }

    // ── Periodic heartbeat ────────────────────────────────────────────
    // Keeps the gateway marked as online on the server.

    private void startHeartbeat() {
        stopHeartbeat();
        heartbeatHandler = new Handler(Looper.getMainLooper());
        heartbeatRunnable = new Runnable() {
            @Override
            public void run() {
                sendHeartbeat();
                heartbeatHandler.postDelayed(this, HEARTBEAT_INTERVAL_MS);
            }
        };
        // Send first heartbeat immediately
        new Thread(this::sendHeartbeat).start();
        heartbeatHandler.postDelayed(heartbeatRunnable, HEARTBEAT_INTERVAL_MS);
        Log.d(TAG, "Heartbeat started (every " + (HEARTBEAT_INTERVAL_MS / 1000) + "s)");
    }

    private void stopHeartbeat() {
        if (heartbeatHandler != null) {
            heartbeatHandler.removeCallbacks(heartbeatRunnable);
            heartbeatHandler = null;
        }
    }

    private void sendHeartbeat() {
        try {
            SharedPreferences prefs = getSharedPreferences("settings", MODE_PRIVATE);
            String serverUrl = prefs.getString("server_url", "");
            if (serverUrl.isEmpty()) return;

            String deviceId = prefs.getString("device_id", "");
            if (deviceId.isEmpty()) {
                deviceId = java.util.UUID.randomUUID().toString();
                prefs.edit().putString("device_id", deviceId).apply();
            }

            String sim1 = prefs.getString(SmsSender.PREF_SIM1_CARRIER, "");
            String sim2 = prefs.getString(SmsSender.PREF_SIM2_CARRIER, "");

            org.json.JSONObject body = new org.json.JSONObject();
            body.put("userId", deviceId);
            body.put("deviceId", deviceId);
            if (!sim1.isEmpty()) body.put("sim_carrier", sim1);
            if (!sim2.isEmpty()) body.put("sim2_carrier", sim2);

            java.net.HttpURLConnection conn = (java.net.HttpURLConnection)
                    new java.net.URL(serverUrl + "/api/auth/gateway/heartbeat").openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setDoOutput(true);
            conn.setConnectTimeout(8_000);
            conn.setReadTimeout(8_000);
            try (java.io.OutputStream os = conn.getOutputStream()) {
                os.write(body.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
            }

            int code = conn.getResponseCode();
            if (code < 400) {
                // Try to extract webhook URL from response
                try {
                    java.io.BufferedReader reader = new java.io.BufferedReader(
                            new java.io.InputStreamReader(conn.getInputStream(),
                                    java.nio.charset.StandardCharsets.UTF_8));
                    StringBuilder sb = new StringBuilder();
                    String line;
                    while ((line = reader.readLine()) != null) sb.append(line);
                    String responseBody = sb.toString();
                    org.json.JSONObject resp = new org.json.JSONObject(responseBody);
                    String webhookUrl = resp.optString("inbound_webhook_url", "");
                    // Always store (even if empty) so InboundSmsReceiver can
                    // fall back to the LAN URL instead of using a stale URL.
                    prefs.edit().putString("inbound_webhook_url", webhookUrl).apply();
                } catch (Exception ignored) {}
            }
            conn.disconnect();
        } catch (Exception e) {
            Log.w(TAG, "Heartbeat failed: " + e.getMessage());
        }
    }

    // ── Connectivity change receiver ─────────────────────────────────
    // Detects WiFi / mobile data reconnection and ensures the gateway
    // re-registers with the server.

    private void registerConnectivityReceiver() {
        unregisterConnectivityReceiver();
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return;
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                Log.d(TAG, "Network available \u2014 sending heartbeat");
                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                    if (isRunning) {
                        sendHeartbeat();
                        if (outboundPoller != null) {
                            outboundPoller.onNetworkAvailable();
                        }
                    }
                }, 2000);
            }

            @Override
            public void onLost(Network network) {
                Log.w(TAG, "Network lost");
                updateNotification("\u26a0 Network lost \u2014 waiting for reconnection");
            }
        };
        NetworkRequest request = new NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build();
        cm.registerNetworkCallback(request, networkCallback);
        Log.d(TAG, "Connectivity callback registered");
    }

    private void unregisterConnectivityReceiver() {
        if (networkCallback != null) {
            try {
                ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
                if (cm != null) {
                    cm.unregisterNetworkCallback(networkCallback);
                }
            } catch (Exception e) {
                Log.w(TAG, "Unregister connectivity: " + e.getMessage());
            }
            networkCallback = null;
        }
    }

    // ── HTTP server (PUSH mode) ──────────────────────────────────────

    private void startHttpServer() {
        try {
            SharedPreferences prefs = getSharedPreferences("settings", MODE_PRIVATE);
            int httpPort = prefs.getInt("port", 8088);
            if (httpPort < 1024 || httpPort > 65535) httpPort = 8088;
            String apiKey = prefs.getString("api_key", "");

            httpServer = new GatewayHttpServer(getApplicationContext(), httpPort, apiKey);
            httpServer.start();

            // Compute the reachable URL
            String localIp = getLocalIp();
            sHttpUrl = "http://" + localIp + ":" + httpPort;

            Log.d(TAG, "PUSH HTTP server at " + sHttpUrl);
            updateNotification("\u2713 " + sHttpUrl);
        } catch (Exception e) {
            Log.e(TAG, "Failed to start HTTP server: " + e.getMessage());
        }
    }

    private String getLocalIp() {
        try {
            for (java.net.NetworkInterface ni :
                    java.util.Collections.list(java.net.NetworkInterface.getNetworkInterfaces())) {
                for (java.net.InetAddress addr :
                        java.util.Collections.list(ni.getInetAddresses())) {
                    if (!addr.isLoopbackAddress() && addr instanceof java.net.Inet4Address) {
                        return addr.getHostAddress();
                    }
                }
            }
        } catch (Exception ignored) {}
        return "0.0.0.0";
    }

    @SuppressLint("MissingPermission")
    private void updateNotification(String text) {
        if (notificationManager == null) return;
        // POST_NOTIFICATIONS runtime permission only enforced on Android 13+ (API 33)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) return;
        }
        notificationManager.notify(NOTIF_ID, buildNotification(text));
    }
}