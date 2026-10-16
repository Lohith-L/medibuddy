// Nearby pharmacies from OpenStreetMap (Overpass API).
//
// One request per place: everything within MAX_RADIUS_KM, cached for 10
// minutes (memory + localStorage). The page filters by the chosen radius on
// the device, so switching 2 / 5 / 10 / 15 km never fetches again.
//
// Public Overpass servers reject requests without a meaningful User-Agent
// (overpass-api.de: 406, kumi / private.coffee: 429), and a WebView or browser
// can't set one; their error pages also lack CORS headers, so fetch() only
// reported "Failed to fetch". So:
//   - Android: native HTTP (CapacitorHttp: no CORS) with a MediBuddy User-Agent,
//     then the nearby-pharmacies edge function as a fallback.
//   - Website: the nearby-pharmacies edge function (it sets the User-Agent and
//     caches), then the servers directly.
// Mirrors are "hedged": the next one joins after a few seconds or as soon as
// one fails; the first good answer wins. One automatic retry, then an error.
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";

export interface Pharmacy {
  id: string;
  /** Name, or "" when OpenStreetMap has none (shown as "Local pharmacy"). */
  name: string;
  address: string;
  /** Only real numbers from OpenStreetMap; null when none is listed. */
  phone: string | null;
  /** OpenStreetMap opening_hours, e.g. "24/7" or "Mo-Sa 09:00-21:00". */
  hours: string | null;
  lat: number;
  lng: number;
}

export interface PharmacyWithDistance extends Pharmacy {
  distanceKm: number;
}

export const MAX_RADIUS_KM = 15;
/** Moving less than this keeps the current results. */
export const REFETCH_DISTANCE_KM = 0.5;
const CACHE_TTL_MS = 10 * 60_000;
/** Older results are kept this long, only to show when every server fails. */
const STALE_MAX_MS = 7 * 24 * 3600_000;
const CACHE_KEY = "medibuddy.pharmacies.v2";
const CACHE_MAX_ENTRIES = 6;

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
/** When each mirror joins in (ms after the start). */
const MIRROR_DELAYS = [0, 4000, 8000];
/** Per-server limit. */
const REQUEST_TIMEOUT_MS = 10_000;
/** Pause before the one automatic retry. */
const RETRY_DELAY_MS = 2000;
/** Overpass asks every client to identify itself (else 406 / 429). Native HTTP only. */
const USER_AGENT = "MediBuddy/1.0 (Android medicine-reminder app; nearby pharmacies; +https://github.com/Lohith-L/medibuddy)";

/** Distance in km between two points (Haversine). */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Everything within radiusKm of the point (0 to radiusKm), closest first. */
export function withinRadius(list: Pharmacy[], lat: number, lng: number, radiusKm: number): PharmacyWithDistance[] {
  return list
    .map((p) => ({ ...p, distanceKm: haversineKm(lat, lng, p.lat, p.lng) }))
    .filter((p) => p.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

// ── Cache ─────────────────────────────────────────────────────────────────

interface CacheEntry {
  lat: number;
  lng: number;
  at: number;
  items: Pharmacy[];
}

let memory: CacheEntry[] | null = null;

function readCache(): CacheEntry[] {
  if (memory) return memory;
  try {
    memory = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]") as CacheEntry[];
  } catch {
    memory = [];
  }
  return memory;
}

function writeCache(entries: CacheEntry[]) {
  memory = entries;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entries));
  } catch {
    // Storage full or blocked: memory cache still works this session.
  }
}

/** Results fetched within ~500 m of this point and younger than maxAgeMs (default: fresh, 30 min), or null. */
export function cachedPharmacies(lat: number, lng: number, maxAgeMs = CACHE_TTL_MS): { items: Pharmacy[]; at: number } | null {
  const now = Date.now();
  const hit = readCache()
    .filter((e) => now - e.at < maxAgeMs && haversineKm(lat, lng, e.lat, e.lng) <= REFETCH_DISTANCE_KM)
    .sort((a, b) => b.at - a.at)[0];
  return hit ? { items: hit.items, at: hit.at } : null;
}

function saveToCache(lat: number, lng: number, items: Pharmacy[]) {
  const now = Date.now();
  const kept = readCache().filter((e) => now - e.at < STALE_MAX_MS && haversineKm(lat, lng, e.lat, e.lng) > REFETCH_DISTANCE_KM);
  writeCache([{ lat, lng, at: now, items }, ...kept].slice(0, CACHE_MAX_ENTRIES));
}

// ── Last known location: shared with the rest of the app (lib/location) ──

export { readLastLocation, saveLastLocation } from "@/lib/location";

// ── Overpass ──────────────────────────────────────────────────────────────

