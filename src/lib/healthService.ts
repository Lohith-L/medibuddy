// Health data: real fitness data from Android Health Connect (with the phone's
// step counter as a fallback for steps), synced to Supabase `health_data` so the
// website shows the same numbers. The website only reads from Supabase.
import { Capacitor, registerPlugin } from "@capacitor/core";
import type { HealthDataType } from "@capgo/capacitor-health";
import { supabase } from "@/integrations/supabase/client";

// ── Types ─────────────────────────────────────────────────────────────────

/** Where a day's steps came from. */
export type StepSource = "health_connect" | "phone_sensor";

export interface HealthSummary {
  date: string; // YYYY-MM-DD (local)
  steps: number;
  stepsSource: StepSource | null;
  /** App that recorded the steps, e.g. "Google Fit"; null for the phone sensor or unknown. */
  stepsSourceName: string | null;
  sleepMinutes: number | null;
  heartRateAvg: number | null;
  heartRateLatest: number | null;
  caloriesActive: number | null;
  caloriesTotal: number | null;
  syncedAt: string | null;
  source: string;
}

export type HealthConnectState =
  | "unsupported" // web, or Android without Health Connect support
  | "needs_install" // Android 13 and below: app not installed
  | "needs_update" // installed but too old
  | "available";

export interface StepSensorStatus {
  available: boolean;
  permission: "granted" | "denied" | "prompt" | "prompt-with-rationale";
}

// ── Native plugins ────────────────────────────────────────────────────────

interface MediHealthPlugin {
  getStepSensorStatus(): Promise<StepSensorStatus>;
  requestActivityPermission(): Promise<{ permission: StepSensorStatus["permission"] }>;
  setStepSensorEnabled(opts: { enabled: boolean }): Promise<void>;
  readSensorSteps(opts: { days: number }): Promise<{ ok: boolean; days: { date: string; steps: number }[]; lastReadAt: number }>;
  revokeHealthConnect(): Promise<void>;
  totalCaloriesByDay(opts: { days: number }): Promise<{ days: { date: string; kcal: number }[] }>;
}

const MediHealth = registerPlugin<MediHealthPlugin>("MediHealth");

export const isNativeAndroid = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";

/**
 * Loaded lazily so the website bundle never pulls in the native plugin.
 * Returns the module, not the plugin: awaiting a Capacitor plugin proxy calls
 * its (missing) native "then" method.
 */
const healthModule = () => import("@capgo/capacitor-health");

export const HEALTH_TYPES: HealthDataType[] = ["steps", "sleep", "heartRate", "calories", "totalCalories"];

const HC_PACKAGE = "com.google.android.apps.healthdata";
const CONNECTED_KEY = "medibuddy.health.connected";

// ── Connection preference (Disconnect stops syncing) ──────────────────────

const store = {
  get(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      /* storage unavailable */
    }
  },
};

export const isHealthEnabled = () => store.get(CONNECTED_KEY) === "1";
export const setHealthEnabled = (on: boolean) => store.set(CONNECTED_KEY, on ? "1" : null);

// ── Health Connect: availability, permissions ─────────────────────────────

export const getHealthConnectState = async (): Promise<HealthConnectState> => {
  if (!isNativeAndroid()) return "unsupported";
  try {
    const res = await (await healthModule()).Health.isAvailable();
    if (res.available) return "available";
    const reason = (res.reason || "").toLowerCase();
    if (reason.includes("update")) return "needs_update";
    // Health Connect is built into Android 14+; below that it is a Play Store app.
    return "needs_install";
  } catch {
    return "unsupported";
  }
};

/** Opens the Health Connect page in the Play Store (install or update). */
export const openHealthConnectInPlayStore = () => {
  const a = document.createElement("a");
  a.href = `market://details?id=${HC_PACKAGE}&url=healthconnect%3A%2F%2Fonboarding`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
};

export const openHealthConnectSettings = async () => {
  try {
    await (await healthModule()).Health.openHealthConnectSettings();
  } catch (e) {
    console.warn("[health] could not open Health Connect settings", e);
  }
};

/** The data types this app may read right now. */
export const getGrantedTypes = async (): Promise<HealthDataType[]> => {
  try {
    const res = await (await healthModule()).Health.checkAuthorization({ read: HEALTH_TYPES, write: [] });
    return res.readAuthorized ?? [];
  } catch {
    return [];
  }
};

