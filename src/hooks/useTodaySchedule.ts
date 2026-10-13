// Today's schedule for a patient, kept live: refetches when a dose is logged
// (alarm "Taken", another device, the website) and every minute so
// Upcoming -> Due now -> Missed changes on time.
import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import { fetchTodaySchedule, type ScheduledDose } from "@/lib/todaySchedule";
import { logDoseTaken } from "@/lib/doseLogging";
import { DOSE_LOGGED_EVENT, MedicineAlarm, reminderId } from "@/plugins/medicineAlarm";

export function useTodaySchedule(
  patientId: string | null | undefined,
  timeZone: string,
  missedDelayMinutes: number,
) {
  const [doses, setDoses] = useState<ScheduledDose[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    if (!patientId) return;
    const run = ++latest.current;
    try {
      const list = await fetchTodaySchedule(patientId, timeZone, missedDelayMinutes);
      if (run === latest.current) setDoses(list);
    } catch (e) {
      console.warn("[today] could not load the schedule", e);
    } finally {
      if (run === latest.current) setLoading(false);
    }
  }, [patientId, timeZone, missedDelayMinutes]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  // Live updates from the alarm, another device or the website.
  useRealtimeTable("medicine_logs", "patient_id", patientId, refresh);
  useRealtimeTable("reminder_events", "patient_id", patientId, refresh);
  useRealtimeTable("medicines", "patient_id", patientId, refresh);

  useEffect(() => {
    const onLogged = () => void refresh();
    window.addEventListener(DOSE_LOGGED_EVENT, onLogged);
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    const tick = window.setInterval(() => void refresh(), 60_000); // Upcoming -> Due -> Missed
    return () => {
      window.removeEventListener(DOSE_LOGGED_EVENT, onLogged);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(tick);
    };
  }, [refresh]);

  /** Same write as the alarm's "Taken"; also silences that alarm if it is ringing on this phone. */
  const markTaken = useCallback(
    async (dose: ScheduledDose): Promise<boolean> => {
      if (!patientId) return false;
      setSavingKey(dose.key);
      // Show it right away; the refetch confirms.
      setDoses((list) => list.map((d) => (d.key === dose.key ? { ...d, status: "taken", takenAt: new Date().toISOString() } : d)));
      try {
        const result = await logDoseTaken(
          {
            uid: `manual-${dose.key}-${Date.now()}`,
            action: "taken",
            medicineId: dose.medicineId,
            medicineName: dose.name,
            date: dose.date,
            time: dose.time,
            isTest: false,
            at: Date.now(),
          },
          patientId,
        );
        if (result !== "logged") throw new Error(result);
        if (Capacitor.isNativePlatform()) {
          try {
            const ringing = await MedicineAlarm.getRingingAlarm();
            if (ringing.ringing && ringing.id === reminderId(dose.medicineId, dose.time)) await MedicineAlarm.stopAlarm();
          } catch {
            /* alarm plugin unavailable: nothing ringing */
          }
        }
        return true;
      } catch (e) {
        console.warn("[today] mark taken failed", e);
        return false;
      } finally {
        setSavingKey(null);
        void refresh();
      }
    },
    [patientId, refresh],
  );

  return { doses, loading, refresh, markTaken, savingKey };
}
