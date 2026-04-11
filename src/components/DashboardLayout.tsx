import { useEffect, useState, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import {
  Home, Pill, Camera, Users, BarChart3, Settings, LogOut, Heart, Menu, X, Bell, Globe, Check, AlertTriangle, Clock, CheckCircle2, XCircle, Mail, Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { languageLabelByCode, languageOptions, normalizeLanguageCode, resolvePreferredLanguage } from "@/lib/language";
import BottomNav from "@/components/BottomNav";
import { useLanguage } from "@/contexts/LanguageContext";
import { format } from "date-fns";

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
  { key: "uploadPrescription", icon: Camera, path: "/upload" },
  { key: "healthData", icon: Activity, path: "/health" },
  { key: "familyAlerts", icon: Users, path: "/family-alerts" },
  { key: "healthReports", icon: BarChart3, path: "/health-reports" },
  { key: "settings", icon: Settings, path: "/profile" },
];

interface Props {
  children: React.ReactNode;
}

const DashboardLayout = ({ children }: Props) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, language, setLanguage: setGlobalLanguage } = useLanguage();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [patientLanguage, setPatientLanguage] = useState<string>("en");
  const [langDropdownOpen, setLangDropdownOpen] = useState(false);
  const [patientId, setPatientId] = useState<string | null>(null);
  const langRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [recentAlerts, setRecentAlerts] = useState<AlertItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) navigate("/auth");
      else { setUser(session.user); setLoading(false); }
    });
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) navigate("/auth");
      else { setUser(data.session.user); setLoading(false); }
    });
    return () => listener.subscription.unsubscribe();
  }, [navigate]);

  // Fetch patient language
  useEffect(() => {
    if (!user) return;
    supabase
      .from("patients")
      .select("id, language")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        setPatientLanguage(resolvePreferredLanguage({
          settingsLanguage: data?.language,
          patientLanguage: user.user_metadata?.language as string | undefined,
        }));
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

  const changeLanguage = async (lang: string) => {
    if (!user || !patientId) return;
    const normalizedLang = normalizeLanguageCode(lang);
    setLangDropdownOpen(false);

    const [{ error: patientError }, { error: authError }] = await Promise.all([
      supabase
        .from("patients")
        .update({ language: normalizedLang })
        .eq("id", patientId),
      supabase.auth.updateUser({
        data: { language: normalizedLang },
      }),
    ]);

    if (patientError || authError) {
      toast.error("Failed to update language");
    } else {
      setPatientLanguage(normalizedLang);
      toast.success(`Language changed to ${languageLabelByCode[normalizedLang] || normalizedLang}`);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success("Logged out successfully");
    navigate("/");
  };

  const userName = user?.user_metadata?.name || "Friend";

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const dateStr = now.toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const SidebarContent = () => (
    <>
      {/* Logo */}
      <div className="p-6 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl gradient-warm flex items-center justify-center">
            <Heart className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="text-xl font-extrabold tracking-tight">
            <span className="gradient-text">Med</span>Buddy
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 space-y-1">
        {navKeys.map((item) => {
          const active = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => { navigate(item.path); setMobileOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-base font-medium transition-all ${
                active
                  ? "bg-accent text-accent-foreground font-semibold shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <item.icon className="w-5 h-5 shrink-0" />
              <span>{t(item.key)}</span>
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
          <span>Logout</span>
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
    <div className="min-h-screen flex bg-background">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-[260px] border-r bg-card fixed inset-y-0 left-0 z-40">
        <SidebarContent />
      </aside>


      {/* Main content */}
      <div className="flex-1 lg:ml-[260px] flex flex-col min-h-screen">
        {/* Top header — compact on mobile */}
        <header className="sticky top-0 z-30 bg-card/80 backdrop-blur-lg border-b px-3 lg:px-8">
          <div className="flex items-center justify-between h-14 lg:h-[72px]">
            <div className="flex items-center gap-3">
              <div>
                <h1 className="text-base lg:text-xl font-bold truncate max-w-[200px] sm:max-w-none">{greeting}, {userName}! 👋</h1>
                <p className="text-sm text-muted-foreground hidden sm:block">{dateStr}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative" ref={langRef}>
                <button
                  onClick={() => setLangDropdownOpen(!langDropdownOpen)}
                  className="px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-semibold border border-primary/20 hover:bg-primary/20 transition-colors flex items-center gap-1.5"
                >
                  <Globe className="w-3.5 h-3.5" />
                  {languageLabelByCode[patientLanguage] || patientLanguage}
                </button>
                {langDropdownOpen && (
                  <div className="absolute right-0 top-full mt-2 w-48 bg-card border rounded-xl shadow-float z-50 py-1 animate-fade-in">
                    {languageOptions.map(({ value, label }) => (
                      <button
                        key={value}
                        onClick={() => changeLanguage(value)}
                        className={`w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-muted transition-colors ${
                          patientLanguage === value ? "text-primary font-semibold" : "text-foreground"
                        }`}
                      >
                        <span>{label}</span>
                        {patientLanguage === value && <Check className="w-4 h-4 text-primary" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="relative" ref={notifRef}>
                <Button variant="ghost" size="icon" className="relative" onClick={() => setNotifOpen(!notifOpen)}>
                  <Bell className="w-5 h-5" />
                  {unreadCount > 0 && (
                    <span className="absolute top-1.5 right-1.5 min-w-[18px] h-[18px] rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center border-2 border-card">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </Button>
                {notifOpen && (
                  <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 bg-card border rounded-xl shadow-float z-50 animate-fade-in max-h-[400px] overflow-hidden flex flex-col">
                    <div className="flex items-center justify-between px-4 py-3 border-b">
                      <p className="font-bold text-sm">Notifications</p>
                      <button onClick={() => { navigate("/family-alerts"); setNotifOpen(false); }} className="text-xs text-primary font-semibold hover:underline">
                        View All
                      </button>
                    </div>
                    <div className="overflow-y-auto flex-1">
                      {recentAlerts.length === 0 ? (
                        <div className="p-6 text-center text-muted-foreground text-sm">No notifications yet</div>
                      ) : (
                        recentAlerts.map(a => (
                          <div key={a.id} className="flex items-start gap-2.5 px-4 py-3 hover:bg-muted/50 transition-colors border-b last:border-0">
                            <div className="mt-0.5">{notifIcon(a.alert_type)}</div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">
                                {a.medicine_name || a.message_preview || a.alert_type}
                              </p>
                              <p className="text-xs text-muted-foreground truncate">
                                {a.recipient_name && `To: ${a.recipient_name} · `}
                                {a.status === "sent" ? "✅ Sent" : a.status === "failed" ? "❌ Failed" : "⏳ Pending"}
                              </p>
                              <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                                {format(new Date(a.created_at), "dd MMM, hh:mm a")}
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

        {/* Page content */}
        <main className="flex-1 p-3 sm:p-4 lg:p-8 pb-20 lg:pb-8">
          {children}
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <BottomNav />
    </div>
  );
};

export default DashboardLayout;
