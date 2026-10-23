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
const REQUEST_TIMEOUT_MS = 8_000;
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
/**
 * OpenStreetMap search for pharmacies in a ~11 km box around the point: "pharmacy",
 * then "medicals" (how many Indian chemists are named), 1 s apart as the
 * Nominatim usage policy asks. `onEach` gets the merged list after each search.
 */
async function fromNominatim(
  lat: number,
  lng: number,
  signal: AbortSignal,
  onEach?: (items: Pharmacy[]) => void,
): Promise<Pharmacy[]> {
  const merged = new Map<string, Pharmacy>();
  const errors: string[] = [];
  for (const [i, term] of ["pharmacy", "medicals"].entries()) {
    if (i > 0) await sleep(1100, signal);
    try {
      for (const p of await nominatimSearch(lat, lng, term, signal)) merged.set(p.id, p);
      onEach?.([...merged.values()]);
    } catch (e) {
      if ((e as Error).name === "AbortError" || signal.aborted) throw abortError();
      errors.push((e as Error).message);
    }
  }
  if (!merged.size && errors.length) throw new Error(errors.join("; "));
  return [...merged.values()];
}

async function nominatimSearch(lat: number, lng: number, term: string, signal: AbortSignal): Promise<Pharmacy[]> {
  const d = 0.05;
  const url =
    `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(term)}&limit=50&bounded=1&extratags=1` +
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
/** First promise to resolve wins; rejects with every error if all fail (Promise.any, ES2020-safe). */
function firstSuccess<T>(promises: Promise<T>[]): Promise<T> {
  return new Promise((resolve, reject) => {
    const errors: unknown[] = [];
    let pending = promises.length;
    promises.forEach((p, i) =>
      p.then(resolve, (e) => {
        errors[i] = e;
        if (--pending === 0) reject(errors);
      }),
    );
  });
}

/** The full directory gets this long in total; then quick / saved results stand. */
const FULL_BUDGET_MS = 20_000;

/**
 * All pharmacies within MAX_RADIUS_KM of the point. Uses the 10-minute cache
 * unless `force`.
 *
 * Public Overpass servers are often slow or down, so nobody waits for them:
 * - OpenStreetMap search (Nominatim) answers in ~1 s with the nearest ~50
 *   pharmacies; they are handed to `onQuick` at once;
 * - meanwhile every Overpass server AND the edge-function proxy are asked at
 *   the same time (first good answer wins), for at most FULL_BUDGET_MS;
 * - if they all fail: saved results for this place, else the quick results
 *   (stats.partial), else an Error. Rejects with an AbortError if `signal` aborts.
 */
export async function fetchPharmacies(
  lat: number,
  lng: number,
  opts: { signal?: AbortSignal; force?: boolean; onQuick?: (items: Pharmacy[], savedAt?: number) => void } = {},
): Promise<{ items: Pharmacy[]; stats: FetchStats }> {
  const t0 = performance.now();
  const elapsed = () => Math.round(performance.now() - t0);
  if (!opts.force) {
    const hit = cachedPharmacies(lat, lng);
    if (hit) return { items: hit.items, stats: { ms: elapsed(), mirror: "cache", fromCache: true } };
  }
  const outer = opts.signal ?? new AbortController().signal;
  // Stops the slower full-directory requests once one wins or the budget runs out.
  const fullCtl = new AbortController();
  const stopFull = () => fullCtl.abort();
  outer.addEventListener("abort", stopFull, { once: true });

  let fullDone = false;
  // Saved full results for this place (up to 7 days old): show them at once.
  const saved = cachedPharmacies(lat, lng, STALE_MAX_MS);
  if (saved) {
    console.info(`[pharmacies] showing ${saved.items.length} saved results while refreshing`);
    opts.onQuick?.(saved.items, saved.at);
  }
  const quickP = (saved ? Promise.resolve([] as Pharmacy[]) : fromNominatim(lat, lng, outer, (items) => {
    console.info(`[pharmacies] quick results: ${items.length} in ${elapsed()} ms (nominatim)`);
    if (!fullDone && items.length) opts.onQuick?.(items);
  }))
    // null = the search itself failed; [] = it answered "no pharmacies listed here".
    .catch((e: Error): Pharmacy[] | null => {
      if (e.name !== "AbortError") console.warn("[pharmacies] quick results failed:", e.message);
      return null;
    });

  const errors: string[] = [];
  const budget = setTimeout(() => fullCtl.abort(), FULL_BUDGET_MS);
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        // Every source at once; the first good answer wins.
        const { elements, source } = await firstSuccess([
          fromMirrors(lat, lng, fullCtl.signal),
          fromProxy(lat, lng, fullCtl.signal),
        ]);
        fullDone = true;
        const items = toPharmacies(elements);
        saveToCache(lat, lng, items);
        return { items, stats: { ms: elapsed(), mirror: source, fromCache: false } };
      } catch (e) {
        if (outer.aborted) throw abortError();
        const list = Array.isArray(e) ? e : [e];
        errors.push(...list.map((x) => (x as Error)?.message ?? String(x)));
        // One retry, only after a quick failure (not after timeouts).
        if (attempt === 2 || fullCtl.signal.aborted || elapsed() > 8000) break;
        await sleep(RETRY_DELAY_MS, outer);
      }
    }
  } finally {
    clearTimeout(budget);
    fullCtl.abort();
    outer.removeEventListener("abort", stopFull);
  }
  fullDone = true;
  console.warn(`[pharmacies] full directory unavailable after ${elapsed()} ms:`, errors.join(" | "));

  // Saved full results for this place beat a partial list.
  const old = cachedPharmacies(lat, lng, STALE_MAX_MS);
  if (old) {
    return { items: old.items, stats: { ms: elapsed(), mirror: "saved", fromCache: true, stale: true, savedAt: old.at } };
  }
  const quick = saved ? null : await quickP;
  if (outer.aborted) throw abortError();
  // The search answered (even "none listed here", e.g. a small town): a real result, not an error.
  if (quick) return { items: quick, stats: { ms: elapsed(), mirror: "nominatim", fromCache: false, partial: true } };
  throw new Error(errors.join(" | ") || "no pharmacy source answered");
}

