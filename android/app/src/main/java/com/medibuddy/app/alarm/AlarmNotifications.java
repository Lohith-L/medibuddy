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

    /**
     * Ringing alarm (the service speaks itself, so the channel is silent).
     * Android only lets an app create a DND-bypassing channel while it has
     * "Do Not Disturb access", and channel settings can't change after
     * creation, so there are two ids: the DND one is created once access is
     * granted. The old "medicine_alarm" channel is deleted.
     */
    static final String CHANNEL_ALARM = "medicine_alarm_v2";
    static final String CHANNEL_ALARM_DND = "medicine_alarm_dnd";
    private static final String OLD_CHANNEL_ALARM = "medicine_alarm";
    /** Plain reminder used when "Alarm sound" is off. */
    static final String CHANNEL_REMINDER = "medicine_reminder";
    /** "Missed dose" after the alarm rang for 2 minutes without an answer. */
    static final String CHANNEL_MISSED = "medicine_missed";
    /** FCM: SOS from a patient (fallback notification if the alarm can't start). */
    public static final String CHANNEL_SOS = "sos_alerts";
    /** FCM: missed-dose alerts for caregivers (normal priority). */
    public static final String CHANNEL_CAREGIVER = "caregiver_alerts";

    static final int ALARM_NOTIFICATION_ID = 7001;
    private static final int REMINDER_BASE = 200000;
    private static final int MISSED_BASE = 400000;

    private static final int COLOR = 0xFF0077CE; // logo blue (the cross)

    private AlarmNotifications() {}

    static void ensureChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        // Channel names follow the app language (re-creating a channel only updates its name).
        String lang = AlarmStore.getLanguage(ctx);

        nm.deleteNotificationChannel(OLD_CHANNEL_ALARM);
        nm.createNotificationChannel(alarmChannel(CHANNEL_ALARM, AlarmTexts.get(lang, "channelAlarm")));
        if (nm.isNotificationPolicyAccessGranted()) {
            nm.createNotificationChannel(alarmChannel(CHANNEL_ALARM_DND, AlarmTexts.get(lang, "channelAlarm")));
        }

        NotificationChannel reminder = new NotificationChannel(
            CHANNEL_REMINDER,
            AlarmTexts.get(lang, "channelReminder"),
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
            AlarmTexts.get(lang, "channelMissed"),
            NotificationManager.IMPORTANCE_DEFAULT
        );
        missed.setDescription("Tells you when a medicine alarm was not answered");
        nm.createNotificationChannel(missed);

        // Caregiver pushes. SOS: loud alarm sound, vibration, over Do Not Disturb when
        // allowed, full content on the lock screen.
        NotificationChannel sos = new NotificationChannel(CHANNEL_SOS, "SOS alerts", NotificationManager.IMPORTANCE_HIGH);
        sos.setDescription("Emergency alerts from the people you look after");
        sos.setSound(
            RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM),
            new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build()
        );
        sos.enableVibration(true);
        sos.setVibrationPattern(new long[] { 0, 800, 400, 800, 400, 800 });
        sos.setBypassDnd(true); // honoured when MediBuddy has Do Not Disturb access
        sos.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(sos);

        NotificationChannel care = new NotificationChannel(CHANNEL_CAREGIVER, "Caregiver alerts", NotificationManager.IMPORTANCE_DEFAULT);
        care.setDescription("Missed doses of the people you look after");
        care.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(care);
    }

    private static NotificationChannel alarmChannel(String id, String name) {
        NotificationChannel alarm = new NotificationChannel(id, name, NotificationManager.IMPORTANCE_HIGH);
        alarm.setDescription("Speaks the medicine name at medicine time, even in Do Not Disturb");
        alarm.setSound(null, null);
        alarm.enableVibration(false);
        alarm.setBypassDnd(true); // honoured when MediBuddy has Do Not Disturb access
        alarm.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        return alarm;
    }

    /** The DND-bypassing channel when it exists, else the normal alarm channel. */
    private static String alarmChannelId(Context ctx) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        NotificationChannel dnd = nm == null ? null : nm.getNotificationChannel(CHANNEL_ALARM_DND);
        return dnd != null && dnd.canBypassDnd() ? CHANNEL_ALARM_DND : CHANNEL_ALARM;
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
        String lang = AlarmTexts.langFor(ctx, p);
        String patient = p.patientName == null ? "" : p.patientName;
        String title = p.isSos()
            ? "🚨 " + AlarmTexts.get(lang, "cgSosTitle", "patient", patient)
            : p.isCaregiver()
                ? "⚠️ " + AlarmTexts.get(lang, "cgMissedTitle", "patient", patient).replace("{name}", p.medicineName == null ? "" : p.medicineName)
                : "💊 " + AlarmTexts.get(lang, "timeFor", "name", p.medicineName);
        String text = (p.dose == null || p.dose.isEmpty() ? "" : p.dose + " · ") + p.displayTime();
        if (waiting > 0) text += " · " + AlarmTexts.get(lang, "more", "n", String.valueOf(waiting));

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, alarmChannelId(ctx))
            .setSmallIcon(R.drawable.ic_stat_medibuddy)
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
            .setFullScreenIntent(alarmScreenIntent(ctx, p, null, 11), true);
        if (p.isCaregiver()) {
            // Caregiver: just stop the alarm. Never log a dose or snooze from here.
            b.addAction(0, AlarmTexts.get(lang, p.isSos() ? "cgResponding" : "cgOk"),
                serviceIntent(ctx, AlarmService.ACTION_ACK, p, 14));
        } else {
            b.addAction(0, AlarmTexts.get(lang, "taken"), alarmScreenIntent(ctx, p, AlarmActivity.ACTION_TAKEN, 12))
                .addAction(0, AlarmTexts.get(lang, "snooze"), serviceIntent(ctx, AlarmService.ACTION_SNOOZE, p, 13));
        }
        return b.build();
    }

    /** Plain reminder (alarm sound turned off in settings). */
    static void showReminder(Context ctx, AlarmPayload p) {
        ensureChannels(ctx);
        int id = REMINDER_BASE + Math.abs(p.id % 100000);
        String lang = AlarmTexts.langFor(ctx, p);
        Notification n = new NotificationCompat.Builder(ctx, CHANNEL_REMINDER)
            .setSmallIcon(R.drawable.ic_stat_medibuddy)
            .setColor(COLOR)
            .setContentTitle("💊 " + AlarmTexts.get(lang, "timeFor", "name", p.medicineName))
            .setContentText((p.dose == null || p.dose.isEmpty() ? "" : p.dose + " · ") + p.displayTime())
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent(ctx))
            .addAction(0, AlarmTexts.get(lang, "taken"), alarmScreenIntent(ctx, p, AlarmActivity.ACTION_TAKEN, 20 + id))
            .addAction(0, AlarmTexts.get(lang, "snooze"), snoozeBroadcast(ctx, p, id))
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
        String lang = AlarmTexts.langFor(ctx, p);
        Notification n = new NotificationCompat.Builder(ctx, CHANNEL_MISSED)
            .setSmallIcon(R.drawable.ic_stat_medibuddy)
            .setColor(COLOR)
            .setContentTitle(AlarmTexts.get(lang, "missedTitle", "name", p.medicineName))
            .setContentText(AlarmTexts.get(lang, "missedText", "time", p.displayTime()))
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
