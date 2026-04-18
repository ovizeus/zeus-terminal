package com.zeus.terminal.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.widget.RemoteViews;

import com.zeus.terminal.R;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class ZeusWidgetProvider extends AppWidgetProvider {
    private static final String TAG = "ZeusWidget";
    public static final String PREFS_NAME = "ZeusWidgetPrefs";
    public static final String ACTION_REFRESH = "com.zeus.terminal.widget.REFRESH";
    private static final ExecutorService EXEC = Executors.newSingleThreadExecutor();

    @Override
    public void onUpdate(Context context, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) render(context, mgr, id);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager mgr, int id, Bundle newOptions) {
        render(context, mgr, id);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (ACTION_REFRESH.equals(intent.getAction())) {
            AppWidgetManager mgr = AppWidgetManager.getInstance(context);
            int[] ids = mgr.getAppWidgetIds(new ComponentName(context, ZeusWidgetProvider.class));
            for (int id : ids) render(context, mgr, id);
        }
    }

    private void render(Context context, AppWidgetManager mgr, int id) {
        Bundle opts = mgr.getAppWidgetOptions(id);
        int minW = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 110);
        int minH = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 40);

        int layoutId;
        if (minW >= 250 && minH >= 110) layoutId = R.layout.widget_large;
        else if (minH >= 110) layoutId = R.layout.widget_medium;
        else layoutId = R.layout.widget_small;

        RemoteViews views = new RemoteViews(context.getPackageName(), layoutId);
        applySnapshot(context, views, layoutId);
        wireClicks(context, views);
        mgr.updateAppWidget(id, views);
        fetchPricesAsync(context, mgr, id, layoutId);
    }

    private void applySnapshot(Context context, RemoteViews views, int layoutId) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String balance = prefs.getString("balance", "—");
        String pnl = prefs.getString("pnlToday", "—");
        float pnlVal = prefs.getFloat("pnlTodayNum", 0f);
        int pos = prefs.getInt("openPositions", 0);
        boolean atOn = prefs.getBoolean("atEnabled", false);
        String mode = prefs.getString("atMode", "DEMO");
        String brainMode = prefs.getString("brainMode", "—");
        int brainScore = prefs.getInt("brainScore", 0);
        long ts = prefs.getLong("snapshotTs", 0L);

        int pnlColor;
        if (pnlVal > 0) pnlColor = Color.parseColor("#22cc66");
        else if (pnlVal < 0) pnlColor = Color.parseColor("#ff4455");
        else pnlColor = Color.parseColor("#aab8c8");

        if (layoutId == R.layout.widget_medium || layoutId == R.layout.widget_large) {
            views.setTextViewText(R.id.wBalance, balance);
            views.setTextViewText(R.id.wPnl, pnl);
            views.setTextColor(R.id.wPnl, pnlColor);
            views.setTextViewText(R.id.wPositions, pos + " open");
            views.setTextViewText(R.id.wAt, "AT " + (atOn ? "ON" : "OFF") + " · " + mode);
            views.setTextColor(R.id.wAt, atOn ? Color.parseColor("#22cc66") : Color.parseColor("#556677"));
        }
        if (layoutId == R.layout.widget_large) {
            views.setTextViewText(R.id.wBrain, "Brain " + brainMode + " (" + brainScore + ")");
        }

        String staleLabel = (ts > 0 && System.currentTimeMillis() - ts > 15 * 60 * 1000L) ? " · stale" : "";
        if (layoutId != R.layout.widget_small) {
            views.setTextViewText(R.id.wStatus, "Zeus" + staleLabel);
        }
    }

    private void fetchPricesAsync(final Context context, final AppWidgetManager mgr, final int id, final int layoutId) {
        EXEC.execute(new Runnable() {
            @Override
            public void run() {
                String btcPrice = "—", btcChg = "";
                String ethPrice = "—", ethChg = "";
                float btcChgNum = 0f, ethChgNum = 0f;
                try {
                    String btcJson = httpGet("https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT");
                    JSONObject b = new JSONObject(btcJson);
                    double bp = b.getDouble("lastPrice");
                    double bc = b.getDouble("priceChangePercent");
                    btcChgNum = (float) bc;
                    btcPrice = "$" + formatPrice(bp);
                    btcChg = (bc >= 0 ? "+" : "") + String.format("%.2f", bc) + "%";
                } catch (Exception e) { Log.w(TAG, "BTC fetch failed", e); }
                try {
                    String ethJson = httpGet("https://api.binance.com/api/v3/ticker/24hr?symbol=ETHUSDT");
                    JSONObject e2 = new JSONObject(ethJson);
                    double ep = e2.getDouble("lastPrice");
                    double ec = e2.getDouble("priceChangePercent");
                    ethChgNum = (float) ec;
                    ethPrice = "$" + formatPrice(ep);
                    ethChg = (ec >= 0 ? "+" : "") + String.format("%.2f", ec) + "%";
                } catch (Exception e) { Log.w(TAG, "ETH fetch failed", e); }

                final String fBtc = btcPrice, fBtcCh = btcChg;
                final String fEth = ethPrice, fEthCh = ethChg;
                final float fBtcN = btcChgNum, fEthN = ethChgNum;

                new Handler(Looper.getMainLooper()).post(new Runnable() {
                    @Override public void run() {
                        RemoteViews v = new RemoteViews(context.getPackageName(), layoutId);
                        applySnapshot(context, v, layoutId);
                        v.setTextViewText(R.id.wBtc, fBtc);
                        v.setTextViewText(R.id.wBtcChg, fBtcCh);
                        v.setTextColor(R.id.wBtcChg, fBtcN >= 0 ? Color.parseColor("#22cc66") : Color.parseColor("#ff4455"));
                        if (layoutId == R.layout.widget_large) {
                            v.setTextViewText(R.id.wEth, fEth);
                            v.setTextViewText(R.id.wEthChg, fEthCh);
                            v.setTextColor(R.id.wEthChg, fEthN >= 0 ? Color.parseColor("#22cc66") : Color.parseColor("#ff4455"));
                        }
                        wireClicks(context, v);
                        mgr.updateAppWidget(id, v);
                    }
                });
            }
        });
    }

    private void wireClicks(Context context, RemoteViews views) {
        Intent launchIntent = context.getPackageManager()
                .getLaunchIntentForPackage(context.getPackageName());
        if (launchIntent == null) {
            launchIntent = new Intent(context, com.zeus.terminal.MainActivity.class);
        }
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(context, 0, launchIntent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        views.setOnClickPendingIntent(R.id.wRoot, pi);

        Intent refreshIntent = new Intent(context, ZeusWidgetProvider.class);
        refreshIntent.setAction(ACTION_REFRESH);
        PendingIntent refreshPi = PendingIntent.getBroadcast(context, 1, refreshIntent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        views.setOnClickPendingIntent(R.id.wRefresh, refreshPi);
    }

    private String httpGet(String urlStr) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(urlStr).openConnection();
        c.setConnectTimeout(6000);
        c.setReadTimeout(6000);
        c.setRequestProperty("User-Agent", "ZeusWidget/1.0");
        BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream()));
        StringBuilder sb = new StringBuilder();
        String ln;
        while ((ln = r.readLine()) != null) sb.append(ln);
        r.close();
        return sb.toString();
    }

    private String formatPrice(double p) {
        if (p >= 1000) return String.format("%,.0f", p);
        if (p >= 10) return String.format("%.2f", p);
        return String.format("%.4f", p);
    }
}
