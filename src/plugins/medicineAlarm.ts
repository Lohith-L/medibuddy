/**
 * medicineAlarm.ts
 *
 * JavaScript side of the app-local Capacitor plugin "MedicineAlarm"
 * (android/app/src/main/java/com/medibuddy/app/alarm/MedicineAlarmPlugin.java).
 *
 * Android only. It is never called on the website.
 */
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface AlarmReminder {
  /** Stable positive 31-bit id (see reminderId()). */
  id: number;
  medicineId: string;
  medicineName: string;
  dose: string;
  /** "HH:MM" (24h) for daily reminders. */
  time?: string;
  /** Epoch ms for one-shot alarms. */
  at?: number;
  /** Daily repeat (default) or one-shot. */
  repeat?: boolean;
  /** Optional "YYYY-MM-DD" bounds for daily reminders. */
  startDate?: string | null;
  endDate?: string | null;
  isTest?: boolean;
  /** App language for the spoken announcement: "en", "hi", "te", "ta", "kn", "mr", "bn", "gu". */
  language?: string;
}

export interface AlarmPermissionStatus {
  notifications: 'granted' | 'denied' | 'prompt';
  exactAlarm: boolean;
  fullScreenIntent: boolean;
  batteryOptimizationIgnored: boolean;
  /** "Do Not Disturb access": the voice alarm can play in DND / Total silence. */
  dndAccess: boolean;
  /** Lower-case Build.MANUFACTURER, e.g. "xiaomi", "samsung". */
  manufacturer: string;
  sdkInt: number;
}

/** A "Taken" press saved on the phone that still has to be written to Supabase. */
export interface PendingDoseAction {
  uid: string;
  action: 'taken';
  medicineId: string;
  medicineName: string;
  /** "YYYY-MM-DD" (local) */
  date: string;
  /** "HH:MM" (local, 24h) */
  time: string;
  isTest: boolean;
  /** Epoch ms when Taken was pressed. */
  at: number;
}

export interface MedicineAlarmPlugin {
  scheduleAlarm(options: AlarmReminder): Promise<{ scheduledAt: number }>;
  cancelAlarm(options: { id: number }): Promise<void>;
  cancelAll(): Promise<void>;
  /** Replaces all daily reminders with this list (cancel + reschedule). */
  syncAlarms(options: { reminders: AlarmReminder[]; language?: string }): Promise<{ scheduled: number }>;

  checkPermissions(): Promise<AlarmPermissionStatus>;
  /** Asks for the notification permission (Android 13+). */
  requestPermissions(): Promise<AlarmPermissionStatus>;
  openExactAlarmSettings(): Promise<void>;
  openFullScreenIntentSettings(): Promise<void>;
  openNotificationSettings(): Promise<void>;
  /** Settings > Do Not Disturb access (to allow MediBuddy). */
  openDndAccessSettings(): Promise<void>;
  openBatteryOptimizationSettings(): Promise<void>;
  openAutostartSettings(): Promise<void>;
  openAppSettings(): Promise<void>;

  /** Beep (siren for SOS) and voice; at least one is always on. */
  getSettings(): Promise<{ voiceEnabled: boolean; beepEnabled: boolean }>;
  /** Rejects with code "both_off" if it would turn off both beep and voice. */
  setBeepEnabled(options: { enabled: boolean }): Promise<void>;
  /** Rings a caregiver alarm (missed dose / SOS) on this phone after a delay. Test only. */
  testCaregiverAlarm(options: {
    kind: 'missed' | 'sos';
    patientName: string;
    medicineName?: string;
    dose?: string;
    time?: string;
    language?: string;
    delaySeconds?: number;
  }): Promise<{ scheduledAt: number }>;
  setVoiceEnabled(options: { enabled: boolean }): Promise<void>;

  /** Whether the phone has an installed (offline) text-to-speech voice for this language. */
  checkVoice(options: { language: string }): Promise<{ available: boolean; language: string; engine: string; ttsWorking: boolean }>;
  /** Language that had to be spoken in English during an alarm (reported once), or null. */
  consumeVoiceFallback(): Promise<{ language: string | null }>;
  openTtsSettings(): Promise<void>;
  installVoiceData(): Promise<void>;

  /** Stops whatever is ringing right now (no dose is logged). */
  stopAlarm(): Promise<void>;
  getRingingAlarm(): Promise<{ ringing: boolean; id?: number; medicineName?: string; time?: string }>;

  getPendingDoseActions(): Promise<{ actions: PendingDoseAction[] }>;
  removePendingDoseActions(options: { uids: string[] }): Promise<void>;

  addListener(eventName: 'doseActionQueued', listener: () => void): Promise<PluginListenerHandle>;
}

export const MedicineAlarm = registerPlugin<MedicineAlarmPlugin>('MedicineAlarm');

/** Id used by the "Test alarm in 1 minute" button. */
export const TEST_ALARM_ID = 2_000_000_001;

/** Stable positive 31-bit id for one medicine + reminder time. */
export function reminderId(medicineId: string, time: string): number {
  const key = `${medicineId}|${time}`;
  let h = 0x811c9dc5; // FNV-1a
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Keep clear of TEST_ALARM_ID and of 0.
  return ((h >>> 0) % 2_000_000_000) + 1;
}

/** Normalises "8:5", "08:05:00" etc. to "08:05", or null if invalid. */
export function normalizeTime(t: string): string | null {
  const m = /^(\d{1,2}):(\d{1,2})/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Window event other screens fire after changing medicines, to resync alarms at once. */
export const MEDICINES_CHANGED_EVENT = 'medibuddy:medicines-changed';
/** Fired after alarm "Taken" presses were written to Supabase. */
export const DOSE_LOGGED_EVENT = 'medibuddy:dose-logged';

/** localStorage key prefix: the "install voice" tip was shown once for this language. */
export const VOICE_TIP_KEY_PREFIX = 'medibuddy.voiceTipShown.';

export function notifyMedicinesChanged() {
  window.dispatchEvent(new Event(MEDICINES_CHANGED_EVENT));
}
