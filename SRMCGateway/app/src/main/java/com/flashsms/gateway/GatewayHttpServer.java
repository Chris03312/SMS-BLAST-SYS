package com.flashsms.gateway;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * GatewayHttpServer — lightweight embedded HTTP server for PUSH-mode SMS.
 *
 * Listens for incoming HTTP requests from the central server and sends SMS
 * via the phone's SIM(s). Two endpoints:
 *
 *   GET  /health  →  {"status": "ok"}
 *   POST /send    →  { "to": "+639xx...", "message": "Hello", "flash": false }
 *                    →  {"success": true, "message_id": "..."}
 *
 * Authentication: Bearer token matching the API key shown in Settings.
 */
public class GatewayHttpServer {

    private static final String TAG = "GatewayHttpServer";

    private final Context context;
    private final int     port;
    private final String  apiKey;

    private ServerSocket     serverSocket;
    private ExecutorService  executor;
    private volatile boolean running = false;

    public GatewayHttpServer(Context context, int port, String apiKey) {
        this.context = context.getApplicationContext();
        this.port    = port;
        this.apiKey  = apiKey;
    }

    // ── Lifecycle ─────────────────────────────────────────────────────

    public synchronized void start() throws Exception {
        if (running) return;
        running = true;
        serverSocket = new ServerSocket(port);
        executor = Executors.newCachedThreadPool();
        executor.execute(this::acceptLoop);
        Log.d(TAG, "HTTP server started on port " + port);
    }

    public synchronized void stop() {
        running = false;
        if (serverSocket != null) {
            try { serverSocket.close(); } catch (Exception ignored) {}
            serverSocket = null;
        }
        if (executor != null) {
            executor.shutdownNow();
            executor = null;
        }
        Log.d(TAG, "HTTP server stopped");
    }

    public boolean isRunning() { return running; }

    // ── Accept loop ───────────────────────────────────────────────────

    private void acceptLoop() {
        while (running && serverSocket != null && !serverSocket.isClosed()) {
            try {
                Socket client = serverSocket.accept();
                executor.execute(() -> handleClient(client));
            } catch (Exception e) {
                if (running) Log.w(TAG, "Accept error: " + e.getMessage());
            }
        }
    }

    // ── Request handler ───────────────────────────────────────────────

    private void handleClient(Socket client) {
        try {
            client.setSoTimeout(15_000);

            BufferedReader reader = new BufferedReader(
                    new InputStreamReader(client.getInputStream(), StandardCharsets.UTF_8));

            // Parse request line
            String requestLine = reader.readLine();
            if (requestLine == null || requestLine.isEmpty()) {
                sendResponse(client, 400, "{\"error\":\"Bad request\"}");
                return;
            }

            String[] parts = requestLine.split(" ");
            if (parts.length < 2) {
                sendResponse(client, 400, "{\"error\":\"Bad request\"}");
                return;
            }
            String method = parts[0].toUpperCase();
            String path   = parts[1];

            // Parse headers
            String authHeader = null;
            int contentLength = 0;
            String line;
            while ((line = reader.readLine()) != null && !line.isEmpty()) {
                if (line.toLowerCase().startsWith("authorization:")) {
                    authHeader = line.substring("authorization:".length()).trim();
                }
                if (line.toLowerCase().startsWith("content-length:")) {
                    contentLength = Integer.parseInt(line.substring("content-length:".length()).trim());
                }
            }

            // Authenticate
            if (!authenticate(authHeader)) {
                sendResponse(client, 401, "{\"error\":\"Unauthorized\"}");
                return;
            }

            // Read body if present
            String body = "";
            if (contentLength > 0) {
                char[] buf = new char[contentLength];
                int read = reader.read(buf, 0, contentLength);
                if (read > 0) body = new String(buf, 0, read);
            }

            // Route
            if ("GET".equals(method) && "/health".equals(path)) {
                handleHealth(client);
            } else if ("POST".equals(method) && "/send".equals(path)) {
                handleSend(client, body);
            } else {
                sendResponse(client, 404, "{\"error\":\"Not found\"}");
            }
        } catch (Exception e) {
            Log.w(TAG, "Handle client error: " + e.getMessage());
            try { sendResponse(client, 500, "{\"error\":\"Internal error\"}"); } catch (Exception ignored) {}
        } finally {
            try { client.close(); } catch (Exception ignored) {}
        }
    }

