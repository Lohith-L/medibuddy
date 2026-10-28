import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { authRedirect } from "@/lib/webUrl";
import { takeLoginIntent } from "@/lib/care";

/**
 * "/auth/callback": the website's Google sign-in returns here.
 * Waits for the ?code= exchange (AuthContext), then /home picks the right
 * home (patient dashboard, caregiver home, or role choice for a new account).
 * The Android app finishes Google sign-in in useDeepLink instead.
 */
const AuthCallback = () => {
  const { session, loading, callbackError } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const triedExchange = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (session) {
      navigate("/home", { replace: true });
      return;
    }
    if (callbackError) {
      setError(callbackError);
      return;
    }
    // Supabase didn't pick the code up on load (e.g. the sign-in was started in
    // another browser): try once ourselves to get the real error.
    if (authRedirect.code && !triedExchange.current) {
      triedExchange.current = true;
      supabase.auth.exchangeCodeForSession(authRedirect.code).then(({ error }) => {
        if (error) setError(error.message);
      });
      return;
    }
    if (!triedExchange.current) setError(t("auth.signInIncomplete"));
  }, [loading, session, callbackError, navigate, t]);

  if (error) {
    return (
      <div className="min-h-screen gradient-hero flex items-center justify-center px-4">
        <div role="alert" className="w-full max-w-md bg-card border rounded-2xl p-6 shadow-card text-center space-y-4">
          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
          <p className="font-semibold">{t("auth.googleFailed", { message: error })}</p>
          <Button
            variant="hero"
            size="lg"
            onClick={() => {
              takeLoginIntent(); // not signed in: forget it
              navigate("/auth", { replace: true });
            }}
          >
            {t("auth.backToLogin")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center gradient-hero">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-full border-4 border-primary border-t-transparent animate-spin" />
        <p className="text-muted-foreground text-sm font-medium">{t("auth.signingIn")}</p>
      </div>
    </div>
  );
};

export default AuthCallback;
