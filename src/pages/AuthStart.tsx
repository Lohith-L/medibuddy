import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useLanguage } from "@/contexts/LanguageContext";

/** Start screen: "Patient login", "Caregiver login", "New here? Sign up". */
const AuthStart = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const code = params.get("code");
  const suffix = code ? `?code=${encodeURIComponent(code)}` : "";

  const Choice = ({ emoji, title, desc, to }: { emoji: string; title: string; desc: string; to: string }) => (
    <button
      type="button"
      onClick={() => navigate(to)}
      className="w-full min-h-[92px] text-left rounded-2xl border-2 border-border bg-card p-5 flex items-center gap-4 shadow-sm hover:border-primary hover:bg-primary/5 active:scale-[0.99] transition-all"
    >
      <span className="text-4xl leading-none shrink-0" aria-hidden>{emoji}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-xl font-bold">{title}</span>
        <span className="block text-sm text-muted-foreground mt-0.5">{desc}</span>
      </span>
      <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
    </button>
  );

  return (
    <div className="min-h-screen gradient-hero flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-5">
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => navigate("/")}>
            <ArrowLeft className="w-4 h-4 mr-2" /> {t("auth.backHome")}
          </Button>
          <LanguageSwitcher />
        </div>
        <div className="text-center">
          <p className="text-3xl font-extrabold">
            <span className="gradient-text">MEDDI</span>BUDDY
          </p>
          <p className="text-muted-foreground text-sm mt-1">{t("login.startSubtitle")}</p>
        </div>
        <Choice emoji="🧑" title={t("login.patientLogin")} desc={t("login.patientLoginDesc")} to={`/login/patient${suffix}`} />
        <Choice emoji="👨‍👩‍👧" title={t("login.caregiverLogin")} desc={t("login.caregiverLoginDesc")} to={`/login/caregiver${suffix}`} />
        <p className="text-center text-base">
          {t("login.newHere")}{" "}
          <Link to={`/signup${suffix}`} className="text-primary font-bold hover:underline">{t("login.signUp")}</Link>
        </p>
      </div>
    </div>
  );
};

export default AuthStart;