    // ── Authentication ────────────────────────────────────────────────

    private boolean authenticate(String authHeader) {
        if (apiKey == null || apiKey.isEmpty()) return true; // No key = allow (legacy)
        if (authHeader == null) return false;
        // Accept "Bearer <token>" format
        if (authHeader.toUpperCase().startsWith("BEARER ")) {
            String token = authHeader.substring(7).trim();
            return apiKey.equals(token);
        }
        return false;
    }

    // ── Endpoints ─────────────────────────────────────────────────────

    private void handleHealth(Socket client) throws Exception {
        String localIp = getLocalIp();
        JSONObject json = new JSONObject();
        json.put("status", "ok");
        json.put("device", android.os.Build.MODEL);
        json.put("ip", localIp);
        json.put("port", port);
        sendResponse(client, 200, json.toString());
    }

    private void handleSend(Socket client, String body) throws Exception {
        JSONObject req = new JSONObject(body);
        String to      = req.optString("to", "");
        String message = req.optString("message", "");

        if (to.isEmpty() || message.isEmpty()) {
            sendResponse(client, 400, "{\"error\":\"Missing 'to' or 'message' field\"}");
            return;
        }

        // Send via SMS — use sim_mode from request if provided
        String simMode = req.optString("sim_mode", "sim1");
        boolean useSim2 = SmsSender.SIM_MODE_SIM2_ONLY.equals(simMode);
        int subId = useSim2 ? SmsSender.getSim2SubId(context) : SmsSender.getSim1SubId(context);
        int result;
        if (subId >= 0) {
            result = SmsSender.sendViaSubId(context, to, message, subId);
        } else {
            result = SmsSender.send(context, to, message);
        }

        // Log to phone's message history (same as OutboundPoller does)
        Log.d(TAG, "PUSH send to " + to + ": " + (result == SmsSender.RESULT_OK ? "ok" : "failed"));
        MessageLog.add(context, new MessageLog.Entry(
                to, message,
                result == SmsSender.RESULT_OK ? "ok" : "error",
                result == SmsSender.RESULT_OK ? "Sent (PUSH)" : ("Failed: SMS send error")));
        context.sendBroadcast(new Intent("com.flashsms.LOG_UPDATED"));

        JSONObject json = new JSONObject();
        json.put("success", result == SmsSender.RESULT_OK);
        json.put("to", to);
        json.put("status", result == SmsSender.RESULT_OK ? "sent" : "failed");

        int httpCode = result == SmsSender.RESULT_OK ? 200 : 502;
        sendResponse(client, httpCode, json.toString());
    }

    // ── HTTP response helper ──────────────────────────────────────────

    private void sendResponse(Socket client, int code, String body) throws Exception {
        String statusText = code == 200 ? "OK" : code == 400 ? "Bad Request"
                : code == 401 ? "Unauthorized" : code == 404 ? "Not Found" : "Internal Server Error";

        byte[] bodyBytes = body.getBytes(StandardCharsets.UTF_8);
        String header = "HTTP/1.1 " + code + " " + statusText + "\r\n"
                + "Content-Type: application/json\r\n"
                + "Content-Length: " + bodyBytes.length + "\r\n"
                + "Connection: close\r\n"
                + "Access-Control-Allow-Origin: *\r\n"
                + "\r\n";

        OutputStream out = client.getOutputStream();
        out.write(header.getBytes(StandardCharsets.UTF_8));
        out.write(bodyBytes);
        out.flush();
    }

    // ── Helpers ───────────────────────────────────────────────────────

    private String getLocalIp() {
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                for (InetAddress addr : Collections.list(ni.getInetAddresses())) {
                    if (!addr.isLoopbackAddress() && addr instanceof Inet4Address) {
                        return addr.getHostAddress();
                    }
                }
            }
        } catch (Exception ignored) {}
        return "0.0.0.0";
    }
}
