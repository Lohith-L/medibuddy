// Duplicate-medicine check: is a medicine about to be saved already set for
// reminders? Prevents double doses (e.g. the same Dolo 650 from a new prescription).

/** Dosage forms written in front of names ("Tab Dolo", "Cap. Pan-D", "Syp Ascoril"). */
const FORM_PREFIX = /^(?:tab(?:let)?s?|cap(?:sule)?s?|syp|syr(?:up)?|inj(?:ection)?|drops?|susp(?:ension)?|oint(?:ment)?)\b\.?\s*/i;
/** A strength in the name: "650", "40mg", "2.5 mg", "500 mcg", "5ml", "1%". */
const STRENGTH = /\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|g|gm|ml|iu|%|units?)?\b/gi;

/**
 * "Tab. Dolo 650" -> "dolo"; "Pan-D 40" = "pan d" = "PanD" -> "pand";
 * "Glycomet GP 1" -> "glycometgp". Empty when nothing is left.
 */
export function normalizeMedicineName(name: string): string {
  let n = (name ?? "").toLowerCase().trim();
  // Repeat: "Tab. Cap" style double prefixes are rare but harmless to handle.
  for (let i = 0; i < 2; i++) n = n.replace(FORM_PREFIX, "");
  n = n.replace(STRENGTH, " ");
  // Keep letters of any script (Latin, Devanagari, Kannada ...); drop spaces, hyphens, dots, digits.
  return n.replace(/[^\p{L}\p{M}]+/gu, "");
}

export type MatchKind = "exact" | "possible";

/**
 * "exact": same normalised name. "possible": one contains the other and the
 * shorter one has at least 5 letters ("Pantop" vs "Pantop-D").
 */
export function matchKind(a: string, b: string): MatchKind | null {
  const x = normalizeMedicineName(a);
  const y = normalizeMedicineName(b);
  if (!x || !y) return null;
  if (x === y) return "exact";
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length >= 5 && long.includes(short)) return "possible";
  return null;
}

export interface ExistingMedicine {
  id: string;
  name: string;
  dosage: string;
  frequency?: string | null;
  instructions?: string | null;
  reminder_times: string[] | null;
  is_active: boolean;
  end_date: string | null;
  start_date?: string | null;
}

/** Active = switched on and not ended before today (YYYY-MM-DD, local). */
export function isActiveMedicine(m: Pick<ExistingMedicine, "is_active" | "end_date">, today: string): boolean {
  return !!m.is_active && (!m.end_date || m.end_date >= today);
}

export interface DuplicateInfo {
  /** The active medicine it matches (exact matches win over possible ones). */
  existing: ExistingMedicine | null;
  existingKind: MatchKind | null;
  /** Index of an earlier entry in the same list with the same medicine (listed twice). */
  twiceOf: number | null;
}

/**
 * For each candidate: does it match an active medicine of this patient, and is
 * it a repeat of an earlier entry in the same list? `ignoreId` skips the
 * medicine being edited.
 */
export function findDuplicates(
  candidates: { name: string }[],
  existing: ExistingMedicine[],
  today: string,
  ignoreId?: string,
): DuplicateInfo[] {
  const active = existing.filter((m) => m.id !== ignoreId && isActiveMedicine(m, today));
  return candidates.map((c, i) => {
    let best: ExistingMedicine | null = null;
    let bestKind: MatchKind | null = null;
    for (const m of active) {
      const k = matchKind(c.name, m.name);
      if (k === "exact") {
        best = m;
        bestKind = k;
        break;
      }
      if (k === "possible" && !best) {
        best = m;
        bestKind = k;
      }
    }
    let twiceOf: number | null = null;
    for (let j = 0; j < i; j++) {
      if (matchKind(c.name, candidates[j].name) === "exact") {
        twiceOf = j;
        break;
      }
    }
    return { existing: best, existingKind: bestKind, twiceOf };
  });
}

export const hasAnyDuplicate = (d: DuplicateInfo[]) => d.some((x) => x.existing || x.twiceOf !== null);

/** Today as YYYY-MM-DD in local time (end_date is a calendar date). */
export function localToday(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "08:00" -> "8:00 AM" in the user's locale. */
export function formatTime(hhmm: string, locale?: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const d = new Date(2000, 0, 1, Number(m[1]), Number(m[2]));
  return d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
}

/** "Dolo 650 mg · 8:00 AM, 8:00 PM" */
export function describeMedicine(m: { name: string; dosage?: string | null; reminder_times?: string[] | null }, locale?: string): string {
  const times = (m.reminder_times ?? []).map((t) => formatTime(t, locale)).join(", ");
  // "Dolo 650" + "650 mg": the strength is already in the name.
  const num = (m.dosage ?? "").match(/\d+(?:[.,]\d+)?/)?.[0];
  const nameNumbers: string[] = m.name.match(/\d+(?:[.,]\d+)?/g) ?? [];
  const dosageInName = !!num && nameNumbers.includes(num);
  const head = [m.name, dosageInName ? null : m.dosage].filter(Boolean).join(" ");
  return times ? `${head} · ${times}` : head;
}
