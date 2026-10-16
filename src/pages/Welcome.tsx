import { useNavigate } from "react-router-dom";
import { LogIn, UserPlus } from "lucide-react";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useLanguage } from "@/contexts/LanguageContext";
import BrandLogo from "@/components/BrandLogo";

/**
 * Android app, signed out: logo, tagline and two big buttons.
 * Create account -> Patient / Caregiver -> sign-up; I already have an account ->
 * Patient / Caregiver login. The back button exits the app here (useMobilePolish).
 */
const Welcome = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();

  return (
    <main className="min-h-screen bg-background text-foreground flex flex-col px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      <div className="flex justify-end">
        <LanguageSwitcher large />
      </div>

      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <BrandLogo variant="full" className="h-[min(54vw,221px)]" />
        <p className="mt-6 text-xl leading-snug text-muted-foreground max-w-xs">{t("start.welcomeTagline")}</p>
      </div>

      <div className="space-y-3">
        <button
          onClick={() => navigate("/signup")}
          className="flex min-h-[60px] w-full items-center justify-center gap-2.5 rounded-2xl bg-blue-700 text-xl font-bold text-white shadow-md active:scale-[0.99]"
        >
          <UserPlus className="h-6 w-6" /> {t("start.createAccount")}
        </button>
        <button
          onClick={() => navigate("/auth")}
          className="flex min-h-[60px] w-full items-center justify-center gap-2.5 rounded-2xl border-2 border-blue-700 bg-background text-xl font-bold text-blue-800 dark:border-blue-400 dark:text-blue-200 active:scale-[0.99]"
        >
          <LogIn className="h-6 w-6" /> {t("start.haveAccount")}
        </button>
      </div>
    </main>
  );
};

export default Welcome;
