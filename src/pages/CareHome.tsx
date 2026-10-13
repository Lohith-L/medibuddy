import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Activity, CheckCircle2, ChevronRight, Clock, Eye, HeartHandshake, Loader2, PencilLine, Timer, UserPlus, XCircle } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import CaregiverAlertSetupCard from "@/components/CaregiverAlertSetupCard";
import { Button } from "@/components/ui/button";
import { useCare } from "@/contexts/CareContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { fetchTodayStatus, type TodayStatus } from "@/lib/careStatus";
import { fetchLastSyncedAt } from "@/lib/healthService";

interface Row {
  status: TodayStatus | null;
  lastSync: string | null;
}

/** Caregiver home: everyone I look after, with today's doses at a glance. */
const CareHome = () => {
  const { t, locale } = useLanguage();
  const navigate = useNavigate();
  const { linked, loading, setViewing, refresh } = useCare();
  const [rows, setRows] = useState<Record<string, Row>>({});

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        linked.map(async (p) => {
          const [status, lastSync] = await Promise.all([
            fetchTodayStatus(p.patientId, p.timezone, p.missedDoseDelay).catch(() => null),
            fetchLastSyncedAt(p.patientId).catch(() => null),
          ]);
          return [p.patientId, { status, lastSync }] as const;
        }),
      );
      if (!cancelled) setRows(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [linked]);

  const open = (patientId: string) => {
    setViewing(patientId);
    navigate("/care/patient");
  };

  const fmtSync = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(locale, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : t("care.neverSynced");

  return (
    <DashboardLayout>
      <div className="max-w-3xl space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold flex items-center gap-2">
              <HeartHandshake className="w-6 h-6 text-primary shrink-0" /> {t("care.homeTitle")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">{t("care.homeSubtitle")}</p>
          </div>
          <Button variant="hero" size="sm" className="shrink-0" onClick={() => navigate("/care/add")}>
            <UserPlus className="w-4 h-4" /> {t("care.addPatient")}
          </Button>
        </div>

        {!loading && linked.length > 0 && <CaregiverAlertSetupCard dismissible />}

        {loading ? (
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        ) : linked.length === 0 ? (
          <div className="bg-card border rounded-2xl p-8 text-center shadow-card">
            <HeartHandshake className="w-10 h-10 text-primary mx-auto mb-3" />
            <p className="font-bold text-lg">{t("care.noPatients")}</p>
            <p className="text-sm text-muted-foreground mt-1 mb-4">{t("care.noPatientsDesc")}</p>
            <Button variant="hero" size="lg" className="w-full sm:w-auto min-h-[56px] text-base" onClick={() => navigate("/care/add")}>
              <UserPlus className="w-5 h-5" /> {t("care.addPatientBig")}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {linked.map((p) => {
              const row = rows[p.patientId];
              const s = row?.status;
              return (
                <button
                  key={p.patientId}
                  onClick={() => open(p.patientId)}
                  className="w-full text-left bg-card border rounded-2xl p-4 shadow-card hover:shadow-card-hover transition-shadow"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-12 h-12 rounded-full bg-primary/10 text-primary text-lg font-bold flex items-center justify-center shrink-0">
                      {p.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-lg truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
                        {p.permission === "manage" ? <PencilLine className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        {p.permission === "manage" ? t("care.canManage") : t("care.viewOnly")}
                        {p.relationship ? ` · ${t(`care.rel.${p.relationship}`)}` : ""}
                      </p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
                  </div>

                  <div className="grid grid-cols-3 gap-2 mt-3">
                    <div className="rounded-xl bg-success/10 text-success p-2 text-center">
                      <CheckCircle2 className="w-4 h-4 mx-auto" />
                      <p className="text-lg font-extrabold leading-tight">{s ? s.taken : "–"}</p>
                      <p className="text-[11px]">{t("care.taken")}</p>
                    </div>
                    <div className={`rounded-xl p-2 text-center ${s && s.missed > 0 ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground"}`}>
                      <XCircle className="w-4 h-4 mx-auto" />
                      <p className="text-lg font-extrabold leading-tight">{s ? s.missed : "–"}</p>
                      <p className="text-[11px]">{t("care.missed")}</p>
                    </div>
                    <div className="rounded-xl bg-warning/10 text-warning p-2 text-center">
                      <Clock className="w-4 h-4 mx-auto" />
                      <p className="text-lg font-extrabold leading-tight">{s ? s.upcoming : "–"}</p>
                      <p className="text-[11px]">{t("care.upcoming")}</p>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Activity className="w-3.5 h-3.5" /> {t("care.lastHealthSync", { time: fmtSync(row?.lastSync ?? null) })}</span>
                    <span className="flex items-center gap-1"><Timer className="w-3.5 h-3.5" /> {t("care.alertedAfter", { minutes: p.missedDoseDelay })}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default CareHome;
