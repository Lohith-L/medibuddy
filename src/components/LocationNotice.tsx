// One clear message per location problem, with the button that fixes it.
import { Capacitor } from "@capacitor/core";
import { MapPin, RefreshCw, Settings } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { openAppSettings, openLocationSettings, type LocationReason } from "@/lib/location";

interface Props {
  reason: LocationReason;
  onRetry: () => void;
  /** A last known location is being shown instead (time it was taken). */
  lastKnownAt?: number | null;
  compact?: boolean;
}

const LocationNotice = ({ reason, onRetry, lastKnownAt, compact = false }: Props) => {
  const { t, locale } = useLanguage();
  const native = Capacitor.isNativePlatform();
  const kind = reason === "permission-denied" ? "denied" : reason === "location-off" ? "off" : "failed";
  const title = kind === "denied" ? t("locperm.deniedTitle") : kind === "off" ? t("locperm.offTitle") : t("locperm.failedTitle");
  const desc = kind === "denied" ? t("locperm.deniedDesc") : kind === "off" ? t("locperm.offDesc") : t("locperm.failedDesc");
  const when = lastKnownAt
    ? new Date(lastKnownAt).toLocaleString(locale, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
    : null;

  return (
    <div role="alert" className={`rounded-2xl border border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-50 ${compact ? "p-3" : "p-4"}`}>
      <p className="flex items-start gap-2 font-bold">
        <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <span>{title}</span>
      </p>
      <p className="mt-1 text-sm opacity-90">{desc}</p>
      {when && <p className="mt-1 text-sm font-semibold">{t("locperm.lastKnownAt", { time: when })}</p>}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {native && kind === "denied" && (
          <button onClick={() => void openAppSettings()} className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-amber-600 px-3 font-bold text-white hover:bg-amber-700">
            <Settings className="h-4 w-4" /> {t("locperm.openSettings")}
          </button>
        )}
        {native && kind === "off" && (
          <button onClick={() => void openLocationSettings()} className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-amber-600 px-3 font-bold text-white hover:bg-amber-700">
            <Settings className="h-4 w-4" /> {t("locperm.openLocationSettings")}
          </button>
        )}
        <button onClick={onRetry} className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-amber-600/50 bg-card px-3 font-bold text-foreground hover:bg-muted">
          <RefreshCw className="h-4 w-4" /> {t("locperm.retry")}
        </button>
      </div>
    </div>
  );
};

export default LocationNotice;
