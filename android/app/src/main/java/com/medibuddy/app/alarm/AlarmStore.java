package com.medibuddy.app.alarm;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Local copy of everything the alarm system needs while the app is closed:
 *  - the reminders to schedule (written by the app on every sync), so alarms can
 *    be rebuilt after a reboot or a time/timezone change;
 *  - "Taken" presses that still have to be written to Supabase;
 *  - the "alarm sound" setting.
 *
 * Backed by SharedPreferences. All methods are synchronized because receivers,
 * the service and the plugin can touch it from different threads.
 */
public final class AlarmStore {

    private static final String PREFS = "medibuddy_alarms";
    private static final String KEY_REMINDERS = "reminders";
    private static final String KEY_PENDING_ACTIONS = "pending_dose_actions";
    private static final String KEY_PENDING_CARE_ACTIONS = "pending_care_actions";
    private static final String KEY_VOICE_ENABLED = "voice_enabled";
    private static final String KEY_LANGUAGE = "language";
    private static final String KEY_VOICE_FALLBACK = "voice_fallback_language";

    private AlarmStore() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ── Reminders ─────────────────────────────────────────────────────────

    public static synchronized List<Reminder> getReminders(Context ctx) {
        List<Reminder> list = new ArrayList<>();
        try {
            JSONArray arr = new JSONArray(prefs(ctx).getString(KEY_REMINDERS, "[]"));
            for (int i = 0; i < arr.length(); i++) {
                Reminder r = Reminder.fromJson(arr.getJSONObject(i));
                if (r != null) list.add(r);
            }
        } catch (JSONException ignored) {
        }
        return list;
    }

    public static synchronized void saveReminders(Context ctx, List<Reminder> reminders) {
        JSONArray arr = new JSONArray();
        for (Reminder r : reminders) {
            try {
                arr.put(r.toJson());
            } catch (JSONException ignored) {
            }
        }
        prefs(ctx).edit().putString(KEY_REMINDERS, arr.toString()).apply();
    }

    public static synchronized Reminder findReminder(Context ctx, int id) {
        for (Reminder r : getReminders(ctx)) {
            if (r.id == id) return r;
        }
        return null;
    }

    public static synchronized void upsertReminder(Context ctx, Reminder reminder) {
        List<Reminder> list = getReminders(ctx);
        for (int i = 0; i < list.size(); i++) {
            if (list.get(i).id == reminder.id) {
                list.set(i, reminder);
                saveReminders(ctx, list);
                return;
            }
        }
        list.add(reminder);
        saveReminders(ctx, list);
    }

    public static synchronized void removeReminder(Context ctx, int id) {
        List<Reminder> list = getReminders(ctx);
        List<Reminder> kept = new ArrayList<>();
        for (Reminder r : list) {
            if (r.id != id) kept.add(r);
        }
        saveReminders(ctx, kept);
    }

    // ── Pending "Taken" actions (synced to Supabase by the app) ──────────

    public static synchronized void addPendingAction(Context ctx, AlarmPayload payload, String action) {
        try {
            JSONArray arr = new JSONArray(prefs(ctx).getString(KEY_PENDING_ACTIONS, "[]"));
            JSONObject o = new JSONObject();
            o.put("uid", UUID.randomUUID().toString());
            o.put("action", action);
            o.put("medicineId", payload.medicineId);
            o.put("medicineName", payload.medicineName);
            o.put("date", payload.date);
            o.put("time", payload.time);
            o.put("isTest", payload.isTest);
            o.put("at", System.currentTimeMillis());
            arr.put(o);
            prefs(ctx).edit().putString(KEY_PENDING_ACTIONS, arr.toString()).apply();
        } catch (JSONException ignored) {
        }
    }

    /** Caregiver pressed "I'm responding" / "OK" on the native alarm: the app writes it to Supabase. */
    public static synchronized void addCareAction(Context ctx, AlarmPayload payload, String action) {
        if (payload.refId == null || payload.refId.isEmpty()) return; // tests: nothing to send
        try {
            JSONArray arr = new JSONArray(prefs(ctx).getString(KEY_PENDING_CARE_ACTIONS, "[]"));
            JSONObject o = new JSONObject();
            o.put("uid", UUID.randomUUID().toString());
            o.put("action", action);
            o.put("kind", payload.kind);
            o.put("refId", payload.refId);
            o.put("at", System.currentTimeMillis());
            arr.put(o);
            prefs(ctx).edit().putString(KEY_PENDING_CARE_ACTIONS, arr.toString()).apply();
        } catch (JSONException ignored) {
        }
    }

    public static synchronized JSONArray getCareActions(Context ctx) {
        try {
            return new JSONArray(prefs(ctx).getString(KEY_PENDING_CARE_ACTIONS, "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    /** Already answered on this phone (waiting to be sent): don't ring it again. */
    public static synchronized boolean hasCareAction(Context ctx, String refId) {
        JSONArray arr = getCareActions(ctx);
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o != null && refId.equals(o.optString("refId"))) return true;
        }
        return false;
    }

    public static synchronized void removeCareActions(Context ctx, List<String> uids) {
        JSONArray arr = getCareActions(ctx);
        JSONArray kept = new JSONArray();
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o != null && !uids.contains(o.optString("uid"))) kept.put(o);
        }
        prefs(ctx).edit().putString(KEY_PENDING_CARE_ACTIONS, kept.toString()).apply();
    }

