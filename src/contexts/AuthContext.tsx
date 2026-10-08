import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  loading: true,
});

/** Returns true when the URL hash contains an OAuth access_token (post-Google-redirect) */
const hasOAuthHash = () =>
  typeof window !== "undefined" &&
  window.location.hash.includes("access_token");

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // If there's an OAuth hash in the URL, Supabase will fire onAuthStateChange
    // with SIGNED_IN once it exchanges the token. Don't resolve loading from
    // getSession() in that case — it would return null and cause an immediate
    // bounce to /auth before the session exists.
    const oauthRedirect = hasOAuthHash();

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      // Only mark loading done here if there's no pending OAuth token exchange
      if (!oauthRedirect) {
        setLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      // This always fires — safe to clear loading regardless
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);

