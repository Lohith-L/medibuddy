import { useState, useSyncExternalStore } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { detectInstallPlatform, isAppInstalled, promptInstall, subscribeInstallState } from "@/lib/installPrompt";

const APK_URL = "https://github.com/Lohith-L/medibuddy/releases/latest/download/MediBuddy.apk";

const HINT_KEYS = {
  chromium: "landing.downloadChromiumHint",
  macSafari: "landing.downloadSafariHint",
  iOS: "landing.downloadOtherHint",
  other: "landing.downloadOtherHint",
} as const;

interface Props {
  className?: string;
  buttonClassName?: string;
  size?: "default" | "xl";
}

/** Android: the APK. Desktop: installs the website as an app. Hidden once installed. */
const DownloadAppButton = ({ className, buttonClassName, size }: Props) => {
  const { t } = useLanguage();
  const installed = useSyncExternalStore(subscribeInstallState, isAppInstalled);
  const [hintOpen, setHintOpen] = useState(false);
  const platform = detectInstallPlatform();

  if (installed) return null;

  if (platform === "android") {
    return (
      <div className={className}>
        <Button asChild variant="outline" size={size} className={buttonClassName}>
          <a href={APK_URL}>
            <Download />
            {t("landing.downloadApp")}
          </a>
        </Button>
        <p className="text-sm text-muted-foreground">{t("landing.downloadAndroidNote")}</p>
      </div>
    );
  }

  return (
    <div className={className}>
      <Button
        variant="outline"
        size={size}
        className={buttonClassName}
        // Any browser that offers the prompt uses it; otherwise explain how to install.
        onClick={() => setHintOpen(!promptInstall())}
      >
        <Download />
        {t("landing.downloadApp")}
      </Button>
      {hintOpen && <p role="status" className="text-sm font-medium text-foreground">{t(HINT_KEYS[platform])}</p>}
      {platform !== "iOS" && <p className="text-sm text-muted-foreground">{t("landing.downloadDesktopNote")}</p>}
    </div>
  );
};

export default DownloadAppButton;
