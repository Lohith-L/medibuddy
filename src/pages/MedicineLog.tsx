import { CheckCircle2, Hourglass, XCircle, Calendar as CalendarIcon } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import TodayDoseList from "@/components/TodayDoseList";
import { useActivePatient } from "@/contexts/CareContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTodaySchedule } from "@/hooks/useTodaySchedule";

/**
 * "Today's medicine log": today's FULL schedule from the medicines (shown from
 * midnight, before any reminder has fired), merged with what was logged.
 * Shows me (patient interface) or the linked patient (caregiver interface).
 */
const MedicineLog = () => {
  const { t, locale } = useLanguage();
  const { active, loading: careLoading } = useActivePatient();
  const { doses, loading, markTaken, savingKey } = useTodaySchedule(
    active?.patientId,
    active?.timezone ?? "Asia/Kolkata",
    active?.missedDoseDelay ?? 30,
  );

  const taken = doses.filter((d) => d.status === "taken").length;
  const missed = doses.filter((d) => d.status === "missed").length;
  const pending = doses.length - taken - missed;
  const today = new Date().toLocaleDateString(locale, {
    weekday: "long", day: "numeric", month: "long", timeZone: active?.timezone ?? undefined,
  });

  return (
    <DashboardLayout>
      <div className="max-w-3xl space-y-5">
        <div>
          <h1 className="text-2xl font-extrabold">{t("log.title")}</h1>
          <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-1">
            <CalendarIcon className="w-4 h-4" /> {today}
          </p>
        </div>

        {doses.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-success/10 text-success text-sm font-semibold">
              <CheckCircle2 className="w-4 h-4" /> {t("log.countTaken", { count: taken })}
            </span>
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-warning/10 text-warning text-sm font-semibold">
              <Hourglass className="w-4 h-4" /> {t("log.countPending", { count: pending })}
            </span>
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-destructive/10 text-destructive text-sm font-semibold">
              <XCircle className="w-4 h-4" /> {t("log.countMissed", { count: missed })}
            </span>
          </div>
        )}

        <div className="bg-card rounded-2xl border p-3 sm:p-5 shadow-card">
          <TodayDoseList
            doses={doses}
            loading={loading || careLoading}
            canManage={!!active?.canManage}
            onMarkTaken={markTaken}
            savingKey={savingKey}
          />
        </div>
      </div>
    </DashboardLayout>
  );
};

export default MedicineLog;
