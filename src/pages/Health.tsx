import { useCallback, useEffect, useRef, useState } from "react";
import { useActivePatient } from "@/contexts/CareContext";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { App } from "@capacitor/app";
import type { HealthDataType } from "@capgo/capacitor-health";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useLanguage } from "@/contexts/LanguageContext";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Activity, Moon, Heart, Flame, RefreshCw, Wifi, WifiOff, Smartphone, TrendingUp,
  Clock, BarChart3, Info, ShieldAlert, Footprints, Download, ArrowDown,
} from "lucide-react";
import {
  type HealthConnectState, type HealthSummary, type StepSensorStatus,
  isNativeAndroid, isHealthEnabled, setHealthEnabled, getHealthConnectState,
  getGrantedTypes, requestHealthConnectPermissions, revokeHealthConnect,
  openHealthConnectInPlayStore, openHealthConnectSettings, getStepSensorStatus,
  requestActivityPermission, setStepSensorEnabled, readDeviceHealth,
  syncHealthToBackend, fetchHealthData, fetchLastSyncedAt, fillWeek,
  getMockWeekData, formatSleep, localDateKey, PHONE_HC_SOURCE,
} from "@/lib/healthService";
import { HEALTH_SYNCED_EVENT } from "@/hooks/useHealthAutoSync";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useChartTheme } from "@/lib/chartTheme";
import HealthDebugPanel from "@/components/HealthDebugPanel";

const fadeIn = (i: number) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: i * 0.06 },
});

type Status = "not_connected" | "permission_needed" | "connected" | "sync_failed";
type Dialog = null | "install" | "update" | "activity" | "disconnect";

const PULL_TRIGGER = 70;
const NO_SENSOR: StepSensorStatus = { available: false, permission: "denied" };

