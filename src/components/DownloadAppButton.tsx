import { Capacitor } from "@capacitor/core";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";

const APK_URL = "https://github.com/Lohith-L/medibuddy/releases/latest/download/MediBuddy.apk";

interface Props {
  className?: string;
  buttonClassName?: string;
  size?: "default" | "xl";
}

/** Android phone browsers only: the APK. Hidden on desktop, on iPhone and inside the app. */
const DownloadAppButton = ({ className, buttonClassName, size }: Props) => {
  const { t } = useLanguage();

  const showButton =
    !Capacitor.isNativePlatform() &&
    /Android/i.test(navigator.userAgent) &&
    !window.matchMedia("(display-mode: standalone)").matches;
  if (!showButton) return null;

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
};

export default DownloadAppButton;
