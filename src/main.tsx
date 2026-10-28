// Must stay the first import: fixes the URL before Supabase and the router read it.
import "@/lib/webUrl";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { waitForStorageReady } from "@/lib/capacitorStorage";
import { Capacitor } from "@capacitor/core";
import { preloadStoredLanguage } from "@/contexts/LanguageContext";

// Native-only styling hook (safe areas, lighter effects). The website never
// gets this class, so its look is unchanged.
if (Capacitor.isNativePlatform()) {
  document.documentElement.classList.add("native-app");
}

// On native (Android/iOS), pre-populate the Capacitor Preferences cache so
// Supabase can restore the session synchronously before the first render.
// On web this resolves immediately (no-op).
// The saved language's dictionary is loaded first, so the UI never flashes English.
Promise.all([waitForStorageReady(), preloadStoredLanguage()]).then(() => {
  createRoot(document.getElementById("root")!).render(<App />);
});
