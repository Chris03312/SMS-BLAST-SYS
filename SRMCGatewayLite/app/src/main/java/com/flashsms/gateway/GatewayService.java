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
        // Android 14 (API 34): MUST pass the type flag or throws MissingForegroundServiceTypeException.
        // Android 10–13 (API 29–33): accepts the 3-arg overload but type is not strictly required.
        // Android 9 and below (API < 29): 3-arg overload does not exist, use 2-arg.
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // API 29+ — pass type flag
                startForeground(NOTIF_ID,
                        buildNotification("Checking SMS server\u2026"),
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                // API 28 and below                        startForeground(NOTIF_ID, buildNotification("Checking SMS server\u2026"));
            }
        } catch (Exception e) {
            Log.e(TAG, "startForeground failed: " + e.getMessage(), e);
            // Last resort fallback — try without type
            try { startForeground(NOTIF_ID, buildNotification("Checking SMS server\u2026")); }
            catch (Exception ignored) {}
        }

        ServerChecker.check(getApplicationContext(), (online, message) -> {
            if (!online) {
                Log.w(TAG, "SMS server offline \u2014 gateway blocked. " + message);
                updateNotification("\u26a0 SMS server offline \u2014 gateway stopped");
                isRunning = false;
                Intent bc = new Intent(ACTION_SERVER_OFFLINE);
                bc.putExtra("reason", message);
                sendBroadcast(bc);
                stopSelf();
                return;
            }

            if (!isRunning) {
                try {
                    isRunning = true;
                    String srvAddr = ServerConfig.getBaseUrl(getApplicationContext());
                    updateNotification("\u2713 Connected to: " + srvAddr);
                    Log.d(TAG, "Gateway started — SMS server OK @ " + srvAddr);

                    // ── Start PULL outbound poller ───────────────────────────
                    outboundPoller = new OutboundPoller(getApplicationContext());
                    outboundPoller.start();

                    // ── Start PUSH HTTP server ────────────────────────────────
                    // Listens for incoming POST /send and GET /health requests
                    // from the central server (URL + token mode).
                    startHttpServer();

                    sendBroadcast(new Intent(ACTION_GATEWAY_STARTED));
                } catch (Exception e) {
                    Log.e(TAG, "Failed to start gateway: " + e.getMessage(), e);
                    isRunning = false;
                    updateNotification("\u26a0 Failed: " + e.getMessage());
                    stopSelf();
                }
            }
        });

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
        if (wakeLock == null) {
            wakeLock = pm.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    "SMSGateway::GatewayWakeLock");
            // Acquire with a timeout so the lock doesn't run indefinitely
            // on low-end devices where battery is precious. 10 min = 600000ms
            wakeLock.acquire(600_000);
            Log.d(TAG, "WakeLock acquired (10 min timeout)");
        }
    }

    private void releaseWakeLock() {
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
            updateNotification("\u2713 " + sHttpUrl + " | " + ServerConfig.getBaseUrl(getApplicationContext()));
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