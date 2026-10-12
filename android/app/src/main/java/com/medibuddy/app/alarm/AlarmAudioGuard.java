package com.medibuddy.app.alarm;

import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioManager;
import android.os.Build;
import android.util.Log;

/**
 * Makes the voice alarm audible in every phone mode while it rings, and puts
 * everything back afterwards:
 *
 *  - Do Not Disturb: if DND would block alarms (filter NONE = "Total silence",
 *    or PRIORITY without alarms) and MediBuddy has DND access, switch to
 *    "Alarms only" while ringing.
 *    Android 15+ no longer lets apps relax a DND mode the user turned on (an
 *    app's change only becomes an extra "app rule", and the strictest rule
 *    wins), so there the alarm speaks on the accessibility stream instead,
 *    which DND never mutes (see {@link #alarmStreamMuted} / AlarmService).
 *  - Alarm volume: raise STREAM_ALARM (and STREAM_ACCESSIBILITY, used when the
 *    alarm stream is muted) to the maximum while ringing.
 *
 * The original values are saved in SharedPreferences BEFORE anything changes,
 * so they are restored even if the app is killed mid-alarm
 * ({@link #restoreIfLeftOver} runs on the next app start / alarm / reboot).
 * Every change is wrapped in try/catch: a failed change never stops the voice.
 */
final class AlarmAudioGuard {

    private static final String TAG = "MedicineAlarm";
    private static final String PREFS = "medibuddy_alarm_audio";
    private static final String KEY_ACTIVE = "active";
    private static final String KEY_VOLUME = "saved_alarm_volume";
    private static final String KEY_FILTER = "saved_interruption_filter";
    private static final String KEY_FILTER_SET = "filter_we_set";
    private static final String KEY_A11Y_VOLUME = "saved_accessibility_volume";

    /** Android 15+: DND changes by apps become app rules and can't relax the user's DND. */
    private static boolean modesApi() {
        return Build.VERSION.SDK_INT >= 35;
    }

    /** True when DND (or the user) has muted the alarm stream, so USAGE_ALARM would be silent. */
    static boolean alarmStreamMuted(Context ctx) {
        AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        try {
            return am != null && (am.isStreamMute(AudioManager.STREAM_ALARM)
                || am.getStreamVolume(AudioManager.STREAM_ALARM) == 0);
        } catch (RuntimeException e) {
            return false;
        }
    }

