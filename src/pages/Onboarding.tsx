import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowRight, Check, Globe } from "lucide-react";
import { motion } from "framer-motion";

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
  const [selected, setSelected] = useState("en");
  const [loading, setLoading] = useState(false);

  const handleContinue = async () => {
    setLoading(true);
    try {
      // Update user metadata
      const { error: authError } = await supabase.auth.updateUser({
        data: { language: selected },
      });
      if (authError) throw authError;

      // Update patients table
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from("patients")
          .update({ language: selected })
          .eq("user_id", user.id);
      }

      toast.success("Language saved! Welcome to MEDDIBUDDY 🎉");
      navigate("/dashboard");
    } catch (err: any) {
      toast.error(err.message || "Failed to save language");
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
          <div className="w-16 h-16 rounded-2xl gradient-warm flex items-center justify-center mx-auto mb-6 shadow-card">
            <Globe className="w-8 h-8 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-extrabold mb-3">Welcome to MEDDIBUDDY! 🤗</h1>
          <p className="text-muted-foreground text-lg">
            Choose your preferred language for medicine reminders
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
                  <Check className="w-4 h-4 text-primary-foreground" />
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
          {loading ? "Saving..." : "Continue"} <ArrowRight className="ml-2 w-5 h-5" />
        </Button>
      </div>
    </div>
  );
};

export default Onboarding;
