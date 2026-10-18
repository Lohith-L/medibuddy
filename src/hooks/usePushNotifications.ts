/**
 * usePushNotifications.ts
 *
 * Registers the device with Firebase Cloud Messaging (FCM) and keeps its token
 * in Supabase `device_tokens`, so the server (send-push-notification, called by
 * a database trigger) can reach this phone when MediBuddy is closed.
 *
 * - Runs for every signed-in user (patients and caregivers), on app start and
 *   again whenever someone logs in; tokens are saved on start and on refresh,
 *   and removed before logout (lib/pushToken).
 * - SOS pushes are data-only + high priority. Android hands them to our native
 *   MediBuddyMessagingService, which rings the full-screen caregiver alarm even
 *   when the app is swiped away. While the app is open they also arrive here;
 *   CaregiverAlertsContext rings by sos_event_id, so Realtime + push never ring twice.
 *
 * Prerequisites: android/app/google-services.json (see MOBILE_README.md). Without
 * it this hook is a no-op: registering would crash with "Default FirebaseApp is
 * not initialized". On web it is always a no-op.
 */

import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { PushNotifications, Token, PushNotificationActionPerformed } from '@capacitor/push-notifications';
import { CAREGIVER_ALERT_EVENT } from '@/contexts/CaregiverAlertsContext';
import { useAuth } from '@/contexts/AuthContext';
import { savePushToken } from '@/lib/pushToken';
import { useNavigate } from 'react-router-dom';

const CARE_TYPES = new Set(['sos', 'sos_stop', 'missed_dose']);

export function usePushNotifications() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  // Listeners: once.
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !__FIREBASE_CONFIGURED__) return;

    const tokenListener = PushNotifications.addListener('registration', (token: Token) => {
      console.info('[Push] FCM token received:', token.value.slice(0, 16) + '…');
      void savePushToken(token.value);
    });

    const errorListener = PushNotifications.addListener('registrationError', (err) => {
      console.error('[Push] registration error:', JSON.stringify(err));
    });

    // App open: refresh caregiver alerts at once (shows the SOS screen + alarm).
    const receivedListener = PushNotifications.addListener('pushNotificationReceived', (n) => {
      console.info('[Push] received in foreground:', n.data?.type, n.title ?? '');
      if (CARE_TYPES.has(n.data?.type)) window.dispatchEvent(new Event(CAREGIVER_ALERT_EVENT));
    });

    // Notification tapped: caregiver alerts open the Alerts page.
    const actionListener = PushNotifications.addListener('pushNotificationActionPerformed', (action: PushNotificationActionPerformed) => {
      const data = action.notification.data ?? {};
      if (CARE_TYPES.has(data.type)) {
        window.dispatchEvent(new Event(CAREGIVER_ALERT_EVENT));
        navigate(data.sos_event_id ? `/care/alerts?sos=${encodeURIComponent(data.sos_event_id)}` : '/care/alerts');
        return;
      }
      navigate(data.route ?? '/dashboard');
    });

    return () => {
      void tokenListener.then((l) => l.remove());
      void errorListener.then((l) => l.remove());
      void receivedListener.then((l) => l.remove());
      void actionListener.then((l) => l.remove());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Register on app start and on every login (FCM returns the current token,
  // which 'registration' then saves for the signed-in account).
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (!__FIREBASE_CONFIGURED__) {
      console.warn('[Push] Firebase not configured (no google-services.json): push disabled');
      return;
    }
    if (!userId) return;
    (async () => {
      let perm = await PushNotifications.checkPermissions();
      if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await PushNotifications.requestPermissions();
      if (perm.receive !== 'granted') {
        console.warn('[Push] notification permission not granted:', perm.receive);
        return;
      }
      await PushNotifications.register();
    })().catch((err) => console.error('[Push] setup failed:', err));
  }, [userId]);
}
