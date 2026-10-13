// Website only: browsers block sound until the page has been tapped once.
// Caregivers see this once per session so an SOS siren can play.
import { useState } from "react";
import { BellRing } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { CloseX } from "@/components/SOSAlertOverlay";

const DISMISS_KEY = "medibuddy.soundBannerDismissed";

const readDismissed = () => {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
};

const SoundUnlockBanner = ({ onEnable }: { onEnable: () => void }) => {
  const { t } = useLanguage();
  const [dismissed, setDismissed] = useState(readDismissed);
  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      role="region"
      aria-label={t("sosAlert.enableSoundTitle")}
      className="fixed inset-x-3 bottom-20 lg:bottom-6 lg:left-auto lg:right-28 lg:w-[380px] z-[60] flex items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-amber-950 shadow-lg dark:border-amber-700 dark:bg-amber-950 dark:text-amber-50"
    >
      <BellRing className="h-6 w-6 shrink-0 text-amber-600 dark:text-amber-300" />
      <button onClick={onEnable} className="min-w-0 flex-1 text-left">
        <span className="block text-sm font-bold">{t("sosAlert.enableSoundTitle")}</span>
        <span className="block text-xs opacity-80">{t("sosAlert.enableSoundDesc")}</span>
      </button>
      <CloseX onClick={dismiss} label={t("sos.close")} />
    </div>
  );
};

export default SoundUnlockBanner;
