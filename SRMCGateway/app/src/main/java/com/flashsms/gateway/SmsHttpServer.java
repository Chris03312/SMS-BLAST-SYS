package com.flashsms.gateway;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.IOException;
import java.util.Map;

import fi.iki.elonen.NanoHTTPD;

/**
 * Embedded HTTP server (NanoHTTPD) that listens on a user-configured port (default 8088).
 *
 * Endpoints:
 *   POST /         — Send SMS (Traccar-compatible)
 *   POST /send     — Send SMS (explicit path)
 *   GET  /log      — Retrieve message log as JSON
 *   DELETE /log    — Clear message log
 *   GET  /health   — Health check
 */
public class SmsHttpServer extends NanoHTTPD {

    private static final String TAG          = "SmsHttpServer";
    public  static final int    DEFAULT_PORT = 8088;

    private final Context context;
    private final Gson    gson = new Gson();

    public SmsHttpServer(Context context) throws IOException {
        super(getPort(context));
        this.context = context;
        start(NanoHTTPD.SOCKET_READ_TIMEOUT, false);
        Log.d(TAG, "HTTP server started on port " + getPort(context));
    }

    public static int getPort(Context context) {
        SharedPreferences prefs = context.getSharedPreferences("settings", Context.MODE_PRIVATE);
        return prefs.getInt("port", DEFAULT_PORT);
    }

    @Override
    public Response serve(IHTTPSession session) {
        String uri    = session.getUri();
        Method method = session.getMethod();

        // ── Auth check ───────────────────────────────────────────────
        String authHeader = session.getHeaders().get("authorization");
        if (!isAuthorized(authHeader)) {
            return jsonResponse(Response.Status.UNAUTHORIZED,
                    error("Unauthorized. Provide your API key in the Authorization header."));
        }

        // ── Routes ───────────────────────────────────────────────────

        if (Method.POST.equals(method) && (uri.equals("/") || uri.equals("/send"))) {
            return handleSend(session);
        }

        if (Method.GET.equals(method) && uri.equals("/log")) {
            return handleGetLog();
        }

        if (Method.DELETE.equals(method) && uri.equals("/log")) {
            MessageLog.clear(context);
            return jsonResponse(Response.Status.OK, success("Log cleared."));
        }

        if (Method.GET.equals(method) && uri.equals("/health")) {
            JsonObject obj = new JsonObject();
            obj.addProperty("status", "ok");
            obj.addProperty("port", getPort(context));
            return jsonResponse(Response.Status.OK, obj.toString());
        }

        return jsonResponse(Response.Status.NOT_FOUND, error("Not found."));
    }

    // ── Send handler ─────────────────────────────────────────────────

    private Response handleSend(IHTTPSession session) {
        try {
            Map<String, String> body = new java.util.HashMap<>();
            session.parseBody(body);
            String raw = body.get("postData");
            if (raw == null || raw.isEmpty()) {
                return jsonResponse(Response.Status.BAD_REQUEST,
                        error("Request body is empty."));
            }

            JsonObject json;
            try {
                json = JsonParser.parseString(raw).getAsJsonObject();
            } catch (Exception e) {
                return jsonResponse(Response.Status.BAD_REQUEST, error("Invalid JSON."));
            }

            String to      = json.has("to")      ? json.get("to").getAsString().trim()      : null;
            String message = json.has("message") ? json.get("message").getAsString().trim() : null;
            boolean flash  = json.has("flash")   && json.get("flash").getAsBoolean();

            if (to == null || to.isEmpty()) {
                return jsonResponse(Response.Status.BAD_REQUEST, error("Missing 'to' field."));
            }
            if (message == null || message.isEmpty()) {
                return jsonResponse(Response.Status.BAD_REQUEST, error("Missing 'message' field."));
            }
            if (!to.startsWith("+")) {
                return jsonResponse(Response.Status.BAD_REQUEST,
                        error("Phone number must be in international format (+639...)."));
            }

            int result = FlashSmsSender.send(context, to, message, flash);

            String type = flash ? "flash" : "regular";
            if (result == FlashSmsSender.RESULT_OK) {
                MessageLog.add(context, new MessageLog.Entry(to, message, flash, "ok",
                        "Sent as " + type));
                notifyActivity();
                return jsonResponse(Response.Status.OK,
                        success("SMS sent to " + to + " (" + type + ")"));
            } else {
                MessageLog.add(context, new MessageLog.Entry(to, message, flash, "error",
                        "Send failed (code " + result + ")"));
                notifyActivity();
                return jsonResponse(Response.Status.INTERNAL_ERROR,
                        error("Failed to send SMS. Check SEND_SMS permission."));
            }
        } catch (Exception e) {
            Log.e(TAG, "handleSend error", e);
            return jsonResponse(Response.Status.INTERNAL_ERROR, error(e.getMessage()));
        }
    }

    // ── Log handler ──────────────────────────────────────────────────

    private Response handleGetLog() {
        String json = "{\"success\":true,\"log\":" + MessageLog.toJson(context) + "}";
        return jsonResponse(Response.Status.OK, json);
    }

    // ── Auth ─────────────────────────────────────────────────────────

    private boolean isAuthorized(String header) {
        String key = getApiKey();
        if (key == null || key.isEmpty()) return true;
        if (header == null) return false;
        String token = header.startsWith("Bearer ") ? header.substring(7) : header;
        return key.equals(token);
    }

    private String getApiKey() {
        SharedPreferences prefs = context.getSharedPreferences("settings", Context.MODE_PRIVATE);
        return prefs.getString("api_key", "");
    }

    // ── Helpers ──────────────────────────────────────────────────────

    private Response jsonResponse(Response.Status status, String json) {
        Response r = newFixedLengthResponse(status, "application/json", json);
        r.addHeader("Access-Control-Allow-Origin", "*");
        r.addHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
        return r;
    }

    private String success(String msg) {
        return "{\"success\":true,\"message\":\"" + esc(msg) + "\"}";
    }

    private String error(String msg) {
        return "{\"success\":false,\"error\":\"" + esc(msg) + "\"}";
    }

    private String esc(String s) {
        return s == null ? "" : s.replace("\"", "\\\"");
    }

    private void notifyActivity() {
        android.content.Intent i = new android.content.Intent("com.flashsms.LOG_UPDATED");
        context.sendBroadcast(i);
    }
}