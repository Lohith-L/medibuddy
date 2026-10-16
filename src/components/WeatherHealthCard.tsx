import { useEffect, useState } from "react";
import {
  Sun, CloudRain, Thermometer, Droplets, Wind, ShieldAlert, Sparkles, MapPin, RefreshCw, Snowflake, ShieldCheck, Heart, CloudSun,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { motion } from "framer-motion";
import { getLocation, placeName, type LocationError, type LocationReason } from "@/lib/location";
import LocationNotice from "@/components/LocationNotice";

interface WeatherState {
  temp: number;
  humidity: number;
  weatherCode: number;
  windSpeed: number;
  aqi: number | null;
  cityName: string;
  timestamp: number;
}

interface RuleTip {
  icon: any;
  titleKey: string;
  descKey: string;
  badgeKey: string;
  badgeBg: string;
}

// v2: v1 could hold the old silent "Hyderabad" fallback.
const CACHE_KEY = "medbuddy_weather_data_v2";
const CACHE_EXPIRY_MS = 2 * 60 * 60 * 1000; // 2 hours

export const WeatherHealthCard = () => {
  const { t, language } = useLanguage();
  const [weather, setWeather] = useState<WeatherState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  /** Why there is no location (shown with the button that fixes it). */
  const [locError, setLocError] = useState<LocationReason | null>(null);
  /** Weather is for the last known location (a fresh fix failed). */
  const [lastKnownAt, setLastKnownAt] = useState<number | null>(null);

  useEffect(() => {
    // Check cached weather first
    const cachedStr = localStorage.getItem(CACHE_KEY);
    if (cachedStr) {
      try {
        const cached: WeatherState = JSON.parse(cachedStr);
        if (Date.now() - cached.timestamp < CACHE_EXPIRY_MS) {
          setWeather(cached);
          setLoading(false);
          return;
        }
      } catch (e) {
        localStorage.removeItem(CACHE_KEY);
      }
    }

    fetchWeatherForLocation();
  }, []);

  /** Weather for the user's real position (shared location service). No made-up city. */
  const fetchWeatherForLocation = async () => {
    setLoading(true);
    setError(false);
    setLocError(null);
    let loc;
    try {
      loc = await getLocation();
    } catch (e) {
      const err = e as LocationError;
      console.warn("[weather] no location:", err.reason, err.code);
      setLocError(err.reason ?? "unavailable");
      setWeather(null);
      setLoading(false);
      return;
    }
    setLastKnownAt(loc.lastKnown ? loc.at : null);
    if (loc.lastKnown) setLocError("unavailable");
    // "Rajajinagar, Bengaluru" when the lookup answers quickly; else "Your location".
    const name = await Promise.race([
      placeName(loc.lat, loc.lng, language),
      new Promise<null>((r) => setTimeout(() => r(null), 4000)),
    ]);
    await fetchOpenMeteo(loc.lat, loc.lng, name || "weather.yourLocation", !loc.lastKnown);
  };

  const fetchOpenMeteo = async (lat: number, lng: number, cityLabel: string, cache = true) => {
    try {
      const weatherPromise = fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m`
      ).then((r) => r.json());

      const aqiPromise = fetch(
        `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&current=us_aqi`
      )
        .then((r) => r.json())
        .catch(() => null);

      const [wData, aData] = await Promise.all([weatherPromise, aqiPromise]);

      if (wData?.current) {
        const newState: WeatherState = {
          temp: Math.round(wData.current.temperature_2m),
          humidity: Math.round(wData.current.relative_humidity_2m),
          weatherCode: wData.current.weather_code,
          windSpeed: Math.round(wData.current.wind_speed_10m),
          aqi: aData?.current?.us_aqi ? Math.round(aData.current.us_aqi) : null,
          cityName: cityLabel,
          timestamp: Date.now(),
        };

        setWeather(newState);
        if (cache) localStorage.setItem(CACHE_KEY, JSON.stringify(newState));
      } else {
        throw new Error("Invalid weather payload");
      }
    } catch (err) {
      console.error("Weather fetch failed:", err);
      // No invented numbers: show that the forecast couldn't load.
      setError(true);
      setWeather(null);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-card border rounded-2xl p-5 shadow-card animate-pulse space-y-3">
        <div className="h-6 bg-muted rounded-md w-1/3" />
        <div className="h-4 bg-muted rounded-md w-2/3" />
        <div className="h-16 bg-muted rounded-xl" />
      </div>
    );
  }

  if (!weather) {
    return (
      <div className="bg-card border rounded-2xl p-5 shadow-card space-y-3">
        <h3 className="font-extrabold text-lg text-foreground flex items-center gap-2">{t("weatherAdvisory")} ⛅</h3>
        {locError ? (
          <LocationNotice reason={locError} onRetry={() => void fetchWeatherForLocation()} compact />
        ) : error ? (
          <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>{t("locperm.weatherFailed")}</span>
            <Button variant="outline" size="sm" onClick={() => void fetchWeatherForLocation()}>
              <RefreshCw className="w-4 h-4 mr-1.5" /> {t("locperm.retry")}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  // Generate rule-based tips based on current weather parameters
  const generateTips = (): RuleTip[] => {
    const tips: RuleTip[] = [];

    // Rule 1: High Temperature (> 32°C)
    if (weather.temp >= 32) {
      tips.push({
        icon: Sun,
        titleKey: "weatherHotTitle",
        descKey: "weatherHotDesc",
        badgeKey: "weather.badgeHeat",
        badgeBg: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
      });
    }

    // Rule 2: Cold Weather (< 18°C)
    if (weather.temp <= 18) {
      tips.push({
        icon: Snowflake,
        titleKey: "weatherColdTitle",
        descKey: "weatherColdDesc",
        badgeKey: "weather.badgeCold",
        badgeBg: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30",
      });
    }

    // Rule 3: High Humidity (> 70%)
    if (weather.humidity >= 70) {
      tips.push({
        icon: Droplets,
        titleKey: "weatherHumidTitle",
        descKey: "weatherHumidDesc",
        badgeKey: "weather.badgeHumid",
        badgeBg: "bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/30",
      });
    }

    // Rule 4: Rain & Storm (WMO codes 50-99)
    if (weather.weatherCode >= 50 && weather.weatherCode <= 99) {
      tips.push({
        icon: CloudRain,
        titleKey: "weatherRainTitle",
        descKey: "weatherRainDesc",
        badgeKey: "weather.badgeRain",
        badgeBg: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30",
      });
    }

    // Rule 5: Air Quality Index Warning (AQI > 80)
    if (weather.aqi && weather.aqi > 80) {
      tips.push({
        icon: ShieldAlert,
        titleKey: "weatherAqiTitle",
        descKey: "weatherAqiDesc",
        badgeKey: "weather.badgeAqi",
        badgeBg: "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30",
      });
    }

    // Rule 6: Mild / Pleasant Weather Default
    if (tips.length === 0) {
      tips.push({
        icon: Sparkles,
        titleKey: "weatherPleasantTitle",
        descKey: "weatherPleasantDesc",
        badgeKey: "weather.badgePleasant",
        badgeBg: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
      });
    }

    // Rule 7: Essential Medicine Storage Tip
    tips.push({
      icon: Thermometer,
      titleKey: "weatherMedStorageTitle",
      descKey: "weatherMedStorageDesc",
      badgeKey: "weather.badgeStorage",
      badgeBg: "bg-primary/15 text-primary border-primary/30",
    });

    return tips.slice(0, 2); // Show top 2 relevant tips
  };

  const tips = generateTips();

  const getWeatherIcon = () => {
    if (weather.weatherCode >= 50 && weather.weatherCode <= 99) return <CloudRain className="w-8 h-8 text-blue-500" />;
    if (weather.temp >= 32) return <Sun className="w-8 h-8 text-amber-500 animate-spin-slow" />;
    if (weather.temp <= 18) return <Snowflake className="w-8 h-8 text-sky-400" />;
    return <CloudSun className="w-8 h-8 text-amber-400" />;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border rounded-2xl p-5 sm:p-6 shadow-card space-y-4"
    >
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-primary/10 text-primary">
            <Heart className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-extrabold text-lg text-foreground flex items-center gap-2">
              {t("weatherAdvisory")} ⛅
            </h3>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <MapPin className="w-3 h-3 text-primary" /> {t(weather.cityName)}
              {lastKnownAt ? ` (${t("locperm.lastKnown")})` : ""} · {t("weather.subtitle")}
            </p>
          </div>
        </div>

        <button
          onClick={() => void fetchWeatherForLocation()}
          className="self-start sm:self-auto px-3 py-1.5 rounded-xl bg-muted text-xs font-semibold text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors"
          title={t("weather.refreshTitle")}
        >
          <RefreshCw className="w-3.5 h-3.5" /> {t("weather.refresh")}
        </button>
      </div>

      {/* Weather Badges Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-muted/40 p-3.5 rounded-2xl border">
        <div className="flex items-center gap-2.5">
          {getWeatherIcon()}
          <div>
            <p className="text-xl font-extrabold">{weather.temp}°C</p>
            <p className="text-[11px] text-muted-foreground font-medium">{t("weather.temperature")}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Droplets className="w-5 h-5 text-teal-500" />
          <div>
            <p className="text-base font-bold">{weather.humidity}%</p>
            <p className="text-[11px] text-muted-foreground font-medium">{t("weather.humidity")}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Wind className="w-5 h-5 text-blue-500" />
          <div>
            <p className="text-base font-bold">{weather.windSpeed} {t("weather.kmh")}</p>
            <p className="text-[11px] text-muted-foreground font-medium">{t("weather.wind")}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-purple-500" />
          <div>
            <p className="text-base font-bold">{weather.aqi ? `${weather.aqi} AQI` : t("weather.aqiGood")}</p>
            <p className="text-[11px] text-muted-foreground font-medium">{t("weather.airQuality")}</p>
          </div>
        </div>
      </div>

      {/* Generated Health Tips List */}
      <div className="space-y-3 pt-1">
        {tips.map((tip, idx) => (
          <div
            key={idx}
            className="p-4 rounded-2xl border bg-card hover:bg-muted/30 transition-colors flex items-start gap-3.5 shadow-sm"
          >
            <div className={`p-2.5 rounded-xl border shrink-0 ${tip.badgeBg}`}>
              <tip.icon className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full border ${tip.badgeBg}`}>
                  {t(tip.badgeKey)}
                </span>
              </div>
              <h4 className="font-bold text-sm sm:text-base text-foreground leading-snug">{t(tip.titleKey)}</h4>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1 leading-relaxed">{t(tip.descKey)}</p>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
};

export default WeatherHealthCard;
