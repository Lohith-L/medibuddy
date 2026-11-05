// Website install state for the Download App button.
//
// Imported from main.tsx: Chrome and Edge can fire beforeinstallprompt before
// the lazily loaded landing page exists, and the event doesn't fire again.
import { Capacitor } from "@capacitor/core";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

const standalone = () => window.matchMedia("(display-mode: standalone)").matches;

if (typeof window !== "undefined" && !Capacitor.isNativePlatform()) {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    notify();
  });
  window.matchMedia("(display-mode: standalone)").addEventListener("change", notify);
}

export function subscribeInstallState(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Running as the Android app or the installed desktop app, or just installed: no button. */
export function isAppInstalled(): boolean {
  return Capacitor.isNativePlatform() || installed || standalone();
}

/** Opens the browser's install prompt. It can only be used once. False when there is none. */
export function promptInstall(): boolean {
  if (!deferred) return false;
  void deferred.prompt();
  deferred = null;
  return true;
}

export type InstallPlatform = "android" | "chromium" | "macSafari" | "iOS" | "other";

export function detectInstallPlatform(ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints): InstallPlatform {
  if (/Android/i.test(ua)) return "android";
  // iPadOS Safari reports itself as a Mac.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) return "iOS";
  if (/Firefox|OPR\/|SamsungBrowser|Vivaldi/.test(ua)) return "other";
  if (/Edg\/|Chrome\//.test(ua)) return "chromium";
  if (/Macintosh/.test(ua) && /Safari\//.test(ua)) return "macSafari";
  return "other";
}
