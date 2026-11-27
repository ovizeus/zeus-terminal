package com.zeus.terminal;

import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.CookieManager;

import com.getcapacitor.BridgeActivity;
import com.capacitorjs.plugins.app.AppPlugin;
import com.zeus.terminal.biometric.ZeusBiometricPlugin;
import com.zeus.terminal.widget.ZeusWidgetPlugin;
import com.zeus.terminal.share.ZeusSharePlugin;
import com.zeus.terminal.update.ZeusUpdaterPlugin;
import com.zeus.terminal.notify.ZeusNotifyPlugin;
import com.zeus.terminal.secure.ZeusSecurePlugin;

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
        registerPlugin(ZeusSharePlugin.class);
        registerPlugin(ZeusUpdaterPlugin.class);
        // [2026-11-22] notificari pe telefon pentru mesajele importante (suport, aprobari)
        registerPlugin(ZeusNotifyPlugin.class);
        // [2026-11-27] capturile de ecran blocate pana cand interfata spune altfel (doar Super Admin)
        registerPlugin(ZeusSecurePlugin.class);
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
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
