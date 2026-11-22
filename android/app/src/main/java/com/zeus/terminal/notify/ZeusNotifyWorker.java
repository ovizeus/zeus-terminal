package com.zeus.terminal.notify;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashSet;
import java.util.Set;

/**
 * [2026-11-22] Verificarea din fundal (la 15 minute, minimul Android fara Firebase):
 * GET /api/notify/pending cu cheia telefonului → o notificare pentru fiecare mesaj nou
 * (suport; la admin si conturi de aprobat). Cifra de pe iconita = notificarile Zeus active.
 * Cand nu mai e nimic de citit, notificarile Zeus se sterg (iconita ramane fara cifra).
 */
public class ZeusNotifyWorker extends Worker {
    static final String PREFS = "zeus_notify";
    static final String CHANNEL_ID = "zeus_important";
    static final String BASE_URL = "https://zeus-terminal.com";
    private static final int MAX_SEEN = 300;

    public ZeusNotifyWorker(@NonNull Context ctx, @NonNull WorkerParameters params) { super(ctx, params); }

    @NonNull
    @Override
    public Result doWork() {
        try { check(getApplicationContext()); } catch (Exception e) { return Result.success(); }
        return Result.success();
    }

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Important messages", NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("Support replies and admin requests from Zeus Terminal");
                ch.setShowBadge(true);
                nm.createNotificationChannel(ch);
            }
        }
    }

    static void check(Context ctx) throws Exception {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String token = prefs.getString("token", null);
        if (token == null || token.isEmpty()) return;

        HttpURLConnection c = (HttpURLConnection) new URL(BASE_URL + "/api/notify/pending").openConnection();
        c.setConnectTimeout(10000);
        c.setReadTimeout(10000);
        c.setRequestProperty("X-Zeus-Notify-Token", token);
        c.setRequestProperty("User-Agent", "ZeusNotify/1.0");
        int code = c.getResponseCode();
        if (code == 401) { prefs.edit().remove("token").apply(); return; } // cheie revocata
        if (code != 200) return;
        BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream()));
        StringBuilder sb = new StringBuilder();
        String ln;
        while ((ln = r.readLine()) != null) sb.append(ln);
        r.close();

        JSONObject j = new JSONObject(sb.toString());
        int badge = j.optInt("badge", 0);
        JSONArray items = j.optJSONArray("items");
        NotificationManagerCompat nm = NotificationManagerCompat.from(ctx);

        if (badge <= 0 || items == null || items.length() == 0) {
            nm.cancelAll(); // totul citit: fara notificari, fara cifra pe iconita
            return;
        }
        if (!nm.areNotificationsEnabled()) return;
        ensureChannel(ctx);

        Set<String> seen = new HashSet<>(prefs.getStringSet("seen", new HashSet<>()));
        Intent launch = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (launch == null) launch = new Intent(ctx, com.zeus.terminal.MainActivity.class);
        launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 0, launch, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        for (int i = 0; i < items.length(); i++) {
            JSONObject it = items.getJSONObject(i);
            String id = it.optString("id", "");
            if (id.isEmpty() || seen.contains(id)) continue;
            NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                    .setSmallIcon(com.zeus.terminal.R.mipmap.ic_launcher)
                    .setContentTitle(it.optString("title", "Zeus Terminal"))
                    .setContentText(it.optString("body", ""))
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(it.optString("body", "")))
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                    .setNumber(badge)
                    .setBadgeIconType(NotificationCompat.BADGE_ICON_SMALL)
                    .setAutoCancel(true)
                    .setContentIntent(pi);
            try { nm.notify(id.hashCode(), b.build()); } catch (SecurityException se) { return; }
            seen.add(id);
        }
        if (seen.size() > MAX_SEEN) seen = new HashSet<>(); // simplu: se reia curat
        prefs.edit().putStringSet("seen", seen).apply();
    }
}
