package com.medibuddy.app.health;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.SystemClock;

import org.json.JSONException;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Date;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;

/**
 * Turns the phone's step counter (Sensor.TYPE_STEP_COUNTER, which counts steps
 * since the last reboot) into daily step totals.
 *
 * Every reading adds the steps taken since the previous reading to a day:
 *  - same day as the previous reading  → added to today;
 *  - the day changed in between         → added to the previous reading's day
 *    (readings happen at midnight, hourly and whenever the app opens, so
 *    almost all of those steps happened before midnight);
 *  - the counter went down (reboot)     → only the steps since the reboot count.
 * The first ever reading counts the steps since boot as today's when the phone
 * was started today; otherwise today starts from that reading.
 */
public final class StepStore {

    private static final String PREFS = "medibuddy_steps";
    private static final String KEY_LAST_COUNTER = "last_counter";
    private static final String KEY_LAST_DATE = "last_date";
    private static final String KEY_LAST_READ_AT = "last_read_at";
    private static final String KEY_DAILY = "daily";
    private static final int KEEP_DAYS = 30;

    private StepStore() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static String dateKey(long millis) {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date(millis));
    }

    private static long startOfToday(long now) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(now);
        c.set(Calendar.HOUR_OF_DAY, 0);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    /** Records one sensor reading (steps since boot). */
    public static synchronized void record(Context ctx, float counter) {
        SharedPreferences p = prefs(ctx);
        long now = System.currentTimeMillis();
        String today = dateKey(now);
        JSONObject daily = daily(ctx);
        boolean bootedToday = now - SystemClock.elapsedRealtime() >= startOfToday(now);

        if (!p.contains(KEY_LAST_COUNTER)) {
            if (bootedToday) add(daily, today, Math.round(counter));
        } else {
            float last = p.getFloat(KEY_LAST_COUNTER, 0f);
            String lastDate = p.getString(KEY_LAST_DATE, today);
            boolean rebooted = counter < last;
            long delta = Math.round(rebooted ? counter : counter - last);
            if (delta > 0) {
                if (today.equals(lastDate)) {
                    add(daily, today, delta);
                } else if (rebooted && bootedToday) {
                    add(daily, today, delta); // all steps since today's reboot are today's
                } else {
                    add(daily, lastDate, delta);
                }
            }
        }
        if (!daily.has(today)) add(daily, today, 0);
        prune(daily);
        p.edit()
            .putFloat(KEY_LAST_COUNTER, counter)
            .putString(KEY_LAST_DATE, today)
            .putLong(KEY_LAST_READ_AT, now)
            .putString(KEY_DAILY, daily.toString())
            .apply();
    }

    /** Daily totals for the last `days` days (oldest first), 0 for missing days. */
    public static synchronized List<long[]> lastDays(Context ctx, int days, List<String> outDates) {
        JSONObject daily = daily(ctx);
        List<long[]> values = new ArrayList<>();
        Calendar c = Calendar.getInstance();
        for (int i = days - 1; i >= 0; i--) {
            Calendar d = (Calendar) c.clone();
            d.add(Calendar.DAY_OF_YEAR, -i);
            String key = dateKey(d.getTimeInMillis());
            outDates.add(key);
            values.add(new long[] { daily.optLong(key, 0) });
        }
        return values;
    }

    private static final String KEY_ENABLED = "enabled";

    /** The user turned the sensor fallback on (Connect) or off (Disconnect). */
    public static boolean isEnabled(Context ctx) {
        return prefs(ctx).getBoolean(KEY_ENABLED, false);
    }

    public static void setEnabled(Context ctx, boolean enabled) {
        prefs(ctx).edit().putBoolean(KEY_ENABLED, enabled).apply();
    }

    public static long lastReadAt(Context ctx) {
        return prefs(ctx).getLong(KEY_LAST_READ_AT, 0);
    }

    private static JSONObject daily(Context ctx) {
        try {
            return new JSONObject(prefs(ctx).getString(KEY_DAILY, "{}"));
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    private static void add(JSONObject daily, String date, long steps) {
        try {
            daily.put(date, daily.optLong(date, 0) + steps);
        } catch (JSONException ignored) {
        }
    }

    private static void prune(JSONObject daily) {
        List<String> keys = new ArrayList<>();
        Iterator<String> it = daily.keys();
        while (it.hasNext()) keys.add(it.next());
        Collections.sort(keys);
        while (keys.size() > KEEP_DAYS) daily.remove(keys.remove(0));
    }
}
