package com.medibuddy.app.health;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Background step-counter readings: just after midnight (closes the day),
 * hourly, after a reboot (new baseline) and at shutdown (last steps before
 * the counter resets).
 */
public class StepReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        boolean rescheduleAfter = StepSensor.ACTION_READ.equals(action) && "midnight".equals(intent.getStringExtra("kind"))
            || Intent.ACTION_BOOT_COMPLETED.equals(action)
            || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action);

        if (!StepStore.isEnabled(context)) {
            StepSensor.cancelBackgroundReadings(context);
            return;
        }
        PendingResult result = goAsync();
        StepSensor.readAndRecord(context, counter -> {
            if (rescheduleAfter) StepSensor.scheduleBackgroundReadings(context);
            result.finish();
        });
    }
}
