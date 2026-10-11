/**
 * useMedicineNotifications.ts
 *
 * Schedules device-local notifications for each medicine reminder time.
 * Works on Android and iOS (via @capacitor/local-notifications).
 * On web this hook is a complete no-op — the site keeps its existing behaviour.
 *
 * How it works:
 *   1. On mount (and whenever `medicines` changes), request notification permission.
 *   2. Cancel every existing notification in our "medicine" notification group.
 *   3. For each active medicine and each reminder_time, schedule a daily repeating
 *      local notification for the next 30 days.
 *   4. When a notification is tapped, navigate to /medicines.
 *
 * Called from: Medicines.tsx (which already subscribes to Realtime, so it
 * automatically re-runs when the website changes a reminder time).
 */

import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  LocalNotifications,
  PermissionStatus,
  ActionPerformed,
} from '@capacitor/local-notifications';
import { useNavigate } from 'react-router-dom';

export interface MedicineForNotification {
  id: string;
  name: string;
  dosage: string;
  reminder_times: string[] | null;
  is_active: boolean;
}

// We use IDs in the range 10000–99999 so they don't clash with anything else.
// ID formula: (medicine index * 100 + time slot index) offset from 10000.
const ID_BASE = 10000;
const MAX_DAYS = 30; // schedule this many days ahead

function buildNotificationId(medIndex: number, timeIndex: number, dayOffset: number): number {
  // Each medicine*slot pair gets 31 IDs (one per day offset 0–30).
  return ID_BASE + (medIndex * 100 + timeIndex) * 31 + dayOffset;
}

/** Parse "HH:MM" into { hour, minute } */
function parseTime(hhmm: string): { hour: number; minute: number } | null {
  const parts = hhmm.split(':');
  if (parts.length !== 2) return null;
  const hour = parseInt(parts[0], 10);
  const minute = parseInt(parts[1], 10);
  if (isNaN(hour) || isNaN(minute)) return null;
  return { hour, minute };
}

/** Return a Date for today at HH:MM, bumped to tomorrow if that time is already past */
function nextOccurrence(hour: number, minute: number): Date {
  const now = new Date();
  const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0);
  if (candidate <= now) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate;
}

export function useMedicineNotifications(medicines: MedicineForNotification[]) {
  const navigate = useNavigate();
  const listenerRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let cancelled = false;

    const run = async () => {
      // ── 1. Request permission ─────────────────────────────────────────
      let perm: PermissionStatus;
      try {
        perm = await LocalNotifications.requestPermissions();
      } catch {
        console.warn('[Notifications] requestPermissions failed');
        return;
      }

      if (perm.display !== 'granted') {
        console.warn('[Notifications] permission not granted:', perm.display);
        return;
      }

      if (cancelled) return;

      // ── 2. Cancel all existing medicine notifications ──────────────────
      try {
        const pending = await LocalNotifications.getPending();
        const medicineIds = pending.notifications
          .map((n) => n.id)
          .filter((id) => id >= ID_BASE && id < ID_BASE + 500 * 31); // our range

        if (medicineIds.length > 0) {
          await LocalNotifications.cancel({ notifications: medicineIds.map((id) => ({ id })) });
        }
      } catch (e) {
        console.warn('[Notifications] cancel error:', e);
      }

      if (cancelled) return;

      // ── 3. Schedule new notifications ─────────────────────────────────
      const activeMeds = medicines.filter((m) => m.is_active && m.reminder_times?.length);

      const toSchedule: Parameters<typeof LocalNotifications.schedule>[0]['notifications'] = [];

      activeMeds.forEach((med, medIndex) => {
        (med.reminder_times ?? []).forEach((timeStr, timeIndex) => {
          const parsed = parseTime(timeStr);
          if (!parsed) return;

          const { hour, minute } = parsed;
          const firstOccurrence = nextOccurrence(hour, minute);

          for (let day = 0; day < MAX_DAYS; day++) {
            const at = new Date(firstOccurrence);
            at.setDate(at.getDate() + day);

            toSchedule.push({
              id: buildNotificationId(medIndex, timeIndex, day),
              title: `💊 Time for ${med.name}`,
              body: `${med.dosage} — tap to log your dose`,
              schedule: { at, allowWhileIdle: true },
              // Extra data so the tap handler can navigate
              extra: { route: '/medicines', medicineId: med.id },
              // Group all medicine reminders together
              group: 'medicine-reminders',
              groupSummary: false,
              sound: undefined, // use system default
              smallIcon: 'ic_stat_icon_config_sample',
              iconColor: '#6366f1',
            });
          }
        });
      });

      if (toSchedule.length > 0 && !cancelled) {
        try {
          await LocalNotifications.schedule({ notifications: toSchedule });
          console.log(`[Notifications] scheduled ${toSchedule.length} notifications`);
        } catch (e) {
          console.error('[Notifications] schedule error:', e);
        }
      }
    };

    run();

    // ── 4. Tap handler: navigate to /medicines ─────────────────────────
    // Register once; the ref lets us remove the old listener before adding a new one.
    if (listenerRef.current) {
      listenerRef.current(); // remove previous listener
    }

    LocalNotifications.addListener(
      'localNotificationActionPerformed',
      (action: ActionPerformed) => {
        const route = action.notification.extra?.route ?? '/medicines';
        navigate(route, { replace: false });
      }
    ).then((handle) => {
      listenerRef.current = () => handle.remove();
    });

    return () => {
      cancelled = true;
      // Don't remove the tap listener on every re-render — only on final unmount.
    };
  // Re-run whenever the medicines list changes (triggered by Realtime updates).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [medicines]);

  // Clean up tap listener on unmount
  useEffect(() => {
    return () => {
      if (listenerRef.current) {
        listenerRef.current();
        listenerRef.current = null;
      }
    };
  }, []);
}
