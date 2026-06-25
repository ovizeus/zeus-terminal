package com.zeus.terminal.share;

import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

// [2026-06-26] Native bridge so the referral promo image can be SHARED (Android share sheet) and
// SAVED to the Gallery from inside the Capacitor WebView, where navigator.share / <a download> /
// long-press do not work. The web calls these via Capacitor.Plugins.ZeusShare.
@CapacitorPlugin(name = "ZeusShare")
public class ZeusSharePlugin extends Plugin {

    // Accept a data URL ("data:image/png;base64,....") or raw base64.
    private byte[] decode(String data) {
        if (data == null) return null;
        int comma = data.indexOf(',');
        String b64 = (data.startsWith("data:") && comma >= 0) ? data.substring(comma + 1) : data;
        return Base64.decode(b64, Base64.DEFAULT);
    }

    @PluginMethod
    public void shareImage(PluginCall call) {
        try {
            byte[] bytes = decode(call.getString("data"));
            String text = call.getString("text", "");
            if (bytes == null || bytes.length == 0) { call.reject("no image data"); return; }
            Context ctx = getContext();
            File dir = new File(ctx.getCacheDir(), "shared");
            if (!dir.exists()) dir.mkdirs();
            File f = new File(dir, "zeus-invite.png");
            FileOutputStream fos = new FileOutputStream(f);
            fos.write(bytes); fos.flush(); fos.close();
            Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", f);
            Intent intent = new Intent(Intent.ACTION_SEND);
            intent.setType("image/png");
            intent.putExtra(Intent.EXTRA_STREAM, uri);
            if (text != null && text.length() > 0) intent.putExtra(Intent.EXTRA_TEXT, text);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(intent, "Share invite");
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            ctx.startActivity(chooser);
            JSObject ret = new JSObject(); ret.put("shared", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("share failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void saveImage(PluginCall call) {
        try {
            byte[] bytes = decode(call.getString("data"));
            if (bytes == null || bytes.length == 0) { call.reject("no image data"); return; }
            Context ctx = getContext();
            String name = "zeus-invite-" + System.currentTimeMillis() + ".png";
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.Images.Media.DISPLAY_NAME, name);
                cv.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
                cv.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Zeus");
                cv.put(MediaStore.Images.Media.IS_PENDING, 1);
                Uri uri = ctx.getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv);
                if (uri == null) { call.reject("save failed: no uri"); return; }
                OutputStream os = ctx.getContentResolver().openOutputStream(uri);
                os.write(bytes); os.flush(); os.close();
                cv.clear(); cv.put(MediaStore.Images.Media.IS_PENDING, 0);
                ctx.getContentResolver().update(uri, cv, null, null);
            } else {
                File pics = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES);
                File zeus = new File(pics, "Zeus"); if (!zeus.exists()) zeus.mkdirs();
                File f = new File(zeus, name);
                FileOutputStream fos = new FileOutputStream(f); fos.write(bytes); fos.flush(); fos.close();
                MediaStore.Images.Media.insertImage(ctx.getContentResolver(), f.getAbsolutePath(), name, "Zeus invite");
            }
            JSObject ret = new JSObject(); ret.put("saved", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("save failed: " + e.getMessage());
        }
    }
}
