package com.medibuddy.app.health;

import android.Manifest;
import android.os.Build;
import android.util.Log;

import androidx.health.connect.client.HealthConnectClient;
import androidx.health.connect.client.aggregate.AggregationResultGroupedByPeriod;
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord;
import androidx.health.connect.client.records.metadata.DataOrigin;
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest;
import androidx.health.connect.client.time.TimeRangeFilter;
import androidx.health.connect.client.units.Energy;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.Period;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import kotlin.coroutines.EmptyCoroutineContext;
import kotlinx.coroutines.BuildersKt;

/**
 * JavaScript bridge (registered in MainActivity as "MediHealth") for:
 *  - the phone's built-in step counter, used when Health Connect has no steps;
 *  - revoking Health Connect permissions on "Disconnect"
 *    (@capgo/capacitor-health has no revoke method).
 */
@CapacitorPlugin(
    name = "MediHealth",
    permissions = { @Permission(alias = "activity", strings = { Manifest.permission.ACTIVITY_RECOGNITION }) }
)
public class MediHealthPlugin extends Plugin {

    private static final String TAG = "MediHealth";

    @Override
    public void load() {
        // Keep midnight/hourly readings armed while the user uses the sensor fallback.
        StepSensor.scheduleBackgroundReadings(getContext());
    }

    private String permissionState() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return "granted";
        PermissionState s = getPermissionState("activity");
        return s == null ? "prompt" : s.toString().toLowerCase();
    }

    /** { available: boolean, permission: "granted" | "denied" | "prompt" | "prompt-with-rationale" } */
    @PluginMethod
    public void getStepSensorStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", StepSensor.isAvailable(getContext()));
        ret.put("permission", permissionState());
        call.resolve(ret);
    }

    @PluginMethod
    public void requestActivityPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || "granted".equals(permissionState())) {
            StepSensor.scheduleBackgroundReadings(getContext());
            JSObject ret = new JSObject();
            ret.put("permission", "granted");
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias("activity", call, "activityPermissionResult");
    }

    @PermissionCallback
    private void activityPermissionResult(PluginCall call) {
        String state = permissionState();
        if ("granted".equals(state)) StepSensor.scheduleBackgroundReadings(getContext());
        JSObject ret = new JSObject();
        ret.put("permission", state);
        call.resolve(ret);
    }

    /**
     * readSensorSteps({ days?: number = 7 }) → { ok, days: [{ date: "YYYY-MM-DD", steps }], lastReadAt }
     * Takes a fresh reading first. ok = false when the sensor or permission is missing.
     */
    @PluginMethod
    public void readSensorSteps(PluginCall call) {
        int days = Math.max(1, Math.min(30, call.getInt("days", 7)));
        if (!StepStore.isEnabled(getContext())) {
            JSObject off = new JSObject();
            off.put("ok", false);
            off.put("days", new JSArray());
            off.put("lastReadAt", 0);
            call.resolve(off);
            return;
        }
        StepSensor.readAndRecord(getContext(), counter -> {
            // Keeps the midnight/hourly readings armed (e.g. permission granted from Settings).
            if (counter != null) StepSensor.scheduleBackgroundReadings(getContext());
            List<String> dates = new ArrayList<>();
            List<long[]> values = StepStore.lastDays(getContext(), days, dates);
            JSArray arr = new JSArray();
            for (int i = 0; i < dates.size(); i++) {
                JSObject d = new JSObject();
                d.put("date", dates.get(i));
                d.put("steps", values.get(i)[0]);
                arr.put(d);
            }
            JSObject ret = new JSObject();
            ret.put("ok", counter != null);
            ret.put("days", arr);
            ret.put("lastReadAt", StepStore.lastReadAt(getContext()));
            call.resolve(ret);
        });
    }

    /** setStepSensorEnabled({ enabled }) — Connect turns readings on, Disconnect turns them off. */
    @PluginMethod
    public void setStepSensorEnabled(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        StepStore.setEnabled(getContext(), enabled);
        StepSensor.scheduleBackgroundReadings(getContext()); // arms or cancels the alarms
        call.resolve();
    }

    /**
     * totalCaloriesByDay({ days?: 7 }) → { days: [{ date, kcal, origins: [package] }] }
     * @capgo/capacitor-health cannot aggregate total calories, and summing raw
     * records double-counts when several apps write them; Health Connect's own
     * aggregation de-duplicates by app priority.
     *
     * Health Connect also ADDS an estimated basal (BMR) burn to this total, even
     * when no app wrote any calories. `origins` lists the apps whose records were
     * used; empty = the number is only that estimate, not tracked data.
     */
    @PluginMethod
    public void totalCaloriesByDay(PluginCall call) {
        int days = Math.max(1, Math.min(30, call.getInt("days", 7)));
        new Thread(() -> {
            try {
                HealthConnectClient client = HealthConnectClient.getOrCreate(getContext());
                LocalDateTime start = LocalDate.now().minusDays(days - 1).atStartOfDay();
                AggregateGroupByPeriodRequest req = new AggregateGroupByPeriodRequest(
                    Collections.singleton(TotalCaloriesBurnedRecord.ENERGY_TOTAL),
                    TimeRangeFilter.between(start, LocalDateTime.now()),
                    Period.ofDays(1),
                    Collections.emptySet()
                );
                @SuppressWarnings("unchecked")
                List<AggregationResultGroupedByPeriod> groups = (List<AggregationResultGroupedByPeriod>) BuildersKt.runBlocking(
                    EmptyCoroutineContext.INSTANCE,
                    (scope, continuation) -> client.aggregateGroupByPeriod(req, continuation)
                );
                JSArray arr = new JSArray();
                for (AggregationResultGroupedByPeriod g : groups) {
                    Energy e = g.getResult().get(TotalCaloriesBurnedRecord.ENERGY_TOTAL);
                    if (e == null) continue;
                    JSObject d = new JSObject();
                    d.put("date", g.getStartTime().toLocalDate().toString());
                    d.put("kcal", e.getKilocalories());
                    JSArray origins = new JSArray();
                    for (DataOrigin o : g.getResult().getDataOrigins()) origins.put(o.getPackageName());
                    d.put("origins", origins);
                    arr.put(d);
                }
                JSObject ret = new JSObject();
                ret.put("days", arr);
                call.resolve(ret);
            } catch (Exception e) {
                Log.w(TAG, "Total calories aggregate failed", e);
                call.reject("Could not read total calories", e);
            }
        }, "hc-total-calories").start();
    }

    /** Revokes every Health Connect permission this app holds. */
    @PluginMethod
    public void revokeHealthConnect(PluginCall call) {
        new Thread(() -> {
            try {
                HealthConnectClient client = HealthConnectClient.getOrCreate(getContext());
                BuildersKt.runBlocking(
                    EmptyCoroutineContext.INSTANCE,
                    (scope, continuation) -> client.getPermissionController().revokeAllPermissions(continuation)
                );
                call.resolve();
            } catch (Exception e) {
                Log.w(TAG, "Revoking Health Connect permissions failed", e);
                call.reject("Could not revoke Health Connect permissions", e);
            }
        }, "hc-revoke").start();
    }
}
