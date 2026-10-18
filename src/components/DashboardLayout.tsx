import { useEffect, useState, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import {
  Home, Pill, Camera, Users, BarChart3, Settings, LogOut, Menu, X, Bell, Globe, Check, AlertTriangle, Clock, CheckCircle2, XCircle, Mail, Activity, Store,
  HeartHandshake, ClipboardList, BellRing, Siren,
} from "lucide-react";
import { useCare } from "@/contexts/CareContext";
import { useCaregiverAlerts } from "@/contexts/CaregiverAlertsContext";
import { peekPendingInvite } from "@/lib/care";
import ViewingBar from "@/components/ViewingBar";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { languageLabelByCode, languageOptions } from "@/lib/language";
import BottomNav from "@/components/BottomNav";
import { useLanguage } from "@/contexts/LanguageContext";
import SOSButton, { SOSProvider } from "@/components/SOSButton";
import BrandLogo from "@/components/BrandLogo";
import { signedOutPath } from "@/lib/startFlow";
import ThemeToggle from "@/components/ThemeToggle";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { forgetPushToken } from "@/lib/pushToken";

interface AlertItem {
  id: string;
  alert_type: string;
  medicine_name: string | null;
  recipient_name: string | null;
  status: string;
  message_preview: string | null;
  created_at: string;
}

const navKeys = [
  { key: "dashboard", icon: Home, path: "/dashboard" },
  { key: "myMedicines", icon: Pill, path: "/medicines" },
  { key: "nearbyPharmacies", icon: Store, path: "/pharmacies" },
  { key: "uploadPrescription", icon: Camera, path: "/upload" },
  { key: "healthData", icon: Activity, path: "/health" },
  { key: "familyAlerts", icon: Users, path: "/family-alerts" },
  { key: "healthReports", icon: BarChart3, path: "/health-reports" },
  { key: "settings", icon: Settings, path: "/profile" },
];

/** Caregiver who is not also a patient: their own nav. */
const caregiverNavKeys = [
  { key: "care.navPatients", icon: HeartHandshake, path: "/care" },
  { key: "sosAlert.navAlerts", icon: BellRing, path: "/care/alerts" },
  { key: "myMedicines", icon: Pill, path: "/medicines" },
  { key: "healthData", icon: Activity, path: "/health" },
  { key: "healthReports", icon: BarChart3, path: "/health-reports" },
  { key: "care.navHistory", icon: ClipboardList, path: "/log" },
  { key: "nearbyPharmacies", icon: Store, path: "/pharmacies" },
  { key: "settings", icon: Settings, path: "/profile" },
];

/** Pages that show the active patient's data: the "Viewing:" bar goes on top. */
const PATIENT_DATA_ROUTES = new Set(["/medicines", "/health", "/health-reports", "/log", "/upload", "/care/patient"]);
/** Patient-interface pages (my own medicines, alarms, contacts, caregiver invites). */
const PATIENT_ONLY_ROUTES = new Set(["/dashboard", "/family-alerts", "/caregivers"]);
/** Caregiver-interface pages. ("/care/add" is allowed in both: accepting an invite.) */
const CAREGIVER_ONLY_ROUTES = new Set(["/care", "/care/patient"]);

interface Props {
  children: React.ReactNode;
}

const DashboardLayout = ({ children }: Props) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, language, setLanguage, locale } = useLanguage();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [langDropdownOpen, setLangDropdownOpen] = useState(false);
  const [patientId, setPatientId] = useState<string | null>(null);
  const langRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [recentAlerts, setRecentAlerts] = useState<AlertItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const care = useCare();
  const cgAlerts = useCaregiverAlerts();
  const caregiverBell = care.mode === "caregiver";
  /** Bell badge: my caregiver alerts in caregiver mode, my own notifications otherwise. */
  const bellCount = caregiverBell ? cgAlerts.unseen : unreadCount;

  // Pending invite (opened a link before signing in) -> role picker -> keep caregivers off patient-only pages.
  useEffect(() => {
    if (care.loading || !care.me) return;
    const pending = peekPendingInvite();
    if (pending && location.pathname !== "/care/add" && care.me.rolesConfirmed) {
      navigate(`/care/add?code=${encodeURIComponent(pending)}&auto=1`, { replace: true });
      return;
    }
    if (!care.me.rolesConfirmed) {
      navigate("/choose-role", { replace: true });
      return;
    }
    // Route guards: the interface (mode) decides which pages can be opened.
    if (care.mode === "caregiver" && PATIENT_ONLY_ROUTES.has(location.pathname)) {
      navigate("/care", { replace: true });
      return;
    }
    if (care.mode === "patient" && CAREGIVER_ONLY_ROUTES.has(location.pathname)) {
      navigate("/dashboard", { replace: true });
    }
  }, [care.loading, care.me, care.mode, location.pathname, navigate]);

  const both = care.isPatient && care.isCaregiver;
  type SideItem = { key: string; icon: typeof Home; path: string; switchTo?: "patient" | "caregiver" };
  const sideNav: SideItem[] = care.mode === "caregiver"
    ? [...caregiverNavKeys, ...(both ? [{ key: "nav.switchToPatient", icon: Home, path: "/dashboard", switchTo: "patient" as const }] : [])]
    : both
      ? [
          navKeys[0],
          { key: "nav.switchToCaregiver", icon: HeartHandshake, path: "/care", switchTo: "caregiver" as const },
          { key: "sosAlert.navAlerts", icon: BellRing, path: "/care/alerts" },
          ...navKeys.slice(1),
        ]
      : navKeys;

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) navigate(signedOutPath());
      else { setUser(session.user); setLoading(false); }
    });
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) navigate(signedOutPath());
      else { setUser(data.session.user); setLoading(false); }
    });
    return () => listener.subscription.unsubscribe();
  }, [navigate]);

  // Patient id for the notification panel
  useEffect(() => {
    if (!user) return;
    supabase
      .from("patients")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.id) setPatientId(data.id);
      });
  }, [user]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) {
        setLangDropdownOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Fetch recent alerts for notification panel
  useEffect(() => {
    if (!patientId) return;
    const fetchAlerts = async () => {
      const { data, count } = await supabase
        .from("alert_history")
        .select("id, alert_type, medicine_name, recipient_name, status, message_preview, created_at", { count: "exact" })
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false })
        .limit(10);
      setRecentAlerts((data as AlertItem[]) || []);
      setUnreadCount(count || 0);
    };
    fetchAlerts();

    const channel = supabase
      .channel("notif_alerts")
      .on("postgres_changes" as any, { event: "INSERT", schema: "public", table: "alert_history", filter: `patient_id=eq.${patientId}` }, () => fetchAlerts())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [patientId]);

  const notifIcon = (type: string) => {
    if (type === "family_alert" || type === "escalation") return <AlertTriangle className="w-3.5 h-3.5 text-warning" />;
    if (type === "reminder") return <Clock className="w-3.5 h-3.5 text-primary" />;
    if (type === "weekly_report") return <Mail className="w-3.5 h-3.5 text-primary" />;
    return <Bell className="w-3.5 h-3.5 text-muted-foreground" />;
  };

  // Switches the whole UI at once and saves the choice (device + profile).
  const changeLanguage = (lang: string) => {
    setLangDropdownOpen(false);
    void setLanguage(lang);
  };

  const handleLogout = async () => {
    await forgetPushToken(); // before signing out (RLS)
    await supabase.auth.signOut();
    toast.success(t("layout.loggedOut"));
    navigate("/");
  };

  const userName = user?.user_metadata?.name || t("layout.friend");

  // Re-render every minute so the greeting/date stay correct while the app is left open
  // (otherwise "Good morning" sticks past noon until the layout remounts), and at once
  // when the app / tab comes back to the foreground (timers sleep in the background).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = window.setInterval(tick, 60_000);
    const onVisible = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVisible);
    const resume = Capacitor.isNativePlatform() ? App.addListener("resume", tick) : null;
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      void resume?.then((h) => h.remove());
    };
  }, []);
  const hour = now.getHours();
  const greeting = hour < 12 ? t("goodMorning") : hour < 17 ? t("goodAfternoon") : t("goodEvening");
  const dateStr = now.toLocaleDateString(locale, { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const SidebarContent = () => (
    <>
      {/* Logo */}
      <div className="p-6 pb-4">
        <BrandLogo variant="horizontal" className="h-10" />
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 space-y-1">
        {sideNav.map((item) => {
          const active = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => { if (item.switchTo) care.setMode(item.switchTo); navigate(item.path); setMobileOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-base font-medium transition-all ${
                active
                  ? "bg-accent text-accent-foreground font-semibold shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <item.icon className="w-5 h-5 shrink-0" />
              <span className="flex-1 text-left">{t(item.key)}</span>
              {item.path === "/care/alerts" && cgAlerts.unseen > 0 && (
                <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-destructive text-destructive-foreground text-[11px] font-bold flex items-center justify-center">
                  {cgAlerts.unseen > 99 ? "99+" : cgAlerts.unseen}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="p-3 border-t">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-base font-medium text-destructive hover:bg-destructive/10 transition-all"
        >
          <LogOut className="w-5 h-5" />
          <span>{t("logout")}</span>
        </button>
      </div>
    </>
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="space-y-4 w-64">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    );
  }

  return (
    <SOSProvider>
    <div className="min-h-screen flex bg-background w-full max-w-full overflow-x-clip">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-[260px] border-r bg-card fixed inset-y-0 left-0 z-40">
        <SidebarContent />
      </aside>


      {/* Main content */}
      <div className="flex-1 min-w-0 w-full lg:ml-[260px] flex flex-col min-h-screen">
        {/* Top header — compact on mobile */}
        <header className="app-header sticky top-0 z-30 bg-card/80 backdrop-blur-lg border-b px-3 lg:px-8">
          <div className="flex items-center justify-end sm:justify-between gap-2 h-14 lg:h-[72px]">
            {/* Desktop/tablet: greeting inline. On phones it gets its own row below (see after this row). */}
            <div className="hidden sm:flex items-center gap-3 min-w-0">
              <div className="min-w-0">
                <h1 className="text-base lg:text-xl font-bold truncate">{greeting}, {userName}! 👋</h1>
                <p className="text-sm text-muted-foreground">{dateStr}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
              <SOSButton variant="header" />
              <ThemeToggle className="max-[340px]:hidden" />
              <div className="relative" ref={langRef}>
                <button
                  onClick={() => setLangDropdownOpen(!langDropdownOpen)}
                  className="h-10 min-w-10 justify-center px-2.5 max-[380px]:px-0 max-[380px]:w-10 sm:px-3 rounded-full bg-primary/10 text-primary text-sm font-semibold border border-primary/20 hover:bg-primary/20 transition-colors flex items-center gap-1.5"
                  aria-label={t("layout.changeLanguage")}
                >
                  <Globe className="w-5 h-5 shrink-0" />
                  <span className="max-[380px]:hidden">{languageLabelByCode[language] || language}</span>
                </button>
                {langDropdownOpen && (
                  <div className="absolute right-0 top-full mt-2 w-48 bg-card border rounded-xl shadow-float z-50 py-1 animate-fade-in">
                    {languageOptions.map(({ value, label }) => (
                      <button
                        key={value}
                        onClick={() => changeLanguage(value)}
                        className={`w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-muted transition-colors ${
                          language === value ? "text-primary font-semibold" : "text-foreground"
                        }`}
                      >
                        <span>{label}</span>
                        {language === value && <Check className="w-4 h-4 text-primary" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="relative" ref={notifRef}>
                <Button variant="ghost" size="icon" className="relative shrink-0 h-10 w-10 rounded-full border border-primary/20 bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary" aria-label={t("notifications")} onClick={() => setNotifOpen(!notifOpen)}>
                  <Bell className="w-5 h-5" />
                  {bellCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center border-2 border-card">
                      {bellCount > 99 ? "99+" : bellCount}
                    </span>
                  )}
                </Button>
                {notifOpen && (
                  <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 max-w-[calc(100vw-1.5rem)] bg-card border rounded-xl shadow-float z-50 animate-fade-in max-h-[400px] overflow-hidden flex flex-col">
                    <div className="flex items-center justify-between px-4 py-3 border-b">
                      <p className="font-bold text-sm">{t("notifications")}</p>
                      <button onClick={() => { navigate(caregiverBell ? "/care/alerts" : "/family-alerts"); setNotifOpen(false); }} className="text-xs text-primary font-semibold hover:underline">
                        {t("viewAll")}
                      </button>
                    </div>
                    <div className="overflow-y-auto flex-1">
                      {/* Caregiver alerts (SOS / missed doses): open the Alerts page. */}
                      {cgAlerts.enabled && (caregiverBell || cgAlerts.unseen > 0 || cgAlerts.activeSos.length > 0) && (
                        <button
                          onClick={() => { navigate("/care/alerts"); setNotifOpen(false); }}
                          className={`w-full flex items-center gap-2.5 px-4 py-3 text-left border-b transition-colors ${
                            cgAlerts.activeSos.some((a) => !a.sos?.acknowledgedAt) ? "bg-red-50 hover:bg-red-100 dark:bg-red-950/40" : "hover:bg-muted/50"
                          }`}
                        >
                          {cgAlerts.activeSos.length > 0 ? <Siren className="w-4 h-4 text-destructive shrink-0" /> : <BellRing className="w-4 h-4 text-primary shrink-0" />}
                          <span className="flex-1 min-w-0 text-sm font-semibold truncate">
                            {cgAlerts.activeSos.length > 0
                              ? t("sosAlert.bellActive", { n: cgAlerts.activeSos.length })
                              : t("sosAlert.bellUnseen", { n: cgAlerts.unseen })}
                          </span>
                        </button>
                      )}
                      {caregiverBell ? null : recentAlerts.length === 0 ? (
                        <div className="p-6 text-center text-muted-foreground text-sm">{t("noNotifications")}</div>
                      ) : (
                        recentAlerts.map(a => (
                          <div key={a.id} className="flex items-start gap-2.5 px-4 py-3 hover:bg-muted/50 transition-colors border-b last:border-0">
                            <div className="mt-0.5">{notifIcon(a.alert_type)}</div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">
                                {a.medicine_name || a.message_preview || a.alert_type}
                              </p>
                              <p className="text-xs text-muted-foreground truncate">
                                {a.recipient_name && `${t("layout.to", { name: a.recipient_name })} · `}
                                {a.status === "sent" ? `✅ ${t("status.sent")}` : a.status === "failed" ? `❌ ${t("status.failed")}` : `⏳ ${t("status.pending")}`}
                              </p>
                              <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                                {new Date(a.created_at).toLocaleString(locale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                              </p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Phones: full greeting on its own line (scrolls with the page, never truncated) */}
        <div className="sm:hidden px-3 pt-3">
          <h1 className="text-lg font-bold leading-snug break-words">{greeting}, {userName}! 👋</h1>
          <p className="text-sm text-muted-foreground">{dateStr}</p>
        </div>

        {/* Page content */}
        <main className="app-main flex-1 min-w-0 w-full max-w-full p-3 sm:p-4 lg:p-8 pb-20 lg:pb-8">
          {PATIENT_DATA_ROUTES.has(location.pathname) && <ViewingBar />}
          {children}
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <BottomNav />
      <SOSButton variant="floating" />
    </div>
    </SOSProvider>
  );
};

export default DashboardLayout;
