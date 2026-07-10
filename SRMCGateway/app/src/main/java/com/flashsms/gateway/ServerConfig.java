package com.flashsms.gateway;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Stores and retrieves the SRMC SMS Server address (IP + port).
 * The gateway will not start unless this server is reachable.
 */
public class ServerConfig {

    private static final String PREFS    = "settings";
    private static final String KEY_IP   = "srmc_server_ip";
    private static final String KEY_PORT = "srmc_server_port";

    public static final String DEFAULT_IP   = "192.168.3.239";
    public static final int    DEFAULT_PORT = 3003;

    public static String getIp(Context ctx) {
        return prefs(ctx).getString(KEY_IP, DEFAULT_IP);
    }

    public static int getPort(Context ctx) {
        return prefs(ctx).getInt(KEY_PORT, DEFAULT_PORT);
    }

    /**
     * Full base URL.
     *  - If the "IP" field holds a full URL (http:// or https://), use it as-is.
     *    This lets the phone point at a central server over the internet, e.g.
     *    "https://your-name.ngrok-free.dev" (no port needed).
     *  - Otherwise build "http://<ip>:<port>" for same-LAN use.
     */
    public static String getBaseUrl(Context ctx) {
        String ip = getIp(ctx).trim();
        if (ip.startsWith("http://") || ip.startsWith("https://")) {
            return ip.replaceAll("/+$", ""); // strip trailing slash
        }
        return "http://" + ip + ":" + getPort(ctx);
    }

    /** Ping URL the gateway checks before starting. */
    public static String getPingUrl(Context ctx) {
        return getBaseUrl(ctx) + "/api/ping";
    }

    public static void setIp(Context ctx, String ip) {
        prefs(ctx).edit().putString(KEY_IP, ip.trim()).apply();
    }

    public static void setPort(Context ctx, int port) {
        prefs(ctx).edit().putInt(KEY_PORT, port).apply();
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
