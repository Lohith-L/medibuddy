/**
 * location.ts: the ONE way the app gets the user's position (weather card,
 * pharmacies, SOS).
 *
 * - Android / iOS: @capacitor/geolocation (navigator.geolocation in the Android
 *   WebView never shows the permission popup and fails silently).
 * - Website: navigator.geolocation.
 *
 * Steps: check the permission -> if Android would ask, first show our short
 * explanation (registered by LocationRationaleHost) -> request -> high-accuracy
 * fix (15 s, a fix up to 5 min old is fine) -> on timeout retry once with
 * network accuracy -> on failure fall back to the last known location, clearly
 * marked. Never a made-up city.
 *
 * Failures reject with a LocationError whose `reason` says what went wrong;
 * the exact plugin error code / message is logged to the console.
 */
import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";

export type LocationReason = "permission-denied" | "location-off" | "timeout" | "unavailable" | "unsupported";

export const LOCATION_MESSAGES: Record<LocationReason, string> = {
  "permission-denied": "Location is off for MediBuddy. Enable it in Settings > Apps > MediBuddy > Permissions.",
  "location-off": "Your phone's location is turned off. Please turn on Location in your quick settings and try again.",
  timeout: "We couldn't find your location in time. Please try again.",
  unavailable: "We couldn't get your location right now. Please try again.",
  unsupported: "Location is not supported on this device.",
};

export class LocationError extends Error {
  readonly reason: LocationReason;
  /** Friendly text to show the user. Only set on native; the website stays silent as before. */
  readonly userMessage: string | null;
  /** Translation key, e.g. "location.permission-denied". */
  readonly messageKey: string;
  /** The plugin / browser error code, for debugging. */
  readonly code: string | null;

  constructor(reason: LocationReason, cause?: unknown, code: string | null = null) {
    super(LOCATION_MESSAGES[reason]);
    this.name = "LocationError";
    this.reason = reason;
    this.messageKey = `location.${reason}`;
    this.userMessage = Capacitor.isNativePlatform() ? LOCATION_MESSAGES[reason] : null;
    this.code = code;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

export interface Coords {
  lat: number;
  lng: number;
}

export interface DeviceLocation extends Coords {
  /** Metres, if known. */
  accuracy: number | null;
  /** When the fix was taken (epoch ms). */
  at: number;
  /** A fresh fix failed: this is the last known location (show it as such). */
  lastKnown: boolean;
}

export interface LocationOptions {
  /**
   * May show the explanation + Android permission popup if not decided yet
   * (default true). Use false for background work that must never prompt.
   */
  prompt?: boolean;
  /** Accept a fix up to this old (default 5 min). */
  maxAgeMs?: number;
  /** Use the last known location if a fresh fix fails (default true). */
  allowLastKnown?: boolean;
}

const LAST_KEY = "medibuddy.lastLocation";
/** The last known location is offered for at most this long. */
const LAST_KNOWN_MAX_MS = 24 * 3600_000;

// ── Last known location ───────────────────────────────────────────────────

export function readLastLocation(): (Coords & { at: number; accuracy: number | null }) | null {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_KEY) || "null");
    if (!v || typeof v.lat !== "number" || typeof v.lng !== "number") return null;
    return { lat: v.lat, lng: v.lng, at: typeof v.at === "number" ? v.at : 0, accuracy: v.accuracy ?? null };
  } catch {
    return null;
  }
}

export function saveLastLocation(c: Coords & { accuracy?: number | null; at?: number }) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ lat: c.lat, lng: c.lng, accuracy: c.accuracy ?? null, at: c.at ?? Date.now() }));
  } catch {
    /* ignore */
  }
}

// ── Explanation before the permission popup ───────────────────────────────

type RationaleHandler = () => Promise<boolean>;
let rationaleHandler: RationaleHandler | null = null;
let rationalePending: Promise<boolean> | null = null;

/** LocationRationaleHost registers the dialog that explains why we ask. */
export function setLocationRationaleHandler(h: RationaleHandler | null) {
  rationaleHandler = h;
}