/** Shows the Health Connect permission sheet; returns the granted types. */
export const requestHealthConnectPermissions = async (): Promise<HealthDataType[]> => {
  const res = await (await healthModule()).Health.requestAuthorization({ read: HEALTH_TYPES, write: [] });
  return res.readAuthorized ?? [];
};

export const revokeHealthConnect = async () => {
  try {
    await MediHealth.revokeHealthConnect();
  } catch (e) {
    console.warn("[health] revoke failed", e);
  }
};

// ── Phone step counter fallback ───────────────────────────────────────────

export const getStepSensorStatus = async (): Promise<StepSensorStatus> => {
  if (!isNativeAndroid()) return { available: false, permission: "denied" };
  try {
    return await MediHealth.getStepSensorStatus();
  } catch {
    return { available: false, permission: "denied" };
  }
};

export const requestActivityPermission = async (): Promise<boolean> => {
  const res = await MediHealth.requestActivityPermission();
  return res.permission === "granted";
};

export const setStepSensorEnabled = async (enabled: boolean) => {
  if (!isNativeAndroid()) return;
  try {
    await MediHealth.setStepSensorEnabled({ enabled });
  } catch (e) {
    console.warn("[health] step sensor toggle failed", e);
  }
};

// ── Dates ─────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");
export const localDateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** The last `days` local dates, oldest first. */
export const lastDates = (days = 7): string[] => {
  const out: string[] = [];
  const today = startOfDay(new Date());
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    out.push(localDateKey(d));
  }
  return out;
};

const emptyDay = (date: string): HealthSummary => ({
  date,
  steps: 0,
  stepsSource: null,
  stepsSourceName: null,
  sleepMinutes: null,
  heartRateAvg: null,
  heartRateLatest: null,
  caloriesActive: null,
  caloriesTotal: null,
  syncedAt: null,
  source: "none",
});

// ── Reading from the phone ────────────────────────────────────────────────

/** Friendly names for apps that commonly write to Health Connect. */
const APP_NAMES: Record<string, string> = {
  "com.google.android.apps.fitness": "Google Fit",
  "com.sec.android.app.shealth": "Samsung Health",
  "com.fitbit.FitbitMobile": "Fitbit",
  "com.google.android.apps.healthdata": "Health Connect",
  "com.google.android.healthconnect.controller": "Health Connect",
  "com.android.healthconnect.controller": "Health Connect",
  "com.xiaomi.wearable": "Mi Fitness",
  "com.mi.health": "Mi Fitness",
  "com.huami.watch.hmwatchmanager": "Zepp",
  "com.huawei.health": "Huawei Health",
  "com.heytap.health.international": "OHealth",
  "com.oneplus.health.international": "OHealth",
  "com.garmin.android.apps.connectmobile": "Garmin Connect",
  "com.withings.wiscale2": "Withings",
  "com.ouraring.oura": "Oura",
  "com.noisefit": "NoiseFit",
  "com.boat.crest": "boAt Crest",
  "com.strava": "Strava",
  "com.nike.plusgps": "Nike Run Club",
  "com.whoop.android": "WHOOP",
  "com.polar.flow": "Polar Flow",
};

/** Steps recorded by the phone itself through Health Connect (Android 14+). */
export const PHONE_HC_SOURCE = "phone";

export const appName = (packageName?: string | null): string | null => {
  if (!packageName) return null;
  // e.g. "com.android.healthconnect.phone.j9c6f8…" — the phone's built-in step tracking
  if (/healthconnect\.phone/.test(packageName)) return PHONE_HC_SOURCE;
  if (APP_NAMES[packageName]) return APP_NAMES[packageName];
  const last = packageName.split(".").pop() || packageName; // "com.example.stepsapp" -> "Stepsapp"
  return last.charAt(0).toUpperCase() + last.slice(1);
};

const iso = (d: Date) => d.toISOString();

// Health Connect reads that threw during the current readDeviceHealth run
// (e.g. the app was not in the foreground, which Android 14+ requires).
let readErrors = 0;
const readFailed = (what: string, e: unknown) => {
  readErrors++;
  console.warn(`[health] ${what} failed`, e);
};
const round = (n: number | null | undefined) => (n == null || !isFinite(n) ? null : Math.round(n));

