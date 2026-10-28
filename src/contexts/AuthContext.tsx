import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { authRedirect, clearAuthParamsFromUrl } from "@/lib/webUrl";
import { translate } from "@/i18n";
import { getStoredLanguage } from "@/contexts/LanguageContext";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  /** True until the stored session is known and any OAuth ?code= in the URL has been exchanged. */
  loading: boolean;
  /** Why the OAuth redirect in the URL did not sign the user in (shown on /auth/callback). */
  callbackError: string | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  loading: true,
  callbackError: null,
  signOut: async () => {},
});

// Marks a sign-out the user asked for (shared with other tabs), so it isn't
// reported as "Your session expired".
const SIGN_OUT_KEY = "medibuddy.signedOutAt";

/** Signs out on purpose. Use this instead of supabase.auth.signOut(). */
// eslint-disable-next-line react-refresh/only-export-components
export async function signOut(): Promise<void> {
  try {
    localStorage.setItem(SIGN_OUT_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
  await supabase.auth.signOut();
}

/** The user signed out on purpose in the last few seconds (this tab or another). */
// eslint-disable-next-line react-refresh/only-export-components
export function wasIntentionalSignOut(): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(SIGN_OUT_KEY) || 0) < 15_000;
  } catch {
    return false;
  }
}

/**
 * The only place that listens to Supabase auth. Everything else reads useAuth().
 *
 * A null session only counts as signed out on SIGNED_OUT or when the first
 * getSession() (after the OAuth code exchange) finds none. Other events with
 * no session (e.g. during a token refresh) are ignored.
 */
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [callbackError, setCallbackError] = useState<string | null>(authRedirect.error);
  const hadSession = useRef(false);

  useEffect(() => {
    let active = true;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === "SIGNED_OUT") {
        // Not asked for: the refresh token was rejected (expired / revoked).
        if (hadSession.current && !wasIntentionalSignOut()) {
          toast.error(translate(getStoredLanguage(), "auth.sessionExpired"));
        }
        hadSession.current = false;
        setSession(null);
        return;
      }
      if (next) {
        hadSession.current = true;
        setSession(next);
      }
    });

    (async () => {
      // Resolves after Supabase has exchanged an OAuth ?code= from the URL (or failed to).
      const { error } = await supabase.auth.initialize();
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      if (authRedirect.pending) {
        if (error && !data.session) setCallbackError((prev) => prev ?? error.message);
        clearAuthParamsFromUrl();
      }
      if (data.session) hadSession.current = true;
      setSession(data.session);
      setLoading(false);
    })();

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    loading,
    callbackError,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);
