package com.medibuddy.app.alarm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Alarms are wiped on reboot and become wrong after a clock or timezone change.
 * Rebuild them from the reminders the app last saved locally.
 */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        Log.i("MedicineAlarm", "Rescheduling alarms after " + action);
        AlarmScheduler.rescheduleAll(context);
    }
}
