import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { waitForStorageReady } from "@/lib/capacitorStorage";

// On native (Android/iOS), pre-populate the Capacitor Preferences cache so
// Supabase can restore the session synchronously before the first render.
// On web this resolves immediately (no-op).
waitForStorageReady().then(() => {
  createRoot(document.getElementById("root")!).render(<App />);
});
