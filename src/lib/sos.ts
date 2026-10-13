// SOS alerts: database calls (migration 20261014000000_sos_alerts.sql).
//
// Patient: raiseSos() -> every active caregiver gets a caregiver_alerts row.
// Caregiver: listens to its caregiver_alerts rows (Realtime), acknowledges.
// The database enforces "1 SOS per 2 minutes" and who may see / change what.
import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { supabase } from "@/integrations/supabase/client";

// The generated Supabase types don't know the new tables / functions yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type SosOption = "alert" | "ambulance" | "health_helpline" | "national_emergency" | "caregiver";

export interface SosEvent {
  id: string;
  patientId: string;
  createdAt: string;
  optionUsed: SosOption;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  status: "active" | "resolved";
  resolvedReason: "patient_safe" | "superseded" | null;
  resolvedAt: string | null;
  acknowledgedBy: string | null;
  acknowledgedByName: string | null;
  acknowledgedAt: string | null;
}

export interface CaregiverAlert {
  id: string;
  patientId: string;
  type: "sos" | "missed_dose";
  status: "active" | "acknowledged" | "resolved";
  createdAt: string;
  seenAt: string | null;
  medicineName: string | null;
  scheduledAt: string | null;
  sos: SosEvent | null;
}

export interface RaiseSosResult {
  sosId: string;
  createdAt: string;
  /** How many caregivers were alerted. */
  caregivers: number;
  /** An SOS was already sent less than 2 minutes ago: that one is returned. */
  rateLimited: boolean;
}

/** An SOS older than this no longer counts as "active" in the apps. */
export const SOS_ACTIVE_HOURS = 24;
/** Caregivers' phones ring for an unanswered SOS younger than this. */
export const SOS_RING_MINUTES = 60;
/** The patient's phone keeps trying to add the location for this long. */
const LOCATION_WAIT_MS = 10_000;

const SOS_COLUMNS =
  "id, patient_id, created_at, option_used, latitude, longitude, location_accuracy_m, status, resolved_reason, resolved_at, acknowledged_by, acknowledged_by_name, acknowledged_at";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toSosEvent(r: any): SosEvent {
  return {
    id: r.id,
    patientId: r.patient_id,
    createdAt: r.created_at,
    optionUsed: r.option_used,
    lat: r.latitude ?? null,
    lng: r.longitude ?? null,
    accuracy: r.location_accuracy_m ?? null,
    status: r.status,
    resolvedReason: r.resolved_reason ?? null,
    resolvedAt: r.resolved_at ?? null,
    acknowledgedBy: r.acknowledged_by ?? null,
    acknowledgedByName: r.acknowledged_by_name ?? null,
    acknowledgedAt: r.acknowledged_at ?? null,
  };
}

/** Active = not resolved and not older than SOS_ACTIVE_HOURS. */
export function isSosActive(e: SosEvent, now = Date.now()): boolean {
  return e.status === "active" && now - new Date(e.createdAt).getTime() < SOS_ACTIVE_HOURS * 3600_000;
}

/** Should a caregiver's phone ring for it? (active, nobody responding yet, recent) */
export function shouldRing(e: SosEvent, now = Date.now()): boolean {
  return isSosActive(e, now) && !e.acknowledgedAt && now - new Date(e.createdAt).getTime() < SOS_RING_MINUTES * 60_000;
}

// ── Patient ───────────────────────────────────────────────────────────────

export async function raiseSos(option: SosOption, coords?: { lat: number; lng: number; accuracy?: number } | null): Promise<RaiseSosResult> {
  const { data, error } = await db.rpc("raise_sos", {
    p_option: option,
    p_lat: coords?.lat ?? null,
    p_lng: coords?.lng ?? null,
    p_accuracy: coords?.accuracy ?? null,
  });
  if (error) throw error;
  return { sosId: data.sos_id, createdAt: data.created_at, caregivers: data.caregivers ?? 0, rateLimited: !!data.rate_limited };
}

export async function updateSosLocation(sosId: string, lat: number, lng: number, accuracy?: number | null): Promise<boolean> {
  const { data, error } = await db.rpc("update_sos_location", { p_sos: sosId, p_lat: lat, p_lng: lng, p_accuracy: accuracy ?? null });
  if (error) throw error;
  return !!data;
}

export async function cancelSos(sosId: string): Promise<boolean> {
  const { data, error } = await db.rpc("cancel_sos", { p_sos: sosId });
  if (error) throw error;
  return !!data;
}

/** The patient's latest SOS that is still active, if any. */
export async function fetchMyActiveSos(patientId: string): Promise<SosEvent | null> {
  const since = new Date(Date.now() - SOS_ACTIVE_HOURS * 3600_000).toISOString();
  const { data, error } = await db
    .from("sos_events")
    .select(SOS_COLUMNS)
    .eq("patient_id", patientId)
    .eq("status", "active")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (error.code !== "42P01" && error.code !== "PGRST205") console.warn("[sos] could not load the active SOS", error.message);
    return null;
  }
  return data ? toSosEvent(data) : null;
}

export async function fetchSosEvent(id: string): Promise<SosEvent | null> {
  const { data, error } = await db.from("sos_events").select(SOS_COLUMNS).eq("id", id).maybeSingle();
  if (error || !data) return null;
  return toSosEvent(data);
}

/**
 * The phone's position for an SOS, without ever blocking the alert.
 * Uses a permission already given; asks only if `ask` is true (the patient
 * tapped "Alert my caregivers", so a prompt is expected).
 */
