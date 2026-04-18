package com.zeus.terminal.widget;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ZeusWidget")
public class ZeusWidgetPlugin extends Plugin {

    @PluginMethod
    public void updateSnapshot(PluginCall call) {
        Context ctx = getContext();
        SharedPreferences.Editor e = ctx.getSharedPreferences(
                ZeusWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE).edit();

        if (call.hasOption("balance")) e.putString("balance", call.getString("balance", "—"));
        if (call.hasOption("pnlToday")) e.putString("pnlToday", call.getString("pnlToday", "—"));
        if (call.hasOption("pnlTodayNum")) e.putFloat("pnlTodayNum", call.getFloat("pnlTodayNum", 0f));
        if (call.hasOption("openPositions")) e.putInt("openPositions", call.getInt("openPositions", 0));
        if (call.hasOption("atEnabled")) e.putBoolean("atEnabled", call.getBoolean("atEnabled", false));
        if (call.hasOption("atMode")) e.putString("atMode", call.getString("atMode", "DEMO"));
        if (call.hasOption("brainMode")) e.putString("brainMode", call.getString("brainMode", "—"));
        if (call.hasOption("brainScore")) e.putInt("brainScore", call.getInt("brainScore", 0));
        e.putLong("snapshotTs", System.currentTimeMillis());
        e.apply();

        Intent i = new Intent(ctx, ZeusWidgetProvider.class);
        i.setAction(ZeusWidgetProvider.ACTION_REFRESH);
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, ZeusWidgetProvider.class));
        if (ids != null && ids.length > 0) {
            i.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
            ctx.sendBroadcast(i);
        }

        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("widgetsActive", ids != null ? ids.length : 0);
        call.resolve(ret);
    }
}