async function explainFirst(): Promise<boolean> {
  if (!rationaleHandler) return true;
  // Several screens may ask at once: one dialog.
  rationalePending ??= rationaleHandler().finally(() => (rationalePending = null));
  return rationalePending;
}

// ── Permission ────────────────────────────────────────────────────────────

export type PermissionState = "granted" | "prompt" | "denied" | "unsupported";

/** Native: Capacitor permission state. Website: Permissions API where available. */
export async function locationPermission(): Promise<PermissionState> {
  try {
    if (Capacitor.isNativePlatform()) {
      const p = await Geolocation.checkPermissions();
      if (p.location === "granted" || p.coarseLocation === "granted") return "granted";
      if (p.location === "denied") return "denied";
      return "prompt"; // "prompt" or "prompt-with-rationale"
    }
    if (!navigator.geolocation) return "unsupported";
    if (!navigator.permissions) return "prompt";
    const s = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    return s.state as PermissionState;
  } catch {
    return "prompt";
  }
}

/** Plugin error codes (OS-PLUG-GLOC-xxxx) -> reason. */
function reasonFromNativeError(err: unknown): LocationReason {
  const code = (err as { code?: string } | null)?.code ?? "";
  switch (code) {
    case "OS-PLUG-GLOC-0003": // permission denied
    case "OS-PLUG-GLOC-0008": // restricted (iOS)
      return "permission-denied";
    case "OS-PLUG-GLOC-0007": // location services disabled
    case "OS-PLUG-GLOC-0009": // user declined the "turn on location" dialog
    case "OS-PLUG-GLOC-0017": // network and location both off
      return "location-off";
    case "OS-PLUG-GLOC-0010": // timeout
      return "timeout";
    default: {
      const msg = String((err as { message?: string } | null)?.message ?? "");
      if (/location services|disabled|turned off/i.test(msg)) return "location-off";
      if (/denied|permission/i.test(msg)) return "permission-denied";
      if (/time ?out|in time/i.test(msg)) return "timeout";
      return "unavailable";
    }
  }
}

/** Makes sure we may read the location; explains first, then shows the system popup. */
async function ensurePermission(prompt: boolean): Promise<void> {
  const state = await locationPermission();
  if (state === "granted") return;
  if (state === "unsupported") throw new LocationError("unsupported");
  if (state === "denied" || !prompt) throw new LocationError("permission-denied", undefined, `permission:${state}`);
  if (!Capacitor.isNativePlatform()) return; // the browser asks by itself on getCurrentPosition
  if (!(await explainFirst())) throw new LocationError("permission-denied", undefined, "rationale:not-now");
  const p = await Geolocation.requestPermissions({ permissions: ["location"] });
  console.info("[location] permission after request:", JSON.stringify(p));
  if (p.location !== "granted" && p.coarseLocation !== "granted") {
    throw new LocationError("permission-denied", undefined, `permission:${p.location}`);
  }
}

// ── Position ──────────────────────────────────────────────────────────────

/** Android: is the phone's Location switch on? (true if it can't be checked) */
async function phoneLocationEnabled(): Promise<boolean> {
  try {
    const { MedicineAlarm } = await import("@/plugins/medicineAlarm");
    return (await MedicineAlarm.isLocationEnabled()).enabled;
  } catch {
    return true;
  }
}

async function nativePosition(highAccuracy: boolean, maxAgeMs: number) {
  const pos = await Geolocation.getCurrentPosition({
    enableHighAccuracy: highAccuracy,
    timeout: highAccuracy ? 15_000 : 10_000,
    maximumAge: maxAgeMs,
  });
  return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? null, at: pos.timestamp || Date.now() };
}

function webPosition(highAccuracy: boolean, maxAgeMs: number) {
  return new Promise<{ lat: number; lng: number; accuracy: number | null; at: number }>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? null, at: p.timestamp || Date.now() }),
      (err) => {
        const reason: LocationReason =
          err.code === err.PERMISSION_DENIED ? "permission-denied" : err.code === err.TIMEOUT ? "timeout" : "unavailable";
        reject(new LocationError(reason, err, `web:${err.code}`));
      },
      { enableHighAccuracy: highAccuracy, timeout: highAccuracy ? 15_000 : 10_000, maximumAge: maxAgeMs },
    );
  });
}

