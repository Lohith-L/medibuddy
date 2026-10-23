package com.medibuddy.app;

import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * ReportPlugin
 *
 * Provides native printing and file export for health reports on Android:
 * - printReport: Uses Android PrintManager so users can directly "Save as PDF"
 *   or print via Android's native print service.
 * - downloadReport: Saves the HTML report directly to the device's public Downloads directory.
 * - shareReport: Writes report to cache and shares via Android's native share sheet (FileProvider).
 */
@CapacitorPlugin(name = "ReportPlugin")
public class ReportPlugin extends Plugin {

    /** Kept until printing is done: a WebView with no reference can be garbage-collected mid-print. */
    private WebView printWebView;

    @PluginMethod
    public void printReport(PluginCall call) {
        String html = call.getString("html");
        String title = call.getString("title", "Health Report");
        if (html == null || html.isEmpty()) {
            call.reject("html is required");
            return;
        }

        getActivity().runOnUiThread(() -> {
            try {
                WebView webView = new WebView(getContext());
                printWebView = webView;
                webView.getSettings().setJavaScriptEnabled(true);
                webView.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, String url) {
                        try {
                            PrintManager printManager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                            if (printManager != null) {
                                PrintDocumentAdapter printAdapter = webView.createPrintDocumentAdapter(title);
                                // A4 by default (standard paper in India); the user can still change it.
                                printManager.print(title, printAdapter, new PrintAttributes.Builder()
                                    .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                                    .build());
                                call.resolve();
                            } else {
                                call.reject("PrintManager service not available");
                            }
                        } catch (Exception e) {
                            call.reject("Failed to trigger print: " + e.getMessage(), e);
                        }
                    }
                });
                webView.loadDataWithBaseURL("https://medibuddy.app", html, "text/html", "UTF-8", null);
            } catch (Exception e) {
                call.reject("Failed to initialize print WebView: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void downloadReport(PluginCall call) {
        String html = call.getString("html");
        String fileName = call.getString("fileName", "Health-Report.html");
        if (html == null || html.isEmpty()) {
            call.reject("html is required");
            return;
        }

        new Thread(() -> {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
                    values.put(MediaStore.Downloads.MIME_TYPE, "text/html");
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    Uri uri = getContext().getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) {
                        throw new IOException("Failed to create download entry in MediaStore");
                    }
                    try (OutputStream os = getContext().getContentResolver().openOutputStream(uri)) {
                        if (os == null) {
                            throw new IOException("Failed to open output stream");
                        }
                        os.write(html.getBytes(StandardCharsets.UTF_8));
                        os.flush();
                    }
                } else {
                    File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                    if (!downloadsDir.exists()) {
                        downloadsDir.mkdirs();
                    }
                    File outFile = new File(downloadsDir, fileName);
                    try (FileOutputStream fos = new FileOutputStream(outFile)) {
                        fos.write(html.getBytes(StandardCharsets.UTF_8));
                        fos.flush();
                    }
                }

                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("fileName", fileName);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Could not save report file: " + e.getMessage(), e);
            }
        }, "download-report").start();
    }

    @PluginMethod
    public void shareReport(PluginCall call) {
        String html = call.getString("html");
        String fileName = call.getString("fileName", "Health-Report.html");
        String title = call.getString("title", "Health Report");
        if (html == null || html.isEmpty()) {
            call.reject("html is required");
            return;
        }

        new Thread(() -> {
            try {
                File cacheDir = new File(getContext().getCacheDir(), "reports");
                if (!cacheDir.exists()) {
                    cacheDir.mkdirs();
                }
                File reportFile = new File(cacheDir, fileName);
                try (FileOutputStream fos = new FileOutputStream(reportFile)) {
                    fos.write(html.getBytes(StandardCharsets.UTF_8));
                    fos.flush();
                }

                Uri uri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    reportFile
                );

                getActivity().runOnUiThread(() -> {
                    try {
                        Intent sendIntent = new Intent(Intent.ACTION_SEND);
                        sendIntent.setType("text/html");
                        sendIntent.putExtra(Intent.EXTRA_STREAM, uri);
                        sendIntent.putExtra(Intent.EXTRA_SUBJECT, title);
                        sendIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                        Intent chooser = Intent.createChooser(sendIntent, title);
                        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        getContext().startActivity(chooser);
                        call.resolve();
                    } catch (Exception e) {
                        call.reject("Failed to open share chooser: " + e.getMessage(), e);
                    }
                });
            } catch (Exception e) {
                call.reject("Failed to prepare report for sharing: " + e.getMessage(), e);
            }
        }, "share-report").start();
    }
}
