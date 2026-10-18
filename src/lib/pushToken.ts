// This device's FCM token in Supabase `device_tokens`, so the server can push
// SOS / missed-dose alerts to it. Saved on every app start and token refresh,
// removed before logout (row-level security only allows it while signed in).
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { stopSosWatch } from "@/lib/sosWatch";

const TOKEN_KEY = "medibuddy.fcmToken";

const read = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

export async function savePushToken(token: string): Promise<void> {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return; // saved after login (usePushNotifications re-runs on login)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from("device_tokens" as any) as any).upsert(
    { user_id: user.id, token, platform: Capacitor.getPlatform(), updated_at: new Date().toISOString() },
    { onConflict: "user_id,token" },
  );
  if (error) console.error("[Push] failed to save token:", error.message);
  else console.info("[Push] token saved for", user.id.slice(0, 8));
}

/** Call BEFORE supabase.auth.signOut(): stops pushes and the SOS watcher for that account on this phone. */
export async function forgetPushToken(): Promise<void> {
  await stopSosWatch().catch((e) => console.warn("[sos-watch] stop failed:", e));
  const token = read();
  if (!token || !Capacitor.isNativePlatform()) return;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from("device_tokens" as any) as any).delete().eq("user_id", user.id).eq("token", token);
    if (error) console.warn("[Push] could not remove token:", error.message);
  } catch (e) {
    console.warn("[Push] could not remove token:", e);
  }
}
