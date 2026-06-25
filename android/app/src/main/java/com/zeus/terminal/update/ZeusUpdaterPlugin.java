package com.zeus.terminal.update;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;

import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

// [2026-06-26] In-app self-update for the sideloaded APK (not on Play Store). The web checks the
// server's latest versionCode vs the installed one and, if newer, calls downloadAndInstall: this
// downloads the APK via the system DownloadManager (with a notification) and, on completion, fires the
// Android package installer. The user still confirms the install once (OS rule for sideloaded apps) —
// it cannot be fully silent — but it's one tap instead of browser->download->find->install.
@CapacitorPlugin(name = "ZeusUpdater")
public class ZeusUpdaterPlugin extends Plugin {

    @PluginMethod
    public void getCurrentVersion(PluginCall call) {
        try {
            Context ctx = getContext();
            PackageInfo pi = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            long code = (Build.VERSION.SDK_INT >= 28) ? pi.getLongVersionCode() : (long) pi.versionCode;
            JSObject r = new JSObject();
            r.put("versionCode", code);
            r.put("versionName", pi.versionName);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("version failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        try {
            final String url = call.getString("url");
            if (url == null || url.length() == 0) { call.reject("no url"); return; }
            final Context ctx = getContext();
            final File dest = new File(ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "zeus-update.apk");
            if (dest.exists()) { try { dest.delete(); } catch (Exception _e) {} }

            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
            req.setTitle("Zeus Terminal update");
            req.setDescription("Downloading the new version…");
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            req.setMimeType("application/vnd.android.package-archive");
            req.setDestinationInExternalFilesDir(ctx, Environment.DIRECTORY_DOWNLOADS, "zeus-update.apk");

            final DownloadManager dm = (DownloadManager) ctx.getSystemService(Context.DOWNLOAD_SERVICE);
            final long id = dm.enqueue(req);

            final BroadcastReceiver onComplete = new BroadcastReceiver() {
                @Override
                public void onReceive(Context c, Intent i) {
                    long got = i.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                    if (got != id) return;
                    try { c.unregisterReceiver(this); } catch (Exception _e) {}
                    try {
                        Uri apkUri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", dest);
                        Intent install = new Intent(Intent.ACTION_VIEW);
                        install.setDataAndType(apkUri, "application/vnd.android.package-archive");
                        install.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        ctx.startActivity(install);
                    } catch (Exception _e) { /* user can install manually from the download notification */ }
                }
            };
            // System DOWNLOAD_COMPLETE broadcast → register exported (required on API 34+).
            ContextCompat.registerReceiver(ctx, onComplete,
                    new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
                    ContextCompat.RECEIVER_EXPORTED);

            JSObject r = new JSObject();
            r.put("started", true);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("update failed: " + e.getMessage());
        }
    }
}
