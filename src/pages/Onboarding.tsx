import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import { translate } from "@/i18n";
import { ArrowRight, Check } from "lucide-react";
import { motion } from "framer-motion";
import BrandLogo from "@/components/BrandLogo";

const languageOptions = [
  { code: "en", name: "English", native: "English", emoji: "🇬🇧" },
  { code: "hi", name: "Hindi", native: "हिंदी", emoji: "🇮🇳" },
  { code: "te", name: "Telugu", native: "తెలుగు", emoji: "🇮🇳" },
  { code: "ta", name: "Tamil", native: "தமிழ்", emoji: "🇮🇳" },
  { code: "kn", name: "Kannada", native: "ಕನ್ನಡ", emoji: "🇮🇳" },
  { code: "mr", name: "Marathi", native: "मराठी", emoji: "🇮🇳" },
  { code: "bn", name: "Bengali", native: "বাংলা", emoji: "🇮🇳" },
  { code: "gu", name: "Gujarati", native: "ગુજરાતી", emoji: "🇮🇳" },
];

const Onboarding = () => {
  const navigate = useNavigate();
  const { t, language, setLanguage } = useLanguage();
  const [selected, setSelected] = useState<string>(language);
  const [loading, setLoading] = useState(false);

  // Strip the #access_token hash from the address bar after OAuth redirect.
  // Supabase has already read and exchanged the token by the time this component
  // mounts, so clearing it is safe and prevents the token from staying visible.
  useEffect(() => {
    if (window.location.hash.includes("access_token")) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  const handleContinue = async () => {
    setLoading(true);
    try {
      // Switches the whole UI and saves it on this device and in the profile.
      await setLanguage(selected);
      toast.success(translate(selected, "onboarding.saved"));
      navigate("/dashboard");
    } catch (err: any) {
      toast.error(err.message || t("onboarding.saveFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen gradient-hero flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-10"
        >
          <div className="flex justify-center mb-6">
            <BrandLogo variant="full" className="h-36" />
          </div>
          <h1 className="text-3xl font-extrabold mb-3">{t("onboarding.title")}</h1>
          <p className="text-muted-foreground text-lg">
            {t("onboarding.subtitle")}
          </p>
        </motion.div>

        <div className="grid grid-cols-2 gap-4 mb-8">
          {languageOptions.map((lang, i) => (
            <motion.button
              key={lang.code}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.4 }}
              onClick={() => setSelected(lang.code)}
              className={`relative p-5 rounded-2xl border-2 text-left transition-all ${
                selected === lang.code
                  ? "border-primary bg-primary/5 shadow-card-hover"
                  : "border-border bg-card hover:border-primary/30 hover:shadow-card"
              }`}
            >
              {selected === lang.code && (
                <div className="absolute top-3 right-3 w-6 h-6 rounded-full gradient-warm flex items-center justify-center">
                  <Check className="w-4 h-4 text-white" />
                </div>
              )}
              <span className="text-2xl mb-2 block">{lang.emoji}</span>
              <p className="font-bold text-lg">{lang.native}</p>
              <p className="text-sm text-muted-foreground">{lang.name}</p>
            </motion.button>
          ))}
        </div>

        <Button
          variant="hero"
          size="xl"
          className="w-full"
          onClick={handleContinue}
          disabled={loading}
        >
          {loading ? t("saving") : t("onboarding.continue")} <ArrowRight className="ml-2 w-5 h-5" />
        </Button>
      </div>
    </div>
  );
};

export default Onboarding;
