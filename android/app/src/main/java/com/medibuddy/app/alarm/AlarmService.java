package com.medibuddy.app.alarm;

import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.ServiceCompat;

import java.util.ArrayList;
import java.util.List;

/**
 * Foreground service that rings the alarm: loops the alarm sound on the ALARM
 * stream (plays in silent / Do Not Disturb when alarms are allowed), vibrates,
 * and keeps a full-screen notification up until the user answers.
 *
 * Several medicines due at once are queued and shown one after another.
 * Each one rings for at most 2 minutes, then becomes a "Missed dose" notification.
 */
public class AlarmService extends Service {

    private static final String TAG = "MedicineAlarm";

    public static final String ACTION_START = "com.medibuddy.app.alarm.START";
    public static final String ACTION_TAKEN = "com.medibuddy.app.alarm.TAKEN";
    public static final String ACTION_SNOOZE = "com.medibuddy.app.alarm.SNOOZE";
    public static final String ACTION_DISMISS_ALL = "com.medibuddy.app.alarm.DISMISS_ALL";

    private static final long RING_TIMEOUT_MS = 2 * 60 * 1000L;

    /** Lets the alarm screen follow what is ringing. Same process, main thread only. */
    public interface Listener {
        void onAlarmChanged(@Nullable AlarmPayload current, int waiting);
    }

    private static AlarmService instance;
    private static Listener listener;

    private final List<AlarmPayload> queue = new ArrayList<>();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable timeout = this::onTimeout;

    private MediaPlayer player;
    private Vibrator vibrator;
    private PowerManager.WakeLock wakeLock;
    private boolean inForeground;

    // ── Static access for AlarmActivity ───────────────────────────────────

    @Nullable
    public static AlarmPayload current() {
        AlarmService s = instance;
        return s == null || s.queue.isEmpty() ? null : s.queue.get(0);
    }

    public static int waitingCount() {
        AlarmService s = instance;
        return s == null ? 0 : Math.max(0, s.queue.size() - 1);
    }

    public static void setListener(@Nullable Listener l) {
        listener = l;
    }

