/**
 * useMobilePolish.ts
 *
 * Handles Android/iOS-specific UX polish:
 *   - Hides the splash screen once the app is ready
 *   - Configures the status bar (dark icons on light, light on dark)
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
    StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
    StatusBar.setBackgroundColor({ color: '#0f172a' }).catch(() => {});

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
        toast('Press back again to exit', { duration: 2000 });
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
