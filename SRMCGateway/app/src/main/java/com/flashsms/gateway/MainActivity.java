package com.flashsms.gateway;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class MainActivity extends AppCompatActivity {

    private static final int REQ_PERMISSIONS = 100;
    private static final String PREF_DEVICE_ID = "device_id";
    /** Default port for the embedded HTTP gateway server. */
    private static final int GATEWAY_DEFAULT_PORT = 8088;

    // Tabs
    private LinearLayout btnTabDashboard, btnTabSettings;
    private LinearLayout layoutDashboard, layoutSettings;

    // Dashboard views
    private TextView     tvStatus, tvSentCount, tvFailCount, tvQueueCount;
    private TextView     tvSendingStatus, tvServerBanner, tvLastUpdated;
    private Button       btnToggle, btnClearLog;
    private RecyclerView recyclerView;
    private LogAdapter   logAdapter;

    // User info header
    private TextView tvWelcomeUser, tvUserRole, tvUserStatus;
    private Button   btnLogout;

    // User-scoped stats
    private TextView tvMySentCount;

    // Settings — gateway
    private TextView tvIpAddress, tvApiKey, tvSimSlot, tvSimCarrier;
    private TextView tvSim2Slot, tvSim2Carrier;
    private EditText etPort;

    // Settings — SMS server
    private EditText etSrmcIp, etSrmcPort;
    private Button   btnCheckServer;
    private TextView tvSrmcStatus;

    // Settings — Inbound webhook
    private TextView tvWebhookUrl;
    private Button   btnRegisterWebhook;
    private TextView tvWebhookStatus;

    private SharedPreferences prefs;

    // Live stats poller
    private ServerStatsPoller statsPoller;

    // Gateway heartbeat
    private java.util.concurrent.ScheduledExecutorService heartbeatExecutor;
    private static final long HEARTBEAT_INTERVAL_SEC = 60;

    // Logged-in user
    private String loggedInUserId;
    private String loggedInUserName;
    private String loggedInUserRole;
    private String loggedInUserStatus;

    // ── Broadcast receivers ───────────────────────────────────────────

    private final BroadcastReceiver logReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context ctx, Intent i) { refreshLog(); }
    };

    private final BroadcastReceiver serverOfflineReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context ctx, Intent i) {
            String reason = i.getStringExtra("reason");
            btnToggle.setEnabled(true);
            updateStatusUi();
            showBanner(reason != null ? reason : getString(R.string.msg_server_unreachable));
            statsPoller.stop();
        }
    };

    private final BroadcastReceiver gatewayStartedReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context ctx, Intent i) {
            btnToggle.setEnabled(true);
            updateStatusUi();
            hideBanner();
            statsPoller.start();
        }
    };

    // ── Lifecycle ─────────────────────────────────────────────────────

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        prefs = getSharedPreferences("settings", MODE_PRIVATE);

        if (!prefs.getBoolean(LoginActivity.PREF_LOGGED_IN, false)) {
            redirectToLogin();
            return;
        }

        loggedInUserId     = prefs.getString(LoginActivity.PREF_USER_ID,     "");
        loggedInUserName   = prefs.getString(LoginActivity.PREF_USER_NAME,   "");
        loggedInUserRole   = prefs.getString(LoginActivity.PREF_USER_ROLE,   "user");
        loggedInUserStatus = prefs.getString(LoginActivity.PREF_USER_STATUS, "Active");

        setContentView(R.layout.activity_main);

        bindViews();
        initRecycler();
        initTabs();

        // Detect SIMs FIRST so heartbeat has the data
        detectSims();

        initStatsPoller();
        startGatewayHeartbeat();
        setupUserHeader();

        // Now send immediate heartbeat — detectSims() has already run
        new Thread(() -> sendHeartbeat(loggedInUserId)).start();

        tvIpAddress.setText(getLocalIp());
        int savedPort = prefs.getInt("port", GATEWAY_DEFAULT_PORT);
        etPort.setText(String.valueOf(savedPort));

        etSrmcIp.setText(ServerConfig.getIp(this));
        etSrmcPort.setText(String.valueOf(ServerConfig.getPort(this)));

        String key = prefs.getString("api_key", "");
        if (key.isEmpty()) { key = generateApiKey(); prefs.edit().putString("api_key", key).apply(); }
        tvApiKey.setText(key);

        tvSimSlot.setText(R.string.label_sim1_slot);
        tvSim2Slot.setText(R.string.label_sim2_slot);

        listeners();
        detectSims();
        updateStatusUi();
        refreshLog();
        checkPermissions();
    }

    // ── User header ───────────────────────────────────────────────────

    private void setupUserHeader() {
        tvWelcomeUser.setText(getString(R.string.label_welcome_name, loggedInUserName));
        tvUserRole.setText(loggedInUserRole.equals("admin")
                ? R.string.label_role_admin
                : R.string.label_role_user);
        updateStatusBadge(loggedInUserStatus);
        btnLogout.setOnClickListener(v -> confirmLogout());
    }

    private void updateStatusBadge(String status) {
        boolean isActive = "Active".equalsIgnoreCase(status);
        tvUserStatus.setText(isActive ? R.string.label_active : R.string.label_inactive);
        tvUserStatus.setTextColor(isActive ? 0xFF4CAF50 : 0xFFAAAAAA);
    }

    private void confirmLogout() {
        new AlertDialog.Builder(this)
                .setTitle(R.string.dialog_logout_title)
                .setMessage(R.string.dialog_logout_message)
                .setPositiveButton(R.string.btn_logout, (d, w) -> performLogout())
                .setNegativeButton(R.string.btn_cancel, null)
                .show();
    }

    private void performLogout() {
        if (GatewayService.isRunning) {
            stopService(new Intent(this, GatewayService.class));
            statsPoller.stop();
        }

        stopGatewayHeartbeat();

        String userId = loggedInUserId;
        String offlineUrl = ServerConfig.getBaseUrl(this) + "/api/auth/gateway/offline";
        new Thread(() -> {
            try {
                org.json.JSONObject body = new org.json.JSONObject();
                body.put("userId", userId);
                java.net.HttpURLConnection conn =
                        (java.net.HttpURLConnection) new java.net.URI(offlineUrl).toURL().openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setConnectTimeout(5_000);
                conn.setReadTimeout(5_000);
                conn.setDoOutput(true);
                try (java.io.OutputStream os = conn.getOutputStream()) {
                    os.write(body.toString().getBytes(StandardCharsets.UTF_8));
                }
                conn.getResponseCode();
                conn.disconnect();
            } catch (Exception ignored) {}
        }).start();

        updateStatusBadge("Inactive");
        String url = ServerConfig.getBaseUrl(this) + "/api/auth/logout";
        new Thread(() -> {
            try {
                org.json.JSONObject body = new org.json.JSONObject();
                body.put("userId", userId);
                java.net.HttpURLConnection conn =
                        (java.net.HttpURLConnection) new java.net.URI(url).toURL().openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setConnectTimeout(5_000);
                conn.setReadTimeout(5_000);
                conn.setDoOutput(true);
                try (java.io.OutputStream os = conn.getOutputStream()) {
                    os.write(body.toString().getBytes(StandardCharsets.UTF_8));
                }
                conn.getResponseCode();
                conn.disconnect();
            } catch (Exception ignored) {}
        }).start();

        prefs.edit()
                .remove(LoginActivity.PREF_LOGGED_IN)
                .remove(LoginActivity.PREF_USER_ID)
                .remove(LoginActivity.PREF_USER_NAME)
                .remove(LoginActivity.PREF_USER_ROLE)
                .remove(LoginActivity.PREF_USER_STATUS)
                .remove("saved_password")
                .remove(InboundSmsReceiver.PREF_INBOUND_TOKEN)
                .remove(InboundSmsReceiver.PREF_INBOUND_WEBHOOK)
                .apply();

        redirectToLogin();
    }

    // ── Gateway Heartbeat ─────────────────────────────────────────────

    private void startGatewayHeartbeat() {
        stopGatewayHeartbeat();
        heartbeatExecutor = java.util.concurrent.Executors.newSingleThreadScheduledExecutor();
        heartbeatExecutor.scheduleWithFixedDelay(
                () -> sendHeartbeat(loggedInUserId),
                HEARTBEAT_INTERVAL_SEC, HEARTBEAT_INTERVAL_SEC,
                java.util.concurrent.TimeUnit.SECONDS);
        android.util.Log.d("MainActivity", "Heartbeat started for: " + loggedInUserId);
    }

    private void stopGatewayHeartbeat() {
        if (heartbeatExecutor != null && !heartbeatExecutor.isShutdown()) {
            heartbeatExecutor.shutdownNow();
            heartbeatExecutor = null;
        }
    }

    /** True only for a non-empty value that starts with http:// or https://. */
    private static boolean isValidHttpUrl(String url) {
        return url != null
                && (url.startsWith("http://") || url.startsWith("https://"));
    }

    private void refreshInboundWebhookUrl() {
        try {
            String configUrl = ServerConfig.getBaseUrl(this) + "/api/config";
            java.net.HttpURLConnection conn =
                    (java.net.HttpURLConnection) new java.net.URI(configUrl).toURL().openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(6_000);
            conn.setReadTimeout(6_000);

            java.io.BufferedReader reader = new java.io.BufferedReader(
                    new java.io.InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) sb.append(line);
            conn.disconnect();

            org.json.JSONObject cfg = new org.json.JSONObject(sb.toString());
            String webhookUrl = cfg.optString("INBOUND_WEBHOOK_URL", "");
            if (isValidHttpUrl(webhookUrl)) {
                getSharedPreferences("settings", MODE_PRIVATE)
                        .edit()
                        .putString(InboundSmsReceiver.PREF_INBOUND_WEBHOOK, webhookUrl)
                        .apply();

                runOnUiThread(() -> {
                    if (tvWebhookUrl != null) tvWebhookUrl.setText(webhookUrl);
                });

                android.util.Log.d("MainActivity", "📥 Inbound webhook refreshed: " + webhookUrl);
            }
        } catch (Exception e) {
            android.util.Log.w("MainActivity", "Could not refresh webhook URL: " + e.getMessage());
        }
    }

    /**
     * Tests the inbound webhook.
     * Step 1 (bg thread): refresh the webhook URL from /api/config + resolve token.
     * Step 2 (bg thread): POST test payload to the webhook URL.
     * Always uses the latest token from prefs — never sends an empty Bearer.
     */
    private void performWebhookTest() {
        tvWebhookStatus.setVisibility(View.VISIBLE);
        tvWebhookStatus.setText("⏳ Resolving token…");
        tvWebhookStatus.setTextColor(0xFFFFCC00);
        btnRegisterWebhook.setEnabled(false);

        new Thread(() -> {
            // ── Resolve webhook URL (always get latest from /api/config) ──
            String webhookUrl = prefs.getString(InboundSmsReceiver.PREF_INBOUND_WEBHOOK, "");
            try {
                String configUrl = ServerConfig.getBaseUrl(MainActivity.this) + "/api/config";
                java.net.HttpURLConnection c =
                        (java.net.HttpURLConnection) new java.net.URI(configUrl).toURL().openConnection();
                c.setRequestMethod("GET");
                c.setConnectTimeout(6_000);
                c.setReadTimeout(6_000);
                java.io.BufferedReader r = new java.io.BufferedReader(
                        new java.io.InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8));
                StringBuilder sb = new StringBuilder(); String ln;
                while ((ln = r.readLine()) != null) sb.append(ln);
                c.disconnect();
                String fromConfig = new org.json.JSONObject(sb.toString()).optString("INBOUND_WEBHOOK_URL", "");
                // Only trust a properly-formed http(s) URL — a misconfigured
                // server can return just the ngrok token (no scheme), which
                // would later blow up with "no protocol".
                if (isValidHttpUrl(fromConfig)) {
                    webhookUrl = fromConfig;
                    prefs.edit().putString(InboundSmsReceiver.PREF_INBOUND_WEBHOOK, webhookUrl).apply();
                }
            } catch (Exception ignored) {}

            // Fall back to the LAN endpoint if we have no usable URL (empty or
            // a malformed value cached from a previous bad config).
            if (!isValidHttpUrl(webhookUrl)) {
                webhookUrl = ServerConfig.getBaseUrl(MainActivity.this) + "/api/inbound";
            }

            // ── Resolve token (use stored pref; it was saved at gateway login) ──
            String token = prefs.getString(InboundSmsReceiver.PREF_INBOUND_TOKEN, "");

            if (token.isEmpty()) {
                final String noTokenMsg = "✘  No auth token found. Log out and log in again to refresh it.";
                runOnUiThread(() -> {
                    tvWebhookStatus.setText(noTokenMsg);
                    tvWebhookStatus.setTextColor(0xFFF44336);
                    tvWebhookStatus.setVisibility(View.VISIBLE);
                    btnRegisterWebhook.setEnabled(true);
                });
                return;
            }

            android.util.Log.d("MainActivity",
                    "Webhook test → " + webhookUrl + "  token=" + token.substring(0, Math.min(8, token.length())) + "…");

            // ── POST test payload ──────────────────────────────────────────
            String  resultText;
            int     resultColor;

            try {
                org.json.JSONObject payload = new org.json.JSONObject();
                payload.put("sender",  "WEBHOOK_TEST");
                payload.put("message", "✔ Webhook test from " + android.os.Build.MODEL);
                byte[] body = payload.toString().getBytes(StandardCharsets.UTF_8);

                java.net.HttpURLConnection conn =
                        (java.net.HttpURLConnection) new java.net.URL(webhookUrl).openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type",  "application/json");
                conn.setRequestProperty("Authorization", "Bearer " + token);
                conn.setDoOutput(true);
                conn.setConnectTimeout(12_000);
                conn.setReadTimeout(12_000);
                try (java.io.OutputStream os = conn.getOutputStream()) { os.write(body); }

                int code = conn.getResponseCode();
                java.io.BufferedReader reader = new java.io.BufferedReader(
                        new java.io.InputStreamReader(
                                code >= 400 ? conn.getErrorStream() : conn.getInputStream(),
                                StandardCharsets.UTF_8));
                StringBuilder sb = new StringBuilder(); String line;
                while ((line = reader.readLine()) != null) sb.append(line);
                conn.disconnect();

                try {
                    org.json.JSONObject resp = new org.json.JSONObject(sb.toString());
                    boolean ok = resp.optBoolean("success", false);
                    String  msg = resp.optString("message", sb.toString());
                    resultText  = (ok ? "✔" : "✘") + "  HTTP " + code + " — " + msg;
                    resultColor = ok ? 0xFF4CAF50 : 0xFFF44336;
                } catch (Exception pe) {
                    resultText  = "HTTP " + code + ": " + sb.toString().trim();
                    resultColor = code < 400 ? 0xFF4CAF50 : 0xFFF44336;
                }

            } catch (java.net.ConnectException ce) {
                resultText  = getString(R.string.msg_webhook_fail, "Connection refused — is server running?");
                resultColor = 0xFFF44336;
            } catch (java.net.SocketTimeoutException te) {
                resultText  = getString(R.string.msg_webhook_fail, "Timed out — check ngrok URL");
                resultColor = 0xFFF44336;
            } catch (Exception e) {
                resultText  = getString(R.string.msg_webhook_fail, e.getMessage());
                resultColor = 0xFFF44336;
            }

            final String finalText  = resultText;
            final int    finalColor = resultColor;
            runOnUiThread(() -> {
                tvWebhookStatus.setText(finalText);
                tvWebhookStatus.setTextColor(finalColor);
                tvWebhookStatus.setVisibility(View.VISIBLE);
                btnRegisterWebhook.setEnabled(true);
            });
        }).start();
    }

    /** Get this device's persistent unique ID. */
    private String getGatewayDeviceId() {
        String deviceId = prefs.getString(PREF_DEVICE_ID, "");
        if (deviceId.isEmpty()) {
            deviceId = java.util.UUID.randomUUID().toString();
            prefs.edit().putString(PREF_DEVICE_ID, deviceId).apply();
        }
        return deviceId;
    }

    private void sendHeartbeat(String userId) {
        if (userId == null || userId.isEmpty()) return;
        String url = ServerConfig.getBaseUrl(this) + "/api/auth/gateway/heartbeat";
        String deviceId = getGatewayDeviceId();
        try {
            org.json.JSONObject body = new org.json.JSONObject();
            body.put("userId", userId);
            body.put("deviceId", deviceId);

            // Include SIM carrier info from prefs
            String sim1 = prefs.getString(SmsSender.PREF_SIM1_CARRIER, "");
            String sim2 = prefs.getString(SmsSender.PREF_SIM2_CARRIER, "");
            if (!sim1.isEmpty()) body.put("sim_carrier", sim1);
            if (!sim2.isEmpty()) body.put("sim2_carrier", sim2);

            java.net.HttpURLConnection conn =
                    (java.net.HttpURLConnection) new java.net.URI(url).toURL().openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setConnectTimeout(5_000);
            conn.setReadTimeout(5_000);
            conn.setDoOutput(true);
            try (java.io.OutputStream os = conn.getOutputStream()) {
                os.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            conn.getResponseCode();
            conn.disconnect();

            refreshInboundWebhookUrl();

        } catch (Exception e) {
            android.util.Log.w("MainActivity", "Heartbeat failed: " + e.getMessage());
        }
    }

    private void redirectToLogin() {
        startActivity(new Intent(this, LoginActivity.class));
        finish();
    }

    // ── Stats poller ──────────────────────────────────────────────────

    private void initStatsPoller() {
        statsPoller = new ServerStatsPoller(this, stats -> {
            if (stats.fetchError) {
                tvSentCount    .setText(R.string.label_default_value);
                tvFailCount    .setText(R.string.label_default_value);
                tvQueueCount   .setText(R.string.label_default_value);
                tvMySentCount  .setText(R.string.label_default_value);
                tvSendingStatus.setText(R.string.msg_server_unreachable);
                tvSendingStatus.setTextColor(0xFFFF5B5B);
                tvLastUpdated  .setText(R.string.msg_last_update_failed);
            } else {
                tvSentCount .setText(String.valueOf(stats.totalSent));
                tvFailCount .setText(String.valueOf(stats.totalFailed));
                tvQueueCount.setText(String.valueOf(stats.totalQueued));
                tvMySentCount.setText(String.valueOf(stats.userSentToday));

                if (stats.sendingActive) {
                    tvSendingStatus.setText(R.string.msg_sending_active);
                    tvSendingStatus.setTextColor(0xFF4CAF50);
                } else {
                    tvSendingStatus.setText(R.string.msg_sending_canceled);
                    tvSendingStatus.setTextColor(0xFFFF5B5B);
                }

                java.text.SimpleDateFormat sdf =
                        new java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.getDefault());
                tvLastUpdated.setText(getString(R.string.msg_last_updated, sdf.format(new java.util.Date())));
                tvLastUpdated.setTextColor(0xFF555555);
            }
        });

        statsPoller.setUserId(loggedInUserId);
        // Stats are independent of the gateway — show immediately on login
        statsPoller.start();
    }

    // ── View binding ──────────────────────────────────────────────────

    private void bindViews() {
        btnTabDashboard = findViewById(R.id.btnTabDashboard);
        btnTabSettings  = findViewById(R.id.btnTabSettings);
        layoutDashboard = findViewById(R.id.layoutDashboard);
        layoutSettings  = findViewById(R.id.layoutSettings);

        tvServerBanner  = findViewById(R.id.tvServerBanner);
        tvStatus        = findViewById(R.id.tvStatus);
        tvSentCount     = findViewById(R.id.tvSentCount);
        tvFailCount     = findViewById(R.id.tvFailCount);
        tvQueueCount    = findViewById(R.id.tvQueueCount);
        tvSendingStatus = findViewById(R.id.tvSendingStatus);
        tvLastUpdated   = findViewById(R.id.tvLastUpdated);
        btnToggle       = findViewById(R.id.btnToggle);
        btnClearLog     = findViewById(R.id.btnClearLog);
        recyclerView    = findViewById(R.id.recyclerView);

        tvWelcomeUser = findViewById(R.id.tvWelcomeUser);
        tvUserRole    = findViewById(R.id.tvUserRole);
        tvUserStatus  = findViewById(R.id.tvUserStatus);
        btnLogout     = findViewById(R.id.btnLogout);

        tvMySentCount = findViewById(R.id.tvMySentCount);

        tvIpAddress  = findViewById(R.id.tvIpAddress);
        tvApiKey     = findViewById(R.id.tvApiKey);
        tvSimSlot    = findViewById(R.id.tvSimSlot);
        tvSimCarrier = findViewById(R.id.tvSimCarrier);
        tvSim2Slot    = findViewById(R.id.tvSim2Slot);
        tvSim2Carrier = findViewById(R.id.tvSim2Carrier);
        etPort        = findViewById(R.id.etPort);

        etSrmcIp       = findViewById(R.id.etSrmcIp);
        etSrmcPort     = findViewById(R.id.etSrmcPort);
        btnCheckServer = findViewById(R.id.btnCheckServer);
        tvSrmcStatus   = findViewById(R.id.tvSrmcStatus);

        // ── Inbound webhook views ─────────────────────────────────
        tvWebhookUrl       = findViewById(R.id.tvWebhookUrl);
        btnRegisterWebhook = findViewById(R.id.btnRegisterWebhook);
        tvWebhookStatus    = findViewById(R.id.tvWebhookStatus);

        // Populate webhook URL from stored prefs
        String storedWebhook = prefs.getString(InboundSmsReceiver.PREF_INBOUND_WEBHOOK, "");
        tvWebhookUrl.setText(storedWebhook.isEmpty()
                ? getString(R.string.label_webhook_url_placeholder)
                : storedWebhook);
    }

    private void initRecycler() {
        recyclerView.setLayoutManager(new LinearLayoutManager(this));
        logAdapter = new LogAdapter(MessageLog.load(this));
        recyclerView.setAdapter(logAdapter);
    }

    private void initTabs() {
        showDashboard();
        btnTabDashboard.setOnClickListener(v -> showDashboard());
        btnTabSettings .setOnClickListener(v -> showSettings());
    }

    private void showDashboard() {
        layoutDashboard.setVisibility(View.VISIBLE);
        layoutSettings .setVisibility(View.GONE);
        setNavTabActive(btnTabDashboard, true);
        setNavTabActive(btnTabSettings,  false);
    }

    private void showSettings() {
        layoutDashboard.setVisibility(View.GONE);
        layoutSettings .setVisibility(View.VISIBLE);
        setNavTabActive(btnTabDashboard, false);
        setNavTabActive(btnTabSettings,  true);
    }

    private void setNavTabActive(android.widget.LinearLayout tab, boolean active) {
        int color = active ? 0xFF3D52C4 : 0xFF9A9AB0;
        if (tab.getChildCount() >= 2) {
            android.view.View icon  = tab.getChildAt(0);
            android.view.View label = tab.getChildAt(1);
            if (icon  instanceof android.widget.TextView) ((android.widget.TextView) icon ).setTextColor(color);
            if (label instanceof android.widget.TextView) ((android.widget.TextView) label).setTextColor(color);
        }
        if (tab.getChildCount() >= 3) {
            android.view.View indicator = tab.getChildAt(2);
            indicator.setVisibility(active ? View.VISIBLE : View.INVISIBLE);
        }
    }

    // ── Listeners ─────────────────────────────────────────────────────

    private void listeners() {
        btnToggle.setOnClickListener(v -> toggleService());

        btnClearLog.setOnClickListener(v -> {
            MessageLog.clear(this);
            refreshLog();
        });

        tvApiKey.setOnLongClickListener(v -> {
            new AlertDialog.Builder(this)
                    .setTitle(R.string.dialog_regen_key_title)
                    .setMessage(R.string.dialog_regen_key_message)
                    .setPositiveButton(R.string.btn_yes, (d, w) -> {
                        String k = generateApiKey();
                        prefs.edit().putString("api_key", k).apply();
                        tvApiKey.setText(k);
                    })
                    .setNegativeButton(R.string.btn_cancel, null).show();
            return true;
        });

        etPort.setOnFocusChangeListener((v, f) -> { if (!f) savePort(); });
        etPort.setOnEditorActionListener((v, a, e) -> {
            if (a == EditorInfo.IME_ACTION_DONE) savePort();
            return false;
        });

        etSrmcIp.setOnFocusChangeListener((v, f)     -> { if (!f) saveSrmcServer(); });
        etSrmcIp.setOnEditorActionListener((v, a, e)  -> {
            if (a == EditorInfo.IME_ACTION_DONE) saveSrmcServer();
            return false;
        });
        etSrmcPort.setOnFocusChangeListener((v, f)    -> { if (!f) saveSrmcServer(); });
        etSrmcPort.setOnEditorActionListener((v, a, e) -> {
            if (a == EditorInfo.IME_ACTION_DONE) saveSrmcServer();
            return false;
        });

        btnCheckServer.setOnClickListener(v -> checkSrmcServerNow());
        btnRegisterWebhook.setOnClickListener(v -> performWebhookTest());
    }

    // ── Gateway toggle ────────────────────────────────────────────────

    private void toggleService() {
        savePort();
        Intent svc = new Intent(this, GatewayService.class);
        if (GatewayService.isRunning) {
            stopService(svc);
            statsPoller.stop();
            tvSentCount    .setText(R.string.label_default_value);
            tvFailCount    .setText(R.string.label_default_value);
            tvQueueCount   .setText(R.string.label_default_value);
            tvMySentCount  .setText(R.string.label_default_value);
            tvSendingStatus.setText(R.string.msg_gateway_stopped);
            tvSendingStatus.setTextColor(0xFFAAAAAA);
            tvLastUpdated  .setText("");
            btnToggle.postDelayed(() -> { updateStatusUi(); hideBanner(); }, 400);
        } else {
            tvStatus.setText(R.string.msg_checking_server);
            tvStatus.setTextColor(0xFFFFCC00);
            btnToggle.setEnabled(false);
            // startForegroundService is only available on API 26+ (Android 8).
            // On older devices, startService starts the service and the foreground
            // notification is handled inside GatewayService.onCreate().
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startForegroundService(svc);
                } else {
                    startService(svc);
                }
            } catch (Exception e) {
                android.util.Log.e("MainActivity", "Failed to start service: " + e.getMessage(), e);
                btnToggle.setEnabled(true);
                updateStatusUi();
            }
            btnToggle.postDelayed(() -> {
                btnToggle.setEnabled(true);
                updateStatusUi();
            }, 8_000);
        }
    }

    private void updateStatusUi() {
        int port = prefs.getInt("port", GATEWAY_DEFAULT_PORT);
        if (GatewayService.isRunning) {
            tvStatus.setText(getString(R.string.msg_running_on_port, port));
            tvStatus.setTextColor(0xFF4CAF50);
            btnToggle.setText(R.string.btn_stop);
        } else {
            tvStatus.setText(R.string.label_status_stopped);
            tvStatus.setTextColor(0xFFAAAAAA);
            btnToggle.setText(R.string.btn_start);
        }
    }

    // ── Banner ────────────────────────────────────────────────────────

    private void showBanner(String reason) {
        tvServerBanner.setVisibility(View.VISIBLE);
        tvServerBanner.setText(getString(R.string.msg_banner_template, reason));
    }

    private void hideBanner() { tvServerBanner.setVisibility(View.GONE); }

    // ── Log ───────────────────────────────────────────────────────────

    private void refreshLog() { logAdapter.update(MessageLog.load(this)); }

    // ── Settings helpers ──────────────────────────────────────────────

    private void savePort() {
        String val = etPort.getText().toString().trim();
        int port;
        try { port = Integer.parseInt(val); } catch (Exception e) { port = GATEWAY_DEFAULT_PORT; }
        if (port < 1024 || port > 65535) port = GATEWAY_DEFAULT_PORT;
        prefs.edit().putInt("port", port).apply();
        etPort.setText(String.valueOf(port));
        updateStatusUi();
    }

    private void saveSrmcServer() {
        String ip = etSrmcIp.getText().toString().trim();
        if (ip.isEmpty()) ip = ServerConfig.DEFAULT_IP;
        ServerConfig.setIp(this, ip);

        String ps = etSrmcPort.getText().toString().trim();
        int port;
        try { port = Integer.parseInt(ps); } catch (Exception e) { port = ServerConfig.DEFAULT_PORT; }
        if (port < 1 || port > 65535) port = ServerConfig.DEFAULT_PORT;
        ServerConfig.setPort(this, port);

        etSrmcIp  .setText(ServerConfig.getIp(this));
        etSrmcPort.setText(String.valueOf(ServerConfig.getPort(this)));

        tvSrmcStatus.setVisibility(View.VISIBLE);
        tvSrmcStatus.setText(R.string.msg_saved_verify);
        tvSrmcStatus.setTextColor(0xFFAAAAAA);
    }

    private void checkSrmcServerNow() {
        etSrmcIp.clearFocus();
        etSrmcPort.clearFocus();
        saveSrmcServer();

        tvSrmcStatus.setVisibility(View.VISIBLE);
        tvSrmcStatus.setText(R.string.msg_checking);
        tvSrmcStatus.setTextColor(0xFFFFCC00);
        btnCheckServer.setEnabled(false);

        ServerChecker.check(this, (online, message) -> {
            btnCheckServer.setEnabled(true);
            tvSrmcStatus.setVisibility(View.VISIBLE);
            if (online) {
                tvSrmcStatus.setText(getString(R.string.msg_server_ok, message));
                tvSrmcStatus.setTextColor(0xFF4CAF50);
                statsPoller.pollNow();
            } else {
                tvSrmcStatus.setText(getString(R.string.msg_server_fail, message));
                tvSrmcStatus.setTextColor(0xFFFF5B5B);
            }
        });
    }

    @SuppressLint("MissingPermission")
    private void detectSims() {
        tvSimCarrier.setText(R.string.label_sim_not_detected);
        tvSim2Carrier.setText(R.string.label_sim_not_detected);

        // Clear stored subscription IDs by default
        SharedPreferences.Editor edit = prefs.edit();
        edit.remove(SmsSender.PREF_SIM1_SUB_ID);
        edit.remove(SmsSender.PREF_SIM2_SUB_ID);
        edit.remove(SmsSender.PREF_SIM1_CARRIER);
        edit.remove(SmsSender.PREF_SIM2_CARRIER);

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1) {
        try {
            SubscriptionManager sm = (SubscriptionManager) getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE);
            if (sm == null) return;
            List<SubscriptionInfo> list = sm.getActiveSubscriptionInfoList();
            if (list == null) return;

            boolean foundSim1 = false;
            boolean foundSim2 = false;

            for (SubscriptionInfo info : list) {
                int slot = info.getSimSlotIndex();
                String carrier = info.getCarrierName() == null
                        ? getString(R.string.label_unknown)
                        : info.getCarrierName().toString();
                int subId = info.getSubscriptionId();

                if (slot == 0) {
                    tvSimCarrier.setText(carrier);
                    edit.putInt(SmsSender.PREF_SIM1_SUB_ID, subId);
                    edit.putString(SmsSender.PREF_SIM1_CARRIER, carrier);
                    foundSim1 = true;
                } else if (slot > 0) {
                    // Some devices (iQOO, Xiaomi, etc.) use slot 2 or 3 for SIM 2
                    tvSim2Carrier.setText(carrier);
                    edit.putInt(SmsSender.PREF_SIM2_SUB_ID, subId);
                    edit.putString(SmsSender.PREF_SIM2_CARRIER, carrier);
                    foundSim2 = true;
                }
            }

            edit.apply();
        } catch (SecurityException ignored) {
            // READ_PHONE_STATE permission not granted — SIM detection unavailable
        } catch (Exception ignored) {}
    }
    }

    // ── Permissions ───────────────────────────────────────────────────

    private void checkPermissions() {
        ArrayList<String> needed = new ArrayList<>();
        String[] required = {
                Manifest.permission.SEND_SMS,
                Manifest.permission.RECEIVE_SMS,
                Manifest.permission.READ_SMS,
                Manifest.permission.READ_PHONE_STATE
        };
        for (String p : required)
            if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED)
                needed.add(p);

        // POST_NOTIFICATIONS is only needed on Android 13+ (API 33)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED)
                needed.add(Manifest.permission.POST_NOTIFICATIONS);
        }

        if (!needed.isEmpty())
            ActivityCompat.requestPermissions(this, needed.toArray(new String[0]), REQ_PERMISSIONS);
    }

    // ── Lifecycle ─────────────────────────────────────────────────────

    @Override
    protected void onResume() {
        super.onResume();
        if (!prefs.getBoolean(LoginActivity.PREF_LOGGED_IN, false)) {
            redirectToLogin();
            return;
        }

        // RECEIVER_NOT_EXPORTED was added in Android 13 (API 33).
        // On older devices we pass 0 (no flags) which is safe.
        int receiverFlags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                ? ContextCompat.RECEIVER_NOT_EXPORTED
                : 0;

        ContextCompat.registerReceiver(this, logReceiver,
                new IntentFilter("com.flashsms.LOG_UPDATED"),
                receiverFlags);
        ContextCompat.registerReceiver(this, serverOfflineReceiver,
                new IntentFilter(GatewayService.ACTION_SERVER_OFFLINE),
                receiverFlags);
        ContextCompat.registerReceiver(this, gatewayStartedReceiver,
                new IntentFilter(GatewayService.ACTION_GATEWAY_STARTED),
                receiverFlags);

        updateStatusUi();
        detectSims();
        refreshLog();
        statsPoller.pollNow();
    }

    @Override
    protected void onPause() {
        super.onPause();
        savePort();
        saveSrmcServer();
        try { unregisterReceiver(logReceiver); }           catch (Exception ignored) {}
        try { unregisterReceiver(serverOfflineReceiver); }  catch (Exception ignored) {}
        try { unregisterReceiver(gatewayStartedReceiver); } catch (Exception ignored) {}
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        stopGatewayHeartbeat();
        statsPoller.stop();
    }

    // ── Helpers ───────────────────────────────────────────────────────

    private String getLocalIp() {
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                for (InetAddress address : Collections.list(ni.getInetAddresses())) {
                    if (!address.isLoopbackAddress() && address instanceof Inet4Address) {
                        return address.getHostAddress();
                    }
                }
            }
        } catch (Exception ignored) {}
        return getString(R.string.label_unknown);
    }

    private String generateApiKey() {
        String chars = "abcdefghijklmnopqrstuvwxyz0123456789";
        StringBuilder sb = new StringBuilder();
        java.util.Random r = new java.util.Random();
        for (int i = 0; i < 32; i++) sb.append(chars.charAt(r.nextInt(chars.length())));
        return sb.toString();
    }
}