    /** Sends a command (taken / snooze) to the running service. */
    public static void send(Context ctx, String action, @Nullable AlarmPayload p) {
        Intent i = new Intent(ctx, AlarmService.class).setAction(action);
        if (p != null) p.writeTo(i);
        try {
            ctx.startService(i);
        } catch (Exception e) {
            Log.w(TAG, "Could not reach alarm service", e);
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        AlarmPayload payload = AlarmPayload.from(intent);

        // Every start via startForegroundService() must call startForeground() promptly.
        if (!inForeground) {
            AlarmPayload shown = payload != null ? payload : current();
            if (shown == null) {
                stopSelf();
                return START_NOT_STICKY;
            }
            goForeground(shown);
        }

        if (ACTION_START.equals(action) && payload != null) {
            enqueue(payload);
        } else if (ACTION_TAKEN.equals(action)) {
            AlarmPayload done = resolve(payload);
            if (done != null) {
                AlarmStore.addPendingAction(this, done, "taken");
                MedicineAlarmPlugin.notifyDoseAction();
                finishCurrent(done);
            }
        } else if (ACTION_SNOOZE.equals(action)) {
            AlarmPayload snoozed = resolve(payload);
            if (snoozed != null) {
                AlarmScheduler.snooze(this, snoozed);
                finishCurrent(snoozed);
            }
        } else if (ACTION_DISMISS_ALL.equals(action)) {
            queue.clear();
            stopEverything();
        }

        if (queue.isEmpty()) stopEverything();
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        stopRinging();
        handler.removeCallbacksAndMessages(null);
        releaseWakeLock();
        if (instance == this) instance = null;
        notifyListener();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ── Queue handling ────────────────────────────────────────────────────

    private void enqueue(AlarmPayload p) {
        for (AlarmPayload q : queue) {
            if (q.id == p.id) return; // already ringing for this reminder
        }
        queue.add(p);
        if (queue.size() == 1) {
            startRinging();
            restartTimeout();
        }
        updateNotification();
        notifyListener();
    }

    /** The payload the user acted on: the one sent, or whatever is ringing now. */
    @Nullable
    private AlarmPayload resolve(@Nullable AlarmPayload sent) {
        if (sent != null) {
            for (AlarmPayload q : queue) {
                if (q.id == sent.id) return q;
            }
            // Not ringing any more (e.g. it already timed out): still honour the action.
            return sent;
        }
        return current();
    }

    private void finishCurrent(AlarmPayload p) {
        boolean wasFirst = !queue.isEmpty() && queue.get(0).id == p.id;
        queue.remove(p);
        if (queue.isEmpty()) return;
        if (wasFirst) restartTimeout();
        updateNotification();
        notifyListener();
    }

    private void onTimeout() {
        AlarmPayload p = current();
        if (p == null) return;
        Log.i(TAG, "Alarm #" + p.id + " not answered in 2 minutes");
        AlarmNotifications.showMissed(this, p);
        queue.remove(0);
        if (queue.isEmpty()) {
            stopEverything();
        } else {
            restartTimeout();
            updateNotification();
            notifyListener();
        }
    }

    private void restartTimeout() {
        handler.removeCallbacks(timeout);
        handler.postDelayed(timeout, RING_TIMEOUT_MS);
    }

    private void stopEverything() {
        stopRinging();
        handler.removeCallbacks(timeout);
        releaseWakeLock();
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        inForeground = false;
        notifyListener();
        stopSelf();
    }

    // ── Foreground notification ───────────────────────────────────────────

    private void goForeground(AlarmPayload p) {
        Notification n = AlarmNotifications.buildAlarm(this, p, 0);
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
            ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
            : 0;
        ServiceCompat.startForeground(this, AlarmNotifications.ALARM_NOTIFICATION_ID, n, type);
        inForeground = true;
    }

    private void updateNotification() {
        AlarmPayload p = current();
        if (p == null) return;
        try {
            NotificationManagerCompat.from(this).notify(
                AlarmNotifications.ALARM_NOTIFICATION_ID,
                AlarmNotifications.buildAlarm(this, p, waitingCount())
            );
        } catch (SecurityException ignored) {
        }
    }

    private void notifyListener() {
        Listener l = listener;
        if (l != null) l.onAlarmChanged(current(), waitingCount());
    }

    // ── Sound, vibration, wake lock ───────────────────────────────────────

    private void startRinging() {
        acquireWakeLock();
        startSound();
        startVibration();
    }

    private void startSound() {
        if (player != null) return;
        Uri uri = RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_ALARM);
        if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        try {
            player = new MediaPlayer();
            player.setAudioAttributes(
                new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            );
            player.setDataSource(this, uri);
            player.setLooping(true);
            player.prepare();
            player.start();
        } catch (Exception e) {
            Log.e(TAG, "Could not play alarm sound", e);
            if (player != null) {
                player.release();
                player = null;
            }
        }
    }

    private void startVibration() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager vm = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            vibrator = vm != null ? vm.getDefaultVibrator() : null;
        } else {
            vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        }
        if (vibrator == null || !vibrator.hasVibrator()) return;
        long[] pattern = { 0, 800, 600 };
        AudioAttributes attrs = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0), attrs);
        } else {
            vibrator.vibrate(pattern, 0, attrs);
        }
    }

    private void stopRinging() {
        if (player != null) {
            try {
                player.stop();
            } catch (Exception ignored) {
            }
            player.release();
            player = null;
        }
        if (vibrator != null) {
            vibrator.cancel();
            vibrator = null;
        }
    }

    private void acquireWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) return;
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MediBuddy:MedicineAlarm");
        // Safety net: never hold it longer than a few alarms' worth of ringing.
        wakeLock.acquire(10 * 60 * 1000L);
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
    }
}
