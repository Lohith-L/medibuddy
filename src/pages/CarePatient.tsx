import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity, BarChart3, CheckCircle2, ChevronRight, Clock, ClipboardList, Eye, LogOut, PencilLine, Phone, Pill, Timer, Upload, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useCare } from "@/contexts/CareContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { MISSED_DOSE_DELAYS, leavePatient, setMissedDoseDelay } from "@/lib/care";
import { fetchTodayStatus, type TodayStatus } from "@/lib/careStatus";

/** One patient, as their caregiver sees it. Always says whose data this is. */
const CarePatient = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { active, loading, refresh, setViewing } = useCare();
  const [today, setToday] = useState<TodayStatus | null>(null);
  const [week, setWeek] = useState<{ taken: number; missed: number } | null>(null);
  const [leaving, setLeaving] = useState(false);

  const other = !!active && !active.isSelf;

  useEffect(() => {
    if (!loading && !other) navigate("/care", { replace: true });
  }, [loading, other, navigate]);

  useEffect(() => {
    if (!active || active.isSelf) return;
    let cancelled = false;
    setToday(null);
    setWeek(null);
    (async () => {
      const since = new Date(Date.now() - 7 * 86400000).toISOString();
      const [status, { data: logs }] = await Promise.all([
        fetchTodayStatus(active.patientId, active.timezone, active.missedDoseDelay),
        supabase.from("medicine_logs").select("status").eq("patient_id", active.patientId).gte("scheduled_time", since),
      ]);
      if (cancelled) return;
      setToday(status);
      setWeek({
        taken: (logs ?? []).filter((l) => l.status === "taken").length,
        missed: (logs ?? []).filter((l) => l.status === "missed").length,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [active]);

  if (!active || active.isSelf) {
    return (
      <DashboardLayout>
        <Skeleton className="h-40 rounded-2xl max-w-3xl" />
      </DashboardLayout>
    );
  }

  const adherence = week && week.taken + week.missed > 0 ? Math.round((week.taken / (week.taken + week.missed)) * 100) : null;

  const changeDelay = async (m: number) => {
    try {
      await setMissedDoseDelay(active.patientId, m);
      await refresh();
      toast.success(t("care.delaySaved", { minutes: m }));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const leave = async () => {
    try {
      await leavePatient(active.patientId);
      setViewing(null);
      await refresh();
      toast.success(t("care.leftPatient", { name: active.name }));
      navigate("/care", { replace: true });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const links = [
    { icon: Pill, label: t("care.linkMedicines"), path: "/medicines" },
    { icon: ClipboardList, label: t("care.linkHistory"), path: "/log" },
    { icon: Activity, label: t("care.linkHealth"), path: "/health" },
    { icon: BarChart3, label: t("care.linkReports"), path: "/health-reports" },
    ...(active.canManage ? [{ icon: Upload, label: t("care.linkUpload"), path: "/upload" }] : []),
  ];

  const statusChip = (s: string) =>
    s === "taken"
      ? "bg-success/15 text-success"
      : s === "missed"
        ? "bg-destructive/15 text-destructive"
        : "bg-warning/15 text-warning";

  return (
    <DashboardLayout>
      <div className="max-w-3xl space-y-4">
        {/* Whose data */}
        <section className="bg-card border-2 border-primary/30 rounded-2xl p-4 shadow-card">
          <div className="flex items-center gap-3">
            <span className="w-14 h-14 rounded-full bg-primary text-primary-foreground text-2xl font-extrabold flex items-center justify-center shrink-0">
              {active.name.slice(0, 1).toUpperCase()}
            </span>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-extrabold truncate">{active.name}</h1>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                {active.canManage ? <PencilLine className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                {active.canManage ? t("care.canManage") : t("care.viewOnly")}
              </p>
            </div>
            {active.phone && (
              <Button variant="outline" size="sm" className="shrink-0" asChild>
                <a href={`tel:${active.phone}`}><Phone className="w-4 h-4" /> {t("care.call")}</a>
              </Button>
            )}
          </div>
          <div className="mt-3 flex items-center gap-2 text-sm">
            <Timer className="w-4 h-4 text-primary shrink-0" />
            <span>{t("care.alertedAfter", { minutes: active.missedDoseDelay })}</span>
          </div>
          {active.canManage && (
            <div className="grid grid-cols-5 gap-1.5 mt-2">
              {MISSED_DOSE_DELAYS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => m !== active.missedDoseDelay && void changeDelay(m)}
                  aria-pressed={active.missedDoseDelay === m}
                  className={`min-h-[40px] rounded-lg border text-xs font-semibold ${active.missedDoseDelay === m ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
                >
                  {t("care.minutesShort", { minutes: m })}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Today's doses */}
        <section className="bg-card border rounded-2xl p-4 shadow-card">
          <h2 className="font-bold text-lg mb-3">{t("care.todayDoses")}</h2>
          {!today ? (
            <div className="space-y-2">{[1, 2].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
          ) : today.doses.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("care.noDosesToday")}</p>
          ) : (
            <ul className="space-y-2">
              {today.doses.map((d) => (
                <li key={`${d.medicineId}-${d.time}`} className="flex items-center gap-3 rounded-xl bg-muted/40 p-3">
                  <span className="text-sm font-semibold w-12 shrink-0 flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{d.time}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-semibold truncate">{d.name}</span>
                    <span className="block text-xs text-muted-foreground truncate">{d.dosage}</span>
                  </span>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full shrink-0 flex items-center gap-1 ${statusChip(d.status)}`}>
                    {d.status === "taken" ? <CheckCircle2 className="w-3.5 h-3.5" /> : d.status === "missed" ? <XCircle className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                    {t(`care.${d.status}`)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Last 7 days */}
        <section className="bg-card border rounded-2xl p-4 shadow-card">
          <h2 className="font-bold mb-1">{t("care.adherenceTitle")}</h2>
          {week === null ? (
            <Skeleton className="h-8 rounded-lg" />
          ) : adherence === null ? (
            <p className="text-sm text-muted-foreground">{t("care.noHistory")}</p>
          ) : (
            <p className="text-sm">
              <span className="text-2xl font-extrabold mr-2">{adherence}%</span>
              {t("care.adherenceDetail", { taken: week.taken, missed: week.missed })}
            </p>
          )}
        </section>

        {/* More for this patient */}
        <section className="bg-card border rounded-2xl shadow-card divide-y">
          {links.map((l) => (
            <button key={l.path} onClick={() => navigate(l.path)} className="w-full min-h-[56px] flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50">
              <l.icon className="w-5 h-5 text-primary shrink-0" />
              <span className="flex-1 font-medium">{l.label}</span>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
          ))}
        </section>

        <Button variant="ghost" className="w-full text-destructive" onClick={() => setLeaving(true)}>
          <LogOut className="w-4 h-4" /> {t("care.stopCaring", { name: active.name })}
        </Button>
      </div>

      <AlertDialog open={leaving} onOpenChange={setLeaving}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("care.stopCaring", { name: active.name })}</AlertDialogTitle>
            <AlertDialogDescription>{t("care.stopCaringDesc", { name: active.name })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => void leave()}>
              {t("care.stop")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
};

export default CarePatient;
