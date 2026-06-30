package com.flashsms.gateway;

import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class LoginActivity extends AppCompatActivity {

    private static final int    TIMEOUT_MS = 8_000;
    private static final String TAG        = "LoginActivity";

    private EditText    etUserId, etPassword;
    private Button      btnLogin;
    private Button      btnSettings;
    private ProgressBar progressBar;
    private TextView    tvError, tvServerInfo;
    private View        cardError;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    public static final String PREF_USER_ID     = "auth_user_id";
    public static final String PREF_USER_NAME   = "auth_user_name";
    public static final String PREF_USER_ROLE   = "auth_user_role";
    public static final String PREF_USER_STATUS = "auth_user_status";
    public static final String PREF_LOGGED_IN   = "auth_logged_in";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        SharedPreferences prefs = getSharedPreferences("settings", MODE_PRIVATE);
        if (prefs.getBoolean(PREF_LOGGED_IN, false)) {
            startMainActivity();
            return;
        }

        try {
            setContentView(R.layout.activity_login);

            etUserId     = findViewById(R.id.etUserId);
            etPassword   = findViewById(R.id.etPassword);
            btnLogin     = findViewById(R.id.btnLogin);
            btnSettings  = findViewById(R.id.btnSettings);
            progressBar  = findViewById(R.id.progressBar);
            tvError      = findViewById(R.id.tvError);
            tvServerInfo = findViewById(R.id.tvServerInfo);
            cardError    = findViewById(R.id.cardError);

            updateServerInfo();

            btnSettings.setOnClickListener(v -> showServerSettingsDialog());
            btnLogin.setOnClickListener(v -> attemptLogin());
        } catch (Throwable t) {
            android.util.Log.e(TAG, "Fatal during login screen setup", t);
            showFatalOnScreen(t);
        }
    }

    private void showFatalOnScreen(Throwable t) {
        try {
            java.io.StringWriter sw = new java.io.StringWriter();
            t.printStackTrace(new java.io.PrintWriter(sw));

            android.widget.ScrollView scroll = new android.widget.ScrollView(this);
            android.widget.TextView tv = new android.widget.TextView(this);
            int pad = (int) (16 * getResources().getDisplayMetrics().density);
            tv.setPadding(pad, pad, pad, pad);
            tv.setTextIsSelectable(true);
            tv.setTextColor(0xFF000000);
            tv.setText("SMS Gateway Lite failed to start on this device:\n\n"
                    + "Android " + android.os.Build.VERSION.RELEASE
                    + " (API " + android.os.Build.VERSION.SDK_INT + ")\n"
                    + android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL + "\n\n"
                    + sw);
            scroll.addView(tv);
            scroll.setBackgroundColor(0xFFFFFFFF);
            setContentView(scroll);
        } catch (Throwable ignored) {}
    }

    private void showServerSettingsDialog() {
        View dialogView = getLayoutInflater().inflate(R.layout.dialog_server_settings, null);
        EditText dlgIp   = dialogView.findViewById(R.id.etDialogServerIp);
        EditText dlgPort = dialogView.findViewById(R.id.etDialogServerPort);

        dlgIp.setText(ServerConfig.getIp(this));
        dlgPort.setText(String.valueOf(ServerConfig.getPort(this)));

        new AlertDialog.Builder(this)
                .setTitle(R.string.dialog_server_settings_title)
                .setView(dialogView)
                .setPositiveButton(R.string.btn_save, (dialog, which) -> {
                    saveServerConfig(dlgIp.getText().toString().trim(),
                                     dlgPort.getText().toString().trim());
                    updateServerInfo();
                })
                .setNegativeButton(R.string.btn_cancel, null)
                .show();
    }

    private void attemptLogin() {
        String userId   = etUserId.getText().toString().trim();
        String password = etPassword.getText().toString().trim();

        if (userId.isEmpty() || password.isEmpty()) {
            showError(getString(R.string.error_fields_required));
            return;
        }

        String serverIp = ServerConfig.getIp(this);
        if (serverIp == null || serverIp.isEmpty()) {
            showError(getString(R.string.error_no_server_configured));
            return;
        }

        setLoading(true);
        hideError();

        String loginUrl = ServerConfig.getBaseUrl(this) + "/api/auth/gateway/login";
        android.util.Log.d(TAG, "Attempting login → " + loginUrl);

        executor.execute(() -> {
            try {
                JSONObject loginBody = new JSONObject();
                loginBody.put("userId",   userId);
                loginBody.put("password", password);

                HttpURLConnection conn = openPost(loginUrl, loginBody);
                int code = conn.getResponseCode();

                BufferedReader reader = new BufferedReader(new InputStreamReader(
                        code >= 400 ? conn.getErrorStream() : conn.getInputStream(),
                        StandardCharsets.UTF_8));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) sb.append(line);
                conn.disconnect();

                android.util.Log.d(TAG, "Login response [" + code + "]: " + sb);

                JSONObject resp = new JSONObject(sb.toString());

                if (code != 200 || !resp.optBoolean("success", false)) {
                    String msg = resp.optString("message", getString(R.string.error_login_failed));
                    runOnUiThread(() -> { setLoading(false); showError(msg); });
                    return;
                }

                JSONObject user      = resp.getJSONObject("user");
                String resUserId     = user.optString("user_id",  userId);
                String name          = user.optString("name",     userId);
                String role          = user.optString("role",     "user");
                String status        = user.optString("status",   "Active");
                String inboundToken  = resp.optString("inboundToken", "");

                // Fetch webhook URL from /api/config
                String webhookUrl = "";
                try {
                    String configUrl = ServerConfig.getBaseUrl(LoginActivity.this) + "/api/config";
                    HttpURLConnection cfgConn = (HttpURLConnection) new URI(configUrl).toURL().openConnection();
                    cfgConn.setRequestMethod("GET");
                    cfgConn.setConnectTimeout(6_000);
                    cfgConn.setReadTimeout(6_000);

                    BufferedReader cfgReader = new BufferedReader(new InputStreamReader(
                            cfgConn.getInputStream(), StandardCharsets.UTF_8));
                    StringBuilder cfgSb = new StringBuilder();
                    while ((line = cfgReader.readLine()) != null) cfgSb.append(line);
                    cfgConn.disconnect();

                    JSONObject cfg = new JSONObject(cfgSb.toString());
                    webhookUrl = cfg.optString("INBOUND_WEBHOOK_URL", "");
                    android.util.Log.d(TAG, "Inbound webhook URL from config: " + webhookUrl);
                } catch (Exception cfgEx) {
                    android.util.Log.w(TAG, "Could not fetch /api/config: " + cfgEx.getMessage());
                }

                final String finalWebhookUrl = webhookUrl;
                runOnUiThread(() -> onLoginSuccess(resUserId, name, role, status, inboundToken, finalWebhookUrl));

            } catch (java.net.ConnectException e) {
                android.util.Log.e(TAG, "Connection refused: " + e.getMessage());
                runOnUiThread(() -> { setLoading(false); showError(getString(R.string.error_connection_refused)); });
            } catch (java.net.SocketTimeoutException e) {
                android.util.Log.e(TAG, "Timeout: " + e.getMessage());
                runOnUiThread(() -> { setLoading(false); showError(getString(R.string.error_timeout)); });
            } catch (Exception e) {
                android.util.Log.e(TAG, "Login error: " + e.getMessage(), e);
                runOnUiThread(() -> { setLoading(false); showError(getString(R.string.error_cannot_reach_server)); });
            }
        });
    }

    private void onLoginSuccess(String userId, String name, String role,
                                String status, String inboundToken, String webhookUrl) {
        SharedPreferences prefs = getSharedPreferences("settings", MODE_PRIVATE);
        String savedPassword = "";
        try { savedPassword = etPassword.getText().toString().trim(); } catch (Exception ignored) {}

        prefs.edit()
                .putBoolean(PREF_LOGGED_IN,   true)
                .putString(PREF_USER_ID,      userId)
                .putString(PREF_USER_NAME,    name)
                .putString(PREF_USER_ROLE,    role)
                .putString(PREF_USER_STATUS,  status)
                .putString("saved_password",  savedPassword)
                .putString(InboundSmsReceiver.PREF_INBOUND_TOKEN,   inboundToken)
                .putString(InboundSmsReceiver.PREF_INBOUND_WEBHOOK, webhookUrl)
                .apply();

        android.util.Log.d(TAG, "✅ Logged in as " + userId);
        Toast.makeText(this, getString(R.string.toast_welcome, name), Toast.LENGTH_SHORT).show();

        notifyGatewayOnline(userId);
        startMainActivity();
    }

    private void notifyGatewayOnline(String userId) {
        String url = ServerConfig.getBaseUrl(this) + "/api/auth/gateway/online";
        executor.execute(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("userId", userId);
                body.put("deviceInfo", android.os.Build.MODEL
                        + " (Android " + android.os.Build.VERSION.RELEASE + ")");

                String sim1Carrier = "";
                String sim2Carrier = "";
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1) {
                    try {
                        SubscriptionManager sm = (SubscriptionManager) getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE);
                        if (sm != null) {
                            java.util.List<SubscriptionInfo> list = sm.getActiveSubscriptionInfoList();
                            if (list != null) {
                                for (SubscriptionInfo info : list) {
                                    String carrier = info.getCarrierName() == null ? "" : info.getCarrierName().toString();
                                    int slot = info.getSimSlotIndex();
                                    if (slot == 0) sim1Carrier = carrier;
                                    else if (slot == 1) sim2Carrier = carrier;
                                }
                            }
                        }
                    } catch (SecurityException ignored) {}
                }

                if (!sim1Carrier.isEmpty()) body.put("sim_carrier", sim1Carrier);
                if (!sim2Carrier.isEmpty()) body.put("sim2_carrier", sim2Carrier);

                HttpURLConnection conn = openPost(url, body);
                conn.getResponseCode();
                conn.disconnect();
            } catch (Exception e) {
                android.util.Log.w(TAG, "Could not notify gateway online: " + e.getMessage());
            }
        });
    }

    private HttpURLConnection openPost(String url, JSONObject body) throws Exception {
        byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
        HttpURLConnection conn = (HttpURLConnection) new URI(url).toURL().openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setConnectTimeout(TIMEOUT_MS);
        conn.setReadTimeout(TIMEOUT_MS);
        conn.setDoOutput(true);
        try (OutputStream os = conn.getOutputStream()) { os.write(bytes); }
        return conn;
    }

    private void startMainActivity() {
        startActivity(new Intent(this, MainActivity.class));
        finish();
    }

    private void saveServerConfig(String ip, String portStr) {
        if (!ip.isEmpty()) {
            ServerConfig.setIp(this, ip);
        }
        if (!portStr.isEmpty()) {
            try {
                int port = Integer.parseInt(portStr);
                ServerConfig.setPort(this, port);
            } catch (NumberFormatException ignored) {}
        }
    }

    private void updateServerInfo() {
        String ip = ServerConfig.getIp(this);
        if (ip == null || ip.isEmpty()) ip = ServerConfig.DEFAULT_IP;
        int port = ServerConfig.getPort(this);
        tvServerInfo.setText("http://" + ip + ":" + port);
    }

    private void setLoading(boolean loading) {
        progressBar.setVisibility(loading ? View.VISIBLE : View.GONE);
        btnLogin     .setEnabled(!loading);
        btnSettings  .setEnabled(!loading);
        etUserId     .setEnabled(!loading);
        etPassword   .setEnabled(!loading);
    }

    private void showError(String msg) {
        tvError.setText(msg);
        tvError.setVisibility(View.VISIBLE);
        if (cardError != null) cardError.setVisibility(View.VISIBLE);
    }

    private void hideError() {
        tvError.setVisibility(View.GONE);
        if (cardError != null) cardError.setVisibility(View.GONE);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        executor.shutdownNow();
    }
}
