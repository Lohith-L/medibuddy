package com.medibuddy.app.alarm;

import android.content.Intent;
import android.os.Bundle;

/** What one ringing alarm is about. Travels between components as Intent extras. */
public final class AlarmPayload {

    static final String EXTRA_ID = "alarm_id";
    static final String EXTRA_MEDICINE_ID = "alarm_medicine_id";
    static final String EXTRA_MEDICINE_NAME = "alarm_medicine_name";
    static final String EXTRA_DOSE = "alarm_dose";
    static final String EXTRA_DATE = "alarm_date";
    static final String EXTRA_TIME = "alarm_time";
    static final String EXTRA_IS_TEST = "alarm_is_test";
    static final String EXTRA_LANGUAGE = "alarm_language";
    static final String EXTRA_KIND = "alarm_kind";
    static final String EXTRA_PATIENT = "alarm_patient_name";
    static final String EXTRA_REF = "alarm_ref_id";

    /** The patient's own medicine alarm. */
    public static final String KIND_MEDICINE = "medicine";
    /** Caregiver: a linked patient missed a dose. */
    public static final String KIND_MISSED = "missed";
    /** Caregiver: a linked patient pressed SOS. */
    public static final String KIND_SOS = "sos";

    public int id;
    public String medicineId;
    public String medicineName;
    public String dose;
    /** Scheduled dose date, "YYYY-MM-DD" (local). */
    public String date;
    /** Scheduled dose time, "HH:MM" (local, 24h). Snoozes keep the original time. */
    public String time;
    public boolean isTest;
    /** App language for the spoken announcement, e.g. "hi". */
    public String language;
    /** KIND_MEDICINE (default), KIND_MISSED or KIND_SOS. */
    public String kind = KIND_MEDICINE;
    /** Caregiver alarms: whose alarm it is. */
    public String patientName;
    /** Caregiver alarms: the SOS event id in Supabase (null for tests). */
    public String refId;

    public boolean isCaregiver() {
        return KIND_MISSED.equals(kind) || KIND_SOS.equals(kind);
    }

    public boolean isSos() {
        return KIND_SOS.equals(kind);
    }

    public void writeTo(Intent intent) {
        intent.putExtra(EXTRA_ID, id);
        intent.putExtra(EXTRA_MEDICINE_ID, medicineId);
        intent.putExtra(EXTRA_MEDICINE_NAME, medicineName);
        intent.putExtra(EXTRA_DOSE, dose);
        intent.putExtra(EXTRA_DATE, date);
        intent.putExtra(EXTRA_TIME, time);
        intent.putExtra(EXTRA_IS_TEST, isTest);
        intent.putExtra(EXTRA_LANGUAGE, language);
        intent.putExtra(EXTRA_KIND, kind);
        intent.putExtra(EXTRA_PATIENT, patientName);
        intent.putExtra(EXTRA_REF, refId);
    }

    public static AlarmPayload from(Intent intent) {
        if (intent == null) return null;
        Bundle b = intent.getExtras();
        if (b == null || !b.containsKey(EXTRA_ID)) return null;
        AlarmPayload p = new AlarmPayload();
        p.id = b.getInt(EXTRA_ID);
        p.medicineId = b.getString(EXTRA_MEDICINE_ID, "");
        p.medicineName = b.getString(EXTRA_MEDICINE_NAME, "Medicine");
        p.dose = b.getString(EXTRA_DOSE, "");
        p.date = b.getString(EXTRA_DATE, "");
        p.time = b.getString(EXTRA_TIME, "");
        p.isTest = b.getBoolean(EXTRA_IS_TEST, false);
        p.language = b.getString(EXTRA_LANGUAGE, null);
        p.kind = b.getString(EXTRA_KIND, KIND_MEDICINE);
        p.patientName = b.getString(EXTRA_PATIENT, null);
        p.refId = b.getString(EXTRA_REF, null);
        return p;
    }

    /** "8:00 AM" style label for the scheduled time. */
    public String displayTime() {
        return AlarmScheduler.formatTime(time);
    }
}
