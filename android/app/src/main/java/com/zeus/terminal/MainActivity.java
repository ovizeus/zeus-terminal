package com.zeus.terminal;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.zeus.terminal.widget.ZeusWidgetPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ZeusWidgetPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
