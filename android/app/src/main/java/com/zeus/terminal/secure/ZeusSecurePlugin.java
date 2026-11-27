package com.zeus.terminal.secure;

import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// [2026-11-27] Capturile de ecran: MainActivity porneste cu FLAG_SECURE (fara capturi, fara inregistrare,
// ecran negru in lista de aplicatii recente). Dupa login, interfata cheama setSecure({on:false}) DOAR pentru
// Super Admin (operatorul trimite capturi) — client/src/core/secureScreen.ts.
@CapacitorPlugin(name = "ZeusSecure")
public class ZeusSecurePlugin extends Plugin {
    @PluginMethod
    public void setSecure(PluginCall call) {
        final boolean on = call.getBoolean("on", true);
        getActivity().runOnUiThread(() -> {
            try {
                if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
                else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
                JSObject r = new JSObject();
                r.put("on", on);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("setSecure failed", e);
            }
        });
    }
}