function query(lat: number, lng: number): string {
  const a = `(around:${MAX_RADIUS_KM * 1000},${lat},${lng})`;
  return `[out:json][timeout:25];(nwr["amenity"="pharmacy"]${a};nwr["healthcare"="pharmacy"]${a};nwr["shop"="chemist"]${a};);out center tags;`;
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function toPharmacies(elements: OverpassElement[]): Pharmacy[] {
  const out: Pharmacy[] = [];
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) continue;
    const tags = el.tags ?? {};
    const name = tags.name || tags["name:en"] || tags.brand || "";
    const address =
      tags["addr:full"] ||
      [tags["addr:housenumber"], tags["addr:street"], tags["addr:suburb"], tags["addr:city"]].filter(Boolean).join(", ");
    const phone = tags.phone || tags["contact:phone"] || tags["contact:mobile"] || null;
    out.push({
      id: `${el.type}/${el.id}`,
      name,
      address,
      // Several numbers are separated by ";" in OpenStreetMap: keep the first.
      phone: phone ? phone.split(";")[0].trim() : null,
      hours: tags.opening_hours || null,
      lat,
      lng,
    });
  }
  // The same shop is sometimes mapped twice (a point and its building).
  const seen: Pharmacy[] = [];
  for (const p of out) {
    const dup = seen.find(
      (s) => s.name && s.name.toLowerCase() === p.name.toLowerCase() && haversineKm(s.lat, s.lng, p.lat, p.lng) < 0.05,
    );
    if (!dup) seen.push(p);
  }
  return seen;
}

const abortError = () => new DOMException("Aborted", "AbortError");

/** Rejects when the signal aborts (CapacitorHttp itself can't be cancelled). */
function whenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(abortError());
    signal.addEventListener("abort", () => reject(abortError()), { once: true });
  });
}

function parseElements(raw: unknown): OverpassElement[] {
  const data = (typeof raw === "string" ? JSON.parse(raw) : raw) as { elements?: OverpassElement[]; remark?: string };
  // Overpass reports server timeouts in "remark" with a partial (often empty) result.
  if (!Array.isArray(data?.elements) || (data.remark && /timed out|runtime error/i.test(data.remark))) {
    throw new Error(data?.remark || "bad response");
  }
  return data.elements;
}

/** One POST to one Overpass server: native HTTP on Android, fetch on the web. */
async function postOverpass(url: string, body: string, signal: AbortSignal): Promise<OverpassElement[]> {
  if (Capacitor.isNativePlatform()) {
    const res = await Promise.race([
      CapacitorHttp.request({
        url,
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": USER_AGENT },
        data: body,
        responseType: "text",
        connectTimeout: REQUEST_TIMEOUT_MS,
        readTimeout: REQUEST_TIMEOUT_MS,
      }),
      whenAborted(signal),
    ]);
    if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
    return parseElements(res.data);
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseElements(await res.json());
}

/** All mirrors, hedged. Resolves with the first good answer. */
function fromMirrors(lat: number, lng: number, signal: AbortSignal): Promise<{ elements: OverpassElement[]; source: string }> {
  const body = "data=" + encodeURIComponent(query(lat, lng));
  return new Promise((resolve, reject) => {
    const ctls = MIRRORS.map(() => new AbortController());
    const timers: ReturnType<typeof setTimeout>[] = [];
    const errors: string[] = [];
    let started = 0;
    let failed = 0;
    let done = false;
    const finish = () => {
      done = true;
      timers.forEach(clearTimeout);
      ctls.forEach((c) => c.abort());
    };
    signal.addEventListener(
      "abort",
      () => {
        if (done) return;
        finish();
        reject(abortError());
      },
      { once: true },
    );
    const start = (i: number) => {
      if (done || i >= MIRRORS.length || i < started) return;
      started = i + 1;
      const host = new URL(MIRRORS[i]).host;
      timers.push(setTimeout(() => ctls[i].abort(), REQUEST_TIMEOUT_MS));
      postOverpass(MIRRORS[i], body, ctls[i].signal)
        .then((elements) => {
          if (done) return;
          finish();
          resolve({ elements, source: host });
        })
        .catch((e: Error) => {
          if (done) return;
          const why = e.name === "AbortError" ? `timeout ${REQUEST_TIMEOUT_MS / 1000}s` : e.message;
          console.warn(`[pharmacies] ${host}: ${why}`);
          errors.push(`${host}: ${why}`);
          failed++;
          if (failed === MIRRORS.length) {
            finish();
            reject(new Error(errors.join("; ")));
          } else {
            start(started); // a failure brings the next server in now
          }
        });
    };
    start(0);
    MIRROR_DELAYS.forEach((d, i) => i > 0 && timers.push(setTimeout(() => start(i), d)));
  });
}

/** The nearby-pharmacies edge function (sets the User-Agent server side, caches). */
async function fromProxy(lat: number, lng: number, signal: AbortSignal): Promise<{ elements: OverpassElement[]; source: string }> {
  const call = supabase.functions.invoke("nearby-pharmacies", { body: { lat, lng } }).then(({ data, error }) => {
    if (error) throw new Error(`proxy: ${error.message}`);
    return { elements: parseElements(data), source: `proxy${data?.cached ? " (cached)" : ""} via ${data?.mirror ?? "?"}` };
  });
  return Promise.race([call, whenAborted(signal)]);
}

export interface FetchStats {
  ms: number;
  mirror: string;
  fromCache: boolean;
  /** Every server failed: these are saved results from `savedAt` (older than 10 min). */
  stale?: boolean;
  savedAt?: number;
  /** Every Overpass server failed: only the nearest ~50 (OpenStreetMap search), not cached. */
  partial?: boolean;
}

/**
 * Last resort when Overpass is down: OpenStreetMap's search (Nominatim) for
 * "pharmacy" in a ~2.2 km box. At most 50 results, but they are the nearby ones.
 */
async function fromNominatim(lat: number, lng: number, signal: AbortSignal): Promise<Pharmacy[]> {
  const d = 0.02;
  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&q=pharmacy&limit=50&bounded=1&extratags=1" +
    `&viewbox=${lng - d},${lat + d},${lng + d},${lat - d}`;
  let rows: unknown;
  if (Capacitor.isNativePlatform()) {
    const res = await Promise.race([
      CapacitorHttp.get({ url, headers: { Accept: "application/json", "User-Agent": USER_AGENT }, connectTimeout: REQUEST_TIMEOUT_MS, readTimeout: REQUEST_TIMEOUT_MS }),
      whenAborted(signal),
    ]);
    if (res.status < 200 || res.status >= 300) throw new Error(`nominatim: HTTP ${res.status}`);
    rows = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
  } else {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal });
    if (!res.ok) throw new Error(`nominatim: HTTP ${res.status}`);
    rows = await res.json();
  }
  if (!Array.isArray(rows)) throw new Error("nominatim: bad response");
  // Same shape as Overpass elements, so toPharmacies() handles both.
  return toPharmacies(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows.map((r: any) => ({
      type: r.osm_type ?? "node",
      id: r.osm_id,
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
      tags: {
        name: r.name || "",
        "addr:full": String(r.display_name ?? "").split(",").slice(1, 4).join(",").trim(),
        ...(r.extratags?.phone ? { phone: r.extratags.phone } : {}),
        ...(r.extratags?.opening_hours ? { opening_hours: r.extratags.opening_hours } : {}),
      },
    })),
  );
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(abortError());
      },
      { once: true },
    );
  });

