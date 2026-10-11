/**
 * Medicine frequency options. The English `value` is what is stored in the
 * database (the reminder cron and the website read it); `labelKey` is shown
 * through t() in the user's language.
 */
export const FREQUENCY_OPTIONS = [
  { value: "Once daily", labelKey: "freq.onceDaily" },
  { value: "Twice daily", labelKey: "freq.twiceDaily" },
  { value: "Three times daily", labelKey: "freq.threeTimesDaily" },
  { value: "As needed", labelKey: "freq.asNeeded" },
  { value: "Weekly", labelKey: "freq.weekly" },
] as const;

/** Translation key for a stored frequency, or null for free text (e.g. "1-0-1"). */
export function frequencyLabelKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  return FREQUENCY_OPTIONS.find((o) => o.value.toLowerCase() === v)?.labelKey ?? null;
}
