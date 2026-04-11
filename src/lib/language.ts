export const languageOptions = [
  { value: "en", label: "English" },
  { value: "hi", label: "हिंदी (Hindi)" },
  { value: "te", label: "తెలుగు (Telugu)" },
  { value: "ta", label: "தமிழ் (Tamil)" },
  { value: "kn", label: "ಕನ್ನಡ (Kannada)" },
  { value: "mr", label: "मराठी (Marathi)" },
  { value: "bn", label: "বাংলা (Bengali)" },
  { value: "gu", label: "ગુજરાતી (Gujarati)" },
] as const;

export const languageLabelByCode: Record<string, string> = Object.fromEntries(
  languageOptions.map(({ value, label }) => [value, label]),
);

const languageAliases: Record<string, string> = {
  en: "en",
  english: "en",
  hi: "hi",
  hindi: "hi",
  te: "te",
  telugu: "te",
  ta: "ta",
  tamil: "ta",
  kn: "kn",
  kannada: "kn",
  mr: "mr",
  marathi: "mr",
  bn: "bn",
  bengali: "bn",
  gu: "gu",
  gujarati: "gu",
};

export function normalizeLanguageCode(value?: string | null): string {
  const normalized = value?.toString().trim().toLowerCase();

  if (!normalized) {
    return "en";
  }

  return languageAliases[normalized] ?? "en";
}

export function resolvePreferredLanguage(options: {
  settingsLanguage?: string | null;
  patientLanguage?: string | null;
  fallback?: string | null;
}): string {
  const { settingsLanguage, patientLanguage, fallback } = options;

  if (settingsLanguage?.toString().trim()) {
    return normalizeLanguageCode(settingsLanguage);
  }

  if (patientLanguage?.toString().trim()) {
    return normalizeLanguageCode(patientLanguage);
  }

  return normalizeLanguageCode(fallback);
}