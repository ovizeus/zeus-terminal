package com.zeus.terminal;

import android.os.Bundle;
import android.webkit.CookieManager;

import com.getcapacitor.BridgeActivity;
import com.capacitorjs.plugins.app.AppPlugin;
import com.zeus.terminal.biometric.ZeusBiometricPlugin;
import com.zeus.terminal.widget.ZeusWidgetPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // [MOB-5 FOLLOWUP-3 2026-05-13] Explicit registerPlugin pentru
        // @capacitor/app. Cap sync 8.x ar trebui să auto-register from
        // capacitor.plugins.json DAR runtime errors "App plugin is not
        // implemented on android" indicate auto-scan nu funcționează când
        // MainActivity has explicit registerPlugin() calls pentru custom
        // plugins (Capacitor 8.x override pattern). Explicit add fixes.
        registerPlugin(AppPlugin.class);
        registerPlugin(ZeusWidgetPlugin.class);
        registerPlugin(ZeusBiometricPlugin.class);
        super.onCreate(savedInstanceState);
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        try { cm.setAcceptThirdPartyCookies(getBridge().getWebView(), true); } catch (Exception _e) {}
    }

    @Override
    public void onPause() {
        super.onPause();
        try { CookieManager.getInstance().flush(); } catch (Exception _e) {}
    }

    @Override
    public void onStop() {
        super.onStop();
        try { CookieManager.getInstance().flush(); } catch (Exception _e) {}
    }
}
