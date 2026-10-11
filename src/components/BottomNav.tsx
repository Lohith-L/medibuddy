import { useNavigate, useLocation } from "react-router-dom";
import { Home, Pill, Camera, Store, Users, BarChart3, Settings } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

/**
 * Mobile bottom navigation. Seven equal-width items always fit a 360px screen
 * (no horizontal scrolling); long labels wrap onto two lines instead of being
 * cut off. Logout lives on the Settings page.
 */
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

  return (
    <nav className="app-bottom-nav lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-lg border-t safe-bottom">
      <div className="grid grid-cols-7 h-16">
        {bottomNavItems.map((item) => {
          const active = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              aria-current={active ? "page" : undefined}
              className={`relative min-w-0 flex flex-col items-center justify-center gap-0.5 px-0 transition-colors active:scale-95 ${
                active ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <item.icon className={`w-5 h-5 shrink-0 ${active ? "stroke-[2.5]" : ""}`} />
              <span
                className={`w-full text-center text-[9.5px] tracking-tight leading-[1.15] line-clamp-2 [overflow-wrap:break-word] ${
                  active ? "font-bold" : "font-medium"
                }`}
              >
                {item.label}
              </span>
              {active && <span className="absolute top-0 w-8 h-0.5 rounded-full bg-primary" />}
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomNav;
