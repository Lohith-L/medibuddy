import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";
import { componentTagger } from "lovable-tagger";

// Push notifications on Android need Firebase. Without google-services.json,
// calling PushNotifications.register() crashes the app natively, so the app
// only registers for push when this file exists at build time.
const firebaseConfigured = fs.existsSync(
  path.resolve(__dirname, "android/app/google-services.json"),
);

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // './' makes all asset paths relative — required for Capacitor's file:// WebView
  base: "./",
  define: {
    __FIREBASE_CONFIGURED__: JSON.stringify(firebaseConfigured),
  },
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
