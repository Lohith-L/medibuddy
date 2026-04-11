// Health data service - mock layer for web, replaceable with Health Connect on native
import { supabase } from "@/integrations/supabase/client";

export type HealthConnectionStatus = "not_connected" | "permission_needed" | "connected" | "sync_failed";

export interface HealthSummary {
  steps: number;
  sleepMinutes: number;
  heartRateAvg: number | null;
  calories: number;
  date: string;
  syncedAt: string | null;
  source: string;
}

// Check if running in a native context with Health Connect support
export const isNativeHealthAvailable = (): boolean => {
  // In future, check for Capacitor / Health Connect plugin
  return false;
};

// Generate realistic mock data for demo/web
export const generateMockHealthData = (date: string): HealthSummary => {
  const dayHash = date.split("-").reduce((a, b) => a + parseInt(b), 0);
  return {
    steps: 3000 + (dayHash * 137) % 8000,
    sleepMinutes: 300 + (dayHash * 43) % 180,
    heartRateAvg: 62 + (dayHash * 7) % 20,
    calories: 1200 + (dayHash * 89) % 800,
    date,
    syncedAt: null,
    source: "demo",
  };
};

// Generate last 7 days of mock data
export const getMockWeekData = (): HealthSummary[] => {
  const data: HealthSummary[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];
    data.push(generateMockHealthData(dateStr));
  }
  return data;
};

// Sync health summary to Supabase
export const syncHealthToBackend = async (
  patientId: string,
  summary: HealthSummary
): Promise<boolean> => {
  const { error } = await supabase
    .from("health_data")
    .upsert(
      {
        patient_id: patientId,
        date: summary.date,
        steps: summary.steps,
        sleep_minutes: summary.sleepMinutes,
        heart_rate_avg: summary.heartRateAvg,
        calories: summary.calories,
        source: summary.source,
        synced_at: new Date().toISOString(),
      },
      { onConflict: "patient_id,date" }
    );
  return !error;
};

// Fetch stored health data from backend
export const fetchHealthData = async (
  patientId: string,
  days = 7
): Promise<HealthSummary[]> => {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const { data } = await supabase
    .from("health_data")
    .select("*")
    .eq("patient_id", patientId)
    .gte("date", startDate.toISOString().split("T")[0])
    .order("date", { ascending: true });

  if (!data || data.length === 0) return [];

  return data.map((row: any) => ({
    steps: row.steps || 0,
    sleepMinutes: row.sleep_minutes || 0,
    heartRateAvg: row.heart_rate_avg,
    calories: row.calories || 0,
    date: row.date,
    syncedAt: row.synced_at,
    source: row.source || "unknown",
  }));
};

// Format sleep minutes to hours/minutes string
export const formatSleep = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
};
