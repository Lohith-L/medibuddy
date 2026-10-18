package com.medibuddy.app.alarm;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import com.medibuddy.app.MainActivity;
import com.medibuddy.app.R;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Caregiver "SOS watcher": a foreground service that asks the server every
 * POLL_MS for this caregiver's active SOS alerts (rpc sos_watch_poll with the
 * phone's watch key) and rings the full-screen caregiver alarm. Backup for FCM
 * push: works with MediBuddy closed, and also when push is missing or delayed.
 *
 * Same alarm ids as push / Realtime (sos_event_id), so an SOS never rings
 * twice; an alert that is no longer active (acknowledged, patient safe) stops.
 * Started by the app for caregivers, after reboot by BootReceiver; stopped on logout.
 */
public class SosWatchService extends Service {
    private static final String TAG = "SosWatch";
    private static final String PREFS = "medibuddy_sos_watch";
    private static final String CHANNEL = "sos_watch";
    private static final int NOTIFICATION_ID = 7301;
    private static final long POLL_MS = 15_000;

    private HandlerThread thread;
    private Handler handler;
    private PowerManager.WakeLock wakeLock;
    /** SOS ids this watcher started ringing (to stop them when no longer active). */
    private final Set<String> ringing = new HashSet<>();
    private int failures = 0;

    // ── Control (from MedicineAlarmPlugin / BootReceiver) ──────────────────

    public static void start(Context ctx, String url, String anonKey, String watchKey) {
        prefs(ctx).edit().putString("url", url).putString("anon", anonKey).putString("key", watchKey).apply();
        startIfConfigured(ctx);
    }

    public static void startIfConfigured(Context ctx) {
        if (prefs(ctx).getString("key", null) == null) return;
        try {
            ContextCompat.startForegroundService(ctx, new Intent(ctx, SosWatchService.class));
        } catch (Exception e) {
            Log.w(TAG, "could not start the SOS watcher", e);
        }
    }

    public static void stop(Context ctx) {
        prefs(ctx).edit().clear().apply();
        ctx.stopService(new Intent(ctx, SosWatchService.class));
    }

    public static boolean isConfigured(Context ctx) {
        return prefs(ctx).getString("key", null) != null;
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ── Service ─────────────────────────────────────────────────────────────

    @Override
    public void onCreate() {
        super.onCreate();
        thread = new HandlerThread("sos-watch");
        thread.start();
        handler = new Handler(thread.getLooper());
        // Polls must keep running with the screen off (CPU asleep otherwise).
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MediBuddy:SosWatch");
        wakeLock.setReferenceCounted(false);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!isConfigured(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        Notification n = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIFICATION_ID, n);
        }
        if (!wakeLock.isHeld()) wakeLock.acquire();
        handler.removeCallbacksAndMessages(null);
        handler.post(this::pollLoop);
        return START_STICKY; // restarted by Android if it kills us
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        thread.quitSafely();
        if (wakeLock.isHeld()) wakeLock.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ── Polling ─────────────────────────────────────────────────────────────

    private void pollLoop() {
        long next = POLL_MS;
        try {
            poll();
            failures = 0;
        } catch (Exception e) {
            failures++;
            // Offline: back off a little (max 60 s) so the battery isn't wasted.
            next = Math.min(60_000, POLL_MS * Math.min(4, failures));
            Log.w(TAG, "poll failed (" + failures + "): " + e.getMessage());
        }
        if (isConfigured(this)) handler.postDelayed(this::pollLoop, next);
        else stopSelf();
    }

    private void poll() throws Exception {
        SharedPreferences p = prefs(this);
        String base = p.getString("url", null), anon = p.getString("anon", null), key = p.getString("key", null);
        if (base == null || anon == null || key == null) return;

        HttpURLConnection c = (HttpURLConnection) new URL(base + "/rest/v1/rpc/sos_watch_poll").openConnection();
        c.setConnectTimeout(10_000);
        c.setReadTimeout(10_000);
        c.setRequestMethod("POST");
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        c.setRequestProperty("apikey", anon);
        c.setRequestProperty("Authorization", "Bearer " + anon);
        try (OutputStream os = c.getOutputStream()) {
            os.write(new JSONObject().put("p_key", key).toString().getBytes(StandardCharsets.UTF_8));
        }
        int code = c.getResponseCode();
        String body = read(code >= 400 ? c.getErrorStream() : c.getInputStream());
        c.disconnect();
        if (code == 404) throw new Exception("sos_watch_poll not found: apply migration 20261017100000_sos_watch.sql");
        if (code >= 400) throw new Exception("HTTP " + code + " " + body);

        JSONObject res = new JSONObject(body);
        if (!res.optBoolean("valid", false)) {
            Log.i(TAG, "watch key no longer valid (logged out elsewhere): stopping");
            stop(this);
            return;
        }
        JSONArray active = res.optJSONArray("active");
        Set<String> now = new HashSet<>();
        for (int i = 0; active != null && i < active.length(); i++) {
            JSONObject a = active.getJSONObject(i);
            String id = a.optString("sos_event_id");
            if (id.isEmpty()) continue;
            now.add(id);
            if (ringing.contains(id) && AlarmService.current() != null) continue;
            Map<String, String> data = new HashMap<>();
            data.put("type", "sos");
            data.put("sos_event_id", id);
            data.put("patient_name", a.optString("patient_name"));
            Log.i(TAG, "active SOS " + id + ": ringing");
            CaregiverPush.ringSos(getApplicationContext(), data);
            ringing.add(id);
        }
        // Answered elsewhere / patient safe: stop what this watcher rang.
        for (String id : new HashSet<>(ringing)) {
            if (now.contains(id)) continue;
            Map<String, String> data = new HashMap<>();
            data.put("sos_event_id", id);
            CaregiverPush.stopSos(getApplicationContext(), data);
            ringing.remove(id);
        }
    }

    private static String read(InputStream in) throws Exception {
        if (in == null) return "";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        in.close();
        return out.toString("UTF-8");
    }

    // ── Persistent notification ─────────────────────────────────────────────

    private Notification buildNotification() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "SOS watch", NotificationManager.IMPORTANCE_MIN);
            ch.setDescription("Keeps MediBuddy ready to ring when someone you look after needs help");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        PendingIntent open = PendingIntent.getActivity(
            this, NOTIFICATION_ID,
            new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_medibuddy)
            .setContentTitle("Watching for SOS alerts")
            .setContentText("MediBuddy will ring if someone you look after needs help.")
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(open)
            .build();
    }
}
