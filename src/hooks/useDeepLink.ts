/**
 * useDeepLink.ts
 *
 * Handles OAuth deep links on native (Android / iOS).
 *
 * Flow:
 *   1. User taps "Sign in with Google" → Supabase opens the browser.
 *   2. After Google authenticates, Supabase redirects to:
 *        com.medibuddy.app://login-callback#access_token=...
 *   3. Android intercepts that URL and fires an `appUrlOpen` event.
 *   4. This hook passes the URL to supabase.auth.getSessionFromUrl() which
 *      exchanges the hash fragment for a real session.
 *   5. AuthContext's onAuthStateChange fires → user is logged in.
 *
 * On the web this hook is a no-op.
 */
import { useEffect } from 'react';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';

export function useDeepLink() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const listener = App.addListener('appUrlOpen', async ({ url }) => {
      console.log('[DeepLink] received:', url);

      // Only handle our own scheme
      if (!url.startsWith('com.medibuddy.app://')) return;

      // Supabase puts tokens in the hash fragment — convert the custom-scheme
      // URL to something its parser can handle.
      const urlObj = new URL(url.replace('com.medibuddy.app://', 'https://placeholder/'));
      const hashOrQuery = urlObj.hash || urlObj.search;

      if (hashOrQuery.includes('access_token') || hashOrQuery.includes('code')) {
        const { data, error } = await supabase.auth.getSessionFromUrl();
        if (error) {
          console.error('[DeepLink] getSessionFromUrl error:', error.message);
          return;
        }
        if (data.session) {
          // Navigate to dashboard after successful OAuth login
          navigate('/dashboard', { replace: true });
        }
      }
    });

    // Cleanup on unmount
    return () => {
      listener.then((l) => l.remove());
    };
  }, [navigate]);
}
