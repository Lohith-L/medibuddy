/**
 * useMedicineAlarmSync.ts
 *
 * Keeps the phone's medicine alarms identical to the database, app-wide.
 * Android only; a no-op on the website.
 *
 *  - When logged in: loads active medicines and replaces every alarm
 *    (MedicineAlarm.syncAlarms). Runs on start, when the app returns to the
 *    foreground, after local edits (MEDICINES_CHANGED_EVENT) and on Supabase
 *    Realtime changes, e.g. reminders edited on the website.
 *  - Writes alarm "Taken" presses (saved natively) to Supabase, and keeps them
 *    queued until that succeeds (offline, logged out, ...).
 *  - Handles the com.medibuddy.app://dose-taken link the alarm opens.
 *  - Cancels all alarms on sign-out.
 *  - Removes the old @capacitor/local-notifications reminders (replaced by alarms).
 */
import { useEffect, useRef } from 'react';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { App } from '@capacitor/app';
import { LocalNotifications } from '@capacitor/local-notifications';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { languageLabelByCode } from '@/lib/language';
import { translate } from '@/i18n';
import { getPatientId, logDoseTaken } from '@/lib/doseLogging';
import {
  MedicineAlarm,
  MEDICINES_CHANGED_EVENT,
  DOSE_LOGGED_EVENT,
  normalizeTime,
  notifyMedicinesChanged,
  reminderId,
  VOICE_TIP_KEY_PREFIX,
  type AlarmReminder,
} from '@/plugins/medicineAlarm';

const DOSE_TAKEN_URL = 'com.medibuddy.app://dose-taken';

// The launch URL stays the same for the whole process; act on it only once.
let launchUrlHandled = false;

// Range used by the previous local-notification reminders (useMedicineNotifications).
const OLD_NOTIFICATION_ID_MIN = 10000;
const OLD_NOTIFICATION_ID_MAX = 10000 + 500 * 31;

async function cancelOldLocalNotifications() {
  try {
    const { notifications } = await LocalNotifications.getPending();
    const old = notifications.filter((n) => n.id >= OLD_NOTIFICATION_ID_MIN && n.id < OLD_NOTIFICATION_ID_MAX);
    if (old.length > 0) {
      await LocalNotifications.cancel({ notifications: old.map((n) => ({ id: n.id })) });
      console.log(`[Alarm] removed ${old.length} old reminder notifications`);
    }
  } catch {
    // Plugin unavailable or nothing scheduled
  }
}

function voiceTipShown(lang: string): boolean {
  try {
    return localStorage.getItem(VOICE_TIP_KEY_PREFIX + lang) === '1';
  } catch {
    return false;
  }
}

function markVoiceTipShown(lang: string) {
  try {
    localStorage.setItem(VOICE_TIP_KEY_PREFIX + lang, '1');
  } catch {
    // ignore
  }
}

