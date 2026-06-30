package com.flashsms.gateway;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            SharedPreferences prefs = ctx.getSharedPreferences("settings", Context.MODE_PRIVATE);
            boolean autoStart = prefs.getBoolean("auto_start", true);
            if (autoStart) {
                try {
                    Intent svc = new Intent(ctx, GatewayService.class);
                    // startForegroundService was added in API 26 (Android 8).
                    // On older devices use startService which also works for foreground services.
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        ctx.startForegroundService(svc);
                    } else {
                        ctx.startService(svc);
                    }
                } catch (Exception e) {
                    Log.e("BootReceiver", "Failed to start GatewayService on boot: " + e.getMessage(), e);
                }
            }
        }
    }
}
