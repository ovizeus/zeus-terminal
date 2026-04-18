package com.zeus.terminal.biometric;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ZeusBiometric")
public class ZeusBiometricPlugin extends Plugin {

    private static final int AUTHENTICATORS =
            BiometricManager.Authenticators.BIOMETRIC_STRONG
                    | BiometricManager.Authenticators.BIOMETRIC_WEAK;

    @PluginMethod
    public void isAvailable(PluginCall call) {
        Context ctx = getContext();
        BiometricManager bm = BiometricManager.from(ctx);
        int status = bm.canAuthenticate(AUTHENTICATORS);
        JSObject ret = new JSObject();
        boolean available = status == BiometricManager.BIOMETRIC_SUCCESS;
        ret.put("available", available);
        if (!available) ret.put("reason", reasonFor(status));
        call.resolve(ret);
    }

    @PluginMethod
    public void authenticate(final PluginCall call) {
        final String reason = call.getString("reason", "Unlock Zeus Terminal");
        final String title = call.getString("title", "Unlock Zeus");
        final String subtitle = call.getString("subtitle", reason);
        final String cancelLabel = call.getString("cancelLabel", "Use PIN");

        final FragmentActivity activity = (FragmentActivity) getActivity();
        if (activity == null) {
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", "no_activity");
            call.resolve(ret);
            return;
        }

        new Handler(Looper.getMainLooper()).post(new Runnable() {
            @Override public void run() {
                try {
                    BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                            .setTitle(title)
                            .setSubtitle(subtitle)
                            .setNegativeButtonText(cancelLabel)
                            .setAllowedAuthenticators(AUTHENTICATORS)
                            .build();

                    BiometricPrompt prompt = new BiometricPrompt(
                            activity,
                            ContextCompat.getMainExecutor(activity),
                            new BiometricPrompt.AuthenticationCallback() {
                                @Override
                                public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                                    JSObject ret = new JSObject();
                                    ret.put("success", true);
                                    call.resolve(ret);
                                }

                                @Override
                                public void onAuthenticationError(int code, CharSequence msg) {
                                    JSObject ret = new JSObject();
                                    ret.put("success", false);
                                    ret.put("error", "code_" + code);
                                    ret.put("message", String.valueOf(msg));
                                    call.resolve(ret);
                                }

                                @Override
                                public void onAuthenticationFailed() {
                                    // Non-terminal: user's finger didn't match but they can retry.
                                    // Don't resolve here; wait for success or terminal error.
                                }
                            });

                    prompt.authenticate(info);
                } catch (Throwable t) {
                    JSObject ret = new JSObject();
                    ret.put("success", false);
                    ret.put("error", "exception");
                    ret.put("message", t.getMessage() == null ? "" : t.getMessage());
                    call.resolve(ret);
                }
            }
        });
    }

    private String reasonFor(int status) {
        switch (status) {
            case BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE: return "no_hardware";
            case BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE: return "hw_unavailable";
            case BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED: return "none_enrolled";
            case BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED: return "security_update";
            default: return "unsupported";
        }
    }
}
