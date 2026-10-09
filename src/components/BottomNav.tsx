import { useNavigate, useLocation } from "react-router-dom";
import { Home, Pill, Camera, Store, Users, BarChart3, Settings, LogOut } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/contexts/LanguageContext";

const BottomNav = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguage();

  const bottomNavItems = [
    { label: t("home"), icon: Home, path: "/dashboard" },
    { label: t("medicines"), icon: Pill, path: "/medicines" },
    { label: t("pharmacy"), icon: Store, path: "/pharmacies" },
    { label: t("upload"), icon: Camera, path: "/upload" },
    { label: t("alerts"), icon: Users, path: "/family-alerts" },
    { label: t("reports"), icon: BarChart3, path: "/health-reports" },
    { label: t("settings"), icon: Settings, path: "/profile" },
  ];

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success("Logged out successfully");
    navigate("/");
  };

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-lg border-t safe-bottom">
      <div className="flex items-stretch h-16 overflow-x-auto scrollbar-hide">
        {bottomNavItems.map((item) => {
          const active = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`relative flex flex-col items-center justify-center flex-1 shrink-0 min-w-[64px] gap-0.5 transition-colors active:scale-95 ${
                active
                  ? "text-primary"
                  : "text-muted-foreground"
              }`}
            >
              <item.icon className={`w-5 h-5 ${active ? "stroke-[2.5]" : ""}`} />
              <span className={`text-[10px] leading-tight truncate max-w-full px-0.5 ${active ? "font-bold" : "font-medium"}`}>
                {item.label}
              </span>
              {active && (
                <span className="absolute top-0 w-8 h-0.5 rounded-full bg-primary" />
              )}
            </button>
          );
        })}
        <button
          onClick={handleLogout}
          className="relative flex flex-col items-center justify-center flex-1 shrink-0 min-w-[64px] gap-0.5 transition-colors active:scale-95 text-destructive"
        >
          <LogOut className="w-5 h-5" />
          <span className="text-[10px] leading-tight font-medium truncate max-w-full px-0.5">
            {t("logout")}
          </span>
        </button>
      </div>
    </nav>
  );
};

export default BottomNav;
