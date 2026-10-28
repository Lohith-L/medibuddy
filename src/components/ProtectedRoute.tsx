import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth, wasIntentionalSignOut } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { rememberReturnTo, signedOutPath } from "@/lib/startFlow";

interface ProtectedRouteProps {
  children: ReactNode;
}

const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const { session, loading } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();

  // Never redirect while the session (or an OAuth code exchange) is still loading.
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center gradient-hero">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-4 border-primary border-t-transparent animate-spin" />
          <p className="text-muted-foreground text-sm font-medium">{t("misc.loadingSession")}</p>
        </div>
      </div>
    );
  }

  if (!session) {
    // Reopened after the next login (see HomeRedirect). Not after pressing Log out.
    if (!wasIntentionalSignOut()) rememberReturnTo(location.pathname + location.search);
    return <Navigate to={signedOutPath()} replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
