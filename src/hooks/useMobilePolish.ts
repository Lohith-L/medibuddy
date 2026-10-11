/**
 * useMobilePolish.ts
 *
 * Handles Android/iOS-specific UX polish:
 *   - Hides the splash screen once the app is ready
 *   - Configures the status bar: dark icons to match the white app header.
 *     Placement under the bar is handled by Capacitor's SystemBars (edge-to-edge)
 *     plus the safe-area CSS for html.native-app in index.css.
 *   - Handles the Android hardware back button:
 *       • On inner screens: navigate(-1)
 *       • On the home screen (/dashboard or /): ask twice then exit
 *
 * Complete no-op on web.
 */

import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { App, BackButtonListenerEvent } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { useNavigate, useLocation } from 'react-router-dom';
import { translate } from '@/i18n';
import { getStoredLanguage } from '@/contexts/LanguageContext';

/** Routes considered "home" — pressing back here exits the app */
const HOME_ROUTES = new Set(['/', '/dashboard']);

export function useMobilePolish() {
  const navigate = useNavigate();
  const location = useLocation();
  const backPressedOnce = useRef(false);
  const backPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    // ── Status bar ─────────────────────────────────────────────────────
    // Style.Light = dark text/icons for a light background.
    StatusBar.setStyle({ style: Style.Light }).catch(() => {});
    // Only has an effect below Android 15; newer versions are always edge-to-edge.
    StatusBar.setBackgroundColor({ color: '#ffffff' }).catch(() => {});

    // ── Splash screen ──────────────────────────────────────────────────
    // Hide after a short delay so the React tree has rendered.
    const splashTimer = setTimeout(() => {
      SplashScreen.hide({ fadeOutDuration: 300 }).catch(() => {});
    }, 300);

    return () => clearTimeout(splashTimer);
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    // ── Android back button ────────────────────────────────────────────
    const handleBackButton = (ev: BackButtonListenerEvent) => {
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
