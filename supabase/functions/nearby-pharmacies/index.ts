/**
 * nearby-pharmacies edge function
 *
 * Proxy for the OpenStreetMap Overpass API. Public Overpass servers now reject
 * requests without a meaningful User-Agent (406 / 429), and browsers can't set
 * one, so the website calls this function instead. It also caches results
 * per ~100 m place for 10 minutes (per function instance), so repeated opens
 * don't hit Overpass.
 *
 * Request:  POST { lat: number, lng: number }      (signed-in users; JWT verified)
 *           POST { action: "geocode", q: string }  -> { found, lat, lng, place, display }
 *             Place search (city, area, pincode) in India via Photon (Nominatim as a
 *             backup; it blocks Supabase's servers), cached 24 h per query.
 * Response: { elements: OverpassElement[], mirror: string, cached: boolean }
 *           | { error, details } with status 502 when every server failed
 *
 * Deploy:   supabase functions deploy nearby-pharmacies
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const USER_AGENT = "MediBuddy/1.0 (medicine-reminder app; nearby pharmacies; +https://github.com/Lohith-L/medibuddy)";
const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
/** When each mirror joins in (ms): a slow server doesn't block the others. */
const MIRROR_DELAYS = [0, 4000, 8000];
const REQUEST_TIMEOUT_MS = 12_000;
const RADIUS_M = 15_000;
const CACHE_TTL_MS = 10 * 60_000;

interface Cached {
  at: number;
  elements: unknown[];
  mirror: string;
}
const cache = new Map<string, Cached>();

function query(lat: number, lng: number) {
  const a = `(around:${RADIUS_M},${lat},${lng})`;
  return `[out:json][timeout:25];(nwr["amenity"="pharmacy"]${a};nwr["healthcare"="pharmacy"]${a};nwr["shop"="chemist"]${a};);out center tags;`;
}

/** Keeps only what the app uses (smaller response). */
// deno-lint-ignore no-explicit-any
function slim(el: any) {
  const t = el.tags ?? {};
  const keep: Record<string, string> = {};
  for (const k of ["name", "name:en", "brand", "addr:full", "addr:housenumber", "addr:street", "addr:suburb", "addr:city", "phone", "contact:phone", "contact:mobile", "opening_hours"]) {
    if (t[k]) keep[k] = t[k];
  }
  return { type: el.type, id: el.id, lat: el.lat, lon: el.lon, center: el.center, tags: keep };
}

async function fromMirror(url: string, body: string, signal: AbortSignal) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": USER_AGENT },
    body,
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data?.elements) || (data.remark && /timed out|runtime error/i.test(data.remark))) {
    throw new Error(data?.remark || "bad response");
  }
  return data.elements.map(slim);
}

/** Main server first; the next mirror joins after a delay or as soon as one fails. */
function race(body: string): Promise<{ elements: unknown[]; mirror: string }> {
  return new Promise((resolve, reject) => {
    const ctls = MIRRORS.map(() => new AbortController());
    const errors: string[] = [];
    let started = 0;
    let failed = 0;
    let done = false;
    const timers: number[] = [];
    const finish = () => {
      done = true;
      timers.forEach(clearTimeout);
      ctls.forEach((c) => c.abort());
    };
    const start = (i: number) => {
      if (done || i >= MIRRORS.length || i < started) return;
      started = i + 1;
      timers.push(setTimeout(() => ctls[i].abort(), REQUEST_TIMEOUT_MS));
      fromMirror(MIRRORS[i], body, ctls[i].signal)
        .then((elements) => {
          if (done) return;
          finish();
          resolve({ elements, mirror: new URL(MIRRORS[i]).host });
        })
        .catch((e) => {
          if (done) return;
          errors.push(`${new URL(MIRRORS[i]).host}: ${e.name === "AbortError" ? "timeout" : e.message}`);
          failed++;
          if (failed === MIRRORS.length) {
            finish();
            reject(new Error(errors.join("; ")));
          } else {
            start(started); // bring the next one in now
          }
        });
    };
    start(0);
    MIRROR_DELAYS.forEach((d, i) => i > 0 && timers.push(setTimeout(() => start(i), d)));
  });
}

// ── Place search (geocode) ─────────────────────────────────────────────

