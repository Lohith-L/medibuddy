// Upserts the last 7 days of Health Connect / step-sensor data to Supabase
// whenever the Android app comes to the foreground (no-op on web or when the
// user has not connected health data).
import { useEffect } from "react";
import { App } from "@capacitor/app";
import type { PluginListenerHandle } from "@capacitor/core";
import { useAuth } from "@/contexts/AuthContext";
import { getPatientId } from "@/lib/doseLogging";
import { isHealthEnabled, isNativeAndroid, syncDeviceHealth } from "@/lib/healthService";

/** Fired after every successful background sync so an open Health page can refresh. */
export const HEALTH_SYNCED_EVENT = "medibuddy:health-synced";

const MIN_GAP_MS = 2 * 60 * 1000; // no more than one foreground sync every 2 minutes

export function useHealthAutoSync() {
  const { session, loading } = useAuth();
  const userId = session?.user?.id;

  useEffect(() => {
    if (loading || !userId || !isNativeAndroid()) return;
    let last = 0;
    let disposed = false;

    const run = async () => {
      if (!isHealthEnabled() || Date.now() - last < MIN_GAP_MS) return;
      last = Date.now();
      const patientId = await getPatientId();
      if (!patientId || disposed) return;
      const res = await syncDeviceHealth(patientId).catch(() => null);
      if (res?.syncedAt && !disposed) {
        window.dispatchEvent(new CustomEvent(HEALTH_SYNCED_EVENT, { detail: res }));
      }
    };

    void run();
    const handle: Promise<PluginListenerHandle> = App.addListener("resume", () => void run());
    return () => {
      disposed = true;
      void handle.then((h) => h.remove());
    };
  }, [loading, userId]);
}
