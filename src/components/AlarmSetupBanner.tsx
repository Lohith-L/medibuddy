import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { AlarmClock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MedicineAlarm } from "@/plugins/medicineAlarm";
import { useLanguage } from "@/contexts/LanguageContext";

const DISMISS_KEY = "medibuddy.alarmBannerDismissedAt";
const DISMISS_FOR_MS = 3 * 24 * 60 * 60 * 1000;

function dismissedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return Date.now() - at < DISMISS_FOR_MS;
  } catch {
    return false;
  }
}

/**
 * Android app only: asks the user to finish alarm setup when a permission the
 * alarm needs is missing. Missing core permissions can't be dismissed; the
 * battery-only hint can be hidden for a few days.
 */
const AlarmSetupBanner = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [state, setState] = useState<"hidden" | "required" | "battery">("hidden");

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const check = async () => {
      try {
        const p = await MedicineAlarm.checkPermissions();
        if (p.notifications !== "granted" || !p.exactAlarm || !p.fullScreenIntent) setState("required");
        else if (!p.batteryOptimizationIgnored && !dismissedRecently()) setState("battery");
        else setState("hidden");
      } catch {
        setState("hidden");
      }
    };
    void check();
    const handle = App.addListener("resume", () => void check());
    return () => {
      handle.then((h) => h.remove());
    };
  }, []);

  if (state === "hidden") return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // ignore
    }
    setState("hidden");
  };

  return (
    <div className="flex items-start gap-3 rounded-2xl border-2 border-amber-500/30 bg-amber-500/10 p-4">
      <AlarmClock className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm text-amber-900 dark:text-amber-100">
          {state === "required" ? t("alarmBanner.requiredTitle") : t("alarmBanner.batteryTitle")}
        </p>
        <p className="text-xs text-amber-800/90 dark:text-amber-200/90 mt-0.5">
          {state === "required"
            ? t("alarmBanner.requiredDesc")
            : t("alarmBanner.batteryDesc")}
        </p>
        <Button size="sm" className="mt-2" onClick={() => navigate("/alarm-settings")}>
          {t("alarmBanner.setUp")}
        </Button>
      </div>
      {state === "battery" && (
        <button onClick={dismiss} aria-label={t("misc.dismiss")} className="text-amber-700/70 hover:text-amber-900 dark:text-amber-300/80 dark:hover:text-amber-100 p-1">
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};

export default AlarmSetupBanner;
