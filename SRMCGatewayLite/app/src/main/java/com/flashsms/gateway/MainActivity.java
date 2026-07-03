package com.flashsms.gateway;

import android.Manifest;
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

    // Settings — server
    private EditText etSrmcIp, etSrmcPort;
    private Button   btnCheckServer;
    private TextView tvSrmcStatus;

    // Settings — local gateway
    private TextView tvIpAddress, tvApiKey, tvSimCarrier, tvSim2Carrier, tvSimMode;
    private EditText etPort;

    private SharedPreferences prefs;

    private ServerStatsPoller statsPoller;

    private java.util.concurrent.ScheduledExecutorService heartbeatExecutor;
    private static final long HEARTBEAT_INTERVAL_SEC = 60;

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

        new Thread(() -> sendHeartbeat(loggedInUserId)).start();

        setContentView(R.layout.activity_main);

        bindViews();
        initRecycler();
        initTabs();
        initStatsPoller();
        startGatewayHeartbeat();
        setupUserHeader();

        tvIpAddress.setText(getLocalIp());
        int savedPort = prefs.getInt("port", 8088);
        etPort.setText(String.valueOf(savedPort));

        etSrmcIp.setText(ServerConfig.getIp(this));
        etSrmcPort.setText(String.valueOf(ServerConfig.getPort(this)));

        // Generate and display API key (lowercase + numbers only)
        String key = prefs.getString("api_key", "");
        if (key.isEmpty()) { key = generateApiKey(); prefs.edit().putString("api_key", key).apply(); }
        tvApiKey.setText(key);

        // Long-press to regenerate
        tvApiKey.setOnLongClickListener(v -> {
            new AlertDialog.Builder(this)
                    .setTitle("Regenerate API Key?")
                    .setMessage("The old key will stop working immediately.")
                    .setPositiveButton("Yes", (d, w) -> {
                        String k = generateApiKey();
                        prefs.edit().putString("api_key", k).apply();
                        tvApiKey.setText(k);
                    })
                    .setNegativeButton("Cancel", null)
                    .show();
            return true;
        });

        listeners();
        detectSims();
        updateSimModeDisplay();
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
    }

    private void stopGatewayHeartbeat() {
        if (heartbeatExecutor != null && !heartbeatExecutor.isShutdown()) {
            heartbeatExecutor.shutdownNow();
            heartbeatExecutor = null;
        }
    }

    private void sendHeartbeat(String userId) {
        if (userId == null || userId.isEmpty()) return;
        String url = ServerConfig.getBaseUrl(this) + "/api/auth/gateway/heartbeat";
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
        if (GatewayService.isRunning) {
            statsPoller.start();
        }
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

        tvIpAddress   = findViewById(R.id.tvIpAddress);
        tvApiKey      = findViewById(R.id.tvApiKey);
        tvSimCarrier  = findViewById(R.id.tvSimCarrier);
        tvSim2Carrier = findViewById(R.id.tvSim2Carrier);
        tvSimMode     = findViewById(R.id.tvSimMode);
        etPort        = findViewById(R.id.etPort);

        etSrmcIp       = findViewById(R.id.etSrmcIp);
        etSrmcPort     = findViewById(R.id.etSrmcPort);
        btnCheckServer = findViewById(R.id.btnCheckServer);
        tvSrmcStatus   = findViewById(R.id.tvSrmcStatus);
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

    private void setNavTabActive(LinearLayout tab, boolean active) {
        int color = active ? 0xFF1A73C8 : 0xFF9A9AB0;
        if (tab.getChildCount() >= 2) {
            View icon  = tab.getChildAt(0);
            View label = tab.getChildAt(1);
            if (icon  instanceof TextView) ((TextView) icon ).setTextColor(color);
            if (label instanceof TextView) ((TextView) label).setTextColor(color);
        }
        if (tab.getChildCount() >= 3) {
            View indicator = tab.getChildAt(2);
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

        // SIM mode picker
        tvSimMode.setOnClickListener(v -> showSimModePicker());
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
        int port = prefs.getInt("port", 8088);
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

    private void showBanner(String reason) {
        tvServerBanner.setVisibility(View.VISIBLE);
        tvServerBanner.setText(getString(R.string.msg_banner_template, reason));
    }

    private void hideBanner() { tvServerBanner.setVisibility(View.GONE); }

    private void refreshLog() { logAdapter.update(MessageLog.load(this)); }

    // ── Settings helpers ──────────────────────────────────────────────

    private void savePort() {
        String val = etPort.getText().toString().trim();
        int port;
        try { port = Integer.parseInt(val); } catch (Exception e) { port = 8088; }
        if (port < 1024 || port > 65535) port = 8088;
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

    /**
     * Show SIM mode picker with 4 options:
     *   SIM 1 Only, SIM 2 Only, Round-robin, Parallel
     */
    private void showSimModePicker() {
        int sim2 = SmsSender.getSim2SubId(this);
        String[] modes;
        int checkedItem;
        String currentMode = SmsSender.getSimMode(this);

        if (sim2 < 0) {
            modes = new String[]{"📱 SIM 1 Only", "↻ Round-robin"};
            checkedItem = currentMode.equals(SmsSender.SIM_MODE_SIM2_ONLY) || currentMode.equals(SmsSender.SIM_MODE_PARALLEL)
                    ? 1 : 0;
        } else {
            modes = new String[]{"📱 SIM 1 Only", "📱 SIM 2 Only", "↻ Round-robin", "⚡ Parallel"};
            if (currentMode.equals(SmsSender.SIM_MODE_SIM1_ONLY)) checkedItem = 0;
            else if (currentMode.equals(SmsSender.SIM_MODE_SIM2_ONLY)) checkedItem = 1;
            else if (currentMode.equals(SmsSender.SIM_MODE_PARALLEL)) checkedItem = 3;
            else checkedItem = 2; // round-robin default
        }

        new AlertDialog.Builder(this)
                .setTitle("SIM Mode")
                .setSingleChoiceItems(modes, checkedItem, (d, w) -> {
                    String mode;
                    if (sim2 < 0) {
                        mode = w == 0 ? SmsSender.SIM_MODE_SIM1_ONLY : SmsSender.SIM_MODE_ROUND_ROBIN;
                    } else {
                        mode = w == 0 ? SmsSender.SIM_MODE_SIM1_ONLY
                                : w == 1 ? SmsSender.SIM_MODE_SIM2_ONLY
                                : w == 3 ? SmsSender.SIM_MODE_PARALLEL
                                : SmsSender.SIM_MODE_ROUND_ROBIN;
                    }
                    prefs.edit().putString(SmsSender.PREF_SIM_MODE, mode).apply();
                    updateSimModeDisplay();
                    d.dismiss();
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    /** Update the SIM mode label in the settings UI. */
    private void updateSimModeDisplay() {
        String mode = SmsSender.getSimMode(this);
        int sim2 = SmsSender.getSim2SubId(this);

        if (sim2 < 0) {
            tvSimMode.setText("📱 SIM 1 Only — no SIM 2 detected");
            tvSimMode.setTextColor(0xFF94A3B8);
            tvSimMode.setBackgroundColor(0xFFF8FAFC);
            return;
        }

        switch (mode) {
            case "sim1":
                tvSimMode.setText("📱 SIM 1 Only — all messages via SIM 1");
                tvSimMode.setTextColor(0xFF059669);
                tvSimMode.setBackgroundColor(0xFFF0FDF4);
                break;
            case "sim2":
                tvSimMode.setText("📱 SIM 2 Only — all messages via SIM 2");
                tvSimMode.setTextColor(0xFFDB2777);
                tvSimMode.setBackgroundColor(0xFFFDF2F8);
                break;
            case "parallel":
                tvSimMode.setText("⚡ Parallel — both SIMs send concurrently");
                tvSimMode.setTextColor(0xFF7C3AED);
                tvSimMode.setBackgroundColor(0xFFF5F3FF);
                break;
            default:
                tvSimMode.setText("↻ Round-robin — alternating SIM1 → SIM2");
                tvSimMode.setTextColor(0xFF4CAF50);
                tvSimMode.setBackgroundColor(0xFFF0FDF4);
                break;
        }
    }

    private void detectSims() {
        tvSimCarrier.setText(R.string.label_sim_not_detected);
        tvSim2Carrier.setText(R.string.label_sim_not_detected);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1) {
            try {
                SubscriptionManager sm = (SubscriptionManager) getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE);
                if (sm == null) return;
                List<SubscriptionInfo> list = sm.getActiveSubscriptionInfoList();
                if (list == null) return;

                for (SubscriptionInfo info : list) {
                    int slot = info.getSimSlotIndex();
                    String carrier = info.getCarrierName() == null
                            ? getString(R.string.label_unknown)
                            : info.getCarrierName().toString();
                    if (slot == 0) tvSimCarrier.setText(carrier);
                    else if (slot == 1) tvSim2Carrier.setText(carrier);
                }
            } catch (SecurityException ignored) {}
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
        ContextCompat.registerReceiver(this, logReceiver,
                new IntentFilter("com.flashsms.LOG_UPDATED"), 0);
        ContextCompat.registerReceiver(this, serverOfflineReceiver,
                new IntentFilter(GatewayService.ACTION_SERVER_OFFLINE), 0);
        ContextCompat.registerReceiver(this, gatewayStartedReceiver,
                new IntentFilter(GatewayService.ACTION_GATEWAY_STARTED), 0);
        updateStatusUi();
        detectSims();
        updateSimModeDisplay();
        refreshLog();
        if (GatewayService.isRunning) statsPoller.pollNow();
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

    private String generateApiKey() {
        String chars = "abcdefghijklmnopqrstuvwxyz0123456789";
        StringBuilder sb = new StringBuilder();
        java.util.Random r = new java.util.Random();
        for (int i = 0; i < 8; i++) sb.append(chars.charAt(r.nextInt(chars.length())));
        return sb.toString();
    }

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
}
