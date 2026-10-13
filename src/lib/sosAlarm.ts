// The caregiver's SOS alarm sound: siren + "Emergency! SOS from {name}", repeated.
//
// Android: the native alarm engine (alarm stream, max volume, works in silent /
// Do Not Disturb, full screen over the lock screen). Website: a siren made with
// Web Audio + the browser's speech voice. Browsers block sound until the user
// has tapped the page once, so the app asks for one tap ("Tap to enable alert
// sounds") and unlocks on the first tap anywhere.
import { Capacitor } from "@capacitor/core";
import { MedicineAlarm } from "@/plugins/medicineAlarm";
import { intlLocale } from "@/i18n";

export interface SosAlarmInfo {
  /** SOS event id. */
  refId: string;
  patientName: string;
  language: string;
  /** Spoken sentence for the website ("Emergency! SOS from Amma."). */
  sentence: string;
}

const isNative = () => Capacitor.isNativePlatform();

/** The website stops by itself after this long (Android: the native 5 minute limit). */
const WEB_MAX_MS = 5 * 60_000;
const SIREN_MS = 5_000;
const PAUSE_MS = 400;

// ── Website: Web Audio siren + speech ─────────────────────────────────────

let ctx: AudioContext | null = null;
const unlockListeners = new Set<() => void>();

function audioContext(): AudioContext | null {
  if (ctx) return ctx;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  ctx.onstatechange = () => unlockListeners.forEach((l) => l());
  return ctx;
}

/** Sound can play (Android always; website after a tap). */
export function soundUnlocked(): boolean {
  if (isNative()) return true;
  return ctx?.state === "running";
}

export function onSoundUnlockChange(listener: () => void): () => void {
  unlockListeners.add(listener);
  return () => unlockListeners.delete(listener);
}

/** Call from a tap: unlocks Web Audio (and warms up speech). */
export async function unlockSound(): Promise<boolean> {
  if (isNative()) return true;
  const c = audioContext();
  if (!c) return false;
  try {
    await c.resume();
    // A silent blip: some browsers only unlock once something actually played.
    const g = c.createGain();
    g.gain.value = 0.0001;
    const o = c.createOscillator();
    o.connect(g).connect(c.destination);
    o.start();
    o.stop(c.currentTime + 0.05);
    if ("speechSynthesis" in window) window.speechSynthesis.getVoices();
  } catch {
    /* still locked */
  }
  unlockListeners.forEach((l) => l());
  return c.state === "running";
}

/** The first tap anywhere unlocks sound (the banner is only a reminder). */
export function installUnlockOnFirstTap(): () => void {
  if (isNative()) return () => {};
  const handler = () => {
    void unlockSound().then((ok) => {
      if (ok) remove();
    });
  };
  const remove = () => {
    window.removeEventListener("pointerdown", handler, true);
    window.removeEventListener("keydown", handler, true);
  };
  window.addEventListener("pointerdown", handler, true);
  window.addEventListener("keydown", handler, true);
  return remove;
}

interface WebRing {
  info: SosAlarmInfo;
  stopAt: number;
  osc: OscillatorNode | null;
  gain: GainNode | null;
  timer: ReturnType<typeof setTimeout> | null;
  stopped: boolean;
}

const webRings = new Map<string, WebRing>();

function playSiren(ring: WebRing, done: () => void) {
  const c = audioContext();
  if (!c || c.state !== "running") {
    // Locked: try again shortly (the overlay asks for a tap).
    ring.timer = setTimeout(done, 1000);
    return;
  }
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "sawtooth";
  // Wail between 700 and 1500 Hz, 1.25 s per up-down (same as the Android siren).
  osc.frequency.setValueAtTime(700, t0);
  for (let t = 0; t < SIREN_MS / 1000; t += 1.25) {
    osc.frequency.linearRampToValueAtTime(1500, t0 + t + 0.625);
    osc.frequency.linearRampToValueAtTime(700, t0 + t + 1.25);
  }
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.35, t0 + 0.05);
  gain.gain.setValueAtTime(0.35, t0 + SIREN_MS / 1000 - 0.1);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + SIREN_MS / 1000);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + SIREN_MS / 1000);
  ring.osc = osc;
  ring.gain = gain;
  osc.onended = () => {
    ring.osc = null;
    done();
  };
  if ("vibrate" in navigator) navigator.vibrate?.([800, 400, 800, 400, 800]);
}

function speak(ring: WebRing, done: () => void) {
  if (!("speechSynthesis" in window)) return done();
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(safety);
    done();
  };
  // Some browsers never fire onend: don't wait forever.
  const safety = setTimeout(finish, 8000);
  try {
    const u = new SpeechSynthesisUtterance(ring.info.sentence);
    u.lang = intlLocale(ring.info.language);
    u.rate = 0.95;
    u.volume = 1;
    u.onend = finish;
    u.onerror = finish;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {
    finish();
  }
}

function webCycle(ring: WebRing) {
  if (ring.stopped) return;
  if (Date.now() > ring.stopAt) return stopWeb(ring.info.refId);
  playSiren(ring, () => {
    if (ring.stopped) return;
    speak(ring, () => {
      if (ring.stopped) return;
      ring.timer = setTimeout(() => webCycle(ring), PAUSE_MS);
    });
  });
}

function stopWeb(refId: string) {
  const ring = webRings.get(refId);
  if (!ring) return;
  ring.stopped = true;
  if (ring.timer) clearTimeout(ring.timer);
  try {
    ring.osc?.stop();
  } catch {
    /* already stopped */
  }
  webRings.delete(refId);
  if (webRings.size === 0) {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    if ("vibrate" in navigator) navigator.vibrate?.(0);
  }
}

// ── Public ────────────────────────────────────────────────────────────────

/** Starts the SOS alarm for this SOS (no-op if it is already ringing). */
export async function startSosAlarm(info: SosAlarmInfo): Promise<void> {
  if (isNative()) {
    try {
      await MedicineAlarm.ringCaregiverAlarm({
        kind: "sos",
        refId: info.refId,
        patientName: info.patientName,
        language: info.language,
      });
    } catch (e) {
      console.warn("[sos] native alarm failed", e);
    }
    return;
  }
  if (webRings.has(info.refId)) return;
  const ring: WebRing = { info, stopAt: Date.now() + WEB_MAX_MS, osc: null, gain: null, timer: null, stopped: false };
  webRings.set(info.refId, ring);
  webCycle(ring);
}

/** Stops the SOS alarm for this SOS (answered here or elsewhere, or cancelled). */
export async function stopSosAlarm(refId: string): Promise<void> {
  if (isNative()) {
    try {
      await MedicineAlarm.stopCaregiverAlarm({ refId });
    } catch (e) {
      console.warn("[sos] could not stop the native alarm", e);
    }
    return;
  }
  stopWeb(refId);
}

export function webAlarmRinging(): boolean {
  return webRings.size > 0;
}
