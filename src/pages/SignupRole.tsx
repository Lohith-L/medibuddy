import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useLanguage } from "@/contexts/LanguageContext";

/** Step 1 of sign-up: "Create your account as: Patient / Caregiver". */
const SignupRole = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const code = params.get("code");
  const suffix = code ? `?code=${encodeURIComponent(code)}` : "";

  const Card = ({ emoji, title, desc, to }: { emoji: string; title: string; desc: string; to: string }) => (
    <button
      type="button"
      onClick={() => navigate(to)}
      className="w-full min-h-[96px] text-left rounded-2xl border-2 border-border bg-card p-5 flex items-center gap-4 shadow-sm hover:border-primary hover:bg-primary/5 active:scale-[0.99] transition-all"
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
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => navigate("/auth")}>
            <ArrowLeft className="w-4 h-4 mr-2" /> {t("signup.back")}
          </Button>
          <LanguageSwitcher />
        </div>
        <h1 className="text-2xl font-extrabold text-center">{t("signup.title")}</h1>
        <Card emoji="🧑" title={t("signup.patientTitle")} desc={t("signup.patientDesc")} to={`/signup/patient${suffix}`} />
        <Card emoji="👨‍👩‍👧" title={t("signup.caregiverTitle")} desc={t("signup.caregiverDesc")} to={`/signup/caregiver${suffix}`} />
        <p className="text-center text-sm text-muted-foreground">
          {t("signup.haveAccount")}{" "}
          <Link to={`/auth${suffix}`} className="text-primary font-semibold hover:underline">{t("signup.login")}</Link>
        </p>
      </div>
    </div>
  );
};

export default SignupRole;