    private AlarmAudioGuard() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** True when MediBuddy may change Do Not Disturb (user allowed "Do Not Disturb access"). */
    static boolean hasDndAccess(Context ctx) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        return nm != null && nm.isNotificationPolicyAccessGranted();
    }

    /** Would the current DND setting silence an alarm? */
    static boolean dndBlocksAlarms(NotificationManager nm) {
        int filter = nm.getCurrentInterruptionFilter();
        if (filter == NotificationManager.INTERRUPTION_FILTER_NONE) return true;
        if (filter == NotificationManager.INTERRUPTION_FILTER_PRIORITY) {
            try {
                NotificationManager.Policy policy = nm.getNotificationPolicy();
                return policy != null
                    && (policy.priorityCategories & NotificationManager.Policy.PRIORITY_CATEGORY_ALARMS) == 0;
            } catch (SecurityException e) {
                return true;
            }
        }
        return false;
    }

    /** Called when an alarm starts ringing. Safe to call again while already active. */
    static synchronized void apply(Context ctx) {
        SharedPreferences p = prefs(ctx);
        boolean alreadyActive = p.getBoolean(KEY_ACTIVE, false);
        SharedPreferences.Editor e = p.edit().putBoolean(KEY_ACTIVE, true);

        AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);

        // 1. Do Not Disturb first (in "Total silence" the alarm volume can't be raised).
        try {
            if (!modesApi() && nm != null && nm.isNotificationPolicyAccessGranted() && dndBlocksAlarms(nm)) {
                int current = nm.getCurrentInterruptionFilter();
                if (!alreadyActive || !p.contains(KEY_FILTER)) e.putInt(KEY_FILTER, current);
                e.putInt(KEY_FILTER_SET, NotificationManager.INTERRUPTION_FILTER_ALARMS);
                e.commit(); // saved before changing anything
                nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALARMS);
                Log.i(TAG, "DND " + current + " would block the alarm: switched to alarms-only");
            } else if (nm != null && dndBlocksAlarms(nm)) {
                Log.w(TAG, "DND is blocking alarms: speaking on the accessibility stream instead");
            }
        } catch (SecurityException ex) {
            Log.w(TAG, "Could not change Do Not Disturb", ex);
        }

        // 2. Alarm volume to the maximum.
        if (am != null) {
            try {
                int current = am.getStreamVolume(AudioManager.STREAM_ALARM);
                int max = am.getStreamMaxVolume(AudioManager.STREAM_ALARM);
                if (!alreadyActive || !p.contains(KEY_VOLUME)) e.putInt(KEY_VOLUME, current);
                e.commit(); // saved before changing anything
                if (current < max) am.setStreamVolume(AudioManager.STREAM_ALARM, max, 0);
                Log.i(TAG, "Alarm volume " + current + " -> " + max);
            } catch (SecurityException ex) {
                Log.w(TAG, "Could not raise the alarm volume", ex);
            }
            // Fallback stream for when DND mutes alarms.
            try {
                int current = am.getStreamVolume(AudioManager.STREAM_ACCESSIBILITY);
                int max = am.getStreamMaxVolume(AudioManager.STREAM_ACCESSIBILITY);
                if (!alreadyActive || !p.contains(KEY_A11Y_VOLUME)) e.putInt(KEY_A11Y_VOLUME, current);
                e.commit();
                if (current < max) am.setStreamVolume(AudioManager.STREAM_ACCESSIBILITY, max, 0);
            } catch (RuntimeException ex) {
                Log.w(TAG, "Could not raise the accessibility volume", ex);
            }
        }
        e.commit();
    }

    /** Called when the alarm stops (Taken, Snooze, 2-minute timeout, dismiss, service destroyed). */
    static synchronized void restore(Context ctx) {
        SharedPreferences p = prefs(ctx);
        if (!p.getBoolean(KEY_ACTIVE, false)) return;
        try {
            AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
            if (am != null && p.contains(KEY_VOLUME)) {
                try {
                    am.setStreamVolume(AudioManager.STREAM_ALARM, p.getInt(KEY_VOLUME, 0), 0);
                } catch (SecurityException ex) {
                    Log.w(TAG, "Could not restore the alarm volume", ex);
                }
            }
            if (am != null && p.contains(KEY_A11Y_VOLUME)) {
                try {
                    am.setStreamVolume(AudioManager.STREAM_ACCESSIBILITY, p.getInt(KEY_A11Y_VOLUME, 0), 0);
                } catch (RuntimeException ex) {
                    Log.w(TAG, "Could not restore the accessibility volume", ex);
                }
            }
            NotificationManager nm = ctx.getSystemService(NotificationManager.class);
            if (nm != null && p.contains(KEY_FILTER)) {
                try {
                    // Only undo our own change: if the user changed DND meanwhile, keep theirs.
                    int weSet = p.getInt(KEY_FILTER_SET, NotificationManager.INTERRUPTION_FILTER_ALARMS);
                    if (nm.isNotificationPolicyAccessGranted() && nm.getCurrentInterruptionFilter() == weSet) {
                        nm.setInterruptionFilter(p.getInt(KEY_FILTER, NotificationManager.INTERRUPTION_FILTER_ALL));
                    }
                } catch (SecurityException ex) {
                    Log.w(TAG, "Could not restore Do Not Disturb", ex);
                }
            }
        } finally {
            p.edit().clear().commit();
            Log.i(TAG, "Alarm volume and Do Not Disturb restored");
        }
    }

    /** After a crash or reboot mid-alarm: put the user's settings back if nothing is ringing. */
    static void restoreIfLeftOver(Context ctx) {
        if (AlarmService.current() != null) return;
        if (prefs(ctx).getBoolean(KEY_ACTIVE, false)) {
            Log.i(TAG, "Restoring audio settings left over from an interrupted alarm");
            restore(ctx);
        }
        clearAppDndRule(ctx);
    }

    /**
     * Android 15+: turns off MediBuddy's own DND app rule ("implicit" rule) if an
     * earlier version left it on. This never touches the user's own DND setting.
     */
    static void clearAppDndRule(Context ctx) {
        if (!modesApi()) return;
        try {
            NotificationManager nm = ctx.getSystemService(NotificationManager.class);
            if (nm != null && nm.isNotificationPolicyAccessGranted()) {
                nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALL);
            }
        } catch (SecurityException ex) {
            Log.w(TAG, "Could not clear the MediBuddy DND rule", ex);
        }
    }
}
