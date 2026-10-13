import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";

interface PublicRouteProps {
  children: ReactNode;
}

/** Redirects already-logged-in users away from auth/landing pages to /dashboard */
const PublicRoute = ({ children }: PublicRouteProps) => {
  const { session, loading } = useAuth();
  const { t } = useLanguage();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center gradient-hero">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-4 border-primary border-t-transparent animate-spin" />
          <p className="text-muted-foreground text-sm font-medium">{t("loading")}</p>
        </div>
      </div>
    );
  }

  if (session) {
    // /home picks the right home (patient dashboard, caregiver home, role choice).
    return <Navigate to="/home" replace />;
  }

  return <>{children}</>;
};

export default PublicRoute;