// ── Place search ("Search area") ──────────────────────────────────────────

export interface Place {
  lat: number;
  lng: number;
  /** Short name for the page, e.g. "Mysuru" or "Rajajinagar, Bengaluru". */
  place: string;
}

/**
 * City / area / pincode in India -> coordinates. Through the nearby-pharmacies
 * edge function (proper User-Agent, 24 h cache); if that is unreachable, asks
 * OpenStreetMap directly (native HTTP with a User-Agent on Android).
 * null = not found. Throws if no source answered.
 */
export async function geocodePlace(q: string, signal?: AbortSignal): Promise<Place | null> {
  const query = q.trim();
  try {
    const { data, error } = await supabase.functions.invoke("nearby-pharmacies", { body: { action: "geocode", q: query }, signal });
    if (error) throw error;
    if (data?.found === false) return null;
    if (typeof data?.lat === "number" && typeof data?.lng === "number") return { lat: data.lat, lng: data.lng, place: data.place || query };
    throw new Error("bad geocode reply");
  } catch (e) {
    if ((e as Error).name === "AbortError" || signal?.aborted) throw abortError();
    console.warn("[pharmacies] geocode via edge function failed, asking Photon directly:", (e as Error).message);
  }
  // Photon (OpenStreetMap geocoder, allows app use, CORS-enabled), then Nominatim.
  try {
    const url = `https://photon.komoot.io/api/?limit=1&lang=en&bbox=68.1,6.5,97.4,35.7&q=${encodeURIComponent(query)}`;
    let data: { features?: { geometry?: { coordinates?: number[] }; properties?: Record<string, string> }[] };
    if (Capacitor.isNativePlatform()) {
      const res = await CapacitorHttp.get({ url, headers: { Accept: "application/json", "User-Agent": USER_AGENT }, connectTimeout: 6000, readTimeout: 6000 });
      if (res.status < 200 || res.status >= 300) throw new Error(`photon: HTTP ${res.status}`);
      data = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
    } else {
      const res = await fetch(url, { headers: { Accept: "application/json" }, signal });
      if (!res.ok) throw new Error(`photon: HTTP ${res.status}`);
      data = await res.json();
    }
    const f = data?.features?.[0];
    if (!f || (f.properties?.country && f.properties.country !== "India")) return null;
    const p = f.properties ?? {};
    const [lng, lat] = f.geometry?.coordinates ?? [];
    const name = p.name || p.district || p.city || query;
    const city = [p.city, p.county, p.state].find((x) => x && x !== name && !/taluk|mandal|tehsil/i.test(x)) ?? "";
    return { lat, lng, place: city ? `${name}, ${city}` : name };
  } catch (e) {
    if ((e as Error).name === "AbortError" || signal?.aborted) throw abortError();
    console.warn("[pharmacies] photon failed, asking Nominatim:", (e as Error).message);
  }
  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=in&addressdetails=1&accept-language=en&q=" +
    encodeURIComponent(query);
  let rows: unknown;
  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.get({ url, headers: { Accept: "application/json", "User-Agent": USER_AGENT }, connectTimeout: 8000, readTimeout: 8000 });
    if (res.status < 200 || res.status >= 300) throw new Error(`nominatim: HTTP ${res.status}`);
    rows = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
  } else {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal });
    if (!res.ok) throw new Error(`nominatim: HTTP ${res.status}`);
    rows = await res.json();
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = Array.isArray(rows) ? (rows[0] as any) : null;
  if (!r) return null;
  const a = r.address ?? {};
  const name = r.name || a.suburb || a.city || a.town || a.village || String(r.display_name ?? "").split(",")[0] || query;
  const city = a.city || a.town || a.village || a.county || "";
  return { lat: parseFloat(r.lat), lng: parseFloat(r.lon), place: city && city !== name ? `${name}, ${city}` : name };
}
