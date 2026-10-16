/**
 * useMobilePolish.ts
 *
 * Handles Android/iOS-specific UX polish:
 *   - (The splash screen is hidden by useNativeSplash once the session has loaded.)
 *   - (Status bar icons follow the light / dark theme: ThemeContext.)
 *     Placement under the bar is handled by Capacitor's SystemBars (edge-to-edge)
 *     plus the safe-area CSS for html.native-app in index.css.
 *   - Handles the Android hardware back button:
 *       • On inner screens: navigate(-1)
 *       • On the welcome / intro screens: exit
 *       • On the home screen (patient /dashboard, caregiver /care): ask twice then exit
 *
 * Complete no-op on web.
 */

import { useEffect, useRef } from 'react';
import { runBackHandler } from '@/lib/backHandlers';
import { Capacitor } from '@capacitor/core';
import { App, BackButtonListenerEvent } from '@capacitor/app';
import { useNavigate, useLocation } from 'react-router-dom';
import { translate } from '@/i18n';
import { getStoredLanguage } from '@/contexts/LanguageContext';

/** Routes considered "home" — pressing back twice here exits the app */
const HOME_ROUTES = new Set(['/', '/dashboard', '/care']);
/** Signed-out start screens: back exits at once (nothing to go back to). */
const EXIT_ROUTES = new Set(['/welcome', '/intro']);

export function useMobilePolish() {
  const navigate = useNavigate();
  const location = useLocation();
  const backPressedOnce = useRef(false);
  const backPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Status / navigation bar colours follow the theme: see ThemeContext (SystemChrome).

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    // ── Android back button ────────────────────────────────────────────
    const handleBackButton = (ev: BackButtonListenerEvent) => {
      // An open sheet/overlay closes first.
      if (runBackHandler()) return;

      if (EXIT_ROUTES.has(location.pathname)) {
        App.exitApp();
        return;
      }

      const isHome = HOME_ROUTES.has(location.pathname);

      if (!isHome) {
        // On any non-home screen: go back in history
        navigate(-1);
        return;
      }

      // On home screen: first press warns, second press exits
      if (backPressedOnce.current) {
        // Second press — exit
        App.exitApp();
        return;
      }

      backPressedOnce.current = true;

      // Show a "press again to exit" toast via the existing sonner toaster
      // Import toast lazily to avoid circular deps
      import('sonner').then(({ toast }) => {
        toast(translate(getStoredLanguage(), 'misc.pressBackToExit'), { duration: 2000 });
      });

      // Reset after 2 seconds
      if (backPressTimer.current) clearTimeout(backPressTimer.current);
      backPressTimer.current = setTimeout(() => {
        backPressedOnce.current = false;
      }, 2000);
    };

    const listenerPromise = App.addListener('backButton', handleBackButton);

    return () => {
      listenerPromise.then((l) => l.remove());
      if (backPressTimer.current) clearTimeout(backPressTimer.current);
    };
  // Re-register when route changes so isHome check is always fresh
  }, [location.pathname, navigate]);
}
