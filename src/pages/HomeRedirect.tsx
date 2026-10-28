import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useCare } from "@/contexts/CareContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { evaluateLogin, peekPendingInvite, takeLoginIntent, writeHomeMode } from "@/lib/care";
import { signedOutPath, takeReturnTo } from "@/lib/startFlow";
import { forgetPushToken } from "@/lib/pushToken";

/**
 * "/home": runs after every login (email, phone, Google) and on app start.
 *
 * Login rules: the login page used decides the interface, the account decides
 * whether that's allowed (see evaluateLogin). Without a fresh login (app restart)
 * the interface stored with the session is reopened.
 */
const HomeRedirect = () => {
  const { session, loading: authLoading, signOut } = useAuth();
  const { loading, homePath, me, refresh, setMode } = useCare();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [blocked, setBlocked] = useState<null | "notPatient">(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || authLoading || loading || !session) return;
    started.current = true;
    (async () => {
      const intent = takeLoginIntent();
      if (intent) {
        const outcome = await evaluateLogin(session.user.id, intent);
        if (outcome === "notPatient") {
          setBlocked("notPatient"); // shown even after signing out
          await forgetPushToken(); // before signing out (RLS)
          await signOut();
          return;
        }
        if (outcome === "newAccount") {
          // e.g. first Google sign-in on a login page: no interface until they create an account.
          navigate("/choose-role", { replace: true });
          return;
        }
        if (outcome === "patient" || outcome === "caregiver") {
          writeHomeMode(outcome);
          setMode(outcome);
          await refresh();
          const pending = peekPendingInvite();
          if (pending) {
            navigate(`/care/add?code=${encodeURIComponent(pending)}&auto=1`, { replace: true });
            return;
          }
          navigate(takeReturnTo() ?? (outcome === "caregiver" ? "/care" : "/dashboard"), { replace: true });
          return;
        }
      }
      // App restart / no fresh login: reopen the stored interface.
      if (!me) {
        navigate("/dashboard", { replace: true });
        return;
      }
      const pending = peekPendingInvite();
      if (pending && me.rolesConfirmed) {
        navigate(`/care/add?code=${encodeURIComponent(pending)}&auto=1`, { replace: true });
        return;
      }
      // A protected page opened while signed out (or when the session expired).
      navigate(takeReturnTo() ?? homePath, { replace: true });
    })();
  }, [authLoading, loading, session, me, homePath, navigate, refresh, setMode, signOut]);

  if (blocked === "notPatient") {
    return (
      <div className="min-h-screen gradient-hero flex items-center justify-center px-4">
        <div role="alert" className="w-full max-w-md bg-card border rounded-2xl p-6 shadow-card text-center space-y-4">
          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
          <p className="font-semibold">{t("login.noPatientAccount")}</p>
          <div className="flex flex-col gap-2">
            <Button variant="hero" size="lg" onClick={() => navigate("/signup/patient", { replace: true })}>
              {t("login.signUpAsPatient")}
            </Button>
            <Button variant="ghost" onClick={() => navigate("/login/caregiver", { replace: true })}>
              {t("login.useCaregiverLogin")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!authLoading && !session) return <Navigate to={signedOutPath()} replace />;
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-10 h-10 rounded-full border-4 border-primary border-t-transparent animate-spin" />
    </div>
  );
};

export default HomeRedirect;
