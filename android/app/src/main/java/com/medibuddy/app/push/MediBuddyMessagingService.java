package com.medibuddy.app.push;

import android.util.Log;
import androidx.annotation.NonNull;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import com.medibuddy.app.alarm.CaregiverPush;
import java.util.Map;

/**
 * Replaces the Capacitor push plugin's FCM service (see AndroidManifest).
 * SOS pushes are data-only + high priority, so Android delivers them here even
 * when the app is swiped away or the phone is locked: we start the full-screen
 * caregiver alarm. Everything is then passed on to the plugin (JS listeners
 * while the app is open, which dedupe by sos_event_id).
 */
public class MediBuddyMessagingService extends MessagingService {
    private static final String TAG = "MediBuddyPush";

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Map<String, String> data = message.getData();
        String type = data.get("type");
        Log.i(TAG, "push received: type=" + type + " priority=" + message.getPriority());
        try {
            if ("sos".equals(type)) CaregiverPush.ringSos(getApplicationContext(), data);
            else if ("sos_stop".equals(type)) CaregiverPush.stopSos(getApplicationContext(), data);
        } catch (Exception e) {
            Log.e(TAG, "handling push failed", e);
        }
        super.onMessageReceived(message);
    }
}
