package com.medibuddy.app.alarm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

import androidx.core.content.ContextCompat;

/** Runs when an alarm goes off (or a snooze ends). */
public class AlarmReceiver extends BroadcastReceiver {

    private static final String TAG = "MedicineAlarm";

    static final String ACTION_SNOOZE_FROM_REMINDER = "com.medibuddy.app.alarm.SNOOZE_FROM_REMINDER";
    static final String EXTRA_NOTIFICATION_ID = "notification_id";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        AlarmPayload payload = AlarmPayload.from(intent);
        if (payload == null) return;

        if (ACTION_SNOOZE_FROM_REMINDER.equals(action)) {
            AlarmNotifications.cancelReminder(context, intent.getIntExtra(EXTRA_NOTIFICATION_ID, 0));
            AlarmScheduler.snooze(context, payload);
            return;
        }

        if (AlarmScheduler.ACTION_FIRE.equals(action)) {
            AlarmStore.Reminder reminder = AlarmStore.findReminder(context, payload.id);
            if (reminder == null) {
                // Removed since it was scheduled (medicine deleted / time changed).
                Log.i(TAG, "Ignoring stale alarm #" + payload.id);
                return;
            }
            if (reminder.repeat) {
                // Arm tomorrow's alarm right away, so a missed or ignored alarm
                // never stops the daily schedule.
                AlarmScheduler.schedule(context, reminder);
            } else {
                AlarmStore.removeReminder(context, reminder.id);
            }
        } else if (!AlarmScheduler.ACTION_SNOOZE_FIRE.equals(action)) {
            return;
        }

        ring(context, payload);
    }

    static void ring(Context context, AlarmPayload payload) {
        if (!AlarmStore.isSoundEnabled(context)) {
            AlarmNotifications.showReminder(context, payload);
            return;
        }
        Intent service = new Intent(context, AlarmService.class).setAction(AlarmService.ACTION_START);
        payload.writeTo(service);
        try {
            // Allowed from the background because we were started by an exact alarm.
            ContextCompat.startForegroundService(context, service);
        } catch (Exception e) {
            Log.w(TAG, "Could not start alarm service, showing a notification instead", e);
            AlarmNotifications.showReminder(context, payload);
        }
    }
}