/**
 * The user's position. Rejects with a LocationError (permission-denied,
 * location-off, unsupported, or timeout/unavailable when there is no last
 * known location either).
 */
export async function getLocation(opts: LocationOptions = {}): Promise<DeviceLocation> {
  const { prompt = true, maxAgeMs = 5 * 60_000, allowLastKnown = true } = opts;
  const native = Capacitor.isNativePlatform();
  if (!native && !navigator.geolocation) throw new LocationError("unsupported");

  await ensurePermission(prompt);

  // Location switched off on the phone: say so at once (the plugin would only
  // time out after ~25 s and report "timeout").
  if (native && !(await phoneLocationEnabled())) {
    console.warn("[location] failed: reason=location-off (phone Location switch is off)");
    throw new LocationError("location-off", undefined, "device:location-off");
  }

  const attempt = async (highAccuracy: boolean) => {
    try {
      return native ? await nativePosition(highAccuracy, maxAgeMs) : await webPosition(highAccuracy, maxAgeMs);
    } catch (err) {
      if (err instanceof LocationError) throw err;
      const code = (err as { code?: string } | null)?.code ?? null;
      console.warn(`[location] ${highAccuracy ? "high" : "network"} accuracy failed: code=${code} message=${(err as Error)?.message}`);
      throw new LocationError(reasonFromNativeError(err), err, code);
    }
  };

  let lastError: LocationError;
  try {
    const p = await attempt(true);
    saveLastLocation(p);
    return { ...p, lastKnown: false };
  } catch (e) {
    lastError = e as LocationError;
  }
  // Indoors GPS often times out: network / Wi-Fi accuracy is enough for pharmacies and weather.
  if (lastError.reason === "timeout" || lastError.reason === "unavailable") {
    try {
      const p = await attempt(false);
      saveLastLocation(p);
      return { ...p, lastKnown: false };
    } catch (e) {
      lastError = e as LocationError;
    }
  }
  console.warn(`[location] failed: reason=${lastError.reason} code=${lastError.code}`);
  if (allowLastKnown && (lastError.reason === "timeout" || lastError.reason === "unavailable")) {
    const last = readLastLocation();
    if (last && Date.now() - last.at < LAST_KNOWN_MAX_MS) {
      console.info("[location] using the last known location");
      return { ...last, lastKnown: true };
    }
  }
  throw lastError;
}

// ── Open the right settings page ──────────────────────────────────────────

/** Android: MediBuddy's app settings (permissions). */
export async function openAppSettings() {
  if (!Capacitor.isNativePlatform()) return;
  const { MedicineAlarm } = await import("@/plugins/medicineAlarm");
  await MedicineAlarm.openAppSettings().catch(() => {});
}

/** Android: the phone's Location settings page. */
export async function openLocationSettings() {
  if (!Capacitor.isNativePlatform()) return;
  const { MedicineAlarm } = await import("@/plugins/medicineAlarm");
  await MedicineAlarm.openLocationSettings().catch(() => openAppSettings());
}

// ── Place name for display ("Rajajinagar, Bengaluru") ─────────────────────

const placeCache = new Map<string, Promise<string | null>>();

/** Neighbourhood + city for a point (OpenStreetMap), or null. Cached per ~100 m. */
export function placeName(lat: number, lng: number, language = "en"): Promise<string | null> {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)},${language}`;
  let p = placeCache.get(key);
  if (!p) {
    p = fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&lat=${lat}&lon=${lng}&accept-language=${encodeURIComponent(language)}`,
      { headers: { Accept: "application/json" } },
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const a = j?.address ?? {};
        const area = a.suburb || a.neighbourhood || a.quarter || a.village || a.town || null;
        const city = a.city || a.town || a.county || a.state_district || null;
        const name = [area, city !== area ? city : null].filter(Boolean).join(", ");
        return name || null;
      })
      .catch(() => null);
    placeCache.set(key, p);
  }
  return p;
}
