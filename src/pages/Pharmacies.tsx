import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MapPin, Phone, Navigation, Search, AlertCircle, RefreshCw, ExternalLink, ShieldAlert, Store, Clock, ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { useLanguage } from "@/contexts/LanguageContext";
import { L, clusterIcon, pharmacyPinIcon, pharmacyPopupHtml, userDotIcon } from "@/lib/pharmacyMap";
import { getLocation, placeName as lookupPlaceName, type LocationError, type LocationReason } from "@/lib/location";
import LocationNotice from "@/components/LocationNotice";
import { useAppTheme } from "@/contexts/ThemeContext";
import {
  MAX_RADIUS_KM, REFETCH_DISTANCE_KM, fetchPharmacies, cachedPharmacies, haversineKm, readLastLocation, saveLastLocation,
  withinRadius, type Pharmacy, type PharmacyWithDistance,
} from "@/lib/pharmacies";

type Coords = { lat: number; lng: number };

/** Used only when location is off and nothing was searched yet. */
const DEFAULT_COORDS: Coords = { lat: 17.385, lng: 78.4867 }; // Hyderabad
const RADII = [2, 5, 10, 15] as const;
/** Cards shown at first; "Show more" adds this many. */
const PAGE = 20;

const directionsUrl = (p: Pharmacy) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
const round1 = (km: number) => Math.round(km * 10) / 10;