/** Daily sums for a cumulative type, keyed by local date. Empty map when not allowed. */
const dailySums = async (dataType: HealthDataType, from: Date, to: Date): Promise<Map<string, number>> => {
  const out = new Map<string, number>();
  try {
    const res = await (await healthModule()).Health.queryAggregated({
      dataType,
      startDate: iso(from),
      endDate: iso(to),
      bucket: "day",
      aggregation: "sum",
    });
    for (const s of res.samples) out.set(localDateKey(new Date(s.startDate)), s.value);
  } catch (e) {
    readFailed(`${dataType} aggregate`, e);
  }
  return out;
};

/** Total calories per local date, aggregated natively (the plugin can't sum this type). */
const totalCaloriesByDay = async (): Promise<Map<string, number>> => {
  const out = new Map<string, number>();
  try {
    const res = await MediHealth.totalCaloriesByDay({ days: 7 });
    for (const d of res.days) out.set(d.date, d.kcal);
  } catch (e) {
    readFailed("total calories", e);
  }
  return out;
};

type SleepSample = { endDate: string; value: number; stages?: { stage: string; durationMinutes: number }[] };

/** Minutes asleep per wake-up date (naps on the same day are added). */
const sleepByDay = async (from: Date, to: Date): Promise<Map<string, number>> => {
  const out = new Map<string, number>();
  try {
    // Start a day early so a session that began before midnight is included.
    const start = new Date(from);
    start.setDate(start.getDate() - 1);
    const res = await (await healthModule()).Health.readSamples({
      dataType: "sleep",
      startDate: iso(start),
      endDate: iso(to),
      limit: 200,
      ascending: true,
    });
    for (const s of res.samples as unknown as SleepSample[]) {
      const wake = new Date(s.endDate);
      if (wake < from) continue;
      const minutes = s.stages?.length
        ? s.stages.filter((st) => st.stage !== "awake").reduce((sum, st) => sum + st.durationMinutes, 0)
        : s.value;
      const key = localDateKey(wake);
      out.set(key, (out.get(key) ?? 0) + Math.round(minutes));
    }
  } catch (e) {
    readFailed("sleep read", e);
  }
  return out;
};

/** Today's heart rate: latest reading and the day's average. */
const heartRateToday = async (from: Date, to: Date) => {
  const { Health: h } = await healthModule();
  let latest: number | null = null;
  let avg: number | null = null;
  try {
    const res = await h.readSamples({ dataType: "heartRate", startDate: iso(from), endDate: iso(to), limit: 1, ascending: false });
    latest = round(res.samples[0]?.value);
  } catch (e) {
    readFailed("heart rate read", e);
  }
  try {
    const res = await h.queryAggregated({ dataType: "heartRate", startDate: iso(from), endDate: iso(to), bucket: "day", aggregation: "average" });
    avg = round(res.samples[0]?.value);
  } catch (e) {
    readFailed("heart rate average", e);
  }
  return { latest, avg };
};

/** The app that wrote most of today's steps, e.g. "Google Fit". */
const stepsSourceToday = async (from: Date, to: Date): Promise<string | null> => {
  try {
    const res = await (await healthModule()).Health.readSamples({ dataType: "steps", startDate: iso(from), endDate: iso(to), limit: 1000 });
    const byApp = new Map<string, number>();
    for (const s of res.samples) {
      const key = s.sourceId || s.sourceName || "";
      byApp.set(key, (byApp.get(key) ?? 0) + s.value);
    }
    let best: string | null = null;
    let bestSteps = 0;
    for (const [pkg, steps] of byApp) {
      if (steps > bestSteps) {
        best = pkg;
        bestSteps = steps;
      }
    }
    return appName(best);
  } catch {
    return null;
  }
};

const hasData = (d: HealthSummary) =>
  d.steps > 0 ||
  d.sleepMinutes != null ||
  d.heartRateAvg != null ||
  d.heartRateLatest != null ||
  d.caloriesActive != null ||
  d.caloriesTotal != null;

export interface DeviceReadResult {
  days: HealthSummary[]; // last 7 days, oldest first
  usedHealthConnect: boolean;
  usedSensor: boolean;
  hasAnyData: boolean;
  /** Health Connect reads failed and nothing was read: don't show or sync this result. */
  failed: boolean;
}

/**
 * Reads the last 7 days on the phone. Steps come from Health Connect; days with
 * no Health Connect steps use the phone's step counter (when enabled).
 */
