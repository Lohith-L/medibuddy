import { useNavigate } from "react-router-dom";
import { AlarmClock, CheckCircle2, Clock, Loader2, Pill, Upload, XCircle, Plus, BellRing } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLanguage } from "@/contexts/LanguageContext";
import { nextDose, type ScheduledDose } from "@/lib/todaySchedule";

interface Props {
  doses: ScheduledDose[];
  loading: boolean;
  /** Me, or a caregiver with 'manage': can mark doses and add medicines. */
  canManage: boolean;
  onMarkTaken: (dose: ScheduledDose) => Promise<boolean>;
  savingKey?: string | null;
  /** Show at most this many (Home); the full list is on the log page. */
  limit?: number;
}

const chip: Record<ScheduledDose["status"], string> = {
  upcoming: "bg-muted text-muted-foreground",
  due: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  taken: "bg-success/15 text-success",
  missed: "bg-destructive/15 text-destructive",
  snoozed: "bg-primary/15 text-primary",
};

/** Today's full schedule: next dose first, then everything in time order. */
const TodayDoseList = ({ doses, loading, canManage, onMarkTaken, savingKey, limit }: Props) => {
  const { t, locale } = useLanguage();
  const navigate = useNavigate();

  if (loading) {
    return <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>;
  }

  if (doses.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
          <Pill className="w-7 h-7 text-primary" />
        </div>
        <p className="font-semibold">{t("dose.noneToday")}</p>
        {canManage && (
          <div className="flex flex-wrap justify-center gap-2 mt-4">
            <Button variant="hero" size="sm" onClick={() => navigate("/upload")}>
              <Plus className="w-4 h-4" /> {t("dose.addMedicine")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/upload")}>
              <Upload className="w-4 h-4" /> {t("uploadPrescription")}
            </Button>
          </div>
        )}
      </div>
    );
  }

  const next = nextDose(doses);
  const ordered = next ? [next, ...doses.filter((d) => d.key !== next.key)] : doses;
  const shown = limit ? ordered.slice(0, limit) : ordered;

  const fmtTime = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return new Date(2000, 0, 1, h, m).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  };
  const fmtInstant = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });

  const label = (d: ScheduledDose) => {
    if (d.status === "taken") return d.takenAt ? t("dose.takenAt", { time: fmtInstant(d.takenAt) }) : t("dose.taken");
    return t(`dose.${d.status}`);
  };

  const mark = async (d: ScheduledDose) => {
    const ok = await onMarkTaken(d);
    if (ok) toast.success(t("dose.savedTaken", { name: d.name }));
    else toast.error(t("dose.saveFailed"));
  };

  return (
    <ul className="space-y-2.5">
      {shown.map((d) => {
        const isNext = next?.key === d.key;
        const canMark = canManage && (d.status === "due" || d.status === "missed" || d.status === "snoozed");
        return (
          <li
            key={d.key}
            className={`rounded-xl p-3 sm:p-4 flex items-center gap-3 ${
              isNext ? "border-2 border-primary bg-primary/5" : "bg-muted/40"
            }`}
          >
            <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-primary/10 flex items-center justify-center">
              {d.photoUrl ? <img src={d.photoUrl} alt="" className="w-full h-full object-cover" /> : <Pill className="w-5 h-5 text-primary" />}
            </div>
            <div className="flex-1 min-w-0">
              {isNext && (
                <p className="text-[11px] font-bold uppercase tracking-wide text-primary flex items-center gap-1">
                  <BellRing className="w-3.5 h-3.5" /> {t("dose.next")}
                </p>
              )}
              <p className="font-semibold text-sm sm:text-base truncate">
                {d.name}
                {d.dosage ? <span className="font-normal text-muted-foreground"> · {d.dosage}</span> : null}
              </p>
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                <Clock className="w-3.5 h-3.5 shrink-0" /> {fmtTime(d.time)}
                {d.instructions ? <span className="truncate"> · {d.instructions}</span> : null}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1 ${chip[d.status]}`}>
                {d.status === "taken" ? <CheckCircle2 className="w-3.5 h-3.5" /> : d.status === "missed" ? <XCircle className="w-3.5 h-3.5" /> : d.status === "due" ? <AlarmClock className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                {label(d)}
              </span>
              {canMark && (
                <button
                  type="button"
                  disabled={savingKey === d.key}
                  onClick={() => void mark(d)}
                  className="min-h-[36px] flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-success/15 text-success hover:bg-success/25 disabled:opacity-50"
                >
                  {savingKey === d.key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  {t("dose.markTaken")}
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
};

export default TodayDoseList;
