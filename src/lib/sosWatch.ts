// Caregiver SOS watcher (Android): a native foreground service that checks for
// active SOS alerts every ~15 s, so the alarm rings with MediBuddy closed even
// when FCM push is missing or delayed. Backup for push; both ring the same alarm.
//
// The service can't use the login session (it expires), so this phone gets a
// random "watch key", registered while signed in (rpc register_sos_watch_key).
import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { MedicineAlarm } from "@/plugins/medicineAlarm";

const KEY_STORAGE = "medibuddy.sosWatchKey";

const readKey = () => {
  try {
    return localStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
};

function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// The generated Supabase types don't know these functions yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args);

/** Registers this phone's key and starts the native watcher. */
export async function startSosWatch(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  let key = readKey();
  if (!key) {
    key = newKey();
    try {
      localStorage.setItem(KEY_STORAGE, key);
    } catch {
      /* ignore */
    }
  }
  const { error } = await rpc("register_sos_watch_key", { p_key: key });
  if (error) {
    // e.g. migration 20261017100000_sos_watch.sql not applied yet
    console.warn("[sos-watch] not started:", error.message);
    return;
  }
  await MedicineAlarm.startSosWatch({
    url: import.meta.env.VITE_SUPABASE_URL,
    anonKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    watchKey: key,
  });
  console.info("[sos-watch] running");
}

/** Logout / no longer a caregiver: stop the watcher and forget the key. Call while still signed in. */
export async function stopSosWatch(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const key = readKey();
  await MedicineAlarm.stopSosWatch().catch(() => {});
  if (key) {
    try {
      await rpc("unregister_sos_watch_key", { p_key: key });
    } catch {
      /* offline: the server drops the key when the account signs in elsewhere */
    }
    try {
      localStorage.removeItem(KEY_STORAGE);
    } catch {
      /* ignore */
    }
  }
}

/** Runs the watcher while a caregiver with linked patients is signed in. */
export function useSosWatch(active: boolean) {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (active) void startSosWatch();
    // Not a caregiver (any more) while signed in: stop. Logout stops it in forgetPushToken().
  }, [active]);
}
