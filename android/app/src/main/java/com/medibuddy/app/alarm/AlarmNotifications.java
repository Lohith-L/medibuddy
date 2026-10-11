package com.medibuddy.app.alarm;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.medibuddy.app.MainActivity;
import com.medibuddy.app.R;

/** Notification channels and builders for medicine alarms. */
public final class AlarmNotifications {

    /** Ringing alarm (the service plays the sound itself, so the channel is silent). */
    static final String CHANNEL_ALARM = "medicine_alarm";
    /** Plain reminder used when "Alarm sound" is off. */
    static final String CHANNEL_REMINDER = "medicine_reminder";
    /** "Missed dose" after the alarm rang for 2 minutes without an answer. */
    static final String CHANNEL_MISSED = "medicine_missed";

    static final int ALARM_NOTIFICATION_ID = 7001;
    private static final int REMINDER_BASE = 200000;
    private static final int MISSED_BASE = 400000;

    private static final int COLOR = 0xFF3B82F6;

    private AlarmNotifications() {}

    static void ensureChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);

        NotificationChannel alarm = new NotificationChannel(
            CHANNEL_ALARM,
            "Medicine alarms",
            NotificationManager.IMPORTANCE_HIGH
        );
        alarm.setDescription("Rings like an alarm clock at medicine time");
        alarm.setSound(null, null);
        alarm.enableVibration(false);
        alarm.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(alarm);

        NotificationChannel reminder = new NotificationChannel(
            CHANNEL_REMINDER,
            "Medicine reminders",
            NotificationManager.IMPORTANCE_HIGH
        );
        reminder.setDescription("Normal notification at medicine time when alarm sound is off");
        Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        reminder.setSound(
            sound,
            new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build()
        );
        reminder.enableVibration(true);
        reminder.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(reminder);

        NotificationChannel missed = new NotificationChannel(
            CHANNEL_MISSED,
            "Missed doses",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        missed.setDescription("Tells you when a medicine alarm was not answered");
        nm.createNotificationChannel(missed);
    }

    // ── Intents ───────────────────────────────────────────────────────────

    /** Opens the full-screen alarm screen. */
    static PendingIntent alarmScreenIntent(Context ctx, AlarmPayload p, String action, int requestCode) {
        Intent i = new Intent(ctx, AlarmActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION);
        if (action != null) i.putExtra(AlarmActivity.EXTRA_ACTION, action);
        if (p != null) p.writeTo(i);
        return PendingIntent.getActivity(
            ctx,
            requestCode,
            i,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    static PendingIntent serviceIntent(Context ctx, String action, AlarmPayload p, int requestCode) {
        Intent i = new Intent(ctx, AlarmService.class).setAction(action);
        if (p != null) p.writeTo(i);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return PendingIntent.getForegroundService(
                ctx, requestCode, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        }
        return PendingIntent.getService(
            ctx, requestCode, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static PendingIntent openAppIntent(Context ctx) {
        Intent i = new Intent(ctx, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(
            ctx, 1, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    // ── Builders ──────────────────────────────────────────────────────────

    /** Ongoing notification for the ringing alarm, with full-screen intent. */
    static Notification buildAlarm(Context ctx, AlarmPayload p, int waiting) {
        ensureChannels(ctx);
        String title = "💊 Time for " + p.medicineName;
        String text = (p.dose == null || p.dose.isEmpty() ? "" : p.dose + " · ") + p.displayTime();
        if (waiting > 0) text += " · +" + waiting + " more";

        return new NotificationCompat.Builder(ctx, CHANNEL_ALARM)
            .setSmallIcon(R.drawable.ic_stat_alarm)
            .setColor(COLOR)
            .setContentTitle(title)
            .setContentText(text)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setOnlyAlertOnce(true)
            .setContentIntent(alarmScreenIntent(ctx, p, null, 10))
            .setFullScreenIntent(alarmScreenIntent(ctx, p, null, 11), true)
            .addAction(0, "✅ Taken", alarmScreenIntent(ctx, p, AlarmActivity.ACTION_TAKEN, 12))
            .addAction(0, "⏰ Snooze 10 min", serviceIntent(ctx, AlarmService.ACTION_SNOOZE, p, 13))
            .build();
    }

    /** Plain reminder (alarm sound turned off in settings). */
    static void showReminder(Context ctx, AlarmPayload p) {
        ensureChannels(ctx);
        int id = REMINDER_BASE + Math.abs(p.id % 100000);
        Notification n = new NotificationCompat.Builder(ctx, CHANNEL_REMINDER)
            .setSmallIcon(R.drawable.ic_stat_alarm)
            .setColor(COLOR)
            .setContentTitle("💊 Time for " + p.medicineName)
            .setContentText((p.dose == null || p.dose.isEmpty() ? "" : p.dose + " · ") + p.displayTime())
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent(ctx))
            .addAction(0, "✅ Taken", alarmScreenIntent(ctx, p, AlarmActivity.ACTION_TAKEN, 20 + id))
            .addAction(0, "⏰ Snooze 10 min", snoozeBroadcast(ctx, p, id))
            .build();
        notify(ctx, id, n);
    }

    /** Snooze from a plain reminder: just re-arms the alarm, no service needed. */
    private static PendingIntent snoozeBroadcast(Context ctx, AlarmPayload p, int notificationId) {
        Intent i = new Intent(ctx, AlarmReceiver.class).setAction(AlarmReceiver.ACTION_SNOOZE_FROM_REMINDER);
        i.putExtra(AlarmReceiver.EXTRA_NOTIFICATION_ID, notificationId);
        p.writeTo(i);
        return PendingIntent.getBroadcast(
            ctx, notificationId, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void cancelReminder(Context ctx, int notificationId) {
        NotificationManagerCompat.from(ctx).cancel(notificationId);
    }

    /** Removes the plain reminder notification for this dose, if shown. */
    static void cancelReminderFor(Context ctx, AlarmPayload p) {
        cancelReminder(ctx, REMINDER_BASE + Math.abs(p.id % 100000));
    }

    static void showMissed(Context ctx, AlarmPayload p) {
        ensureChannels(ctx);
        int id = MISSED_BASE + Math.abs(p.id % 100000);
        Notification n = new NotificationCompat.Builder(ctx, CHANNEL_MISSED)
            .setSmallIcon(R.drawable.ic_stat_alarm)
            .setColor(COLOR)
            .setContentTitle("Missed dose: " + p.medicineName)
            .setContentText(
                "The " + p.displayTime() + " alarm wasn't answered. Tap to open MediBuddy.")
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent(ctx))
            .build();
        notify(ctx, id, n);
    }

    private static void notify(Context ctx, int id, Notification n) {
        try {
            NotificationManagerCompat.from(ctx).notify(id, n);
        } catch (SecurityException ignored) {
            // POST_NOTIFICATIONS not granted
        }
    }
}
