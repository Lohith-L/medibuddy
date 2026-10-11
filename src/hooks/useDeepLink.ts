/**
 * useDeepLink.ts
 *
 * Finishes Google sign-in on native (Android / iOS).
 *
 * Flow:
 *   1. Auth.tsx calls signInWithOAuth with skipBrowserRedirect and opens the
 *      Google page in the system browser (Custom Tabs) via @capacitor/browser.
 *   2. After Google signs the user in, Supabase redirects to:
 *        com.medibuddy.app://login-callback?code=...   (PKCE flow)
 *   3. Android hands that URL to MainActivity, and Capacitor fires `appUrlOpen`.
 *   4. This hook exchanges the code for a session (or, as a fallback, reads
 *      access_token / refresh_token from the hash), closes the browser and
 *      navigates to the dashboard.
 *
 * On the web this hook is a no-op.
 */
import { useEffect, useRef } from 'react';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

export const OAUTH_REDIRECT_URL = 'com.medibuddy.app://login-callback';

// Auth codes are single-use. Remember which URLs we already handled so the
// launch URL and the appUrlOpen event can't both try to exchange the same one.
const handledUrls = new Set<string>();

async function completeOAuth(url: string): Promise<boolean> {
  if (!url.startsWith(OAUTH_REDIRECT_URL) || handledUrls.has(url)) return false;
  handledUrls.add(url);
  console.log('[DeepLink] OAuth callback received');

  // Swap the custom scheme for https so URL() can parse query and hash.
  const parsed = new URL(url.replace(/^com\.medibuddy\.app:\/\//, 'https://callback/'));
  const query = parsed.searchParams;
  const hash = new URLSearchParams(parsed.hash.replace(/^#/, ''));

  try {
    const oauthError = query.get('error_description') || hash.get('error_description');
    if (oauthError) throw new Error(oauthError);

    const code = query.get('code');
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
      return true;
    }

    const access_token = hash.get('access_token');
    const refresh_token = hash.get('refresh_token');
    if (access_token && refresh_token) {
      const { error } = await supabase.auth.setSession({ access_token, refresh_token });
      if (error) throw error;
      return true;
    }

    throw new Error('Sign-in link did not contain a code or tokens');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[DeepLink] OAuth sign-in failed:', message);
    toast.error(`Google sign-in failed: ${message}`);
    return false;
  } finally {
    // Custom Tabs may still be on screen. close() rejects on Android when
    // there is nothing to close, so ignore that.
    Browser.close().catch(() => undefined);
  }
}

export function useDeepLink() {
  const navigate = useNavigate();
  // useNavigate can change identity on route changes. Keep the latest in a ref
  // so the listener below is registered exactly once.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const handle = async (url: string | undefined) => {
      if (url && (await completeOAuth(url))) {
        navigateRef.current('/dashboard', { replace: true });
      }
    };

    const listener = App.addListener('appUrlOpen', ({ url }) => handle(url));

    // If Android killed the app while the browser was open, the callback
    // relaunches it and arrives as the launch URL instead of an event.
    App.getLaunchUrl()
      .then((launch) => handle(launch?.url))
      .catch(() => undefined);

    return () => {
      listener.then((l) => l.remove());
    };
  }, []);
}
