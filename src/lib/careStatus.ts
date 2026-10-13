// Today's doses for a patient, as a caregiver sees them: taken / missed /
// upcoming. Built on the same schedule as the patient's own screens
// (lib/todaySchedule), so both always agree.
import { fetchTodaySchedule, partsInZone } from "@/lib/todaySchedule";

export { partsInZone };

export type DoseStatus = "taken" | "missed" | "upcoming";

export interface Dose {
  medicineId: string;
  name: string;
  dosage: string;
  time: string; // "HH:MM" in the patient's time zone
  status: DoseStatus;
  takenAt: string | null;
}

export interface TodayStatus {
  doses: Dose[];
  taken: number;
  missed: number;
  upcoming: number;
}

export async function fetchTodayStatus(patientId: string, timeZone: string, delayMinutes: number): Promise<TodayStatus> {
  const schedule = await fetchTodaySchedule(patientId, timeZone, delayMinutes);
  const doses: Dose[] = schedule.map((d) => ({
    medicineId: d.medicineId,
    name: d.name,
    dosage: d.dosage,
    time: d.time,
    // Due now / snoozed still count as "upcoming" for the caregiver summary.
    status: d.status === "taken" ? "taken" : d.status === "missed" ? "missed" : "upcoming",
    takenAt: d.takenAt,
  }));
  return {
    doses,
    taken: doses.filter((d) => d.status === "taken").length,
    missed: doses.filter((d) => d.status === "missed").length,
    upcoming: doses.filter((d) => d.status === "upcoming").length,
  };
}
