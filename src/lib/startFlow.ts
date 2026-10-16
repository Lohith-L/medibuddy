// Android app start flow: splash -> (logged in) home, or (first launch) intro
// slides, or the welcome screen. The website keeps its landing page.
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { SplashScreen } from "@capacitor/splash-screen";
import { useAuth } from "@/contexts/AuthContext";
import { useCare } from "@/contexts/CareContext";

const INTRO_KEY = "medibuddy.introDone";
/** The native splash never stays longer than this, even if loading hangs. */
const SPLASH_MAX_MS = 2000;

let introCache: boolean | null = null;

/** The intro slides were seen (or skipped) on this install. */
export async function isIntroDone(): Promise<boolean> {
  if (introCache !== null) return introCache;
  try {
    const { value } = await Preferences.get({ key: INTRO_KEY });
    introCache = value === "1";
  } catch {
    introCache = false;
  }
  return introCache;
}

export async function markIntroDone(): Promise<void> {
  introCache = true;
  try {
    await Preferences.set({ key: INTRO_KEY, value: "1" });
  } catch {
    /* the in-memory flag still holds for this session */
  }
}

/** Where a signed-out user goes: the welcome screen in the app, the login choice on the website. */
export function signedOutPath(): string {
  return Capacitor.isNativePlatform() ? "/welcome" : "/auth";
}

/**
 * Keeps the native splash (MediBuddy logo) up while the session and profile
 * load, then hides it: no fixed delay. Hidden after SPLASH_MAX_MS at the latest.
 */
export function useNativeSplash() {
  const { session, loading: authLoading } = useAuth();
  const care = useCare();
  const location = useLocation();
  const hidden = useRef(false);

  const hide = (reason: string) => {
    if (hidden.current) return;
    hidden.current = true;
    console.info(`[splash] hidden (${reason}) ${Math.round(performance.now())} ms after start`);
    SplashScreen.hide({ fadeOutDuration: 200 }).catch(() => {});
  };

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const timer = setTimeout(() => hide("timeout"), SPLASH_MAX_MS);
    return () => clearTimeout(timer);
  }, []);

  // "/" and "/home" only decide where to go: wait for the real first screen.
  const deciding = location.pathname === "/" || location.pathname === "/home";
  const ready = !authLoading && (!session || !care.loading) && !deciding;

  useEffect(() => {
    if (Capacitor.isNativePlatform() && ready) hide(location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
}