const Pharmacies = () => {
  const { t, locale, language } = useLanguage();
  const { resolved: themeMode } = useAppTheme();

  /** The blue dot and where distances are measured from (my position, or the searched place). */
  const [origin, setOrigin] = useState<Coords | null>(readLastLocation);
  const [placeName, setPlaceName] = useState("pharm.currentLocation");
  const [mode, setMode] = useState<"gps" | "search">("gps");
  const modeRef = useRef(mode);
  modeRef.current = mode;
  /** Why there is no fresh location (shown with the button that fixes it). */
  const [locError, setLocError] = useState<LocationReason | null>(null);
  /** The origin is the last known location (a fresh fix failed). */
  const [lastKnownAt, setLastKnownAt] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);

  const [all, setAll] = useState<Pharmacy[] | null>(() => {
    const last = readLastLocation();
    return last ? cachedPharmacies(last.lat, last.lng)?.items ?? null : null;
  });
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [loadMs, setLoadMs] = useState<number | null>(null);
  /** Every server failed: showing results saved at this time. */
  const [staleAt, setStaleAt] = useState<number | null>(null);
  /** Every Overpass server failed: only the nearest ~50 pharmacies are shown. */
  const [partial, setPartial] = useState(false);

  const [radiusKm, setRadiusKm] = useState<number>(5);
  const [shown, setShown] = useState(PAGE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [manualQuery, setManualQuery] = useState("");
  const [searching, setSearching] = useState(false);

  /** Where the current results were fetched (re-fetch only after moving > 500 m). */
  const fetchedAtRef = useRef<Coords | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollToCardRef = useRef<string | null>(null);

  // A callback ref: the container only appears once the page layout has loaded.
  const [mapEl, setMapEl] = useState<HTMLDivElement | null>(null);
  /** Bumped each time the map is (re)created: map effects re-run for the new map. */
  const [mapGen, setMapGen] = useState(0);
  const mapRef = useRef<L.Map | null>(null);
  const tilesRef = useRef<L.TileLayer | null>(null);
  const userLayerRef = useRef<L.LayerGroup | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const pinsRef = useRef<Map<string, L.Marker>>(new Map());

  // ── Data ────────────────────────────────────────────────────────────

  /** Everything within 15 km of `c` (cache first). Aborts any request still running. */
  const load = useCallback(async (c: Coords, force = false) => {
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    // A different place: never show the previous place's pharmacies (wrong area,
    // wrong counts) while loading or if this request fails.
    const prev = fetchedAtRef.current;
    if (prev && haversineKm(prev.lat, prev.lng, c.lat, c.lng) > REFETCH_DISTANCE_KM) setAll(null);
    fetchedAtRef.current = c;
    const t0 = performance.now();
    if (!force) {
      const hit = cachedPharmacies(c.lat, c.lng);
      if (hit) {
        setAll(hit.items);
        setStaleAt(null);
        setPartial(false);
        setStatus("ok");
        setLoadMs(Math.round(performance.now() - t0));
        return;
      }
    }
    setStatus("loading");
    try {
      const { items, stats } = await fetchPharmacies(c.lat, c.lng, {
        signal: ctl.signal,
        force,
        // Nearest pharmacies in ~1 s while the full directory is still loading.
        onQuick: (quick, savedAt) => {
          if (ctl.signal.aborted) return;
          setAll((cur) => (cur && cur.length >= quick.length ? cur : quick));
          // Saved full list: "last updated" note; search results: "only the nearest".
          if (savedAt) setStaleAt(savedAt);
          else setPartial(true);
          setLoadMs(Math.round(performance.now() - t0));
        },
      });
      if (ctl.signal.aborted) return;
      setAll(items);
      setStatus("ok");
      setStaleAt(stats.stale ? stats.savedAt ?? null : null);
      setPartial(!!stats.partial);
      setLoadMs(stats.ms);
      console.info(`[pharmacies] ${items.length} within ${MAX_RADIUS_KM} km in ${stats.ms} ms (${stats.mirror})`);
    } catch (e) {
      if ((e as Error).name === "AbortError" || ctl.signal.aborted) return;
      console.warn("[pharmacies] directory unreachable:", (e as Error).message);
      setStatus("error");
    }
  }, []);

  /** My position: quick fix (cached / network) unless `fresh`. */
  const locate = useCallback(
    async (fresh: boolean): Promise<Coords | null> => {
      setLocating(true);
      try {
        const c = await getLocation({ maxAgeMs: fresh ? 0 : 5 * 60_000 });
        setLastKnownAt(c.lastKnown ? c.at : null);
        setLocError(c.lastKnown ? "unavailable" : null);
        // "Rajajinagar, Bengaluru" for the map title (best effort).
        void lookupPlaceName(c.lat, c.lng, language).then((name) => {
          if (name && modeRef.current === "gps") setPlaceName(name);
        });
        return { lat: c.lat, lng: c.lng };
      } catch (e) {
        const err = e as LocationError;
        console.warn("[pharmacies] no location:", err.reason, err.code);
        setLocError(err.reason ?? "unavailable");
        return null;
      } finally {
        setLocating(false);
      }
    },
    [language],
  );

  // First visit: map + results for the last known place at once, then the real position.
  useEffect(() => {
    const last = readLastLocation();
    if (last) void load(last);
    void locate(false).then((c) => {
      if (c) {
        setOrigin(c);
        const at = fetchedAtRef.current;
        if (!at || haversineKm(at.lat, at.lng, c.lat, c.lng) > REFETCH_DISTANCE_KM) void load(c);
      } else if (!last) {
        // No location at all: no made-up city. The notice explains; Search area works.
        setStatus("ok");
      }
    });
    return () => abortRef.current?.abort();
    // Runs once on open; later updates come from Refresh / Search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** "Refresh location": a fresh fix and fresh results. */
  const refresh = async () => {
    const c = await locate(true);
    if (!c) return;
    setMode("gps");
    setPlaceName("pharm.currentLocation");
    setOrigin(c);
    void load(c, true);
  };

  const handleManualSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!manualQuery.trim()) {
      toast.error(t("pharm.enterCity"));
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&q=${encodeURIComponent(manualQuery.trim())}`,
      );
      const data = await res.json();
      if (data?.length) {
        const c = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
        const place = data[0].display_name.split(",")[0] || manualQuery;
        setMode("search");
        setOrigin(c);
        setPlaceName(place);
        setLocError(null);
        setLastKnownAt(null);
        toast.success(t("pharm.foundLocation", { place }));
        void load(c);
      } else {
        toast.error(t("pharm.locationNotFound"));
      }
    } catch {
      toast.error(t("pharm.geocodeFailed"));
    } finally {
      setSearching(false);
    }
  };

  /** Within the chosen radius (0 to X km), closest first. Instant: no request. */
  const visible: PharmacyWithDistance[] = useMemo(
    () => (all && origin ? withinRadius(all, origin.lat, origin.lng, radiusKm) : []),
    [all, origin, radiusKm],
  );

  useEffect(() => setShown(PAGE), [radiusKm, origin]);

  // ── Map tiles: OpenStreetMap in both themes ───────────────────────────
  // Dark mode darkens only the tile pane with CSS (index.css, .dark .pharm-map
  // .leaflet-tile-pane): CARTO's dark_all / light_all now return an "API KEY
  // REQUIRED" placeholder instead of streets. Markers, circle and popups are in
  // other panes, so they are never filtered.

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    tilesRef.current?.remove();
    tilesRef.current = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);
    tilesRef.current.bringToBack();
  }, [mapGen]);

  // Theme switched (Light / Dark / System, also when the phone's setting changes):
  // the CSS filter applies at once; re-measure in case the layout shifted.
  useEffect(() => {
    mapRef.current?.invalidateSize();
  }, [themeMode]);

  // ── Map: created once, as soon as its container exists ───────────────

  useEffect(() => {
    if (!mapEl || mapRef.current) return;
    const start = origin ?? DEFAULT_COORDS;
    // maxZoom on the map itself: the cluster layer needs it before any tile layer exists.
    const map = L.map(mapEl, { zoomControl: true, maxZoom: 19 }).setView([start.lat, start.lng], 13);
    mapRef.current = map;
    userLayerRef.current = L.layerGroup().addTo(map);
    clusterRef.current = L.markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      maxClusterRadius: 45,
      chunkedLoading: true,
      iconCreateFunction: clusterIcon,
    }).addTo(map);
    setMapGen((g) => g + 1);
    return () => {
      map.stop(); // a running zoom animation would fail on the removed map (_leaflet_pos)
      map.remove();
      mapRef.current = null;
      clusterRef.current = null;
      userLayerRef.current = null;
      circleRef.current = null;
      tilesRef.current = null;
      pinsRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapEl]);

  // Blue dot + radius circle; the map fits the circle when the place or radius changes.
  useEffect(() => {
    const map = mapRef.current;
    const layer = userLayerRef.current;
    if (!map || !layer || !origin) return;
    layer.clearLayers();
    circleRef.current = L.circle([origin.lat, origin.lng], {
      radius: radiusKm * 1000,
      // Lighter blue on the dark map so the radius stays visible.
      color: themeMode === "dark" ? "#60a5fa" : "#2563eb",
      weight: themeMode === "dark" ? 2 : 1.5,
      fillColor: themeMode === "dark" ? "#60a5fa" : "#2563eb",
      fillOpacity: themeMode === "dark" ? 0.08 : 0.05,
      interactive: false,
    }).addTo(layer);
    L.marker([origin.lat, origin.lng], { icon: userDotIcon(), zIndexOffset: 1000, keyboard: false })
      .addTo(layer)
      .bindPopup(`<b>📍 ${t("weather.yourLocation")}</b><br/>${t(placeName).replace(/</g, "&lt;")}`);
    // No animation: an animated fit racing the cluster / tile updates throws in Leaflet.
    map.fitBounds(circleRef.current.getBounds(), { padding: [12, 12], animate: false });
  }, [mapGen, origin, radiusKm, placeName, t, themeMode]);

  // Pins: only the pharmacies inside the circle, clustered.
  useEffect(() => {
    const cluster = clusterRef.current;
    if (!cluster) return;
    cluster.clearLayers();
    pinsRef.current.clear();
    const pins = visible.map((p) => {
      const pin = L.marker([p.lat, p.lng], {
        icon: pharmacyPinIcon(p.id === selectedId),
        title: p.name || t("pharm.localStore"),
        riseOnHover: true,
      });
      pin.bindPopup(
        pharmacyPopupHtml({
          name: p.name || t("pharm.localStore"),
          address: p.address,
          distanceLabel: t("pharm.kmAway", { km: round1(p.distanceKm) }),
          hoursLabel: p.hours === "24/7" ? t("pharm.open24") : null,
          phone: p.phone,
          callLabel: t("pharm.callShort"),
          directionsLabel: t("pharm.directions"),
          directionsUrl: directionsUrl(p),
        }),
        { maxWidth: 260, minWidth: 200, autoPanPadding: [16, 16] },
      );
      // Tapping a pin highlights its card and scrolls the list to it.
      pin.on("click", () => {
        scrollToCardRef.current = p.id;
        setSelectedId(p.id);
      });
      pinsRef.current.set(p.id, pin);
      return pin;
    });
    cluster.addLayers(pins);
    // The selected pin is restyled below without rebuilding every pin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapGen, visible, t]);

  useEffect(() => {
    pinsRef.current.forEach((pin, id) => {
      const selected = id === selectedId;
      pin.setIcon(pharmacyPinIcon(selected));
      pin.setZIndexOffset(selected ? 900 : 0);
    });
  }, [selectedId, visible]);

  // Pin tapped: make sure its card is rendered, then scroll to it.
  useEffect(() => {
    const id = scrollToCardRef.current;
    if (!id || id !== selectedId) return;
    const index = visible.findIndex((p) => p.id === id);
    if (index >= shown) {
      setShown(Math.ceil((index + 1) / PAGE) * PAGE);
      return; // runs again after the card renders
    }
    scrollToCardRef.current = null;
    document.getElementById(`pharm-card-${id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedId, shown, visible]);

  /** Card tapped: highlight its pin, pan the map to it and open its popup. */
  const selectAndPan = (p: PharmacyWithDistance) => {
    setSelectedId(p.id);
    const map = mapRef.current;
    const pin = pinsRef.current.get(p.id);
    const cluster = clusterRef.current;
    if (!map) return;
    if (window.matchMedia("(max-width: 1023px)").matches) {
      mapEl?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    if (pin && cluster) {
      cluster.zoomToShowLayer(pin, () => {
        map.panTo(pin.getLatLng(), { animate: true });
        pin.openPopup();
      });
    } else {
      map.flyTo([p.lat, p.lng], 16, { duration: 1 });
    }
  };

  const busy = locating || searching;
  const firstLoad = status === "loading" && !all;

  return (
    <DashboardLayout>
      {/* Bottom padding: nothing hides behind the floating SOS button or the bottom nav */}
      <div className="space-y-6 max-w-6xl pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight flex items-center gap-2">
              <Store className="w-7 h-7 text-primary" /> {t("nearbyPharmacies")}
            </h1>
            <p className="text-muted-foreground text-sm mt-1">{t("pharm.subtitle")}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
            disabled={busy}
            className="self-start sm:self-auto rounded-xl flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${locating ? "animate-spin" : ""}`} /> {t("pharm.refreshLocation")}
          </Button>
        </div>

        {locError && mode === "gps" && (
          <div className="space-y-2">
            <LocationNotice reason={locError} lastKnownAt={lastKnownAt} onRetry={() => void refresh()} />
            <p className="px-1 text-sm text-muted-foreground">{t("pharm.enterCityHelp")}</p>
          </div>
        )}

        {/* Search + radius */}
        <div className="bg-card border rounded-2xl p-4 shadow-card space-y-4">
          <form onSubmit={handleManualSearch} className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <MapPin className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={manualQuery}
                onChange={(e) => setManualQuery(e.target.value)}
                placeholder={t("pharm.searchPlaceholder")}
                className="pl-11 rounded-xl min-h-btn text-base"
              />
            </div>
            <Button type="submit" variant="hero" className="rounded-xl px-6 shrink-0" disabled={busy}>
              <Search className="w-4 h-4 mr-2" /> {t("pharm.searchArea")}
            </Button>
          </form>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("pharm.searchRadius")}</span>
            <div className="flex items-center gap-1.5 bg-muted p-1 rounded-xl" role="radiogroup" aria-label={t("pharm.searchRadius")}>
              {RADII.map((r) => (
                <button
                  key={r}
                  role="radio"
                  aria-checked={radiusKm === r}
                  onClick={() => setRadiusKm(r)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    radiusKm === r ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t("pharm.km", { km: r })}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-12 gap-6 items-start">
          {/* Map: shown at once, pins arrive when the list loads */}
          <div className="lg:col-span-6 bg-card border rounded-2xl shadow-card overflow-hidden lg:sticky lg:top-24">
            <div className="p-3.5 bg-muted/50 border-b flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                <Navigation className="w-4 h-4 text-primary" /> {t("pharm.map", { place: t(placeName) })}
              </span>
              <span className="text-xs text-muted-foreground font-medium">{t("pharm.tapMarkers")}</span>
            </div>
            {/* isolate: keeps Leaflet's internal z-indexes below the sticky header and bottom nav */}
            <div ref={setMapEl} className="pharm-map relative isolate z-0 w-full h-[340px] sm:h-[480px]" />
          </div>

          {/* List */}
          <div className="lg:col-span-6 space-y-4">
            {/* No "Found 0" when the request failed: the error card says what happened. */}
            {all && (
            <div className="flex items-center justify-between gap-2 px-1">
              <p className="font-bold text-base" data-load-ms={loadMs ?? undefined} data-count={visible.length} id="pharm-count">
                {firstLoad ? t("pharm.searching") : t("pharm.foundCount", { count: visible.length, km: radiusKm })}
              </p>
              <span className="text-xs text-muted-foreground font-medium flex items-center gap-1 shrink-0">
                {status === "loading" && all ? (
                  <>
                    <RefreshCw className="w-3 h-3 animate-spin" /> {t("pharm.updating")}
                  </>
                ) : (
                  t("pharm.sortedByDistance")
                )}
              </span>
            </div>
            )}

            {partial && status === "ok" && (
              <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-900 dark:text-amber-100" role="status">
                <p className="flex items-start gap-2.5 text-sm font-semibold">
                  <AlertCircle className="w-5 h-5 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span className="min-w-0">{t("pharm.partialResults")}</span>
                </p>
                <Button
                  variant="outline"
                  onClick={() => origin && void load(origin, true)}
                  className="mt-3 w-full min-h-[48px] rounded-xl border-amber-500/50 bg-card text-base font-bold"
                >
                  <RefreshCw className="w-4 h-4 mr-2" /> {t("pharm.retry")}
                </Button>
              </div>
            )}

            {staleAt && status === "ok" && (
              <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-200" role="status">
                <Clock className="w-4 h-4 shrink-0 mt-0.5 text-warning" />
                <p className="flex-1 min-w-0 text-xs font-semibold">
                  {t("pharm.staleResults", {
                    time: new Date(staleAt).toLocaleString(locale, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }),
                  })}
                </p>
                <button
                  onClick={() => origin && void load(origin, true)}
                  className="shrink-0 text-xs font-bold text-amber-700 dark:text-amber-300 hover:underline"
                >
                  {t("pharm.retry")}
                </button>
              </div>
            )}

            {status === "error" && (
              <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-900 dark:text-amber-100" role="alert">
                <p className="flex items-start gap-2.5 text-base font-semibold">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                  <span className="min-w-0">{t("pharm.loadError")}</span>
                </p>
                <Button
                  variant="outline"
                  onClick={() => origin && void load(origin, true)}
                  className="mt-3 w-full min-h-[48px] rounded-xl border-amber-500/50 bg-card text-base font-bold"
                >
                  <RefreshCw className="w-4 h-4 mr-2" /> {t("pharm.retry")}
                </Button>
              </div>
            )}

            {firstLoad ? (
              <div className="space-y-3" aria-busy="true" aria-label={t("pharm.searching")}>
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="p-4 sm:p-5 rounded-2xl border-2 bg-card space-y-3">
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-9 w-full" />
                  </div>
                ))}
                <p className="text-xs text-center text-muted-foreground">{t("pharm.checkingDirectory")}</p>
              </div>
            ) : status !== "error" && visible.length === 0 && all ? (
              <div className="text-center py-12 bg-card border rounded-2xl p-6 space-y-4">
                <AlertCircle className="w-10 h-10 text-muted-foreground mx-auto" />
                <div>
                  <p className="font-bold text-lg">{t("noPharmaciesFound")}</p>
                  {radiusKm < MAX_RADIUS_KM && <p className="text-sm text-muted-foreground mt-1">{t("widenRadius")}</p>}
                </div>
                {radiusKm < MAX_RADIUS_KM && (
                  <div className="flex justify-center gap-2 pt-2">
                    {RADII.filter((r) => r > radiusKm).map((r) => (
                      <Button key={r} variant="outline" size="sm" onClick={() => setRadiusKm(r)}>
                        {t("pharm.searchKm", { km: r })}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            ) : !all ? null : (
              <div className="space-y-3 max-h-[540px] overflow-y-auto pr-1 pb-2" id="pharm-list">
                {visible.slice(0, shown).map((p) => {
                  const isSelected = selectedId === p.id;
                  return (
                    <div
                      key={p.id}
                      id={`pharm-card-${p.id}`}
                      onClick={() => selectAndPan(p)}
                      className={`p-4 sm:p-5 rounded-2xl border-2 cursor-pointer transition-colors ${
                        isSelected ? "border-primary bg-primary/5 shadow-card-hover" : "border-border bg-card hover:border-primary/40 hover:shadow-card"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="min-w-0">
                          <h3 className="font-bold text-base sm:text-lg [overflow-wrap:anywhere]">{p.name || t("pharm.localStore")}</h3>
                          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 [overflow-wrap:anywhere]">
                            {p.address || t("pharm.kmFromSelected", { km: round1(p.distanceKm) })}
                          </p>
                        </div>
                        {p.hours === "24/7" && (
                          <span className="shrink-0 text-[11px] font-extrabold px-2.5 py-1 rounded-full uppercase tracking-wider bg-emerald-500/15 text-success">
                            {t("pharm.open24")}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-muted-foreground my-3">
                        <span className="flex items-center gap-1 text-primary">
                          <MapPin className="w-3.5 h-3.5" /> {t("pharm.kmAway", { km: round1(p.distanceKm) })}
                        </span>
                        {p.phone ? (
                          <span className="flex items-center gap-1">
                            <Phone className="w-3.5 h-3.5" /> {p.phone}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 font-medium">
                            <Phone className="w-3.5 h-3.5" /> {t("pharm.noPhone")}
                          </span>
                        )}
                        {p.hours && p.hours !== "24/7" && (
                          <span className="flex items-center gap-1 font-medium [overflow-wrap:anywhere]">
                            <Clock className="w-3.5 h-3.5 shrink-0" /> {t("pharm.hours", { hours: p.hours })}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 pt-2 border-t">
                        {p.phone && (
                          <a
                            href={`tel:${p.phone.replace(/[^\d+]/g, "")}`}
                            onClick={(e) => e.stopPropagation()}
                            className="flex-1 py-2 px-3 rounded-xl bg-primary text-primary-foreground text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity"
                          >
                            <Phone className="w-4 h-4" /> {t("callPharmacy")}
                          </a>
                        )}
                        <a
                          href={directionsUrl(p)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex-1 py-2 px-3 rounded-xl bg-muted text-foreground hover:bg-muted/80 text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 transition-colors border"
                        >
                          <Navigation className="w-4 h-4 text-primary" /> {t("pharm.directions")} <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </div>
                  );
                })}
                {visible.length > shown && (
                  <Button variant="outline" className="w-full rounded-xl min-h-[48px] font-bold" onClick={() => setShown((n) => n + PAGE)}>
                    <ChevronDown className="w-4 h-4 mr-1.5" /> {t("pharm.showMore", { n: Math.min(PAGE, visible.length - shown) })}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Pharmacies;