const Health = () => {
  const navigate = useNavigate();
  const { t, locale } = useLanguage();
  const chart = useChartTheme();
  // Me, or the patient I'm viewing as a caregiver. Phone (Health Connect) features
  // only apply to my own data: a caregiver sees the patient's synced data.
  const { active, loading: careLoading } = useActivePatient();
  const { user } = useAuth();
  const userId = user?.id;
  const viewingOther = !!active && !active.isSelf;
  const native = isNativeAndroid() && !viewingOther;

  const [loading, setLoading] = useState(true);
  const [patientId, setPatientId] = useState<string | null>(null);
  const [week, setWeek] = useState<HealthSummary[]>([]);
  const [demo, setDemo] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(native && isHealthEnabled());
  const [hcState, setHcState] = useState<HealthConnectState>("unsupported");
  const [granted, setGranted] = useState<HealthDataType[]>([]);
  const [sensor, setSensor] = useState<StepSensorStatus>(NO_SENSOR);
  const [syncFailed, setSyncFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [denied, setDenied] = useState(false); // the user allowed nothing on Connect
  const activityAnswer = useRef<((ok: boolean) => void) | null>(null);

  // ── Loading ────────────────────────────────────────────────────────────

  /** Supabase data (website, or the phone when not connected). Demo only if never synced. */
  const loadFromServer = useCallback(async (pid: string, other = false) => {
    const [rows, last] = await Promise.all([fetchHealthData(pid, 7), fetchLastSyncedAt(pid)]);
    setLastSyncedAt(last);
    if (last || other) {
      // Never show demo numbers as if they were another person's data.
      setWeek(fillWeek(rows));
      setDemo(false);
    } else {
      setWeek(getMockWeekData());
      setDemo(true);
    }
  }, []);

  const refreshNativeStatus = useCallback(async () => {
    if (!native) return { state: "unsupported" as HealthConnectState, types: [] as HealthDataType[], sensorStatus: NO_SENSOR };
    const [state, sensorStatus] = await Promise.all([getHealthConnectState(), getStepSensorStatus()]);
    const types = state === "available" ? await getGrantedTypes() : [];
    setHcState(state);
    setGranted(types);
    setSensor(sensorStatus);
    return { state, types, sensorStatus };
  }, [native]);

  /** Reads the phone, shows it immediately, then upserts it to Supabase. */
  const syncNow = useCallback(
    async (pid: string, types?: HealthDataType[], quiet = false) => {
      const result = await readDeviceHealth(types ?? (await getGrantedTypes()));
      if (result.failed) {
        // Health Connect refused (e.g. app in background): keep showing the synced data.
        await loadFromServer(pid);
        setSyncFailed(true);
        if (!quiet) toast.error(t("health.syncFailedRetry"));
        return result;
      }
      if (!result.hasAnyData) {
        // Nothing readable right now (e.g. access removed): show what was synced before.
        await loadFromServer(pid);
        return result;
      }
      setWeek(result.days);
      setDemo(false);
      const syncedAt = await syncHealthToBackend(pid, result.days);
      if (syncedAt) {
        setLastSyncedAt(syncedAt);
        setSyncFailed(false);
        if (!quiet) toast.success(t("healthSyncSuccess"));
      } else {
        setSyncFailed(true);
        if (!quiet) toast.error(t("health.syncFailedRetry"));
      }
      return result;
    },
    [t, loadFromServer],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Signed out: ProtectedRoute redirects.
      if (careLoading || !userId) return;
      setLoading(true);
      if (viewingOther && active) {
        setPatientId(active.patientId);
        await loadFromServer(active.patientId, true);
        if (!cancelled) setLoading(false);
        return;
      }
      const { data: patient } = await supabase
        .from("patients").select("id").eq("user_id", userId).maybeSingle();
      if (cancelled) return;
      if (!patient) { setLoading(false); return; }
      setPatientId(patient.id);

      if (native && isHealthEnabled()) {
        const { types } = await refreshNativeStatus();
        const last = await fetchLastSyncedAt(patient.id);
        if (cancelled) return;
        setLastSyncedAt(last);
        setLoading(false);
        await syncNow(patient.id, types, true); // page open
      } else {
        if (native) await refreshNativeStatus();
        await loadFromServer(patient.id);
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, careLoading, active?.patientId]);

  // Background (app foreground) syncs refresh the page; returning from Health Connect re-checks access.
  useEffect(() => {
    if (!native) return;
    const onSynced = (e: Event) => {
      const detail = (e as CustomEvent).detail as { syncedAt: string; result: { days: HealthSummary[] } };
      setWeek(detail.result.days);
      setLastSyncedAt(detail.syncedAt);
      setSyncFailed(false);
      setDemo(false);
    };
    window.addEventListener(HEALTH_SYNCED_EVENT, onSynced);
    const handle = App.addListener("resume", () => void refreshNativeStatus());
    return () => {
      window.removeEventListener(HEALTH_SYNCED_EVENT, onSynced);
      void handle.then((h) => h.remove());
    };
  }, [native, refreshNativeStatus]);

  // ── Connect / disconnect ───────────────────────────────────────────────

  /** Explains the Physical activity permission first, then asks Android. */
  const askActivityPermission = (): Promise<boolean> =>
    new Promise((resolve) => {
      activityAnswer.current = resolve;
      setDialog("activity");
    });

  const answerActivity = async (proceed: boolean) => {
    setDialog(null);
    const resolve = activityAnswer.current;
    activityAnswer.current = null;
    if (!proceed) return resolve?.(false);
    let ok = false;
    try {
      ok = await requestActivityPermission();
    } catch {
      ok = false;
    }
    if (!ok) toast.error(t("health.activityDenied"), { duration: 7000 });
    setSensor(await getStepSensorStatus());
    resolve?.(ok);
  };

  /** Turns syncing on and pulls the first data. */
  const finishConnect = async (types: HealthDataType[]) => {
    if (!patientId) return;
    setHealthEnabled(true);
    setEnabled(true);
    setDenied(false);
    await setStepSensorEnabled(true);
    const result = await syncNow(patientId, types, true);
    if (result.hasAnyData) toast.success(t("healthSyncSuccess"));
    else toast.info(t("health.noDataYet"));
  };

  /** Phone step counter only (no Health Connect, or the user chose it). */
  const connectSensorOnly = async () => {
    setDialog(null);
    const status = await getStepSensorStatus();
    setSensor(status);
    if (!status.available) {
      toast.error(t("health.noStepSensor"));
      return;
    }
    setBusy(true);
    try {
      const ok = status.permission === "granted" || (await askActivityPermission());
      if (ok) await finishConnect([]);
    } finally {
      setBusy(false);
    }
  };

  const handleConnect = async () => {
    if (!native || !patientId) return;
    setBusy(true);
    try {
      const { state, sensorStatus } = await refreshNativeStatus();
      if (state === "needs_install" || state === "needs_update") {
        setDialog(state === "needs_install" ? "install" : "update");
        return;
      }

      let types: HealthDataType[] = [];
      if (state === "available") {
        try {
          types = await requestHealthConnectPermissions();
        } catch (e) {
          console.warn("[health] permission request failed", e);
        }
        setGranted(types);
      }

      // Phone step counter when Health Connect can't give steps (not allowed, or no step data).
      let needSensor = !types.includes("steps");
      if (!needSensor) {
        const probe = await readDeviceHealth(types);
        needSensor = !probe.days.some((d) => d.stepsSource === "health_connect");
      }
      if (needSensor && sensorStatus.available && sensorStatus.permission !== "granted") {
        await askActivityPermission();
      }

      const sensorNow = await getStepSensorStatus();
      setSensor(sensorNow);
      if (types.length === 0 && sensorNow.permission !== "granted") {
        // Nothing allowed: the denied card explains how to turn it on.
        setDenied(true);
        return;
      }
      setDenied(false);
      await finishConnect(types);
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setDialog(null);
    setBusy(true);
    try {
      await revokeHealthConnect();
      await setStepSensorEnabled(false);
      setHealthEnabled(false);
      setEnabled(false);
      setGranted([]);
      setSyncFailed(false);
      if (patientId) await loadFromServer(patientId);
      toast.success(t("healthDisconnected"));
    } finally {
      setBusy(false);
    }
  };

  // ── Pull to refresh ────────────────────────────────────────────────────

  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!patientId || refreshing) return;
    setRefreshing(true);
    try {
      if (native && enabled) {
        const { types } = await refreshNativeStatus();
        await syncNow(patientId, types, true);
      } else {
        await loadFromServer(patientId, viewingOther);
      }
    } finally {
      setRefreshing(false);
    }
  }, [patientId, refreshing, native, enabled, refreshNativeStatus, syncNow, loadFromServer, viewingOther]);

  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      startY.current = window.scrollY <= 0 ? e.touches[0].clientY : null;
    };
    const onMove = (e: TouchEvent) => {
      if (startY.current == null) return;
      const dy = e.touches[0].clientY - startY.current;
      setPull(dy > 0 ? Math.min(dy * 0.5, 110) : 0);
    };
    const onEnd = () => {
      if (startY.current == null) return;
      startY.current = null;
      setPull((p) => {
        if (p >= PULL_TRIGGER) void refresh();
        return 0;
      });
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
  }, [refresh]);

  // ── Derived view state ─────────────────────────────────────────────────

  const sensorGranted = sensor.available && sensor.permission === "granted";
  const status: Status = !enabled
    ? denied ? "permission_needed" : "not_connected"
    : syncFailed
      ? "sync_failed"
      : granted.length === 0 && !sensorGranted
        ? "permission_needed"
        : "connected";
  const showDenied = native && hcState === "available" && granted.length === 0 && status === "permission_needed";

  const todayKey = localDateKey(new Date());
  const today = week.find((d) => d.date === todayKey) ?? null;
  const fmtNum = (n: number) => n.toLocaleString(locale);
  const sleepText = (m: number) => formatSleep(m, t("health.hoursShort"), t("health.minutesShort"));

  const stepsSourceLabel = (d: HealthSummary | null) => {
    if (!d || demo || !d.stepsSource || d.steps <= 0) return null;
    if (d.stepsSource === "phone_sensor") return t("health.sourcePhoneSensor");
    if (d.stepsSourceName === PHONE_HC_SOURCE) return t("health.sourcePhoneHC");
    return d.stepsSourceName || t("health.sourceHealthConnect");
  };

  const chartData = week.map((d) => {
    const [y, m, dd] = d.date.split("-").map(Number);
    return {
      day: new Date(y, m - 1, dd).toLocaleDateString(locale, { weekday: "short" }),
      steps: d.steps,
      sleep: d.sleepMinutes ? Math.round((d.sleepMinutes / 60) * 10) / 10 : 0,
    };
  });

  const statusBadge = () => {
    const map: Record<Status, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      connected: { label: t("healthConnected"), variant: "default" },
      not_connected: { label: t("healthNotConnected"), variant: "secondary" },
      permission_needed: { label: t("healthPermissionNeeded"), variant: "outline" },
      sync_failed: { label: t("healthSyncFailed"), variant: "destructive" },
    };
    const s = map[status];
    return <Badge variant={s.variant} className="whitespace-nowrap">{s.label}</Badge>;
  };

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

  const stepsSrc = stepsSourceLabel(today);
  const real = !demo;

  return (
    <DashboardLayout>
      {/* Pull-to-refresh indicator */}
      <div
        className="flex items-center justify-center overflow-hidden text-xs text-muted-foreground transition-[height] duration-150"
        style={{ height: refreshing ? 36 : pull * 0.5 }}
        aria-live="polite"
      >
        {refreshing ? (
          <span className="flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5 animate-spin" />{t("syncing")}</span>
        ) : pull > 0 ? (
          <span className="flex items-center gap-1.5">
            <ArrowDown className={`w-3.5 h-3.5 transition-transform ${pull >= PULL_TRIGGER ? "rotate-180" : ""}`} />
            {pull >= PULL_TRIGGER ? t("health.releaseToRefresh") : t("health.pullToRefresh")}
          </span>
        ) : null}
      </div>

      <div className="space-y-4 sm:space-y-6 max-w-4xl w-full">
        {/* Header */}
        <motion.div {...fadeIn(0)} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
              <Activity className="w-6 h-6 text-primary shrink-0" />
              {viewingOther && active ? t("care.healthOf", { name: active.name }) : t("healthData")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">{t("healthSubtitle")}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => navigate("/health-reports")} title={t("reports")} aria-label={t("reports")}>
              <BarChart3 className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => void refresh()} disabled={refreshing} title={t("health.refresh")} aria-label={t("health.refresh")}>
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
            {native && statusBadge()}
            {native &&
              (enabled ? (
                <Button variant="outline" size="sm" onClick={() => setDialog("disconnect")} disabled={busy}>
                  <WifiOff className="w-4 h-4 mr-1" /> {t("disconnect")}
                </Button>
              ) : (
                <Button variant="hero" size="sm" onClick={() => void handleConnect()} disabled={busy}>
                  {busy ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : <Wifi className="w-4 h-4 mr-1" />}
                  {busy ? t("syncing") : t("connectHealthData")}
                </Button>
              ))}
          </div>
        </motion.div>

        {/* Demo notice: only when this account has never synced */}
        {demo && (
          <motion.div {...fadeIn(1)}>
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="p-4 flex items-start gap-3">
                <Smartphone className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-[10px]">{t("health.demoBadge")}</Badge>
                    {native ? t("health.connectPrompt") : t("healthWebNotice")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">{native ? t("health.demoDescNative") : t("health.demoDescWeb")}</p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Health Connect permission denied */}
        {showDenied && (
          <motion.div {...fadeIn(1)}>
            <Card className="border-amber-500/40 bg-amber-500/5">
              <CardContent className="p-4 flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-warning mt-0.5 shrink-0" />
                <div className="min-w-0 space-y-2">
                  <p className="text-sm font-medium">{t("health.deniedTitle")}</p>
                  <p className="text-xs text-muted-foreground">{t("health.deniedDesc")}</p>
                  <ol className="text-xs text-muted-foreground list-decimal pl-4 space-y-0.5">
                    <li>{t("health.deniedStep1")}</li>
                    <li>{t("health.deniedStep2")}</li>
                    <li>{t("health.deniedStep3")}</li>
                  </ol>
                  <div className="flex gap-2 flex-wrap pt-1">
                    <Button size="sm" variant="outline" onClick={() => void openHealthConnectSettings()}>
                      {t("health.openHealthConnect")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void handleConnect()} disabled={busy}>
                      {t("health.tryAgain")}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Today's summary */}
        {today && (
          <motion.div {...fadeIn(2)}>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <MetricCard
                icon={<Footprints className="w-7 h-7 text-primary" />}
                value={real && today.steps <= 0 ? null : fmtNum(today.steps)}
                label={t("stepsToday")}
                sub={stepsSrc ? t("health.sourceLabel", { source: stepsSrc }) : null}
                empty={t("health.noSteps")}
              />
              <MetricCard
                icon={<Moon className="w-7 h-7 text-indigo-500" />}
                value={today.sleepMinutes ? sleepText(today.sleepMinutes) : null}
                label={t("health.lastNight")}
                empty={t("health.noSleep")}
              />
              <MetricCard
                icon={<Heart className="w-7 h-7 text-destructive" />}
                value={(today.heartRateLatest ?? today.heartRateAvg) != null ? `${today.heartRateLatest ?? today.heartRateAvg} ${t("health.bpm")}` : null}
                label={today.heartRateLatest != null ? t("health.hrLatest") : t("heartRate")}
                sub={today.heartRateAvg != null ? t("health.hrAvg", { bpm: today.heartRateAvg }) : null}
                empty={t("health.noHeartRate")}
              />
              <MetricCard
                icon={<Flame className="w-7 h-7 text-orange-500" />}
                value={(today.caloriesTotal ?? today.caloriesActive) != null ? `${fmtNum((today.caloriesTotal ?? today.caloriesActive)!)} ${t("health.kcal")}` : null}
                label={today.caloriesTotal != null ? t("health.caloriesTotal") : t("health.caloriesActiveLabel")}
                sub={today.caloriesTotal != null && today.caloriesActive != null ? t("health.caloriesActive", { kcal: fmtNum(today.caloriesActive) }) : null}
                empty={t("health.noCalories")}
              />
            </div>
          </motion.div>
        )}

        {/* Last synced */}
        {real && (
          <motion.div {...fadeIn(3)} className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="w-3.5 h-3.5 shrink-0" />
            {lastSyncedAt
              ? `${t("lastSynced")}: ${new Date(lastSyncedAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })}`
              : t("health.notSyncedYet")}
            {syncFailed && <span className="text-destructive">· {t("health.syncFailedRetry")}</span>}
          </motion.div>
        )}

        {/* Where steps come from */}
        <motion.div {...fadeIn(3)}>
          <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            <Info className="w-4 h-4 shrink-0 mt-0.5 text-primary" />
            <p>{t("health.stepsTip")}</p>
          </div>
        </motion.div>

        {/* TEMPORARY: which app writes which records (remove once syncing is sorted) */}
        {native && <HealthDebugPanel />}

        {/* Weekly steps */}
        <motion.div {...fadeIn(4)}>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                {t("weeklyActivity")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {real && week.every((d) => d.steps <= 0) ? (
                <p className="h-24 flex items-center justify-center text-center text-sm text-muted-foreground">{t("health.noStepsWeek")}</p>
              ) : (
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                      <XAxis dataKey="day" {...chart.axisProps} interval={0} />
                      <YAxis {...chart.axisProps} width={40} tickFormatter={(v: number) => v.toLocaleString(locale)} />
                      <Tooltip {...chart.tooltip} formatter={(v: number) => [v.toLocaleString(locale), t("health.chartSteps")]} />
                      <Bar dataKey="steps" fill={chart.primary} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Weekly sleep */}
        <motion.div {...fadeIn(5)}>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Moon className="w-4 h-4 text-indigo-500" />
                {t("weeklySleep")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {real && week.every((d) => !d.sleepMinutes) ? (
                <p className="h-24 flex items-center justify-center text-center text-sm text-muted-foreground px-2">{t("health.noSleep")}</p>
              ) : (
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                      <XAxis dataKey="day" {...chart.axisProps} interval={0} />
                      <YAxis {...chart.axisProps} width={40} unit={t("health.hoursShort")} />
                      <Tooltip {...chart.tooltip} formatter={(v: number) => [`${v.toLocaleString(locale)}${t("health.hoursShort")}`, t("health.chartSleep")]} />
                      <Bar dataKey="sleep" fill={chart.sleep} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Install / update Health Connect */}
      <AlertDialog open={dialog === "install" || dialog === "update"} onOpenChange={(o) => !o && setDialog(null)}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Download className="w-5 h-5 text-primary" />
              {dialog === "update" ? t("health.updateTitle") : t("health.installTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>{dialog === "update" ? t("health.updateDesc") : t("health.installDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            {sensor.available && (
              <Button variant="ghost" onClick={() => void connectSensorOnly()}>{t("health.useSensorOnly")}</Button>
            )}
            <AlertDialogAction onClick={() => { setDialog(null); openHealthConnectInPlayStore(); }}>
              {t("health.openPlayStore")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Physical activity permission: explained before Android asks */}
      <AlertDialog open={dialog === "activity"} onOpenChange={(o) => { if (!o && dialog === "activity") void answerActivity(false); }}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Footprints className="w-5 h-5 text-primary" />
              {t("health.activityTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("health.activityDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel onClick={() => void answerActivity(false)}>{t("health.activitySkip")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void answerActivity(true)}>{t("health.activityAllow")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Disconnect */}
      <AlertDialog open={dialog === "disconnect"} onOpenChange={(o) => !o && setDialog(null)}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("health.disconnectTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("health.disconnectDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => void handleDisconnect()}>
              {t("disconnect")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
};

/** One summary card; shows a short hint instead of the number when there is no data. */
const MetricCard = ({
  icon, value, label, sub, empty,
}: { icon: React.ReactNode; value: string | null; label: string; sub?: string | null; empty: string }) => (
  <Card className="min-w-0">
    <CardContent className="p-3 sm:p-4 text-center flex flex-col items-center gap-1">
      {icon}
      {value != null ? (
        <p className="text-xl sm:text-2xl font-bold leading-tight break-words">{value}</p>
      ) : (
        <p className="text-base font-semibold text-muted-foreground">--</p>
      )}
      <p className="text-xs text-muted-foreground">{label}</p>
      {value != null && sub && <p className="text-[11px] text-muted-foreground/90 leading-snug">{sub}</p>}
      {value == null && <p className="text-[11px] text-muted-foreground leading-snug">{empty}</p>}
    </CardContent>
  </Card>
);

export default Health;
