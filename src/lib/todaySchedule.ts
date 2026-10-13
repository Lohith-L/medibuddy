// Today's full dose schedule for one patient, in the PATIENT's time zone.
//
// Built from the medicines table (so every dose shows from midnight, long
// before the reminder cron creates any row), merged with what actually
// happened: reminder_events ("HH:MM" + status) and medicine_logs (timestamps).
// Used by the patient Home, "Today's medicine log" and the caregiver screens.
import { supabase } from "@/integrations/supabase/client";

export type DoseState = "upcoming" | "due" | "taken" | "missed" | "snoozed";

export interface ScheduledDose {
  /** Stable key: medicineId|HH:MM */
  key: string;
  medicineId: string;
  name: string;
  dosage: string;
  instructions: string | null;
  photoUrl: string | null;
  /** "HH:MM" in the patient's time zone */
  time: string;
  /** "YYYY-MM-DD" in the patient's time zone */
  date: string;
  status: DoseState;
  takenAt: string | null;
}

/** "YYYY-MM-DD" and "HH:MM" for an instant, in a time zone. */
export function partsInZone(date: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};

export const normTime = (t: string | null | undefined) => {
  const m = /^(\d{1,2}):(\d{1,2})/.exec((t ?? "").trim());
  return m ? `${m[1].padStart(2, "0")}:${m[2].padStart(2, "0")}` : null;
};

/** A log counts for a dose when it is within this many minutes of the dose time. */
const LOG_MATCH_MINUTES = 30;

export async function fetchTodaySchedule(
  patientId: string,
  timeZone: string,
  missedDelayMinutes: number,
  now: Date = new Date(),
): Promise<ScheduledDose[]> {
  const today = partsInZone(now, timeZone);
  const nowMin = toMinutes(today.time);
  const from = new Date(now.getTime() - 36 * 3600 * 1000).toISOString();
  const to = new Date(now.getTime() + 36 * 3600 * 1000).toISOString();

  const [{ data: meds }, { data: events }, { data: logs }] = await Promise.all([
    supabase
      .from("medicines")
      .select("id, name, dosage, instructions, reminder_times, start_date, end_date, is_active, medicine_photo_url")
      .eq("patient_id", patientId),
    supabase
      .from("reminder_events")
      .select("medicine_id, scheduled_time, status, taken_at")
      .eq("patient_id", patientId)
      .eq("scheduled_date", today.date),
    supabase
      .from("medicine_logs")
      .select("medicine_id, scheduled_time, status, taken_at")
      .eq("patient_id", patientId)
      .gte("scheduled_time", from)
      .lt("scheduled_time", to),
  ]);

  const medById = new Map((meds ?? []).map((m) => [m.id, m]));
  const doses = new Map<string, ScheduledDose>();

  const addDose = (medicineId: string, time: string) => {
    const key = `${medicineId}|${time}`;
    if (doses.has(key)) return doses.get(key)!;
    const m = medById.get(medicineId);
    const d: ScheduledDose = {
      key, medicineId, time, date: today.date,
      name: m?.name ?? "—",
      dosage: m?.dosage ?? "",
      instructions: m?.instructions ?? null,
      photoUrl: (m as { medicine_photo_url?: string | null } | undefined)?.medicine_photo_url ?? null,
      status: "upcoming",
      takenAt: null,
    };
    doses.set(key, d);
    return d;
  };

  // 1. Today's schedule from the medicines themselves.
  for (const m of meds ?? []) {
    if (!m.is_active) continue;
    if (m.start_date && m.start_date > today.date) continue;
    if (m.end_date && m.end_date < today.date) continue;
    for (const raw of m.reminder_times ?? []) {
      const t = normTime(raw);
      if (t) addDose(m.id, t);
    }
  }

  // 2. What happened (also keeps doses whose time was changed later today).
  type Fact = { status: string; takenAt: string | null };
  const facts = new Map<string, Fact[]>();
  const pushFact = (key: string, f: Fact) => facts.set(key, [...(facts.get(key) ?? []), f]);

  for (const e of events ?? []) {
    const t = normTime(e.scheduled_time);
    if (!t || !medById.has(e.medicine_id)) continue;
    addDose(e.medicine_id, t);
    pushFact(`${e.medicine_id}|${t}`, { status: e.status, takenAt: e.taken_at });
  }
  for (const l of logs ?? []) {
    const local = partsInZone(new Date(l.scheduled_time), timeZone);
    if (local.date !== today.date || !medById.has(l.medicine_id)) continue;
    // Attach to the nearest scheduled dose of that medicine (alarm "Taken" uses ±30 min).
    const lm = toMinutes(local.time);
    let best: ScheduledDose | null = null;
    for (const d of doses.values()) {
      if (d.medicineId !== l.medicine_id) continue;
      const diff = Math.abs(toMinutes(d.time) - lm);
      if (diff <= LOG_MATCH_MINUTES && (!best || diff < Math.abs(toMinutes(best.time) - lm))) best = d;
    }
    const target = best ?? addDose(l.medicine_id, local.time);
    pushFact(target.key, { status: l.status, takenAt: l.taken_at });
  }

  // 3. Status: taken > missed > snoozed > by the clock.
  for (const d of doses.values()) {
    const fs = facts.get(d.key) ?? [];
    const taken = fs.find((f) => f.status === "taken");
    if (taken) {
      d.status = "taken";
      d.takenAt = fs.map((f) => f.takenAt).filter(Boolean).sort()[0] ?? null;
      continue;
    }
    const doseMin = toMinutes(d.time);
    if (fs.some((f) => f.status === "missed" || f.status === "escalated")) d.status = "missed";
    else if (fs.some((f) => f.status === "snoozed")) d.status = "snoozed";
    else if (nowMin < doseMin) d.status = "upcoming";
    else if (nowMin < doseMin + missedDelayMinutes) d.status = "due";
    else d.status = "missed";
  }

  return [...doses.values()].sort((a, b) => a.time.localeCompare(b.time) || a.name.localeCompare(b.name));
}

/** The dose to highlight: due now first, else the next upcoming one. */
export function nextDose(doses: ScheduledDose[]): ScheduledDose | null {
  return doses.find((d) => d.status === "due") ?? doses.find((d) => d.status === "upcoming" || d.status === "snoozed") ?? null;
}
