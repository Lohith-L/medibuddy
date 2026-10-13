/**
 * doseLogging.ts
 *
 * Writes an alarm "Taken" press to Supabase, matching what the dashboard does:
 *   - reminder_events: the row for (medicine, date, "HH:MM") → status "taken".
 *     If the reminder cron hasn't created it yet, insert it as taken. The cron
 *     then sees the row and skips creating a pending one.
 *   - medicine_logs: the row scheduled for that dose (±30 min) → "taken",
 *     or insert one.
 */
import { supabase } from '@/integrations/supabase/client';
import type { PendingDoseAction } from '@/plugins/medicineAlarm';

export type DoseLogResult = 'logged' | 'retry' | 'drop';

/** Postgres foreign-key violation: the medicine was deleted meanwhile. */
const FK_VIOLATION = '23503';
/** Unique violation: the row for this dose already exists. */
const UNIQUE_VIOLATION = '23505';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export async function getPatientId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.from('patients').select('id').eq('user_id', user.id).limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0].id;
}

export async function logDoseTaken(action: PendingDoseAction, patientId: string): Promise<DoseLogResult> {
  if (action.isTest || !action.medicineId || action.medicineId === 'test') return 'drop';
  if (Date.now() - action.at > MAX_AGE_MS) return 'drop';

  const takenAt = new Date(action.at).toISOString();

  // ── reminder_events ─────────────────────────────────────────────────
  const { data: events, error: evErr } = await supabase
    .from('reminder_events')
    .select('id')
    .eq('patient_id', patientId)
    .eq('medicine_id', action.medicineId)
    .eq('scheduled_date', action.date)
    .eq('scheduled_time', action.time)
    .limit(1);
  if (evErr) return 'retry';

  if (events && events.length > 0) {
    const { error } = await supabase
      .from('reminder_events')
      .update({ status: 'taken', taken_at: takenAt })
      .eq('id', events[0].id);
    if (error) return 'retry';
  } else {
    const { error } = await supabase.from('reminder_events').insert({
      medicine_id: action.medicineId,
      patient_id: patientId,
      scheduled_date: action.date,
      scheduled_time: action.time,
      status: 'taken',
      taken_at: takenAt,
    });
    if (error) return error.code === FK_VIOLATION ? 'drop' : 'retry';
  }

  // ── medicine_logs ───────────────────────────────────────────────────
  // The dose time is local phone time (the cron uses IST, same as the phone).
  const scheduled = new Date(`${action.date}T${action.time}:00`);
  const from = new Date(scheduled.getTime() - 30 * 60 * 1000).toISOString();
  const to = new Date(scheduled.getTime() + 30 * 60 * 1000).toISOString();

  const { data: logs, error: logErr } = await supabase
    .from('medicine_logs')
    .select('id')
    .eq('patient_id', patientId)
    .eq('medicine_id', action.medicineId)
    .gte('scheduled_time', from)
    .lt('scheduled_time', to)
    .limit(1);
  if (logErr) return 'retry';

  if (logs && logs.length > 0) {
    const { error } = await supabase
      .from('medicine_logs')
      .update({ status: 'taken', taken_at: takenAt })
      .eq('id', logs[0].id);
    if (error) return 'retry';
  } else {
    const { error } = await supabase.from('medicine_logs').insert({
      medicine_id: action.medicineId,
      patient_id: patientId,
      scheduled_time: scheduled.toISOString(),
      status: 'taken',
      taken_at: takenAt,
    });
    if (error?.code === UNIQUE_VIOLATION) {
      // The cron created this dose's row a moment ago: mark that one instead (one row per dose).
      const { error: updErr } = await supabase
        .from('medicine_logs')
        .update({ status: 'taken', taken_at: takenAt })
        .eq('medicine_id', action.medicineId)
        .eq('scheduled_time', scheduled.toISOString());
      return updErr ? 'retry' : 'logged';
    }
    if (error) return error.code === FK_VIOLATION ? 'drop' : 'retry';
  }

  return 'logged';
}
