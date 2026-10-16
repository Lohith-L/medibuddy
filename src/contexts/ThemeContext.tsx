// Light / Dark / System theme (website + Android app).
//
// next-themes puts the "dark" class on <html> (Tailwind darkMode: "class") and
// follows the phone / PC setting live when the choice is "system". The choice
// is kept in localStorage (read by the inline script in index.html, so there is
// no white flash) and in the user's profile (patients.theme), so it follows the
// user between the website and the app.
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { Capacitor, SystemBars, SystemBarsStyle } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type ThemeChoice = "light" | "dark" | "system";
/** localStorage key; index.html reads the same key before React starts. */
export const THEME_STORAGE_KEY = "medibuddy.theme";
const THEMES: ThemeChoice[] = ["light", "dark", "system"];

const isChoice = (v: unknown): v is ThemeChoice => typeof v === "string" && (THEMES as string[]).includes(v);

// The generated Supabase types don't know patients.theme yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** Saves the choice in the signed-in user's profile (quietly skipped if the column isn't there yet). */
async function saveToProfile(userId: string, theme: ThemeChoice) {
  const { error } = await db.from("patients").update({ theme }).eq("user_id", userId);
  if (error && error.code !== "42703" && error.code !== "PGRST204") console.warn("[theme] not saved to profile:", error.message);
}

/** Android status / navigation bar icons and the browser theme-color follow the theme. */
function SystemChrome() {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    const dark = resolvedTheme === "dark";
    const bg = dark ? "#0b1120" : "#ffffff";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
    if (!Capacitor.isNativePlatform()) return;
    // DARK = light icons for a dark background (both status and navigation bar).
    SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {});
    // Below Android 15 the status bar still has its own colour.
    StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {});
    StatusBar.setBackgroundColor({ color: bg }).catch(() => {});
  }, [resolvedTheme]);
  return null;
}

/** After login: use the theme saved in the profile (set on another device). */
function ProfileSync() {
  const { user } = useAuth();
  const { setTheme } = useTheme();
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!user || loadedFor.current === user.id) return;
    loadedFor.current = user.id;
    void db
      .from("patients")
      .select("theme")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data, error }: { data: { theme?: string } | null; error: { code?: string } | null }) => {
        if (error) return; // column not added yet, or offline: keep this device's choice
        if (isChoice(data?.theme)) setTheme(data!.theme);
      });
  }, [user, setTheme]);
  return null;
}

export const AppThemeProvider = ({ children }: { children: ReactNode }) => (
  <NextThemesProvider attribute="class" defaultTheme="system" enableSystem storageKey={THEME_STORAGE_KEY} disableTransitionOnChange>
    <SystemChrome />
    {children}
  </NextThemesProvider>
);

/** Mounted inside AuthProvider: loads the profile's theme after login. */
export const ThemeProfileSync = () => <ProfileSync />;

/** The current choice, the resulting light/dark, and a setter that also saves to the profile. */
export function useAppTheme() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { user } = useAuth();
  const choose = useCallback(
    (t: ThemeChoice) => {
      setTheme(t);
      if (user) void saveToProfile(user.id, t);
    },
    [setTheme, user],
  );
  return {
    theme: (isChoice(theme) ? theme : "system") as ThemeChoice,
    resolved: (resolvedTheme === "dark" ? "dark" : "light") as "light" | "dark",
    setTheme: choose,
    /** Header button: switch to the opposite of what is showing now. */
    toggle: () => choose(resolvedTheme === "dark" ? "light" : "dark"),
  };
}
