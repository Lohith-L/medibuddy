package com.medibuddy.app;

import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
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