export async function sosLocation(ask: boolean): Promise<{ lat: number; lng: number; accuracy: number } | null> {
  try {
    if (Capacitor.isNativePlatform()) {
      let perm = await Geolocation.checkPermissions();
      if (perm.location !== "granted" && perm.coarseLocation !== "granted") {
        if (!ask) return null;
        perm = await Geolocation.requestPermissions();
        if (perm.location !== "granted" && perm.coarseLocation !== "granted") return null;
      }
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: LOCATION_WAIT_MS - 500, maximumAge: 60_000 });
      return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
    }
    if (!navigator.geolocation) return null;
    if (!ask && navigator.permissions) {
      const status = await navigator.permissions.query({ name: "geolocation" as PermissionName });
      if (status.state !== "granted") return null;
    }
    return await new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: LOCATION_WAIT_MS - 500, maximumAge: 60_000 },
      );
    });
  } catch {
    return null;
  }
}

/**
 * Adds the location to an SOS that was sent without one. Gives up after
 * ~10 seconds; the alert itself was already sent.
 */
export async function attachLocationLater(sosId: string, ask: boolean): Promise<boolean> {
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), LOCATION_WAIT_MS));
  const coords = await Promise.race([sosLocation(ask), timeout]);
  if (!coords) return false;
  try {
    return await updateSosLocation(sosId, coords.lat, coords.lng, coords.accuracy);
  } catch (e) {
    console.warn("[sos] location not saved", e);
    return false;
  }
}

// ── Caregiver ─────────────────────────────────────────────────────────────

export async function acknowledgeSos(sosId: string): Promise<{ name: string | null; status: string }> {
  const { data, error } = await db.rpc("acknowledge_sos", { p_sos: sosId });
  if (error) throw error;
  return { name: data?.acknowledged_by_name ?? null, status: data?.status ?? "active" };
}

export async function markAlertsSeen(ids?: string[]): Promise<void> {
  const { error } = await db.rpc("mark_caregiver_alerts_seen", { p_ids: ids ?? null });
  if (error) console.warn("[sos] could not mark alerts seen", error.message);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toAlert(r: any): CaregiverAlert {
  return {
    id: r.id,
    patientId: r.patient_id,
    type: r.type,
    status: r.status,
    createdAt: r.created_at,
    seenAt: r.seen_at ?? null,
    medicineName: r.medicine_name ?? null,
    scheduledAt: r.scheduled_at ?? null,
    sos: r.sos_events ? toSosEvent(r.sos_events) : null,
  };
}

const ALERT_COLUMNS = `id, patient_id, type, status, created_at, seen_at, medicine_name, scheduled_at, sos_events(${SOS_COLUMNS})`;

/** My alerts (all linked patients), newest first. */
export async function fetchMyAlerts(limit = 50): Promise<CaregiverAlert[] | null> {
  const { data, error } = await db
    .from("caregiver_alerts")
    .select(ALERT_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    // Table missing (migration not applied yet): no alerts, no noise.
    if (error.code !== "42P01" && error.code !== "PGRST205") console.warn("[sos] could not load alerts", error.message);
    return null;
  }
  return (data ?? []).map(toAlert);
}

/** Active SOS alerts for me (any linked patient). */
export async function fetchActiveSosAlerts(): Promise<CaregiverAlert[] | null> {
  const since = new Date(Date.now() - SOS_ACTIVE_HOURS * 3600_000).toISOString();
  const { data, error } = await db
    .from("caregiver_alerts")
    .select(ALERT_COLUMNS)
    .eq("type", "sos")
    .neq("status", "resolved")
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  if (error) {
    if (error.code !== "42P01" && error.code !== "PGRST205") console.warn("[sos] could not load active SOS", error.message);
    return null;
  }
  return (data ?? []).map(toAlert).filter((a: CaregiverAlert) => a.sos && isSosActive(a.sos));
}

export async function countUnseenAlerts(): Promise<number> {
  const { count, error } = await db
    .from("caregiver_alerts")
    .select("id", { count: "exact", head: true })
    .is("seen_at", null);
  if (error) return 0;
  return count ?? 0;
}

// ── Display helpers ───────────────────────────────────────────────────────

export const mapsUrl = (lat: number, lng: number) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

/** One OpenStreetMap tile around the point, with the point's position inside it (0..1). */
export function osmTile(lat: number, lng: number, zoom = 16) {
  const n = 2 ** zoom;
  const xf = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const yf = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const x = Math.floor(xf);
  const y = Math.floor(yf);
  return { url: `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`, fx: xf - x, fy: yf - y };
}

const addressCache = new Map<string, Promise<string | null>>();

/** Street address for a point (OpenStreetMap Nominatim), or null. Cached per point. */
export function reverseGeocode(lat: number, lng: number, language = "en"): Promise<string | null> {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)},${language}`;
  let p = addressCache.get(key);
  if (!p) {
    p = fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&lat=${lat}&lon=${lng}&accept-language=${encodeURIComponent(language)}`,
      { headers: { Accept: "application/json" } },
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (j?.display_name as string | undefined) ?? null)
      .catch(() => null);
    addressCache.set(key, p);
  }
  return p;
}

/** "just now", "2 min ago", "1 h ago" via the app's translations. */
export function timeAgo(iso: string, t: (k: string, v?: Record<string, string | number>) => string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return t("sosAlert.justNow");
  const m = Math.round(s / 60);
  if (m < 60) return t("sosAlert.minAgo", { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("sosAlert.hourAgo", { n: h });
  return t("sosAlert.dayAgo", { n: Math.floor(h / 24) });
}
