/**
 * usePushNotifications.ts
 *
 * Registers the device with Firebase Cloud Messaging (FCM) and saves the token
 * to the Supabase `device_tokens` table so edge functions can push to this device.
 *
 * Prerequisites (manual steps — see README):
 *   1. Create a Firebase project at https://console.firebase.google.com
 *   2. Add an Android app with package name com.medibuddy.app
 *   3. Download google-services.json → place in android/app/
 *   4. Run the device_tokens SQL migration in Supabase SQL Editor
 *
 * On web this hook is a complete no-op. It is also a no-op when the app was
 * built without google-services.json: registering would throw
 * "Default FirebaseApp is not initialized" on a native thread and crash the
 * app. Local notifications do not depend on Firebase and keep working.
 */

import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { PushNotifications, Token, PushNotificationActionPerformed } from '@capacitor/push-notifications';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';

export function usePushNotifications() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (!__FIREBASE_CONFIGURED__) {
      console.warn('[Push] Firebase not configured (no google-services.json) — push disabled');
      return;
    }

    const setup = async () => {
      // ── 1. Request permission ──────────────────────────────────────────
      const perm = await PushNotifications.requestPermissions();
      if (perm.receive !== 'granted') {
        console.warn('[Push] permission not granted:', perm.receive);
        return;
      }

      // ── 2. Register with FCM ───────────────────────────────────────────
      await PushNotifications.register();
    };

    setup().catch((err) => console.error('[Push] setup failed:', err));

    // ── 3. Save token to Supabase when FCM gives us one ───────────────
    const tokenListener = PushNotifications.addListener(
      'registration',
      async (token: Token) => {
        console.log('[Push] FCM token received:', token.value.substring(0, 20) + '...');

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Upsert so re-installs or token rotations update the row.
        const { error } = await supabase
          .from('device_tokens' as any)
          .upsert(
            {
              user_id: user.id,
              token: token.value,
              platform: Capacitor.getPlatform() as 'android' | 'ios',
            },
            { onConflict: 'user_id,token' }
          );

        if (error) {
          console.error('[Push] failed to save token:', error.message);
        } else {
          console.log('[Push] token saved to Supabase');
        }
      }
    );

    // ── 4. Handle registration errors ─────────────────────────────────
    const errorListener = PushNotifications.addListener(
      'registrationError',
      (err) => {
        console.error('[Push] registration error:', err.error);
      }
    );

    // ── 5. Handle notification received while app is open ─────────────
    const receivedListener = PushNotifications.addListener(
      'pushNotificationReceived',
      (notification) => {
        console.log('[Push] notification received in foreground:', notification.title);
        // The notification will appear as a heads-up banner on Android.
        // No extra action needed — the OS handles display.
      }
    );

    // ── 6. Handle notification tap ────────────────────────────────────
    const actionListener = PushNotifications.addListener(
      'pushNotificationActionPerformed',
      (action: PushNotificationActionPerformed) => {
        const data = action.notification.data;
        const route = data?.route ?? '/dashboard';
        navigate(route, { replace: false });
      }
    );

    // Cleanup
    return () => {
      tokenListener.then((l) => l.remove());
      errorListener.then((l) => l.remove());
      receivedListener.then((l) => l.remove());
      actionListener.then((l) => l.remove());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
