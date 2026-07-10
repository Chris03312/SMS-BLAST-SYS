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
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * MainActivity — Push-only SMS Gateway.
 *
 * No server IP/port needed. Just runs an HTTP server that the central
 * platform pushes SMS requests to. Admin adds this gateway manually
 * in the web dashboard with the device IP and API key shown here.
 */
public class MainActivity extends AppCompatActivity {

    private static final int REQ_PERMISSIONS = 100;
    private static final String PREF_API_KEY = "api_key";
    private static final String PREF_DEVICE_ID = "device_id";

    // Gateway info
    private TextView tvDeviceIp, tvApiKey, tvDeviceModel;
    private EditText etGatewayPort;

    // Inbound webhook
    private EditText etServerUrl;
    private Button   btnRegisterWebhook;
    private TextView tvWebhookStatus;

    // Gateway endpoints
    private View     layoutEndpoints;
    private TextView tvEndpointUrl, tvEndpointHealth, tvEndpointSend;

    // Gateway control
    private Button   btnToggle;
    private TextView tvStatus, tvSim1Carrier, tvSim2Carrier, tvGatewayStatus;

    private SharedPreferences prefs;

    // Broadcast receiver
    private final BroadcastReceiver gatewayStartedReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context ctx, Intent i) {
            btnToggle.setEnabled(true);
            String url = GatewayService.getHttpUrl();
            if (!url.isEmpty() && GatewayService.isRunning) {
                showEndpoints(url);
            }
            updateStatusUi();
        }
    };

    // ── Lifecycle ─────────────────────────────────────────────────────

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        prefs = getSharedPreferences("settings", MODE_PRIVATE);

        bindViews();

        // Display device info
        tvDeviceIp.setText(getLocalIp());
        tvDeviceModel.setText(Build.MANUFACTURER + " " + Build.MODEL);

        // Load or generate API key
        String key = prefs.getString(PREF_API_KEY, "");
        if (key.isEmpty()) {
            key = generateApiKey();
            prefs.edit().putString(PREF_API_KEY, key).apply();
        }
        tvApiKey.setText(key);

        // Long-press to regenerate API key
        tvApiKey.setOnLongClickListener(v -> {
            new androidx.appcompat.app.AlertDialog.Builder(this)
                    .setTitle("Regenerate API Key?")
                    .setMessage("The old key will stop working immediately.")
                    .setPositiveButton("Yes", (d, w) -> {
                        String k = generateApiKey();
                        prefs.edit().putString(PREF_API_KEY, k).apply();
                        tvApiKey.setText(k);
                    })
                    .setNegativeButton("Cancel", null)
                    .show();
            return true;
        });

        // Gateway port
        int savedPort = prefs.getInt("port", 8088);
        etGatewayPort.setText(String.valueOf(savedPort));

        // Server URL
        String savedUrl = prefs.getString("server_url", "");
        etServerUrl.setText(savedUrl);

        // Detect SIMs
        detectSims();

        listeners();
        updateStatusUi();
        checkPermissions();
    }

    // ── View binding ──────────────────────────────────────────────────

    private void bindViews() {
        tvDeviceIp      = findViewById(R.id.tvDeviceIp);
        tvDeviceModel   = findViewById(R.id.tvDeviceModel);
        tvApiKey        = findViewById(R.id.tvApiKey);
        etGatewayPort   = findViewById(R.id.etGatewayPort);

        etServerUrl          = findViewById(R.id.etServerUrl);
        btnRegisterWebhook  = findViewById(R.id.btnRegisterWebhook);
        tvWebhookStatus    = findViewById(R.id.tvWebhookStatus);

        layoutEndpoints    = findViewById(R.id.layoutEndpoints);
        tvEndpointUrl      = findViewById(R.id.tvEndpointUrl);
        tvEndpointHealth   = findViewById(R.id.tvEndpointHealth);
        tvEndpointSend     = findViewById(R.id.tvEndpointSend);

        btnToggle       = findViewById(R.id.btnToggle);
        tvStatus        = findViewById(R.id.tvStatus);
        tvGatewayStatus = findViewById(R.id.tvGatewayStatus);
        tvSim1Carrier   = findViewById(R.id.tvSim1Carrier);
        tvSim2Carrier   = findViewById(R.id.tvSim2Carrier);
    }

    // ── Listeners ─────────────────────────────────────────────────────

    private void listeners() {
        btnToggle.setOnClickListener(v -> toggleService());

        // Auto-save port on focus loss
        etGatewayPort.setOnFocusChangeListener((v, f) -> { if (!f) saveGatewayPort(); });
        etGatewayPort.setOnEditorActionListener((v, a, e) -> {
            if (a == EditorInfo.IME_ACTION_DONE) saveGatewayPort();
            return false;
        });

        // Register webhook
        btnRegisterWebhook.setOnClickListener(v -> registerWebhook());

        // Auto-save server URL on focus loss
        etServerUrl.setOnFocusChangeListener((v, f) -> { if (!f) saveServerUrl(); });
        etServerUrl.setOnEditorActionListener((v, a, e) -> {
            if (a == EditorInfo.IME_ACTION_DONE) { saveServerUrl(); return true; }
            return false;
        });
    }

    // ── Gateway port ──────────────────────────────────────────────────

    private void saveGatewayPort() {
        String val = etGatewayPort.getText().toString().trim();
        int port;
        try { port = Integer.parseInt(val); } catch (Exception e) { port = 8088; }
        if (port < 1024 || port > 65535) port = 8088;
        prefs.edit().putInt("port", port).apply();
        etGatewayPort.setText(String.valueOf(port));
        updateStatusUi();
    }

    // ── Gateway toggle ────────────────────────────────────────────────

    private void toggleService() {
        saveGatewayPort();
        Intent svc = new Intent(this, GatewayService.class);
        if (GatewayService.isRunning) {
            stopService(svc);
            btnToggle.postDelayed(() -> updateStatusUi(), 400);
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
        if (GatewayService.isRunning) {
            int port = prefs.getInt("port", 8088);
            tvStatus.setText(getString(R.string.msg_running_on_port, port));
            tvStatus.setTextColor(0xFF4CAF50);
            btnToggle.setText("STOP");
            btnToggle.setBackgroundTintList(
                    android.content.res.ColorStateList.valueOf(0xFFEF4444));
            tvGatewayStatus.setText("RUNNING");
            tvGatewayStatus.setTextColor(0xFFA5D6A7);
            // Show endpoints if we have a URL
            String url = GatewayService.getHttpUrl();
            if (!url.isEmpty()) {
                showEndpoints(url);
            }
        } else {
            tvStatus.setText(R.string.label_status_stopped);
            tvStatus.setTextColor(0xFFAAAAAA);
            btnToggle.setText("START");
            btnToggle.setBackgroundTintList(
                    android.content.res.ColorStateList.valueOf(0xFF1A73C8));
            tvGatewayStatus.setText("STOPPED");
            tvGatewayStatus.setTextColor(0xFFFFCDD2);
            hideEndpoints();
        }
    }

    // ── Server URL ───────────────────────────────────────────────────

    private void saveServerUrl() {
        String url = etServerUrl.getText().toString().trim();
        if (!url.isEmpty() && !url.startsWith("http://") && !url.startsWith("https://")) {
            url = "http://" + url;
        }
        prefs.edit().putString("server_url", url).apply();
        etServerUrl.setText(url);

        // Sync with ServerConfig so InboundSmsReceiver's LAN fallback
        // uses the correct host and port (not the default 3001).
        try {
            java.net.URI parsed = new java.net.URI(url);
            String host = parsed.getHost();
            int port = parsed.getPort();
            if (host != null && !host.isEmpty()) {
                if (port > 0) {
                    // LAN URL with explicit port — store host + port separately
                    ServerConfig.setIp(MainActivity.this, host);
                    ServerConfig.setPort(MainActivity.this, port);
                } else {
                    // ngrok URL (no port) — store full URL so getBaseUrl() uses it as-is
                    ServerConfig.setIp(MainActivity.this, url);
                }
            }
        } catch (Exception ignored) {}
    }

    // ── Heartbeat / Registration ─────────────────────────────────────

    /** Get or generate a persistent device UUID. */
    private String getGatewayDeviceId() {
        String deviceId = prefs.getString(PREF_DEVICE_ID, "");
        if (deviceId.isEmpty()) {
            deviceId = java.util.UUID.randomUUID().toString();
            prefs.edit().putString(PREF_DEVICE_ID, deviceId).apply();
        }
        return deviceId;
    }

    private void registerWebhook() {
        String serverUrl = prefs.getString("server_url", "");
        if (serverUrl.isEmpty()) {
            tvWebhookStatus.setText("No server configured");
            tvWebhookStatus.setTextColor(0xFFF44336);
            return;
        }

        tvWebhookStatus.setText("Registering\u2026");
        tvWebhookStatus.setTextColor(0xFFFFCC00);
        btnRegisterWebhook.setEnabled(false);

        new Thread(() -> {
            try {
                String deviceId = getGatewayDeviceId();
                String deviceName = Build.MANUFACTURER + " " + Build.MODEL;
                String sim1 = prefs.getString(SmsSender.PREF_SIM1_CARRIER, "");
                String sim2 = prefs.getString(SmsSender.PREF_SIM2_CARRIER, "");

                // Step 1: Mark gateway as online
                org.json.JSONObject onlinePayload = new org.json.JSONObject();
                onlinePayload.put("userId", deviceId);
                onlinePayload.put("deviceId", deviceId);
                onlinePayload.put("deviceInfo", deviceName);
                if (!sim1.isEmpty()) onlinePayload.put("sim_carrier", sim1);
                if (!sim2.isEmpty()) onlinePayload.put("sim2_carrier", sim2);

                byte[] onlineBody = onlinePayload.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);

                java.net.HttpURLConnection onlineConn = (java.net.HttpURLConnection)
                        new java.net.URL(serverUrl + "/api/auth/gateway/online").openConnection();
                onlineConn.setRequestMethod("POST");
                onlineConn.setRequestProperty("Content-Type", "application/json");
                onlineConn.setDoOutput(true);
                onlineConn.setConnectTimeout(10_000);
                onlineConn.setReadTimeout(10_000);
                try (java.io.OutputStream os = onlineConn.getOutputStream()) { os.write(onlineBody); }
                onlineConn.getResponseCode();
                onlineConn.disconnect();

                // Step 2: Send heartbeat (registers inbound webhook URL)
                org.json.JSONObject beatPayload = new org.json.JSONObject();
                beatPayload.put("userId", deviceId);
                beatPayload.put("deviceId", deviceId);
                if (!sim1.isEmpty()) beatPayload.put("sim_carrier", sim1);
                if (!sim2.isEmpty()) beatPayload.put("sim2_carrier", sim2);

                byte[] beatBody = beatPayload.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);

                java.net.HttpURLConnection beatConn = (java.net.HttpURLConnection)
                        new java.net.URL(serverUrl + "/api/auth/gateway/heartbeat").openConnection();
                beatConn.setRequestMethod("POST");
                beatConn.setRequestProperty("Content-Type", "application/json");
                beatConn.setDoOutput(true);
                beatConn.setConnectTimeout(10_000);
                beatConn.setReadTimeout(10_000);
                try (java.io.OutputStream os = beatConn.getOutputStream()) { os.write(beatBody); }

                int code = beatConn.getResponseCode();
                java.io.BufferedReader reader = new java.io.BufferedReader(
                        new java.io.InputStreamReader(
                                code >= 400 ? beatConn.getErrorStream() : beatConn.getInputStream(),
                                java.nio.charset.StandardCharsets.UTF_8));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) sb.append(line);
                beatConn.disconnect();

                String responseBody = sb.toString();

                // Extract webhook URL from response if available
                String webhookUrl = "";
                try {
                    org.json.JSONObject resp = new org.json.JSONObject(responseBody);
                    webhookUrl = resp.optString("inbound_webhook_url", "");
                } catch (Exception ignored) {}

                final boolean finalSuccess = code < 400;
                final String msg;
                if (finalSuccess) {
                    if (!webhookUrl.isEmpty()) {
                        msg = "\u2713 OK \u2014 " + webhookUrl;
                        // Store the webhook URL for InboundSmsReceiver
                        prefs.edit().putString("inbound_webhook_url", webhookUrl).apply();
                    } else {
                        msg = "\u2713 Registered (device: " + deviceId.substring(0, 8) + "\u2026)";
                    }
                } else {
                    msg = "\u2717 HTTP " + code + " \u2014 " + responseBody;
                }

                runOnUiThread(() -> {
                    tvWebhookStatus.setText(msg);
                    tvWebhookStatus.setTextColor(finalSuccess ? 0xFF4CAF50 : 0xFFF44336);
                    btnRegisterWebhook.setEnabled(true);
                });

            } catch (java.net.ConnectException e) {
                runOnUiThread(() -> {
                    tvWebhookStatus.setText("\u2717 Connection refused");
                    tvWebhookStatus.setTextColor(0xFFF44336);
                    btnRegisterWebhook.setEnabled(true);
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    tvWebhookStatus.setText("\u2717 " + e.getMessage());
                    tvWebhookStatus.setTextColor(0xFFF44336);
                    btnRegisterWebhook.setEnabled(true);
                });
            }
        }).start();
    }

    private void showEndpoints(String baseUrl) {
        tvEndpointUrl.setText(baseUrl);
        tvEndpointHealth.setText("GET  " + baseUrl + "/health");
        tvEndpointSend.setText("POST " + baseUrl + "/send");
        layoutEndpoints.setVisibility(View.VISIBLE);
    }

    private void hideEndpoints() {
        layoutEndpoints.setVisibility(View.GONE);
    }

    // ── SIM detection ─────────────────────────────────────────────────

    private void detectSims() {
        tvSim1Carrier.setText(getString(R.string.label_sim_not_detected));
        tvSim2Carrier.setText(getString(R.string.label_sim_not_detected));

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

                for (SubscriptionInfo info : list) {
                    int slot = info.getSimSlotIndex();
                    String carrier = info.getCarrierName() == null
                            ? getString(R.string.label_unknown)
                            : info.getCarrierName().toString();
                    int subId = info.getSubscriptionId();

                    if (slot == 0) {
                        tvSim1Carrier.setText(carrier);
                        edit.putInt(SmsSender.PREF_SIM1_SUB_ID, subId);
                        edit.putString(SmsSender.PREF_SIM1_CARRIER, carrier);
                    } else if (slot > 0) {
                        tvSim2Carrier.setText(carrier);
                        edit.putInt(SmsSender.PREF_SIM2_SUB_ID, subId);
                        edit.putString(SmsSender.PREF_SIM2_CARRIER, carrier);
                    }
                }
            } catch (Exception ignored) {}
        }

        edit.apply();
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

        // POST_NOTIFICATIONS only exists on Android 13+ (API 33)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.POST_NOTIFICATIONS);
            }
        }

        if (!needed.isEmpty())
            ActivityCompat.requestPermissions(this, needed.toArray(new String[0]), REQ_PERMISSIONS);
    }

    // ── Lifecycle ─────────────────────────────────────────────────────

    @Override
    protected void onResume() {
        super.onResume();
        registerReceiver(gatewayStartedReceiver,
                new IntentFilter(GatewayService.ACTION_GATEWAY_STARTED));
        updateStatusUi();
        detectSims();
    }

    @Override
    protected void onPause() {
        super.onPause();
        saveGatewayPort();
        try { unregisterReceiver(gatewayStartedReceiver); } catch (Exception ignored) {}
    }

    // ── Helpers ───────────────────────────────────────────────────────

    private String generateApiKey() {
        String chars = "abcdefghijklmnopqrstuvwxyz0123456789";
        StringBuilder sb = new StringBuilder();
        java.util.Random r = new java.util.Random();
        for (int i = 0; i < 32; i++) sb.append(chars.charAt(r.nextInt(chars.length())));
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