export const readDeviceHealth = async (granted: HealthDataType[]): Promise<DeviceReadResult> => {
  const dates = lastDates(7);
  const days = new Map(dates.map((d) => [d, emptyDay(d)]));
  const now = new Date();
  const [y, m, dd] = dates[0].split("-").map(Number);
  const from = new Date(y, m - 1, dd);
  const todayStart = startOfDay(now);
  const todayKey = localDateKey(now);
  const has = (t: HealthDataType) => granted.includes(t);
  readErrors = 0;
  const none = () => Promise.resolve(new Map<string, number>());

  const [steps, active, total, sleep, hr, srcName] = await Promise.all([
    has("steps") ? dailySums("steps", from, now) : none(),
    has("calories") ? dailySums("calories", from, now) : none(),
    has("totalCalories") ? totalCaloriesByDay() : none(),
    has("sleep") ? sleepByDay(from, now) : none(),
    has("heartRate") ? heartRateToday(todayStart, now) : Promise.resolve({ latest: null, avg: null }),
    has("steps") ? stepsSourceToday(todayStart, now) : Promise.resolve(null),
  ]);

  let usedHealthConnect = false;
  for (const [date, d] of days) {
    const s = round(steps.get(date));
    if (s && s > 0) {
      d.steps = s;
      d.stepsSource = "health_connect";
      if (date === todayKey) d.stepsSourceName = srcName;
      usedHealthConnect = true;
    }
    const ca = round(active.get(date));
    const ct = round(total.get(date));
    d.caloriesActive = ca && ca > 0 ? ca : null;
    d.caloriesTotal = ct && ct > 0 ? ct : null;
    const sl = sleep.get(date);
    d.sleepMinutes = sl != null && sl > 0 ? sl : null;
    if (d.caloriesActive || d.caloriesTotal || d.sleepMinutes) usedHealthConnect = true;
  }
  const today = days.get(todayKey)!;
  today.heartRateAvg = hr.avg;
  today.heartRateLatest = hr.latest;
  if (hr.latest || hr.avg) usedHealthConnect = true;

  // Phone step counter for days without Health Connect steps
  let usedSensor = false;
  try {
    const sensor = await MediHealth.readSensorSteps({ days: 7 });
    for (const s of sensor.days) {
      const d = days.get(s.date);
      if (d && d.stepsSource !== "health_connect" && s.steps > 0) {
        d.steps = s.steps;
        d.stepsSource = "phone_sensor";
        d.stepsSourceName = null;
        usedSensor = true;
      }
    }
  } catch (e) {
    console.warn("[health] step sensor read failed", e);
  }

  const list = dates.map((d) => {
    const day = days.get(d)!;
    day.source = day.stepsSource ?? (hasData(day) ? "health_connect" : "none");
    return day;
  });
  const hasAnyData = list.some(hasData);
  return { days: list, usedHealthConnect, usedSensor, hasAnyData, failed: readErrors > 0 && !hasAnyData };
};

// ── Supabase sync ─────────────────────────────────────────────────────────

/** Real data sources; anything else (e.g. old "demo" rows) is ignored. */
export const REAL_SOURCES = ["health_connect", "phone_sensor"];

// Set once the live table turns out to lack the extra columns (migration not applied yet).
let extraColumnsMissing = false;

const isMissingColumn = (err: { code?: string; message?: string } | null) =>
  !!err && (err.code === "42703" || err.code === "PGRST204" || /column/i.test(err.message || ""));

type Row = Record<string, unknown>;
const EXTRA_COLUMNS = ["heart_rate_latest", "calories_active", "calories_total", "steps_source_name", "updated_at"];
const withoutExtras = (row: Row): Row => Object.fromEntries(Object.entries(row).filter(([k]) => !EXTRA_COLUMNS.includes(k)));

/** Upserts one row per day that has data. Returns the sync time, or null on failure. */
export const syncHealthToBackend = async (patientId: string, days: HealthSummary[]): Promise<string | null> => {
  const syncedAt = new Date().toISOString();
  const rows: Row[] = days.filter(hasData).map((d) => ({
    patient_id: patientId,
    date: d.date,
    steps: d.steps,
    sleep_minutes: d.sleepMinutes,
    heart_rate_avg: d.heartRateAvg,
    calories: d.caloriesTotal ?? d.caloriesActive ?? 0,
    source: d.stepsSource ?? "health_connect",
    synced_at: syncedAt,
    heart_rate_latest: d.heartRateLatest,
    calories_active: d.caloriesActive,
    calories_total: d.caloriesTotal,
    steps_source_name: d.stepsSourceName,
    updated_at: syncedAt,
  }));
  if (!rows.length) return syncedAt;

  const upsert = (r: Row[]) =>
    supabase.from("health_data").upsert(r as never, { onConflict: "patient_id,date" });

  let { error } = await upsert(extraColumnsMissing ? rows.map(withoutExtras) : rows);
  if (error && !extraColumnsMissing && isMissingColumn(error)) {
    extraColumnsMissing = true;
    ({ error } = await upsert(rows.map(withoutExtras)));
  }
  if (error) {
    console.warn("[health] sync failed", error);
    return null;
  }
  return syncedAt;
};

