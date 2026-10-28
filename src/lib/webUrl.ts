/**
 * Website URL fix-up. Imported FIRST in main.tsx, so it runs before the
 * Supabase client is created and before HashRouter reads the URL.
 *
 * - Google sign-in returns to /auth/callback?code=... Supabase reads the code
 *   from the real query string, the app routes by the hash. The URL becomes
 *   /?code=...#/auth/callback without reloading, so the code exchange that
 *   Supabase starts on load is never interrupted (a reload here used to lose
 *   the one-time code and the user landed on the home page signed out).
 * - Any other direct link (/dashboard, /join?code=MB-...) becomes /#/dashboard.
 */
import { Capacitor } from "@capacitor/core";

export const AUTH_CALLBACK_PATH = "/auth/callback";

/** The OAuth result found in the URL when the page loaded (before Supabase strips it). */
export const authRedirect: { pending: boolean; code: string | null; error: string | null } = {
  pending: false,
  code: null,
  error: null,
};

/** A PKCE sign-in was started in this browser (Supabase keeps the verifier until the exchange). */
function hasCodeVerifier(): boolean {
  try {
    return Object.keys(localStorage).some((k) => k.endsWith("-code-verifier"));
  } catch {
    return false;
  }
}

if (typeof window !== "undefined" && !Capacitor.isNativePlatform()) {
  const { pathname, search, hash } = window.location;
  const params = new URLSearchParams(search);
  // Supabase may put errors (or implicit-flow tokens) in the fragment instead.
  const fragment = hash && !hash.startsWith("#/") ? new URLSearchParams(hash.slice(1)) : null;
  const hasAuthParams =
    params.has("error") ||
    params.has("error_description") ||
    !!fragment?.has("access_token") ||
    !!fragment?.has("error_description");
  // /auth/callback, or an older redirect (/dashboard?code=, Site URL fallback /?code=).
  const isCallback =
    pathname === AUTH_CALLBACK_PATH ||
    (params.has("code") && hasCodeVerifier()) ||
    (hasAuthParams && (pathname === "/" || pathname === AUTH_CALLBACK_PATH));

  if (isCallback) {
    fragment?.forEach((value, key) => {
      if (!params.has(key)) params.set(key, value);
    });
    authRedirect.pending = true;
    authRedirect.code = params.get("code");
    authRedirect.error = params.get("error_description") || params.get("error");
    const qs = params.toString();
    window.history.replaceState(null, "", `/${qs ? `?${qs}` : ""}#${AUTH_CALLBACK_PATH}`);
  } else if (pathname !== "/" && !hash) {
    window.history.replaceState(null, "", `/#${pathname}${search}`);
  }
}

/** Removes the OAuth parameters from the address bar once they have been used. */
export function clearAuthParamsFromUrl() {
  const url = new URL(window.location.href);
  for (const key of ["code", "error", "error_code", "error_description", "state"]) url.searchParams.delete(key);
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
}