export function useMedicineAlarmSync() {
  const { session, loading } = useAuth();
  const { language } = useLanguage();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const languageRef = useRef(language);
  languageRef.current = language;
  const userId = session?.user?.id;

  // Alarms speak in the app language: reschedule them when it changes.
  const firstLanguage = useRef(true);
  useEffect(() => {
    if (firstLanguage.current) {
      firstLanguage.current = false;
      return;
    }
    notifyMedicinesChanged();
  }, [language]);

  // Cancel every alarm when the user signs out (not when the session is merely
  // still loading or can't be refreshed offline).
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        MedicineAlarm.cancelAll().catch(() => undefined);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || loading || !userId) return;

    let disposed = false;
    let patientId: string | null = null;
    let syncTimer: ReturnType<typeof setTimeout> | undefined;
    let flushing = false;
    const handles: Promise<PluginListenerHandle>[] = [];
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const ensurePatient = async () => {
      if (!patientId) patientId = await getPatientId();
      return patientId;
    };

    /** Rebuild every alarm from the database. Leaves alarms untouched if offline. */
    const sync = async () => {
      const pid = await ensurePatient();
      if (!pid || disposed) return;
      const { data, error } = await supabase
        .from('medicines')
        .select('id, name, dosage, reminder_times, is_active, start_date, end_date')
        .eq('patient_id', pid)
        .eq('is_active', true);
      if (error || !data || disposed) {
        console.warn('[Alarm] could not load medicines, keeping current alarms', error?.message);
        return;
      }

      const reminders: AlarmReminder[] = [];
      for (const med of data) {
        const seen = new Set<string>();
        for (const raw of med.reminder_times ?? []) {
          const time = normalizeTime(raw);
          if (!time || seen.has(time)) continue;
          seen.add(time);
          reminders.push({
            id: reminderId(med.id, time),
            medicineId: med.id,
            medicineName: med.name,
            dose: med.dosage ?? '',
            time,
            repeat: true,
            startDate: med.start_date,
            endDate: med.end_date,
            language: languageRef.current,
          });
        }
      }

      try {
        const { scheduled } = await MedicineAlarm.syncAlarms({ reminders, language: languageRef.current });
        console.log(`[Alarm] synced: ${scheduled} alarms for ${data.length} medicines`);
      } catch (e) {
        console.error('[Alarm] sync failed', e);
      }
    };

    const scheduleSync = () => {
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => void sync(), 400);
    };

    /** Write queued alarm "Taken" presses to Supabase. Returns how many were logged. */
    const flush = async (): Promise<number> => {
      if (flushing) return 0;
      flushing = true;
      try {
        const { actions } = await MedicineAlarm.getPendingDoseActions();
        if (actions.length === 0) return 0;
        const pid = await ensurePatient();
        if (!pid) return 0;

        const done: string[] = [];
        let logged = 0;
        for (const a of actions) {
          const result = await logDoseTaken(a, pid);
          if (result !== 'retry') done.push(a.uid);
          if (result === 'logged') logged++;
        }
        if (done.length > 0) await MedicineAlarm.removePendingDoseActions({ uids: done });
        if (logged > 0) {
          toast.success(
            logged === 1
              ? translate(languageRef.current, 'alarm.dosesTaken')
              : translate(languageRef.current, 'alarm.dosesTakenMany', { count: logged }),
          );
          window.dispatchEvent(new Event(DOSE_LOGGED_EVENT));
        }
        return logged;
      } catch (e) {
        console.warn('[Alarm] could not sync taken doses yet', e);
        return 0;
      } finally {
        flushing = false;
      }
    };

    /**
     * One-time tip when the phone has no voice for the app language (alarms
     * then speak English): checked up front, and after an alarm fell back.
     */
    const maybeShowVoiceTip = async () => {
      try {
        const { voiceEnabled } = await MedicineAlarm.getSettings();
        const fallback = (await MedicineAlarm.consumeVoiceFallback()).language;
        const lang = fallback ?? languageRef.current;
        if (!voiceEnabled || !lang || lang === 'en' || voiceTipShown(lang)) return;
        const { available } = fallback ? { available: false } : await MedicineAlarm.checkVoice({ language: lang });
        if (available || disposed) return;
        markVoiceTipShown(lang);
        const name = languageLabelByCode[lang] ?? lang;
        toast.info(translate(languageRef.current, 'alarm.voiceTipTitle', { language: name }), {
          description: translate(languageRef.current, 'alarm.voiceTipDesc'),
          duration: 12000,
          action: { label: translate(languageRef.current, 'alarm.voiceTipAction'), onClick: () => navigateRef.current('/alarm-settings') },
        });
      } catch {
        // ignore
      }
    };

    const handleUrl = async (url: string | undefined) => {
      if (!url || !url.startsWith(DOSE_TAKEN_URL)) return;
      await flush();
      navigateRef.current('/dashboard');
    };

    (async () => {
      try {
        const perms = await MedicineAlarm.checkPermissions();
        if (perms.notifications === 'prompt') await MedicineAlarm.requestPermissions();
      } catch {
        // ignore
      }
      if (disposed) return;

      await sync();
      await flush();
      void cancelOldLocalNotifications();
      void maybeShowVoiceTip();

      const pid = await ensurePatient();
      if (!pid || disposed) return;
      // Own channel name, so screens that subscribe to medicines don't clash with it.
      channel = supabase
        .channel(`alarm-sync-medicines-${pid}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'medicines', filter: `patient_id=eq.${pid}` }, scheduleSync)
        .subscribe();

      // Cold start from the alarm's "Taken"
      if (!launchUrlHandled) {
        launchUrlHandled = true;
        try {
          const launch = await App.getLaunchUrl();
          await handleUrl(launch?.url);
        } catch {
          // ignore
        }
      }
    })();

    handles.push(
      App.addListener('resume', () => {
        scheduleSync();
        void flush();
        void maybeShowVoiceTip();
      }),
    );
    handles.push(App.addListener('appUrlOpen', ({ url }) => void handleUrl(url)));
    handles.push(MedicineAlarm.addListener('doseActionQueued', () => void flush()));
    window.addEventListener(MEDICINES_CHANGED_EVENT, scheduleSync);

    return () => {
      disposed = true;
      clearTimeout(syncTimer);
      window.removeEventListener(MEDICINES_CHANGED_EVENT, scheduleSync);
      handles.forEach((h) => h.then((l) => l.remove()));
      if (channel) supabase.removeChannel(channel);
    };
  }, [loading, userId]);
}