/**
 * All pharmacies within MAX_RADIUS_KM of the point. Uses the 10-minute cache
 * unless `force`. Rejects with an AbortError if `signal` aborts, or an Error
 * (with every server's status) if all sources failed twice and nothing is saved.
 */
export async function fetchPharmacies(
  lat: number,
  lng: number,
  opts: { signal?: AbortSignal; force?: boolean } = {},
): Promise<{ items: Pharmacy[]; stats: FetchStats }> {
  const t0 = performance.now();
  if (!opts.force) {
    const hit = cachedPharmacies(lat, lng);
    if (hit) return { items: hit.items, stats: { ms: Math.round(performance.now() - t0), mirror: "cache", fromCache: true } };
  }
  const signal = opts.signal ?? new AbortController().signal;
  const sources = Capacitor.isNativePlatform()
    ? [() => fromMirrors(lat, lng, signal), () => fromProxy(lat, lng, signal)]
    : [() => fromProxy(lat, lng, signal), () => fromMirrors(lat, lng, signal)];

  const errors: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    for (const source of sources) {
      try {
        const { elements, source: from } = await source();
        const items = toPharmacies(elements);
        saveToCache(lat, lng, items);
        return { items, stats: { ms: Math.round(performance.now() - t0), mirror: from, fromCache: false } };
      } catch (e) {
        if ((e as Error).name === "AbortError" || signal.aborted) throw abortError();
        errors.push((e as Error).message);
      }
    }
    if (attempt === 1) await sleep(RETRY_DELAY_MS, signal); // one automatic retry
  }

  console.warn("[pharmacies] every source failed:", errors.join(" | "));
  // Every server failed: older saved results for this place beat an empty page.
  const old = cachedPharmacies(lat, lng, STALE_MAX_MS);
  if (old) {
    return {
      items: old.items,
      stats: { ms: Math.round(performance.now() - t0), mirror: "saved", fromCache: true, stale: true, savedAt: old.at },
    };
  }
  // Then the nearest ones from OpenStreetMap search (not cached: Retry tries the full list again).
  try {
    const items = await fromNominatim(lat, lng, signal);
    if (items.length > 0) {
      return { items, stats: { ms: Math.round(performance.now() - t0), mirror: "nominatim", fromCache: false, partial: true } };
    }
  } catch (e) {
    if ((e as Error).name === "AbortError" || signal.aborted) throw abortError();
    errors.push((e as Error).message);
  }
  throw new Error(errors.join(" | "));
}
