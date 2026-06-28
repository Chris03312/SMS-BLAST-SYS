package com.flashsms.gateway;

import androidx.multidex.MultiDexApplication;
import android.os.Build;
import android.util.Log;

import java.io.File;
import java.io.FileWriter;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * App — Application subclass installed via android:name in the manifest.
 *
 * Its only job is to install a global uncaught-exception handler so that any
 * fatal crash (including one that happens during Activity inflation, before any
 * UI is visible) is written to a plain-text file the operator can open with the
 * phone's built-in Files app — no adb / USB debugging required.
 *
 * File location (both written; the external one is user-visible):
 *   Internal:  /data/data/com.flashsms.gateway/files/last_crash.txt
 *   External:  Android/data/com.flashsms.gateway/files/last_crash.txt
 *
 * After saving, we still hand the exception to the platform's default handler so
 * the normal crash dialog / process kill behaviour is unchanged.
 */
public class App extends MultiDexApplication {

    private static final String TAG  = "SRMCGateway";
    private static final String FILE = "last_crash.txt";

    @Override
    public void onCreate() {
        super.onCreate();

        final Thread.UncaughtExceptionHandler previous =
                Thread.getDefaultUncaughtExceptionHandler();

        Thread.setDefaultUncaughtExceptionHandler((thread, throwable) -> {
            try {
                writeCrash(thread, throwable);
            } catch (Throwable ignored) {
                // The crash reporter must never crash.
            }
            // Preserve normal behaviour (show the system "app stopped" dialog).
            if (previous != null) previous.uncaughtException(thread, throwable);
        });
    }

    private void writeCrash(Thread thread, Throwable throwable) {
        StringWriter sw = new StringWriter();
        PrintWriter  pw = new PrintWriter(sw);

        pw.println("SRMC Gateway — crash report");
        pw.println("Time     : " + new SimpleDateFormat(
                "yyyy-MM-dd HH:mm:ss", Locale.US).format(new Date()));
        pw.println("Device   : " + Build.MANUFACTURER + " " + Build.MODEL);
        pw.println("Android  : " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")");
        pw.println("Thread   : " + thread.getName());
        pw.println();
        throwable.printStackTrace(pw);
        pw.flush();

        String report = sw.toString();
        Log.e(TAG, "FATAL — saved crash report:\n" + report);

        // Internal storage (always available).
        save(new File(getFilesDir(), FILE), report);

        // External app-specific storage (visible in the Files app, no permission needed).
        File ext = getExternalFilesDir(null);
        if (ext != null) save(new File(ext, FILE), report);
    }

    private void save(File file, String content) {
        try (FileWriter fw = new FileWriter(file, false)) {
            fw.write(content);
        } catch (Throwable ignored) {
            // Best effort only.
        }
    }
}
