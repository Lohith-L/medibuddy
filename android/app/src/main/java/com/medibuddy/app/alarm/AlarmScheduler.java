package com.medibuddy.app.alarm;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import com.medibuddy.app.MainActivity;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Schedules alarms with AlarmManager.setAlarmClock(): exact, allowed in Doze,
 * and shown as the "next alarm" in the status bar.
 *
 * Daily reminders are one-shot alarms that schedule the next day's alarm when
 * they fire (AlarmReceiver), which stays exact on every Android version.
 */
public final class AlarmScheduler {

    private static final String TAG = "MedicineAlarm";

    static final String ACTION_FIRE = "com.medibuddy.app.alarm.FIRE";
    static final String ACTION_SNOOZE_FIRE = "com.medibuddy.app.alarm.SNOOZE_FIRE";

    public static final long SNOOZE_MS = 10 * 60 * 1000L;

    private AlarmScheduler() {}

    // ── Public API ────────────────────────────────────────────────────────

    /** Schedules the next occurrence of a reminder. Returns the trigger time or -1. */
    public static long schedule(Context ctx, AlarmStore.Reminder r) {
        long trigger = nextTrigger(r, System.currentTimeMillis());
        if (trigger <= 0) {
            cancelFire(ctx, r.id);
            return -1;
        }
        AlarmPayload p = payloadFor(r, trigger);
        setExact(ctx, trigger, firePendingIntent(ctx, ACTION_FIRE, p, PendingIntent.FLAG_UPDATE_CURRENT));
        Log.i(TAG, "Scheduled #" + r.id + " " + r.medicineName + " at " + new Date(trigger));
        return trigger;
    }

    /** Re-arms the alarm for the same dose 10 minutes from now. */
    public static void snooze(Context ctx, AlarmPayload p) {
        long trigger = System.currentTimeMillis() + SNOOZE_MS;
        setExact(ctx, trigger, firePendingIntent(ctx, ACTION_SNOOZE_FIRE, p, PendingIntent.FLAG_UPDATE_CURRENT));
        Log.i(TAG, "Snoozed #" + p.id + " until " + new Date(trigger));
    }

    /** Cancels a reminder's alarm and any snooze for it. */
    public static void cancel(Context ctx, int id) {
        cancelFire(ctx, id);
        PendingIntent snooze = existing(ctx, ACTION_SNOOZE_FIRE, id);
        if (snooze != null) {
            alarmManager(ctx).cancel(snooze);
            snooze.cancel();
        }
    }

    /** Re-creates every alarm from the local store (boot, time change, app update). */
    public static void rescheduleAll(Context ctx) {
        List<AlarmStore.Reminder> reminders = AlarmStore.getReminders(ctx);
        long now = System.currentTimeMillis();
        for (AlarmStore.Reminder r : reminders) {
            if (!r.repeat && r.at <= now) {
                AlarmStore.removeReminder(ctx, r.id);
                continue;
            }
            schedule(ctx, r);
        }
    }

    public static boolean canScheduleExact(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        return alarmManager(ctx).canScheduleExactAlarms();
    }

    // ── Time maths ────────────────────────────────────────────────────────

    /** Next time this reminder should ring after `now`, or -1 if never again. */
    static long nextTrigger(AlarmStore.Reminder r, long now) {
        if (!r.repeat) return r.at > now ? r.at : -1;

        int[] hm = parseTime(r.time);
        if (hm == null) return -1;

        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(now);
        c.set(Calendar.HOUR_OF_DAY, hm[0]);
        c.set(Calendar.MINUTE, hm[1]);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        if (c.getTimeInMillis() <= now) c.add(Calendar.DAY_OF_YEAR, 1);

        // Respect the medicine's start date
        if (r.startDate != null && !r.startDate.isEmpty() && dateKey(c) .compareTo(r.startDate) < 0) {
            Calendar start = parseDate(r.startDate);
            if (start != null) {
                start.set(Calendar.HOUR_OF_DAY, hm[0]);
                start.set(Calendar.MINUTE, hm[1]);
                c = start;
            }
        }
        // ... and its end date
        if (r.endDate != null && !r.endDate.isEmpty() && dateKey(c).compareTo(r.endDate) > 0) return -1;

        return c.getTimeInMillis();
    }

