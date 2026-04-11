import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useLanguage } from "@/contexts/LanguageContext";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Activity, Moon, Heart, Flame, RefreshCw, Wifi, WifiOff,
  Smartphone, TrendingUp, Clock, BarChart3,
} from "lucide-react";
import {
  HealthConnectionStatus, HealthSummary,
  isNativeHealthAvailable, getMockWeekData, syncHealthToBackend,
  fetchHealthData, formatSleep,
} from "@/lib/healthService";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

const fadeIn = (i: number) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: i * 0.08 },
});

const Health = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [patientId, setPatientId] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<HealthConnectionStatus>("not_connected");
  const [todaySummary, setTodaySummary] = useState<HealthSummary | null>(null);
  const [weekData, setWeekData] = useState<HealthSummary[]>([]);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/auth"); return; }

      const { data: patient } = await supabase
        .from("patients")
        .select("id")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (!patient) { setLoading(false); return; }
      setPatientId(patient.id);

      // Try fetching real data first
      const stored = await fetchHealthData(patient.id, 7);
      if (stored.length > 0) {
        setWeekData(stored);
        setTodaySummary(stored[stored.length - 1]);
        setConnectionStatus("connected");
      } else {
        // Use mock data for demo
        const mock = getMockWeekData();
        setWeekData(mock);
        setTodaySummary(mock[mock.length - 1]);
        setConnectionStatus("not_connected");
      }
      setLoading(false);
    };
    load();
  }, [navigate]);

  const handleConnect = async () => {
    if (isNativeHealthAvailable()) {
      // Future: trigger Health Connect permission flow
      toast.info(t("healthConnectNative"));
      return;
    }

    // Demo mode: sync mock data to backend
    if (!patientId) return;
    setSyncing(true);
    const mock = getMockWeekData();
    let success = true;
    for (const day of mock) {
      const ok = await syncHealthToBackend(patientId, day);
      if (!ok) success = false;
    }

    if (success) {
      setConnectionStatus("connected");
      setWeekData(mock);
      setTodaySummary(mock[mock.length - 1]);
      toast.success(t("healthSyncSuccess"));
    } else {
      setConnectionStatus("sync_failed");
      toast.error(t("healthSyncFailed"));
    }
    setSyncing(false);
  };

  const handleDisconnect = () => {
    setConnectionStatus("not_connected");
    toast.success(t("healthDisconnected"));
  };

  const statusBadge = () => {
    const map: Record<HealthConnectionStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      connected: { label: t("healthConnected"), variant: "default" },
      not_connected: { label: t("healthNotConnected"), variant: "secondary" },
      permission_needed: { label: t("healthPermissionNeeded"), variant: "outline" },
      sync_failed: { label: t("healthSyncFailed"), variant: "destructive" },
    };
    const s = map[connectionStatus];
    return <Badge variant={s.variant}>{s.label}</Badge>;
  };

  const chartData = weekData.map((d) => ({
    day: new Date(d.date).toLocaleDateString("en-IN", { weekday: "short" }),
    steps: d.steps,
    sleep: Math.round(d.sleepMinutes / 60 * 10) / 10,
    calories: d.calories,
  }));

  if (loading) {
    return (
      <DashboardLayout>
        <div className="space-y-4 max-w-4xl">
          <Skeleton className="h-8 w-48" />
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28" />)}
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-4 sm:space-y-6 max-w-4xl w-full">
        {/* Header */}
        <motion.div {...fadeIn(0)} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
              <Activity className="w-6 h-6 text-primary" />
              {t("healthData")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">{t("healthSubtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => navigate("/health-reports")} title={t("reports")}>
              <BarChart3 className="w-4 h-4" />
            </Button>
            {statusBadge()}
            {connectionStatus === "connected" ? (
              <Button variant="outline" size="sm" onClick={handleDisconnect}>
                <WifiOff className="w-4 h-4 mr-1" /> {t("disconnect")}
              </Button>
            ) : (
              <Button variant="hero" size="sm" onClick={handleConnect} disabled={syncing}>
                {syncing ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : <Wifi className="w-4 h-4 mr-1" />}
                {syncing ? t("syncing") : t("connectHealthData")}
              </Button>
            )}
          </div>
        </motion.div>

        {/* Platform notice for web */}
        {!isNativeHealthAvailable() && (
          <motion.div {...fadeIn(1)}>
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="p-4 flex items-start gap-3">
                <Smartphone className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">{t("healthWebNotice")}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t("healthWebNoticeDesc")}</p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Today's Summary Cards */}
        {todaySummary && (
          <motion.div {...fadeIn(2)}>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Card>
                <CardContent className="p-4 text-center">
                  <Activity className="w-8 h-8 text-primary mx-auto mb-2" />
                  <p className="text-2xl font-bold">{todaySummary.steps.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">{t("stepsToday")}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <Moon className="w-8 h-8 text-indigo-500 mx-auto mb-2" />
                  <p className="text-2xl font-bold">{formatSleep(todaySummary.sleepMinutes)}</p>
                  <p className="text-xs text-muted-foreground">{t("sleepSummary")}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <Heart className="w-8 h-8 text-destructive mx-auto mb-2" />
                  <p className="text-2xl font-bold">{todaySummary.heartRateAvg ?? "--"}</p>
                  <p className="text-xs text-muted-foreground">{t("heartRate")}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <Flame className="w-8 h-8 text-orange-500 mx-auto mb-2" />
                  <p className="text-2xl font-bold">{todaySummary.calories.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">{t("calories")}</p>
                </CardContent>
              </Card>
            </div>
          </motion.div>
        )}

        {/* Last Synced */}
        {todaySummary?.syncedAt && (
          <motion.div {...fadeIn(3)} className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="w-3.5 h-3.5" />
            {t("lastSynced")}: {new Date(todaySummary.syncedAt).toLocaleString("en-IN")}
          </motion.div>
        )}

        {/* Weekly Steps Chart */}
        <motion.div {...fadeIn(4)}>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                {t("weeklyActivity")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="steps" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Weekly Sleep Chart */}
        <motion.div {...fadeIn(5)}>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Moon className="w-4 h-4 text-indigo-500" />
                {t("weeklySleep")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} unit="h" />
                    <Tooltip formatter={(v: number) => [`${v}h`, "Sleep"]} />
                    <Bar dataKey="sleep" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </DashboardLayout>
  );
};

export default Health;
