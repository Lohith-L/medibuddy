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

// If visiting a non-root route directly on the web without a hash (e.g. /dashboard from Vercel rewrite),
// convert to hash route so HashRouter can match and route properly.
if (!Capacitor.isNativePlatform() && window.location.pathname && window.location.pathname !== "/" && !window.location.hash) {
  const target = window.location.pathname + window.location.search;
  window.location.replace(`/#${target}`);
}

// On native (Android/iOS), pre-populate the Capacitor Preferences cache so
// Supabase can restore the session synchronously before the first render.
// On web this resolves immediately (no-op).
// The saved language's dictionary is loaded first, so the UI never flashes English.
Promise.all([waitForStorageReady(), preloadStoredLanguage()]).then(() => {
  createRoot(document.getElementById("root")!).render(<App />);
});
