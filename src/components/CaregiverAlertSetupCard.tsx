// Caregiver setup note: how SOS alerts reach this device today.
// Without push notifications (Stage 4), the alarm only rings while MediBuddy
// is open or still running in the background.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { BellRing, ChevronRight, X } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

const DISMISS_KEY = "medibuddy.alertSetupDismissed";

const readDismissed = () => {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
};

const CaregiverAlertSetupCard = ({ dismissible = false }: { dismissible?: boolean }) => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const native = Capacitor.isNativePlatform();
  const [dismissed, setDismissed] = useState(() => dismissible && readDismissed());
  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="relative rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-50">
      {dismissible && (
        <button
          onClick={dismiss}
          aria-label={t("sos.close")}
          className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full hover:bg-black/5"
        >
          <X className="h-4 w-4" />
        </button>
      )}
      <p className="flex items-center gap-2 pr-8 font-bold">
        <BellRing className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-300" /> {t("sosAlert.setupTitle")}
      </p>
      <p className="mt-1.5 text-sm">{native ? t("sosAlert.setupNative") : t("sosAlert.setupWeb")}</p>
      <p className="mt-1.5 text-xs opacity-80">{t("sosAlert.setupPushSoon")}</p>
      {native && (
        <button
          onClick={() => navigate("/alarm-settings")}
          className="mt-3 inline-flex min-h-[44px] items-center gap-1 rounded-xl bg-amber-600 px-3 text-sm font-bold text-white hover:bg-amber-700"
        >
          {t("sosAlert.setupAlarmSettings")} <ChevronRight className="h-4 w-4" />
        </button>
      )}
    </div>
  );
};

export default CaregiverAlertSetupCard;
