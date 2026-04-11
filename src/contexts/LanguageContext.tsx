import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { normalizeLanguageCode, resolvePreferredLanguage } from "@/lib/language";
import { t as translate } from "@/lib/translations";
import { toast } from "sonner";
import { languageLabelByCode } from "@/lib/language";

interface LanguageContextType {
  language: string;
  setLanguage: (lang: string) => Promise<void>;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType>({
  language: "en",
  setLanguage: async () => {},
  t: (key) => key,
});

export const useLanguage = () => useContext(LanguageContext);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLang] = useState("en");

  // Load language on mount from patient record
  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;

      const { data: patient } = await supabase
        .from("patients")
        .select("language")
        .eq("user_id", session.user.id)
        .maybeSingle();

      const lang = resolvePreferredLanguage({
        settingsLanguage: patient?.language,
        patientLanguage: session.user.user_metadata?.language as string | undefined,
      });
      setLang(lang);
    };
    load();

    // Re-check on auth changes
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        supabase
          .from("patients")
          .select("language")
          .eq("user_id", session.user.id)
          .maybeSingle()
          .then(({ data: patient }) => {
            const lang = resolvePreferredLanguage({
              settingsLanguage: patient?.language,
              patientLanguage: session.user.user_metadata?.language as string | undefined,
            });
            setLang(lang);
          });
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const setLanguage = useCallback(async (newLang: string) => {
    const normalized = normalizeLanguageCode(newLang);
    setLang(normalized);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [{ error: patientError }, { error: authError }] = await Promise.all([
      supabase.from("patients").update({ language: normalized }).eq("user_id", user.id),
      supabase.auth.updateUser({ data: { language: normalized } }),
    ]);

    if (patientError || authError) {
      toast.error("Failed to update language");
    } else {
      toast.success(`Language changed to ${languageLabelByCode[normalized] || normalized}`);
    }
  }, []);

  const t = useCallback((key: string) => translate(key, language), [language]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};
