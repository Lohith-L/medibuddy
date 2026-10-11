package com.medibuddy.app.health;

import android.Manifest;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;

import androidx.core.content.ContextCompat;

import java.util.Calendar;
import java.util.concurrent.atomic.AtomicBoolean;

/** Reads the hardware step counter once and keeps the background readings scheduled. */
public final class StepSensor {

    public interface Callback {
        /** counter = steps since boot, or null if no reading was possible. */
        void onResult(Float counter);
    }

    static final String ACTION_READ = "com.medibuddy.app.steps.READ";
    private static final long TIMEOUT_MS = 4000;

    private StepSensor() {}

    public static boolean isAvailable(Context ctx) {
        SensorManager sm = (SensorManager) ctx.getSystemService(Context.SENSOR_SERVICE);
        return sm != null && sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) != null;
    }

    public static boolean hasPermission(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true; // install-time before Android 10
        return ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACTIVITY_RECOGNITION)
            == PackageManager.PERMISSION_GRANTED;
    }

    /** Reads the counter (waits up to 4 s for the first event) and records it in StepStore. */
    public static void readAndRecord(Context ctx, Callback cb) {
        Context app = ctx.getApplicationContext();
        SensorManager sm = (SensorManager) app.getSystemService(Context.SENSOR_SERVICE);
        Sensor sensor = sm == null ? null : sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER);
        if (sensor == null || !hasPermission(app)) {
            cb.onResult(null);
            return;
        }
        HandlerThread thread = new HandlerThread("step-counter");
        thread.start();
        Handler handler = new Handler(thread.getLooper());
        AtomicBoolean done = new AtomicBoolean(false);

        SensorEventListener listener = new SensorEventListener() {
            @Override
            public void onSensorChanged(SensorEvent event) {
                if (done.getAndSet(true)) return;
                sm.unregisterListener(this);
                float value = event.values[0];
                StepStore.record(app, value);
                thread.quitSafely();
                cb.onResult(value);
            }

            @Override
            public void onAccuracyChanged(Sensor s, int accuracy) {}
        };
        sm.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_NORMAL, handler);
        handler.postDelayed(() -> {
            if (done.getAndSet(true)) return;
            sm.unregisterListener(listener);
            thread.quitSafely();
            cb.onResult(null);
        }, TIMEOUT_MS);
    }

    /**
     * Keeps daily totals accurate while the app is closed: a reading just after
     * midnight (closes the day) plus hourly readings while the phone is awake.
     */
    public static void scheduleBackgroundReadings(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        if (!StepStore.isEnabled(ctx) || !isAvailable(ctx) || !hasPermission(ctx)) {
            cancelBackgroundReadings(ctx);
            return;
        }

        Calendar midnight = Calendar.getInstance();
        midnight.add(Calendar.DAY_OF_YEAR, 1);
        midnight.set(Calendar.HOUR_OF_DAY, 0);
        midnight.set(Calendar.MINUTE, 0);
        midnight.set(Calendar.SECOND, 30);
        midnight.set(Calendar.MILLISECOND, 0);
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, midnight.getTimeInMillis(), pending(ctx, "midnight"));

        am.setInexactRepeating(
            AlarmManager.RTC, // hourly readings only when the phone is awake anyway
            System.currentTimeMillis() + AlarmManager.INTERVAL_HOUR,
            AlarmManager.INTERVAL_HOUR,
            pending(ctx, "hourly")
        );
    }

    public static void cancelBackgroundReadings(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        am.cancel(pending(ctx, "midnight"));
        am.cancel(pending(ctx, "hourly"));
    }

    private static PendingIntent pending(Context ctx, String kind) {
        Intent i = new Intent(ctx, StepReceiver.class).setAction(ACTION_READ).putExtra("kind", kind);
        i.setData(android.net.Uri.parse("medibuddy-steps://" + kind));
        return PendingIntent.getBroadcast(ctx, kind.hashCode(), i,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