    public static synchronized JSONArray getPendingActions(Context ctx) {
        try {
            return new JSONArray(prefs(ctx).getString(KEY_PENDING_ACTIONS, "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    public static synchronized void removePendingActions(Context ctx, List<String> uids) {
        JSONArray current = getPendingActions(ctx);
        JSONArray kept = new JSONArray();
        for (int i = 0; i < current.length(); i++) {
            JSONObject o = current.optJSONObject(i);
            if (o != null && !uids.contains(o.optString("uid"))) kept.put(o);
        }
        prefs(ctx).edit().putString(KEY_PENDING_ACTIONS, kept.toString()).apply();
    }

    // ── Settings ──────────────────────────────────────────────────────────

    private static final String KEY_BEEP_ENABLED = "beep_enabled";

    /** Spoken announcement (default on). At least one of beep / voice is always on. */
    public static boolean isVoiceEnabled(Context ctx) {
        return prefs(ctx).getBoolean(KEY_VOICE_ENABLED, true);
    }

    /** Beep (medicine / missed dose) or siren (SOS) before the voice (default on). */
    public static boolean isBeepEnabled(Context ctx) {
        return prefs(ctx).getBoolean(KEY_BEEP_ENABLED, true) || !isVoiceEnabled(ctx);
    }

    /** Returns false (and changes nothing) if this would turn both off. */
    public static boolean setBeepEnabled(Context ctx, boolean enabled) {
        if (!enabled && !prefs(ctx).getBoolean(KEY_VOICE_ENABLED, true)) return false;
        prefs(ctx).edit().putBoolean(KEY_BEEP_ENABLED, enabled).apply();
        return true;
    }

    /** Returns false (and changes nothing) if this would turn both off. */
    public static boolean setVoiceEnabled(Context ctx, boolean enabled) {
        if (!enabled && !prefs(ctx).getBoolean(KEY_BEEP_ENABLED, true)) return false;
        prefs(ctx).edit().putBoolean(KEY_VOICE_ENABLED, enabled).apply();
        return true;
    }

    /** App language ("en", "hi", ...) from the last sync; used when an alarm has none. */
    public static String getLanguage(Context ctx) {
        return prefs(ctx).getString(KEY_LANGUAGE, "en");
    }

    public static void setLanguage(Context ctx, String language) {
        if (language != null && !language.isEmpty()) prefs(ctx).edit().putString(KEY_LANGUAGE, language).apply();
    }

    /** Set when an alarm had to speak English because the language's voice is missing. */
    public static void setVoiceFallback(Context ctx, String language) {
        prefs(ctx).edit().putString(KEY_VOICE_FALLBACK, language).apply();
    }

    /** Returns and clears the language that fell back to English, or null. */
    public static synchronized String consumeVoiceFallback(Context ctx) {
        String lang = prefs(ctx).getString(KEY_VOICE_FALLBACK, null);
        if (lang != null) prefs(ctx).edit().remove(KEY_VOICE_FALLBACK).apply();
        return lang;
    }

    // ── Model ─────────────────────────────────────────────────────────────

    /** One alarm: a daily "HH:MM" reminder for a medicine, or a one-shot alarm. */
    public static final class Reminder {
        public int id;
        public String medicineId;
        public String medicineName;
        public String dose;
        /** "HH:MM", 24h, used for daily reminders. */
        public String time;
        /** Epoch millis for one-shot alarms (repeat == false). */
        public long at;
        public boolean repeat;
        /** Optional "YYYY-MM-DD" bounds for daily reminders. */
        public String startDate;
        public String endDate;
        public boolean isTest;
        /** App language for the spoken announcement ("en", "hi", "te", ...). */
        public String language;

        public JSONObject toJson() throws JSONException {
            JSONObject o = new JSONObject();
            o.put("id", id);
            o.put("medicineId", medicineId);
            o.put("medicineName", medicineName);
            o.put("dose", dose);
            o.put("time", time);
            o.put("at", at);
            o.put("repeat", repeat);
            o.put("startDate", startDate);
            o.put("endDate", endDate);
            o.put("isTest", isTest);
            o.put("language", language);
            return o;
        }

        public static Reminder fromJson(JSONObject o) {
            if (o == null || !o.has("id")) return null;
            Reminder r = new Reminder();
            r.id = o.optInt("id");
            r.medicineId = o.optString("medicineId", "");
            r.medicineName = o.optString("medicineName", "Medicine");
            r.dose = o.optString("dose", "");
            r.time = o.isNull("time") ? null : o.optString("time", null);
            r.at = o.optLong("at", 0);
            r.repeat = o.optBoolean("repeat", true);
            r.startDate = o.isNull("startDate") ? null : o.optString("startDate", null);
            r.endDate = o.isNull("endDate") ? null : o.optString("endDate", null);
            r.isTest = o.optBoolean("isTest", false);
            r.language = o.isNull("language") ? null : o.optString("language", null);
            return r;
        }
    }
}
