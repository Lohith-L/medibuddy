package com.medibuddy.app.alarm;

import android.content.Context;
import android.util.Log;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.Map;

/**
 * Caregiver alarms started by an FCM push (app closed, in the background or the
 * screen locked). Same alarm as the in-app Realtime path: same alarm id for the
 * same SOS (FNV hash of sos_event_id), so a push and Realtime never ring twice.
 */
public final class CaregiverPush {
    private static final String TAG = "CaregiverPush";

    private CaregiverPush() {}

    /** data: { type: "sos", sos_event_id, patient_name, lat?, lng? } */
    public static void ringSos(Context ctx, Map<String, String> data) {
        String refId = data.get("sos_event_id");
        if (refId == null || refId.isEmpty()) return;
        if (AlarmStore.hasCareAction(ctx, refId)) {
            Log.i(TAG, "SOS " + refId + " already answered on this phone");
            return;
        }
        AlarmPayload p = new AlarmPayload();
        p.kind = AlarmPayload.KIND_SOS;
        p.refId = refId;
        p.id = MedicineAlarmPlugin.caregiverAlarmId(refId);
        p.medicineId = "care:" + refId;
        p.patientName = nz(data.get("patient_name"));
        p.medicineName = "";
        p.dose = "";
        p.time = new SimpleDateFormat("HH:mm", Locale.US).format(new Date());
        p.date = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
        p.language = AlarmStore.getLanguage(ctx);
        Log.i(TAG, "Ringing SOS " + refId + " from push");
        // A high-priority FCM message may start a foreground service (siren + full screen).
        AlarmReceiver.ring(ctx, p);
    }

    /** data: { type: "sos_stop", sos_event_id }: answered elsewhere or the patient is safe. */
    public static void stopSos(Context ctx, Map<String, String> data) {
        String refId = data.get("sos_event_id");
        if (refId == null || refId.isEmpty() || AlarmService.current() == null) return;
        AlarmPayload p = new AlarmPayload();
        p.id = MedicineAlarmPlugin.caregiverAlarmId(refId);
        p.refId = refId;
        AlarmService.send(ctx, AlarmService.ACTION_REMOVE, p);
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }
}
