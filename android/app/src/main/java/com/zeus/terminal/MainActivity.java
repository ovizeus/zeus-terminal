package com.zeus.terminal;

import android.os.Bundle;
import android.webkit.CookieManager;

import com.getcapacitor.BridgeActivity;
import com.zeus.terminal.biometric.ZeusBiometricPlugin;
import com.zeus.terminal.widget.ZeusWidgetPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
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
