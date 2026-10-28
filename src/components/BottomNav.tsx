import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Home, Camera, Store, Activity, Menu, Pill, Users, BarChart3, Settings, LogOut, ChevronRight, HeartHandshake, ClipboardList, BellRing,
} from "lucide-react";
import { useCare } from "@/contexts/CareContext";
import { useCaregiverAlerts } from "@/contexts/CaregiverAlertsContext";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { signOut } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { pushBackHandler } from "@/lib/backHandlers";
import { forgetPushToken } from "@/lib/pushToken";

/**
 * Mobile bottom navigation (hidden on desktop, where the sidebar is used):
 * Home, Upload, Pharmacy, Health and "More". More opens a bottom sheet with
 * Medicines, Alerts, Health Reports, Settings and Logout. Five equal columns
 * fit a 360px screen; long labels wrap onto two lines instead of being cut off.
 */
const BottomNav = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguage();
  const [moreOpen, setMoreOpen] = useState(false);
  const { mode, isCaregiver, isPatient, setMode } = useCare();
  const caregiverMode = mode === "caregiver";
  const both = isCaregiver && isPatient;
  const { unseen, activeSos } = useCaregiverAlerts();

  // Caregiver who is not also a patient: their own tabs (no alarm / upload / contacts of their own).
  const tabs = caregiverMode
    ? [
        { label: t("care.navPatients"), icon: HeartHandshake, path: "/care" },
        { label: t("medicines"), icon: Pill, path: "/medicines" },
        { label: t("sosAlert.navAlerts"), icon: BellRing, path: "/care/alerts", badge: true },
        { label: t("nav.health"), icon: Activity, path: "/health" },
      ]
    : [
        { label: t("home"), icon: Home, path: "/dashboard" },
        { label: t("upload"), icon: Camera, path: "/upload" },
        { label: t("pharmacy"), icon: Store, path: "/pharmacies" },
        { label: t("nav.health"), icon: Activity, path: "/health" },
      ];

  const moreItems = caregiverMode
    ? [
        ...(both ? [{ label: t("nav.switchToPatient"), icon: Home, path: "/dashboard", switchTo: "patient" as const }] : []),
        { label: t("care.navHistory"), icon: ClipboardList, path: "/log" },
        { label: t("healthReports"), icon: BarChart3, path: "/health-reports" },
        { label: t("nearbyPharmacies"), icon: Store, path: "/pharmacies" },
        { label: t("settings"), icon: Settings, path: "/profile" },
      ]
    : [
        ...(both ? [{ label: t("nav.switchToCaregiver"), icon: HeartHandshake, path: "/care", switchTo: "caregiver" as const }] : []),
        // Also a caregiver: their SOS / missed-dose alerts.
        ...(isCaregiver ? [{ label: t("sosAlert.navAlerts"), icon: BellRing, path: "/care/alerts" }] : []),
        { label: t("myMedicines"), icon: Pill, path: "/medicines" },
        { label: t("familyAlerts"), icon: Users, path: "/family-alerts" },
        { label: t("healthReports"), icon: BarChart3, path: "/health-reports" },
        { label: t("settings"), icon: Settings, path: "/profile" },
      ];

  const moreActive = moreItems.some((m) => m.path === location.pathname);

  // Android back button closes the sheet before navigating back.
  useEffect(() => {
    if (!moreOpen) return;
    return pushBackHandler(() => setMoreOpen(false));
  }, [moreOpen]);

  // Close the sheet when the page changes (e.g. browser back on the website).
  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  const go = (path: string) => {
    setMoreOpen(false);
    if (path !== location.pathname) navigate(path);
  };

  const handleLogout = async () => {
    setMoreOpen(false);
    await forgetPushToken(); // before signing out (RLS)
    await signOut();
    toast.success(t("layout.loggedOut"));
    navigate("/");
  };

  const itemClass = (active: boolean) =>
    `relative min-w-0 flex flex-col items-center justify-center gap-0.5 px-0.5 transition-colors active:scale-95 ${
      active ? "text-primary" : "text-muted-foreground"
    }`;
  const labelClass = (active: boolean) =>
    `w-full text-center text-[10.5px] tracking-tight leading-[1.15] line-clamp-2 [overflow-wrap:anywhere] ${
      active ? "font-bold" : "font-medium"
    }`;
  const indicator = <span className="absolute top-0 w-8 h-0.5 rounded-full bg-primary" />;

  return (
    <>
      <nav className="app-bottom-nav lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-lg border-t safe-bottom">
        <div className="grid grid-cols-5 h-16">
          {tabs.map((item) => {
            const active =
              location.pathname === item.path ||
              (item.path === "/care" && location.pathname.startsWith("/care/") && location.pathname !== "/care/alerts");
            const badge = "badge" in item && item.badge ? (activeSos.some((a) => !a.sos?.acknowledgedAt) ? "!" : unseen) : 0;
            return (
              <button
                key={item.path}
                onClick={() => go(item.path)}
                aria-current={active ? "page" : undefined}
                className={itemClass(active)}
              >
                <span className="relative">
                  <item.icon className={`w-5 h-5 shrink-0 ${active ? "stroke-[2.5]" : ""}`} />
                  {badge ? (
                    <span
                      className={`absolute -top-1.5 -right-2.5 min-w-[17px] h-[17px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center border-2 border-card ${badge === "!" ? "animate-pulse" : ""}`}
                      aria-label={t("sosAlert.unseenCount", { n: badge })}
                    >
                      {typeof badge === "number" && badge > 99 ? "99+" : badge}
                    </span>
                  ) : null}
                </span>
                <span className={labelClass(active)}>{item.label}</span>
                {active && indicator}
              </button>
            );
          })}
          <button
            onClick={() => setMoreOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            aria-current={moreActive ? "page" : undefined}
            className={itemClass(moreActive || moreOpen)}
          >
            <Menu className={`w-5 h-5 shrink-0 ${moreActive ? "stroke-[2.5]" : ""}`} />
            <span className={labelClass(moreActive)}>{t("nav.more")}</span>
            {moreActive && indicator}
          </button>
        </div>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          className="lg:hidden rounded-t-2xl px-3 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] max-h-[85vh] overflow-y-auto"
        >
          <SheetHeader className="text-left px-2">
            <SheetTitle>{t("nav.more")}</SheetTitle>
            <SheetDescription className="sr-only">{t("nav.moreTitle")}</SheetDescription>
          </SheetHeader>
          <ul className="mt-3 space-y-1">
            {moreItems.map((item) => {
              const active = location.pathname === item.path;
              return (
                <li key={item.path}>
                  <button
                    onClick={() => { if ("switchTo" in item && item.switchTo) setMode(item.switchTo); go(item.path); }}
                    aria-current={active ? "page" : undefined}
                    className={`w-full min-h-[56px] flex items-center gap-3 rounded-xl px-3 py-3 text-left text-base transition-colors active:scale-[0.99] ${
                      active ? "bg-primary/10 text-primary font-semibold" : "hover:bg-muted"
                    }`}
                  >
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${active ? "bg-primary/15" : "bg-muted"}`}>
                      <item.icon className="w-5 h-5" />
                    </span>
                    <span className="flex-1 min-w-0">{item.label}</span>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  </button>
                </li>
              );
            })}
            <li className="pt-2 mt-2 border-t">
              <button
                onClick={() => void handleLogout()}
                className="w-full min-h-[56px] flex items-center gap-3 rounded-xl px-3 py-3 text-left text-base font-semibold text-destructive hover:bg-destructive/10 transition-colors active:scale-[0.99]"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
                  <LogOut className="w-5 h-5" />
                </span>
                <span className="flex-1 min-w-0">{t("logout")}</span>
              </button>
            </li>
          </ul>
        </SheetContent>
      </Sheet>
    </>
  );
};

export default BottomNav;