    static int[] parseTime(String hhmm) {
        if (hhmm == null) return null;
        String[] parts = hhmm.trim().split(":");
        if (parts.length < 2) return null;
        try {
            int h = Integer.parseInt(parts[0]);
            int m = Integer.parseInt(parts[1]);
            if (h < 0 || h > 23 || m < 0 || m > 59) return null;
            return new int[] { h, m };
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static Calendar parseDate(String ymd) {
        try {
            SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
            f.setLenient(false);
            Date d = f.parse(ymd);
            if (d == null) return null;
            Calendar c = Calendar.getInstance();
            c.setTime(d);
            c.set(Calendar.SECOND, 0);
            c.set(Calendar.MILLISECOND, 0);
            return c;
        } catch (Exception e) {
            return null;
        }
    }

    static String dateKey(Calendar c) {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(c.getTime());
    }

    static String timeKey(Calendar c) {
        return new SimpleDateFormat("HH:mm", Locale.US).format(c.getTime());
    }

    /** "HH:MM" → "8:00 AM" */
    public static String formatTime(String hhmm) {
        int[] hm = parseTime(hhmm);
        if (hm == null) return hhmm == null ? "" : hhmm;
        Calendar c = Calendar.getInstance();
        c.set(Calendar.HOUR_OF_DAY, hm[0]);
        c.set(Calendar.MINUTE, hm[1]);
        return new SimpleDateFormat("h:mm a", Locale.US).format(c.getTime());
    }

    // ── Internals ─────────────────────────────────────────────────────────

    static AlarmPayload payloadFor(AlarmStore.Reminder r, long trigger) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(trigger);
        AlarmPayload p = new AlarmPayload();
        p.id = r.id;
        p.medicineId = r.medicineId;
        p.medicineName = r.medicineName;
        p.dose = r.dose;
        p.date = dateKey(c);
        p.time = r.repeat && r.time != null ? r.time : timeKey(c);
        p.isTest = r.isTest;
        return p;
    }

    private static void setExact(Context ctx, long trigger, PendingIntent operation) {
        AlarmManager am = alarmManager(ctx);
        try {
            if (canScheduleExact(ctx)) {
                PendingIntent show = PendingIntent.getActivity(
                    ctx,
                    0,
                    new Intent(ctx, MainActivity.class),
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                );
                am.setAlarmClock(new AlarmManager.AlarmClockInfo(trigger, show), operation);
                return;
            }
        } catch (SecurityException e) {
            Log.w(TAG, "Exact alarm not allowed, falling back to inexact", e);
        }
        // Without the exact-alarm permission: best effort, may be a few minutes late.
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, operation);
    }

    private static void cancelFire(Context ctx, int id) {
        PendingIntent fire = existing(ctx, ACTION_FIRE, id);
        if (fire != null) {
            alarmManager(ctx).cancel(fire);
            fire.cancel();
        }
    }

    /** Distinct per (action, id): the data URI makes each PendingIntent unique. */
    private static Intent baseIntent(Context ctx, String action, int id) {
        Intent i = new Intent(ctx, AlarmReceiver.class);
        i.setAction(action);
        i.setData(Uri.parse("medibuddy-alarm://" + (ACTION_FIRE.equals(action) ? "fire" : "snooze") + "/" + id));
        return i;
    }

    private static PendingIntent firePendingIntent(Context ctx, String action, AlarmPayload p, int flags) {
        Intent i = baseIntent(ctx, action, p.id);
        p.writeTo(i);
        return PendingIntent.getBroadcast(ctx, p.id, i, flags | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent existing(Context ctx, String action, int id) {
        return PendingIntent.getBroadcast(
            ctx,
            id,
            baseIntent(ctx, action, id),
            PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private static AlarmManager alarmManager(Context ctx) {
        return (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
    }
}
