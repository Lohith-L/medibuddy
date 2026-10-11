/**
 * App language: one source of truth for the whole UI (website and Android app).
 *
 * - The choice is saved in localStorage (instant on next start, also for
 *   logged-out pages) and in the user's Supabase profile (patients.language +
 *   auth user_metadata.language) so it follows the user across devices.
 * - On sign-in the profile language wins, except when the user picked a
 *   language while logged out: that choice is then written to the profile.
 * - Switching loads the dictionary first, then re-renders everything at once
 *   (no reload). <html lang> is kept in sync.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { normalizeLanguageCode, languageLabelByCode } from "@/lib/language";
import {
  ensureLanguage,
  intlLocale,
  isSupportedLanguage,
  translate,
  type AppLanguage,
  type TranslateVars,
} from "@/i18n";

const STORAGE_KEY = "medibuddy.language";
/** Set when the language was chosen while logged out; pushed to the profile on sign-in. */
const PENDING_SYNC_KEY = "medibuddy.languagePendingSync";

interface LanguageContextType {
  language: AppLanguage;
  setLanguage: (lang: string) => Promise<void>;
  t: (key: string, vars?: TranslateVars) => string;
  /** Translate a key built from data (e.g. "status.taken"); returns `fallback` when there is no translation. */
  tOr: (key: string, fallback: string, vars?: TranslateVars) => string;
  /** Locale for Intl date/number formatting, e.g. "hi-IN". */
  locale: string;
}

const LanguageContext = createContext<LanguageContextType>({
  language: "en",
  setLanguage: async () => {},
  t: (key, vars) => translate("en", key, vars),
  tOr: (key, fallback) => fallback,
  locale: "en-IN",
});

export const useLanguage = () => useContext(LanguageContext);

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage unavailable (private mode): the profile still keeps the choice
  }
}

/** Language saved on this device, used for the first render. */
export function getStoredLanguage(): AppLanguage {
  const saved = normalizeLanguageCode(readStorage(STORAGE_KEY));
  return isSupportedLanguage(saved) ? saved : "en";
}

/** Call before the first render so the saved language shows without a flash of English. */
export async function preloadStoredLanguage(): Promise<void> {
  const lang = getStoredLanguage();
  document.documentElement.lang = lang;
  try {
    await ensureLanguage(lang);
  } catch {
    // falls back to English text
  }
}

async function saveToProfile(lang: AppLanguage): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const [{ error: patientError }, { error: authError }] = await Promise.all([
    supabase.from("patients").update({ language: lang }).eq("user_id", user.id),
    supabase.auth.updateUser({ data: { language: lang } }),
  ]);
  return !patientError && !authError;
}

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLang] = useState<AppLanguage>(getStoredLanguage);
  const languageRef = useRef(language);
  languageRef.current = language;

  /** Load the dictionary, switch the UI, remember it on this device. */
  const apply = useCallback(async (lang: AppLanguage) => {
    try {
      await ensureLanguage(lang);
    } catch (e) {
      console.error("[i18n] could not load", lang, e);
      return false;
    }
    setLang(lang);
    writeStorage(STORAGE_KEY, lang);
    document.documentElement.lang = lang;
    return true;
  }, []);

  // Follow the profile language when a user signs in (or the session restores).
  useEffect(() => {
    let cancelled = false;

    const syncFromProfile = async (userId: string, metaLanguage?: string) => {
      const { data: patient } = await supabase
        .from("patients")
        .select("language")
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled) return;

      const local = languageRef.current;
      if (readStorage(PENDING_SYNC_KEY)) {
        // Chosen on the landing / login page: keep it and save it to the profile.
        if (await saveToProfile(local)) writeStorage(PENDING_SYNC_KEY, null);
        return;
      }

      const profileValue = patient?.language || metaLanguage;
      if (!profileValue) {
        void saveToProfile(local);
        return;
      }
      const profileLang = normalizeLanguageCode(profileValue);
      if (isSupportedLanguage(profileLang) && profileLang !== local) await apply(profileLang);
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) void syncFromProfile(session.user.id, session.user.user_metadata?.language);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.user) {
        void syncFromProfile(session.user.id, session.user.user_metadata?.language);
      }
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [apply]);

  const setLanguage = useCallback(
    async (newLang: string) => {
      const lang = normalizeLanguageCode(newLang);
      if (!isSupportedLanguage(lang)) return;
      const ok = await apply(lang);
      if (!ok) {
        toast.error(translate(languageRef.current, "languageChangeFailed"));
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        writeStorage(PENDING_SYNC_KEY, "1");
        toast.success(translate(lang, "languageChanged", { language: languageLabelByCode[lang] ?? lang }));
        return;
      }
      const saved = await saveToProfile(lang);
      if (saved) {
        toast.success(translate(lang, "languageChanged", { language: languageLabelByCode[lang] ?? lang }));
      } else {
        // The UI already switched and this device remembers it; retry saving on next start.
        writeStorage(PENDING_SYNC_KEY, "1");
        toast.error(translate(lang, "languageSaveFailed"));
      }
    },
    [apply],
  );

  const t = useCallback((key: string, vars?: TranslateVars) => translate(language, key, vars), [language]);
  const tOr = useCallback(
    (key: string, fallback: string, vars?: TranslateVars) => {
      const text = translate(language, key, vars);
      return text === key ? fallback : text;
    },
    [language],
  );

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, tOr, locale: intlLocale(language) }}>
      {children}
    </LanguageContext.Provider>
  );
};
