// Nearby pharmacies from OpenStreetMap (Overpass API).
//
// One request per place: everything within MAX_RADIUS_KM, cached for 30
// minutes (memory + localStorage). The page filters by the chosen radius on
// the device, so switching 2 / 5 / 10 / 15 km never fetches again.
//
// Overpass servers are often slow or return 504, so mirrors are "hedged":
// the main server starts at once, the next mirror joins if no answer came
// within a few seconds, and the first good answer wins (the others are aborted).

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
const CACHE_TTL_MS = 30 * 60_000;
/** Older results are kept this long, only to show when every server fails. */
const STALE_MAX_MS = 7 * 24 * 3600_000;
const CACHE_KEY = "medibuddy.pharmacies.v2";
const CACHE_MAX_ENTRIES = 6;
const LAST_LOCATION_KEY = "medibuddy.lastLocation";

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
/** When each mirror joins in (ms after the start). */
const MIRROR_DELAYS = [0, 3500, 7000];
/** Per-request limit (the query asks the server for 15 s). */
const REQUEST_TIMEOUT_MS = 16_000;

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

// ── Last known location (map shows at once next time) ─────────────────────

export function readLastLocation(): { lat: number; lng: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_LOCATION_KEY) || "null");
    return v && typeof v.lat === "number" && typeof v.lng === "number" ? { lat: v.lat, lng: v.lng } : null;
  } catch {
    return null;
  }
}

export function saveLastLocation(c: { lat: number; lng: number }) {
  try {
    localStorage.setItem(LAST_LOCATION_KEY, JSON.stringify({ lat: c.lat, lng: c.lng, at: Date.now() }));
  } catch {
    /* ignore */
  }
}

// ── Overpass ──────────────────────────────────────────────────────────────

function query(lat: number, lng: number): string {
  const r = MAX_RADIUS_KM * 1000;
  return `[out:json][timeout:15];(
nwr["amenity"="pharmacy"](around:${r},${lat},${lng});
nwr["healthcare"="pharmacy"](around:${r},${lat},${lng});
nwr["shop"="chemist"](around:${r},${lat},${lng});
);out center tags;`;
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

async function fromMirror(url: string, body: string, signal: AbortSignal): Promise<Pharmacy[]> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { elements?: OverpassElement[]; remark?: string };
  // Overpass reports server timeouts in "remark" with a partial (often empty) result.
  if (!data.elements || (data.remark && /timed out|runtime error/i.test(data.remark))) {
    throw new Error(data.remark || "bad response");
  }
  return toPharmacies(data.elements);
}

export interface FetchStats {
  ms: number;
  mirror: string;
  fromCache: boolean;
  /** Every server failed: these are saved results from `savedAt` (older than 30 min). */
  stale?: boolean;
  savedAt?: number;
}

/**
 * All pharmacies within MAX_RADIUS_KM of the point. Uses the 30-minute cache
 * unless `force`. Rejects with an AbortError if `signal` aborts, or an Error
 * if every mirror failed.
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

  const body = "data=" + encodeURIComponent(query(lat, lng));
  const controllers = MIRRORS.map(() => new AbortController());
  const timers: ReturnType<typeof setTimeout>[] = [];
  const abortAll = () => controllers.forEach((c) => c.abort());
  opts.signal?.addEventListener("abort", abortAll, { once: true });

  try {
    const result = await new Promise<{ items: Pharmacy[]; mirror: string }>((resolve, reject) => {
      let failed = 0;
      let started = 0;
      const errors: string[] = [];
      const start = (i: number) => {
        if (controllers[i].signal.aborted) return;
        started++;
        const timeout = setTimeout(() => controllers[i].abort(), REQUEST_TIMEOUT_MS);
        timers.push(timeout);
        fromMirror(MIRRORS[i], body, controllers[i].signal)
          .then((items) => resolve({ items, mirror: new URL(MIRRORS[i]).host }))
          .catch((e: Error) => {
            if (opts.signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
            errors.push(`${new URL(MIRRORS[i]).host}: ${e.name === "AbortError" ? "timeout" : e.message}`);
            failed++;
            // A failure brings the next mirror in right away.
            const next = started;
            if (next < MIRRORS.length) {
              clearTimeout(waits[next]);
              start(next);
            } else if (failed === MIRRORS.length) {
              reject(new Error(errors.join("; ")));
            }
          });
      };
      const waits = MIRROR_DELAYS.map((d, i) =>
        i === 0
          ? (start(0), undefined as unknown as ReturnType<typeof setTimeout>)
          : setTimeout(() => {
              if (started === i) start(i);
            }, d),
      );
      timers.push(...waits.filter(Boolean));
      opts.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });

    saveToCache(lat, lng, result.items);
    return { items: result.items, stats: { ms: Math.round(performance.now() - t0), mirror: result.mirror, fromCache: false } };
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    // Every server failed: older saved results for this place beat an empty page.
    const old = cachedPharmacies(lat, lng, STALE_MAX_MS);
    if (old) {
      return {
        items: old.items,
        stats: { ms: Math.round(performance.now() - t0), mirror: "saved", fromCache: true, stale: true, savedAt: old.at },
      };
    }
    throw e;
  } finally {
    timers.forEach(clearTimeout);
    abortAll(); // stop the slower mirrors
  }
}