const GEO_TTL_MS = 24 * 3600_000;
const geoCache = new Map<string, { at: number; result: Record<string, unknown> }>();

/** India's bounding box (Photon has no country filter). */
const INDIA_BBOX = "68.1,6.5,97.4,35.7";

/**
 * Photon (komoot's OpenStreetMap geocoder) first: Nominatim answers HTTP 403 to
 * requests from Supabase's servers (shared cloud addresses). Nominatim stays as
 * a backup in case Photon is down.
 */
async function geocodePhoton(q: string): Promise<Record<string, unknown>> {
  const url = `https://photon.komoot.io/api/?limit=1&lang=en&bbox=${INDIA_BBOX}&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`photon HTTP ${res.status}`);
  const data = await res.json();
  const f = data?.features?.[0];
  if (!f || (f.properties?.country && f.properties.country !== "India")) return { found: false };
  const p = f.properties ?? {};
  const [lng, lat] = f.geometry?.coordinates ?? [];
  const place = p.name || p.district || p.city || q;
  const city = [p.city, p.county, p.state].find((x: string | undefined) => x && x !== place && !/taluk|mandal|tehsil/i.test(x)) ?? "";
  return { found: true, lat, lng, place: city ? `${place}, ${city}` : place, display: [p.name, p.city, p.state].filter(Boolean).join(", ") };
}

async function geocodeNominatim(q: string): Promise<Record<string, unknown>> {
  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=in&addressdetails=1&accept-language=en&q=" +
    encodeURIComponent(q);
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`nominatim HTTP ${res.status}`);
  const rows = await res.json();
  const r = Array.isArray(rows) ? rows[0] : null;
  if (!r) return { found: false };
  const a = r.address ?? {};
  const place = r.name || a.suburb || a.neighbourhood || a.city || a.town || a.village || String(r.display_name ?? "").split(",")[0];
  const city = a.city || a.town || a.village || a.county || a.state_district || "";
  return { found: true, lat: parseFloat(r.lat), lng: parseFloat(r.lon), place: city && city !== place ? `${place}, ${city}` : place, display: r.display_name };
}

async function geocode(q: string) {
  const key = q.trim().toLowerCase().replace(/\s+/g, " ");
  const hit = geoCache.get(key);
  if (hit && Date.now() - hit.at < GEO_TTL_MS) return { ...hit.result, cached: true };
  let result: Record<string, unknown>;
  try {
    result = { ...(await geocodePhoton(q.trim())), source: "photon" };
  } catch (e) {
    console.warn(`[geocode] photon failed (${(e as Error).message}), trying nominatim`);
    result = { ...(await geocodeNominatim(q.trim())), source: "nominatim" };
  }
  geoCache.set(key, { at: Date.now(), result });
  if (geoCache.size > 1000) geoCache.delete(geoCache.keys().next().value!);
  return { ...result, cached: false };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let reqBody: { lat?: number; lng?: number; action?: string; q?: string };
  try {
    reqBody = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (reqBody.action === "geocode") {
    const q = String(reqBody.q ?? "").slice(0, 120);
    if (q.trim().length < 2) return json({ error: "q required" }, 400);
    try {
      return json(await geocode(q));
    } catch (e) {
      return json({ error: "Place search unavailable", details: (e as Error).message }, 502);
    }
  }

  const { lat, lng } = reqBody as { lat: number; lng: number };
  if (typeof lat !== "number" || typeof lng !== "number" || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return json({ error: "lat / lng required" }, 400);
  }

  // ~100 m grid: nearby users share one Overpass request.
  const rLat = Math.round(lat * 1000) / 1000;
  const rLng = Math.round(lng * 1000) / 1000;
  const key = `${rLat},${rLng}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return json({ elements: hit.elements, mirror: hit.mirror, cached: true });

  const body = "data=" + encodeURIComponent(query(rLat, rLng));
  try {
    let result;
    try {
      result = await race(body);
    } catch {
      await new Promise((r) => setTimeout(r, 1500)); // one retry after a short pause
      result = await race(body);
    }
    cache.set(key, { at: Date.now(), ...result });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    return json({ ...result, cached: false });
  } catch (e) {
    return json({ error: "Pharmacy directory unavailable", details: (e as Error).message }, 502);
  }
});
