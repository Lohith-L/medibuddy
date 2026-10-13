package com.medibuddy.app.alarm;

import android.Manifest;
import android.app.NotificationManager;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.speech.tts.TextToSpeech;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * JavaScript bridge for medicine alarms (registered in MainActivity as "MedicineAlarm").
 */
@CapacitorPlugin(
    name = "MedicineAlarm",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class MedicineAlarmPlugin extends Plugin {

    private static MedicineAlarmPlugin active;

    @Override
    public void load() {
        active = this;
        AlarmNotifications.ensureChannels(getContext());
        // Put back the alarm volume / Do Not Disturb if an alarm was killed mid-ring.
        AlarmAudioGuard.restoreIfLeftOver(getContext());
    }

    @Override
    protected void handleOnDestroy() {
        if (active == this) active = null;
        super.handleOnDestroy();
    }

    /** Called by native code when a "Taken" press was saved locally. */
    static void notifyDoseAction() {
        MedicineAlarmPlugin p = active;
        if (p != null) p.notifyListeners("doseActionQueued", new JSObject(), true);
    }

    // ── Scheduling ────────────────────────────────────────────────────────

    /**
     * scheduleAlarm({ id, medicineId?, medicineName, dose, time?: "HH:MM", at?: epochMs,
     *                 repeat?: boolean, startDate?, endDate?, isTest? })
     */
    @PluginMethod
    public void scheduleAlarm(PluginCall call) {
        AlarmStore.Reminder r = reminderFrom(call.getData());
        if (r == null) {
            call.reject("id plus either time (HH:MM) or at (epoch ms) are required");
            return;
        }
        AlarmScheduler.cancel(getContext(), r.id);
        AlarmStore.upsertReminder(getContext(), r);
        long trigger = AlarmScheduler.schedule(getContext(), r);
        JSObject ret = new JSObject();
        ret.put("scheduledAt", trigger);
        call.resolve(ret);
    }

    @PluginMethod
    public void cancelAlarm(PluginCall call) {
        Integer id = call.getInt("id");
        if (id == null) {
            call.reject("id is required");
            return;
        }
        AlarmScheduler.cancel(getContext(), id);
        AlarmStore.removeReminder(getContext(), id);
        call.resolve();
    }

    @PluginMethod
    public void cancelAll(PluginCall call) {
        Context ctx = getContext();
        for (AlarmStore.Reminder r : AlarmStore.getReminders(ctx)) AlarmScheduler.cancel(ctx, r.id);
        AlarmStore.saveReminders(ctx, new ArrayList<>());
        call.resolve();
    }

    /**
     * syncAlarms({ reminders: [...] }): replaces every daily reminder with this list
     * (cancel + reschedule), so the phone always matches the database.
     * One-shot test alarms are kept.
     */
    @PluginMethod
    public void syncAlarms(PluginCall call) {
        Context ctx = getContext();
        JSArray incoming = call.getArray("reminders", new JSArray());
        AlarmStore.setLanguage(ctx, call.getString("language"));
        AlarmNotifications.ensureChannels(ctx); // channel names follow the app language

        List<AlarmStore.Reminder> next = new ArrayList<>();
        try {
            for (int i = 0; i < incoming.length(); i++) {
                AlarmStore.Reminder r = reminderFrom(incoming.getJSONObject(i));
                if (r != null) next.add(r);
            }
        } catch (JSONException e) {
            call.reject("Invalid reminders", e);
            return;
        }

        List<AlarmStore.Reminder> kept = new ArrayList<>();
        for (AlarmStore.Reminder old : AlarmStore.getReminders(ctx)) {
            if (!old.repeat && old.isTest) {
                kept.add(old);
            } else {
                AlarmScheduler.cancel(ctx, old.id);
            }
        }
        kept.addAll(next);
        AlarmStore.saveReminders(ctx, kept);

        int scheduled = 0;
        for (AlarmStore.Reminder r : next) {
            if (AlarmScheduler.schedule(ctx, r) > 0) scheduled++;
        }
        JSObject ret = new JSObject();
        ret.put("scheduled", scheduled);
        call.resolve(ret);
    }

    /** Stops whatever is ringing right now (no dose is logged). */
    @PluginMethod
    public void stopAlarm(PluginCall call) {
        if (AlarmService.current() != null) {
            AlarmService.send(getContext(), AlarmService.ACTION_DISMISS_ALL, null);
        }
        call.resolve();
    }

    /** What is ringing right now, if anything. */
    @PluginMethod
    public void getRingingAlarm(PluginCall call) {
        AlarmPayload p = AlarmService.current();
        JSObject ret = new JSObject();
        ret.put("ringing", p != null);
        if (p != null) {
            ret.put("id", p.id);
            ret.put("medicineName", p.medicineName);
            ret.put("time", p.time);
        }
        call.resolve(ret);
    }

    // ── Pending "Taken" actions ───────────────────────────────────────────

    @PluginMethod
    public void getPendingDoseActions(PluginCall call) {
        JSONArray arr = AlarmStore.getPendingActions(getContext());
        JSObject ret = new JSObject();
        try {
            ret.put("actions", new JSArray(arr.toString()));
        } catch (JSONException e) {
            ret.put("actions", new JSArray());
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void removePendingDoseActions(PluginCall call) {
        JSArray uids = call.getArray("uids", new JSArray());
        List<String> list = new ArrayList<>();
        for (int i = 0; i < uids.length(); i++) list.add(uids.optString(i));
        AlarmStore.removePendingActions(getContext(), list);
        call.resolve();
    }

    // ── Settings ──────────────────────────────────────────────────────────

    @PluginMethod
    public void getSettings(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("voiceEnabled", AlarmStore.isVoiceEnabled(getContext()));
        ret.put("beepEnabled", AlarmStore.isBeepEnabled(getContext()));
        call.resolve(ret);
    }

    /** Rejected (code "both_off") if it would turn off both the beep and the voice. */
    @PluginMethod
    public void setVoiceEnabled(PluginCall call) {
        if (!AlarmStore.setVoiceEnabled(getContext(), Boolean.TRUE.equals(call.getBoolean("enabled", true)))) {
            call.reject("At least one of alarm beep / voice must stay on", "both_off");
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void setBeepEnabled(PluginCall call) {
        if (!AlarmStore.setBeepEnabled(getContext(), Boolean.TRUE.equals(call.getBoolean("enabled", true)))) {
            call.reject("At least one of alarm beep / voice must stay on", "both_off");
            return;
        }
        call.resolve();
    }

    /**
     * testCaregiverAlarm({ kind: "missed" | "sos", patientName, medicineName?, dose?, time?, language?, delaySeconds? })
     * Rings the caregiver alarm on THIS phone after a delay (default 60 s), so it can be
     * tested with the phone locked and the app closed. Nothing is sent or logged.
     */
    @PluginMethod
    public void testCaregiverAlarm(PluginCall call) {
        String kind = call.getString("kind", AlarmPayload.KIND_MISSED);
        AlarmPayload p = new AlarmPayload();
        p.kind = AlarmPayload.KIND_SOS.equals(kind) ? AlarmPayload.KIND_SOS : AlarmPayload.KIND_MISSED;
        p.id = p.isSos() ? 2_000_000_003 : 2_000_000_002;
        p.isTest = true;
        p.medicineId = "test";
        p.patientName = call.getString("patientName", "Amma");
        p.medicineName = call.getString("medicineName", "Paracetamol");
        p.dose = call.getString("dose", "");
        p.time = call.getString("time", new java.text.SimpleDateFormat("HH:mm", Locale.US).format(new java.util.Date()));
        p.date = new java.text.SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new java.util.Date());
        p.language = call.getString("language", AlarmStore.getLanguage(getContext()));
        int delay = Math.max(0, Math.min(600, call.getInt("delaySeconds", 60)));

        Intent i = new Intent(getContext(), AlarmReceiver.class).setAction(AlarmReceiver.ACTION_TEST_CAREGIVER);
        p.writeTo(i);
        android.app.PendingIntent pi = android.app.PendingIntent.getBroadcast(getContext(), p.id, i,
            android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE);
        android.app.AlarmManager am = (android.app.AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
        long at = System.currentTimeMillis() + delay * 1000L;
        if (AlarmScheduler.canScheduleExact(getContext())) {
            am.setExactAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, at, pi);
        } else {
            am.setAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, at, pi);
        }
        JSObject ret = new JSObject();
        ret.put("scheduledAt", at);
        call.resolve(ret);
    }

    /**
     * checkVoice({ language }): can the phone speak this language offline?
     * Resolves { available, language, engine }.
     */
    @PluginMethod
    public void checkVoice(PluginCall call) {
        String lang = AlarmVoice.normalize(call.getString("language", "en"));
        final TextToSpeech[] holder = new TextToSpeech[1];
        // Post to the main thread: the init callback may run before the constructor returns.
        holder[0] = new TextToSpeech(getContext().getApplicationContext(), status -> new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> {
            JSObject ret = new JSObject();
            ret.put("language", lang);
            TextToSpeech tts = holder[0];
            if (status != TextToSpeech.SUCCESS || tts == null) {
                ret.put("available", false);
                ret.put("engine", "");
                ret.put("ttsWorking", false);
            } else {
                ret.put("available", AlarmVoice.hasInstalledVoice(tts, AlarmVoice.locale(lang)));
                ret.put("engine", tts.getDefaultEngine());
                ret.put("ttsWorking", true);
            }
            call.resolve(ret);
            if (tts != null) tts.shutdown();
        }));
    }

    /** Language whose voice was missing during an alarm (spoken in English instead), once. */
    @PluginMethod
    public void consumeVoiceFallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("language", AlarmStore.consumeVoiceFallback(getContext()));
        call.resolve(ret);
    }

    /** Opens Settings > Text-to-speech output. */
    @PluginMethod
    public void openTtsSettings(PluginCall call) {
        open(call, new Intent("com.android.settings.TTS_SETTINGS"));
    }

    /** Opens the TTS engine's "install voice data" screen. */
    @PluginMethod
    public void installVoiceData(PluginCall call) {
        Intent install = new Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA);
        if (tryStart(install)) {
            call.resolve();
            return;
        }
        open(call, new Intent("com.android.settings.TTS_SETTINGS"));
    }

    // ── Permissions ───────────────────────────────────────────────────────

    @PluginMethod
    @Override
    public void checkPermissions(PluginCall call) {
        call.resolve(permissionStatus());
    }

    @PluginMethod
    @Override
    public void requestPermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationPermsCallback");
            return;
        }
        call.resolve(permissionStatus());
    }

    @PermissionCallback
    private void notificationPermsCallback(PluginCall call) {
        call.resolve(permissionStatus());
    }

    private JSObject permissionStatus() {
        Context ctx = getContext();
        JSObject ret = new JSObject();

        String notifications;
        if (NotificationManagerCompat.from(ctx).areNotificationsEnabled()) {
            notifications = "granted";
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            PermissionState s = getPermissionState("notifications");
            notifications = s == PermissionState.GRANTED ? "denied" // granted but switched off in settings
                : s == PermissionState.DENIED ? "denied" : "prompt";
        } else {
            notifications = "denied";
        }
        ret.put("notifications", notifications);
        ret.put("exactAlarm", AlarmScheduler.canScheduleExact(ctx));
        // "Do Not Disturb access": lets the voice alarm play in DND / Total silence.
        ret.put("dndAccess", AlarmAudioGuard.hasDndAccess(ctx));

        boolean fullScreen = true;
        if (Build.VERSION.SDK_INT >= 34) {
            NotificationManager nm = ctx.getSystemService(NotificationManager.class);
            fullScreen = nm != null && nm.canUseFullScreenIntent();
        }
        ret.put("fullScreenIntent", fullScreen);

        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        ret.put("batteryOptimizationIgnored", pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName()));
        ret.put("manufacturer", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase(Locale.US));
        ret.put("sdkInt", Build.VERSION.SDK_INT);
        return ret;
    }

    // ── System settings shortcuts ─────────────────────────────────────────

    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            open(call, new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, packageUri()));
        } else {
            openAppDetails(call);
        }
    }

    @PluginMethod
    public void openFullScreenIntentSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 34) {
            open(call, new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, packageUri()));
        } else {
            openNotificationSettings(call);
        }
    }

    /** Settings > Do Not Disturb access, so medicine alarms can ring even in Do Not Disturb. */
    @PluginMethod
    public void openDndAccessSettings(PluginCall call) {
        open(call, new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS));
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
        i.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        open(call, i);
    }

    /** Asks to ignore battery optimisation (system dialog), else opens the list. */
    @PluginMethod
    public void openBatteryOptimizationSettings(PluginCall call) {
        Intent ask = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, packageUri());
        if (tryStart(ask)) {
            call.resolve();
            return;
        }
        open(call, new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        openAppDetails(call);
    }

    /** Brand-specific "autostart / background" pages; falls back to app details. */
    @PluginMethod
    public void openAutostartSettings(PluginCall call) {
        ComponentName[] candidates = {
            new ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"),
            new ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"),
            new ComponentName("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"),
            new ComponentName("com.oplus.safecenter", "com.oplus.safecenter.permission.startup.StartupAppListActivity"),
            new ComponentName("com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"),
            new ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),
            new ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager"),
            new ComponentName("com.samsung.android.lool", "com.samsung.android.sm.battery.ui.BatteryActivity"),
            new ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
        };
        for (ComponentName c : candidates) {
            if (tryStart(new Intent().setComponent(c))) {
                call.resolve();
                return;
            }
        }
        openAppDetails(call);
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    private Uri packageUri() {
        return Uri.parse("package:" + getContext().getPackageName());
    }

    private void openAppDetails(PluginCall call) {
        open(call, new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, packageUri()));
    }

    private void open(PluginCall call, Intent intent) {
        if (tryStart(intent) || tryStart(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, packageUri()))) {
            call.resolve();
        } else {
            call.reject("Could not open settings");
        }
    }

    private boolean tryStart(Intent intent) {
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            return false;
        }
    }

    private static AlarmStore.Reminder reminderFrom(JSONObject o) {
        if (o == null || !o.has("id")) return null;
        AlarmStore.Reminder r = new AlarmStore.Reminder();
        r.id = o.optInt("id");
        r.medicineId = o.optString("medicineId", "");
        r.medicineName = o.optString("medicineName", "Medicine");
        r.dose = o.optString("dose", "");
        r.time = o.isNull("time") ? null : o.optString("time", null);
        r.at = o.optLong("at", 0);
        r.isTest = o.optBoolean("isTest", false);
        r.language = o.isNull("language") ? null : emptyToNull(o.optString("language", null));
        r.repeat = o.has("repeat") ? o.optBoolean("repeat", true) : r.at <= 0;
        r.startDate = o.isNull("startDate") ? null : emptyToNull(o.optString("startDate", null));
        r.endDate = o.isNull("endDate") ? null : emptyToNull(o.optString("endDate", null));
        if (r.repeat && AlarmScheduler.parseTime(r.time) == null) return null;
        if (!r.repeat && r.at <= 0) return null;
        return r;
    }

    private static String emptyToNull(String s) {
        return s == null || s.isEmpty() ? null : s;
    }
}
