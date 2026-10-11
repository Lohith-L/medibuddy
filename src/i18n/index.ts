/**
 * i18n core: English + 7 Indian languages.
 *
 * - Dictionaries are TypeScript modules under ./locales/<lang>/, bundled with
 *   the app (no network fetch, works offline in the Android app).
 * - English is loaded eagerly; other languages are separate chunks loaded on
 *   demand (ensureLanguage) before they are shown.
 * - Every non-English dictionary is typed as `Dictionary`, so a missing key is a
 *   type error. `npm run i18n:check` lists missing keys too.
 */
import en from "./locales/en";

export const SUPPORTED_LANGUAGES = ["en", "hi", "te", "ta", "kn", "mr", "bn", "gu"] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export type TranslationKey = keyof typeof en;
export type Dictionary = Record<TranslationKey, string>;
export type TranslateVars = Record<string, string | number>;

const loaders: Record<Exclude<AppLanguage, "en">, () => Promise<{ default: Dictionary }>> = {
  hi: () => import("./locales/hi"),
  te: () => import("./locales/te"),
  ta: () => import("./locales/ta"),
  kn: () => import("./locales/kn"),
  mr: () => import("./locales/mr"),
  bn: () => import("./locales/bn"),
  gu: () => import("./locales/gu"),
};

const dictionaries: Partial<Record<AppLanguage, Dictionary>> = { en };

export function isSupportedLanguage(value: unknown): value is AppLanguage {
  return typeof value === "string" && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/** Loads a language's dictionary (no-op if already loaded). */
export async function ensureLanguage(lang: AppLanguage): Promise<void> {
  if (dictionaries[lang]) return;
  if (lang === "en") return;
  const mod = await loaders[lang]();
  dictionaries[lang] = mod.default;
}

export function isLanguageLoaded(lang: AppLanguage): boolean {
  return !!dictionaries[lang];
}

/**
 * Translate a key. Falls back to English, then to the key itself.
 * `{name}` placeholders are replaced from `vars`.
 */
export function translate(lang: string, key: string, vars?: TranslateVars): string {
  const dict = dictionaries[lang as AppLanguage] ?? en;
  let text = (dict as Record<string, string>)[key] ?? (en as Record<string, string>)[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}

/** BCP-47 locale for Intl date/number formatting, e.g. "hi-IN". */
export function intlLocale(lang: string): string {
  return `${isSupportedLanguage(lang) ? lang : "en"}-IN`;
}
