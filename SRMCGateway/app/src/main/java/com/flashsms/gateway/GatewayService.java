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
    private boolean serverCheckFailed = false;
    private Handler retryHandler;
    private Runnable retryRunnable;
    private int retryBackoffSec = 5;

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

        checkServerWithRetry();

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
            // Acquire permanently — the SMS gateway must stay awake to
            // receive and send SMS. A renewal timer re-acquires every
            // 5 minutes as a safety net against OS-induced release.
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
        if (retryHandler != null) {
            retryHandler.removeCallbacks(retryRunnable);
            retryHandler = null;
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

    // ── Server check with retry ────────────────────────────────────

    private void checkServerWithRetry() {
        serverCheckFailed = false;
        retryBackoffSec = 5;
        doServerCheck();
    }

    private void doServerCheck() {
        ServerChecker.check(getApplicationContext(), (online, message) -> {
            if (!online) {
                Log.w(TAG, "SMS server unreachable: " + message);
                updateNotification("\u26a0 Server unreachable — retrying in " + retryBackoffSec + "s");
                if (!isRunning) {
                    serverCheckFailed = true;
                    // Don't kill the service — retry with exponential backoff
                    scheduleServerRetry();
                }
                return;
            }

            // Reset retry backoff on any successful server contact
            retryBackoffSec = 5;

            if (!isRunning) {
                try {
                    isRunning = true;
                    serverCheckFailed = false;
                    String srvAddr = ServerConfig.getBaseUrl(getApplicationContext());
                    updateNotification("\u2713 Connected to: " + srvAddr);
                    Log.d(TAG, "Gateway started \u2014 SMS server OK @ " + srvAddr);

                    // \u2500\u2500 Start PULL outbound poller \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
                    outboundPoller = new OutboundPoller(getApplicationContext());
                    outboundPoller.start();

                    // \u2500\u2500 Start PUSH HTTP server \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
                    startHttpServer();

                    sendBroadcast(new Intent(ACTION_GATEWAY_STARTED));
                } catch (Exception e) {
                    Log.e(TAG, "Failed to start gateway: " + e.getMessage(), e);
                    isRunning = false;
                    updateNotification("\u26a0 Failed: " + e.getMessage());
                    scheduleServerRetry();
                }
            } else {
                // Already running but server check passed — just update notification
                serverCheckFailed = false;
                updateNotification("\u2713 " + (GatewayService.getHttpUrl().isEmpty() ? "" : GatewayService.getHttpUrl() + " | ") + ServerConfig.getBaseUrl(getApplicationContext()));
            }
        });
    }

    private void scheduleServerRetry() {
        if (retryHandler == null) {
            retryHandler = new Handler(Looper.getMainLooper());
        }
        retryHandler.removeCallbacks(retryRunnable);
        retryRunnable = () -> {
            Log.d(TAG, "Retrying server check (backoff: " + retryBackoffSec + "s)");
            doServerCheck();
            // Exponential backoff: 5s -> 10s -> 20s -> 30s (max)
            retryBackoffSec = Math.min(retryBackoffSec * 2, 30);
        };
        retryHandler.postDelayed(retryRunnable, retryBackoffSec * 1000L);
    }

    // \u2500\u2500 Connectivity change receiver \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    // Detects WiFi / mobile data reconnection and re-checks the server.

    private void registerConnectivityReceiver() {
        unregisterConnectivityReceiver();
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return;
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                Log.d(TAG, "Network available \u2014 re-checking server");
                // Brief delay to let the network stack settle
                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                    if (!isRunning) {
                        doServerCheck();
                    } else {
                        // Re-notify outbound poller that network is back
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

            @Override
            public void onCapabilitiesChanged(Network network, NetworkCapabilities capabilities) {
                if (capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) {
                    Log.d(TAG, "Internet capability restored");
                }
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