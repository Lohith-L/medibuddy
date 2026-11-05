/**
 * Reminder time as three large dropdowns: hour (1-12), minute (00-59), AM/PM.
 * Replaces <input type="time">, which in the Android WebView only highlights
 * one tiny segment and is cut off on narrow phones.
 *
 * Storage contract (do not change): medicines.reminder_times holds "HH:MM",
 * 24-hour, zero-padded. reminder-cron matches it with an exact string compare
 * and useMedicineAlarmSync schedules phone alarms from it. onChange only ever
 * emits fromPicker() output.
 */
import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";

export interface PickerTime {
  /** 1-12 */
  hour12: number;
  /** 0-59 */
  minute: number;
  pm: boolean;
}

export const REMINDER_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "HH:MM" or "HH:MM:SS" (24 h) -> picker parts; null if it isn't a valid time. */
// eslint-disable-next-line react-refresh/only-export-components
export function toPicker(value: string | null | undefined): PickerTime | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec((value ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const minute = Number(m[2]);
  if (h > 23 || minute > 59) return null;
  return { hour12: h % 12 === 0 ? 12 : h % 12, minute, pm: h >= 12 };
}

/** Picker parts -> "HH:MM", zero-padded 24 h. 12 AM -> "00", 12 PM -> "12". */
// eslint-disable-next-line react-refresh/only-export-components
export function fromPicker({ hour12, minute, pm }: PickerTime): string {
  const h = (hour12 % 12) + (pm ? 12 : 0);
  return `${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** AM / PM in the app language (e.g. "ಪೂರ್ವಾಹ್ನ"), "AM" / "PM" if the browser has none. */
function dayPeriodLabels(locale: string): [string, string] {
  const label = (hour: number, fallback: string) => {
    try {
      const part = new Intl.DateTimeFormat(locale, { hour: "numeric", hour12: true })
        .formatToParts(new Date(2000, 0, 1, hour))
        .find((p) => p.type === "dayPeriod");
      return part?.value.trim() || fallback;
    } catch {
      return fallback;
    }
  };
  return [label(9, "AM"), label(21, "PM")];
}

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const EMPTY = "";

type Draft = { hour12: string; minute: string; period: "" | "am" | "pm" };

function toDraft(value: string): Draft {
  const p = toPicker(value);
  return p
    ? { hour12: String(p.hour12), minute: String(p.minute), period: p.pm ? "pm" : "am" }
    : { hour12: EMPTY, minute: EMPTY, period: EMPTY };
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Accessible name for the group, e.g. "Dose 1". */
  label: string;
}

const selectClass =
  "flex-1 min-w-0 min-h-[48px] rounded-xl border bg-background px-2 text-center text-lg font-bold " +
  "focus:outline-none focus:ring-2 focus:ring-primary";

const ReminderTimePicker = ({ value, onChange, label }: Props) => {
  const { locale, t } = useLanguage();
  const [am, pm] = useMemo(() => dayPeriodLabels(locale), [locale]);
  // Kept locally so a half-filled time ("--" in one box) isn't emitted.
  const [draft, setDraft] = useState<Draft>(() => toDraft(value));

  useEffect(() => {
    const p = toPicker(value);
    if (p) setDraft(toDraft(value));
  }, [value]);

  const update = (patch: Partial<Draft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (next.hour12 && next.minute && next.period) {
      onChange(fromPicker({ hour12: Number(next.hour12), minute: Number(next.minute), pm: next.period === "pm" }));
    }
  };

  return (
    <div role="group" aria-label={label} className="flex w-full gap-2">
      <select
        aria-label={`${label}: ${t("meds.timeHour")}`}
        value={draft.hour12}
        onChange={(e) => update({ hour12: e.target.value })}
        className={selectClass}
      >
        {!draft.hour12 && <option value={EMPTY}>--</option>}
        {HOURS.map((h) => (
          <option key={h} value={String(h)}>{h}</option>
        ))}
      </select>
      <select
        aria-label={`${label}: ${t("meds.timeMinute")}`}
        value={draft.minute}
        onChange={(e) => update({ minute: e.target.value })}
        className={selectClass}
      >
        {!draft.minute && <option value={EMPTY}>--</option>}
        {MINUTES.map((m) => (
          <option key={m} value={String(m)}>{String(m).padStart(2, "0")}</option>
        ))}
      </select>
      <select
        aria-label={`${label}: ${am} / ${pm}`}
        value={draft.period}
        onChange={(e) => update({ period: e.target.value as Draft["period"] })}
        className={selectClass}
      >
        {!draft.period && <option value={EMPTY}>--</option>}
        <option value="am">{am}</option>
        <option value="pm">{pm}</option>
      </select>
    </div>
  );
};

export default ReminderTimePicker;