/** Synced real data for the last `days` days (oldest first). */
export const fetchHealthData = async (patientId: string, days = 7): Promise<HealthSummary[]> => {
  const from = new Date();
  from.setDate(from.getDate() - (days - 1));
  const { data, error } = await supabase
    .from("health_data")
    .select("*")
    .eq("patient_id", patientId)
    .in("source", REAL_SOURCES)
    .gte("date", localDateKey(from))
    .order("date", { ascending: true });
  if (error || !data) return [];

  return (data as Record<string, any>[]).map((row) => ({
    date: row.date,
    steps: row.steps || 0,
    stepsSource: (REAL_SOURCES.includes(row.source) ? row.source : null) as StepSource | null,
    stepsSourceName: row.steps_source_name ?? null,
    sleepMinutes: row.sleep_minutes || null,
    heartRateAvg: row.heart_rate_avg ?? null,
    heartRateLatest: row.heart_rate_latest ?? null,
    caloriesActive: row.calories_active ?? null,
    caloriesTotal: row.calories_total ?? (row.calories || null),
    syncedAt: row.synced_at,
    source: row.source || "unknown",
  }));
};

/** Most recent sync time of any real row: null means this account never synced. */
export const fetchLastSyncedAt = async (patientId: string): Promise<string | null> => {
  const { data } = await supabase
    .from("health_data")
    .select("synced_at")
    .eq("patient_id", patientId)
    .in("source", REAL_SOURCES)
    .order("synced_at", { ascending: false })
    .limit(1);
  return (data?.[0] as { synced_at?: string } | undefined)?.synced_at ?? null;
};

/** Fills the 7-day window so charts always have 7 bars. */
export const fillWeek = (rows: HealthSummary[]): HealthSummary[] => {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  return lastDates(7).map((d) => byDate.get(d) ?? emptyDay(d));
};

// ── Phone → Supabase (page open, app foreground, pull-to-refresh) ─────────

let running: Promise<{ syncedAt: string | null; result: DeviceReadResult }> | null = null;

/**
 * Reads the phone and upserts the last 7 days, if the user connected health data.
 * Concurrent callers share one run.
 */
export const syncDeviceHealth = async (
  patientId: string,
): Promise<{ syncedAt: string | null; result: DeviceReadResult } | null> => {
  if (!isNativeAndroid() || !isHealthEnabled()) return null;
  if (!running) {
    running = (async () => {
      const state = await getHealthConnectState();
      const granted = state === "available" ? await getGrantedTypes() : [];
      const result = await readDeviceHealth(granted);
      const syncedAt = result.failed ? null : await syncHealthToBackend(patientId, result.days);
      return { syncedAt, result };
    })().finally(() => {
      running = null;
    });
  }
  return running;
};

// ── Demo data (website, only when this account never synced) ──────────────

export const generateMockHealthData = (date: string): HealthSummary => {
  const dayHash = date.split("-").reduce((a, b) => a + parseInt(b), 0);
  return {
    ...emptyDay(date),
    steps: 3000 + ((dayHash * 137) % 8000),
    sleepMinutes: 300 + ((dayHash * 43) % 180),
    heartRateAvg: 62 + ((dayHash * 7) % 20),
    heartRateLatest: 64 + ((dayHash * 5) % 18),
    caloriesActive: 250 + ((dayHash * 31) % 300),
    caloriesTotal: 1200 + ((dayHash * 89) % 800),
    source: "demo",
  };
};

export const getMockWeekData = (): HealthSummary[] => lastDates(7).map(generateMockHealthData);

/** "7h 25m" with translated unit letters supplied by the caller. */
export const formatSleep = (minutes: number, h = "h", m = "m"): string =>
  `${Math.floor(minutes / 60)}${h} ${minutes % 60}${m}`;
