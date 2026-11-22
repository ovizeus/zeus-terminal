package com.zeus.terminal.notify;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.concurrent.TimeUnit;

/**
 * [2026-11-22] Notificari pe telefon pentru mesajele importante (vezi ZeusNotifyWorker).
 *   hasToken()        → { has }
 *   setToken({token}) → salveaza cheia, porneste verificarea la 15 min si verifica imediat
 *   clearToken()      → la deconectare: opreste verificarea, sterge notificarile
 *   requestPermission() → Android 13+: cere voie pentru notificari
 *   sync()            → verifica acum (la revenirea in aplicatie / dupa citirea mesajelor)
 */
@CapacitorPlugin(name = "ZeusNotify")
public class ZeusNotifyPlugin extends Plugin {
    private static final String WORK_NAME = "zeus-notify-periodic";

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(ZeusNotifyWorker.PREFS, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void hasToken(PluginCall call) {
        String t = prefs().getString("token", null);
        JSObject r = new JSObject();
        r.put("has", t != null && !t.isEmpty());
        r.put("enabled", NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
        call.resolve(r);
    }

    @PluginMethod
    public void setToken(PluginCall call) {
        String token = call.getString("token");
        if (token == null || token.length() < 20) { call.reject("bad token"); return; }
        prefs().edit().putString("token", token).apply();
        ZeusNotifyWorker.ensureChannel(getContext());
        Constraints net = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        PeriodicWorkRequest periodic = new PeriodicWorkRequest.Builder(ZeusNotifyWorker.class, 15, TimeUnit.MINUTES)
                .setConstraints(net).build();
        WorkManager.getInstance(getContext()).enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, periodic);
        runOnce();
        call.resolve();
    }

    @PluginMethod
    public void clearToken(PluginCall call) {
        prefs().edit().remove("token").remove("seen").apply();
        WorkManager.getInstance(getContext()).cancelUniqueWork(WORK_NAME);
        NotificationManagerCompat.from(getContext()).cancelAll();
        call.resolve();
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        JSObject r = new JSObject();
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                && getActivity() != null) {
            ActivityCompat.requestPermissions(getActivity(), new String[]{Manifest.permission.POST_NOTIFICATIONS}, 7311);
            r.put("asked", true);
        } else {
            r.put("asked", false);
        }
        r.put("enabled", NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
        call.resolve(r);
    }

    @PluginMethod
    public void sync(PluginCall call) {
        runOnce();
        call.resolve();
    }

    private void runOnce() {
        Constraints net = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        WorkManager.getInstance(getContext()).enqueue(new OneTimeWorkRequest.Builder(ZeusNotifyWorker.class).setConstraints(net).build());
    }
}
