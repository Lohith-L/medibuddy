package com.medibuddy.app;

import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.medibuddy.app.alarm.MedicineAlarmPlugin;
import com.medibuddy.app.health.MediHealthPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-local Capacitor plugin for medicine alarms (must register before super.onCreate)
        registerPlugin(MedicineAlarmPlugin.class);
        // App-local plugin: phone step counter fallback + Health Connect revoke
        registerPlugin(MediHealthPlugin.class);
        registerPlugin(ImageToolsPlugin.class);
        super.onCreate(savedInstanceState);

        // The WebView scales text with the phone's system font size, which made
        // text too large and layouts cramped. The app already uses readable
        // sizes, so keep text at 100%.
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) {
            webView.getSettings().setTextZoom(100);
        }
    }
}
