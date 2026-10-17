import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Pill, Check, BarChart3, Bell, Upload, Clock, Users, Plus, CheckCircle2, XCircle, Hourglass, Store, MapPin } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import MedicineTrackingChart from "@/components/MedicineTrackingChart";
import SOSButton from "@/components/SOSButton";
import WeatherHealthCard from "@/components/WeatherHealthCard";
import AlarmSetupBanner from "@/components/AlarmSetupBanner";
import TodayDoseList from "@/components/TodayDoseList";
import { useTodaySchedule } from "@/hooks/useTodaySchedule";
import { nextDose } from "@/lib/todaySchedule";
import { useCare } from "@/contexts/CareContext";
import { useLanguage } from "@/contexts/LanguageContext";

const fadeIn = (i: number) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: i * 0.08, duration: 0.4 },
});

interface FamilyMemberBasic {
  id: string;
  full_name: string;
  relationship: string;
}

const Dashboard = () => {
  const navigate = useNavigate();
  const { t, tOr, locale } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [medicineCount, setMedicineCount] = useState(0);
  const [patientId, setPatientId] = useState<string | undefined>();
  const [familyMembers, setFamilyMembers] = useState<FamilyMemberBasic[]>([]);
  // Today's FULL schedule (from the medicines, merged with what was logged), live.
  const { me } = useCare();
  const { doses, loading: dosesLoading, markTaken, savingKey } = useTodaySchedule(
    patientId,
    me?.timezone ?? "Asia/Kolkata",
    me?.missedDoseDelay ?? 30,
  );

  useEffect(() => {
    const fetchData = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: patients } = await supabase
        .from("patients")
        .select("id")
        .eq("user_id", user.id)
        .limit(1);

      let pid: string | undefined = patients && patients.length > 0 ? patients[0].id : undefined;

      if (!pid) {
        // Fallback: Create patient record on demand if trigger was skipped
        const { data: newPatient } = await supabase
          .from("patients")
          .insert({
            user_id: user.id,
            name: user.user_metadata?.name || user.phone || user.email || "User",
            email: user.email || "",
            phone: user.phone || user.user_metadata?.phone || null,
            language: user.user_metadata?.language || "en",
          })
          .select("id")
          .maybeSingle();

        if (newPatient) {
          pid = newPatient.id;
        }
      }

      if (pid) {
        setPatientId(pid);
        const { count } = await supabase
          .from("medicines")
          .select("id", { count: "exact", head: true })
          .eq("patient_id", pid)
          .eq("is_active", true);
        setMedicineCount(count || 0);

        const { data: fm } = await supabase
          .from("family_members")
          .select("id, full_name, relationship")
          .eq("patient_id", pid)
          .eq("is_active", true)
          .limit(5);
        setFamilyMembers((fm as FamilyMemberBasic[]) || []);
      }
      setLoading(false);
    };
    fetchData();
  }, []);

  const nextUp = nextDose(doses);
  const takenToday = doses.filter((d) => d.status === "taken").length;
  const totalToday = doses.length;
  const fmtDoseTime = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return new Date(2000, 0, 1, h, m).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  };
  // The chart counts taken / missed / pending.
  const chartSchedule = doses.map((d) => ({ status: d.status === "taken" || d.status === "missed" ? d.status : "pending" }));

  const statCards = [
    { label: t("dash.totalMedicines"), value: medicineCount > 0 ? String(medicineCount) : "0", icon: Pill, color: "bg-success/15 text-success" },
    { label: t("dash.takenToday"), value: t("dash.xOfY", { x: takenToday, y: totalToday || medicineCount }), icon: Check, color: "bg-accent/15 text-accent-foreground" },
    { label: t("dash.weeklyAdherence"), value: "—", icon: BarChart3, color: "bg-success/15 text-success" },
    { label: t("dash.nextReminder"), value: nextUp ? fmtDoseTime(nextUp.time) : "—", sub: nextUp?.name, icon: Bell, color: "bg-warning/15 text-warning" },
  ];

  const statusPill = (status: string) => {
    const map: Record<string, string> = {
      taken: "bg-success/15 text-success",
      pending: "bg-warning/15 text-warning",
      missed: "bg-destructive/15 text-destructive",
      escalated: "bg-destructive/15 text-destructive",
      snoozed: "bg-primary/15 text-primary",
    };
    return map[status] || "";
  };

  const statusIcon = (status: string) => {
    if (status === "taken") return "✅";
    if (status === "missed" || status === "escalated") return "❌";
    return "⏳";
  };

  const getInitials = (name: string) => name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);

  const relColorMap: Record<string, string> = {
    Spouse: "bg-accent text-accent-foreground", Son: "bg-success text-success-foreground", Daughter: "bg-success text-success-foreground",
    Parent: "bg-warning text-warning-foreground", Doctor: "bg-primary text-primary-foreground",
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-6xl">
        {/* Android app: prompt to finish alarm permissions (renders nothing otherwise) */}
        <AlarmSetupBanner />

        {/* Weather & Health Tips Card */}
        <motion.div {...fadeIn(0)}>
          <WeatherHealthCard />
        </motion.div>

        {/* Emergency SOS Button Banner */}
        <motion.div {...fadeIn(0.1)}>
          <SOSButton variant="inline" />
        </motion.div>

        {/* Upload & Pharmacy Banners Row */}
        <div className="grid md:grid-cols-2 gap-4">
          <motion.div {...fadeIn(0.2)} className="rounded-2xl gradient-dark p-5 flex flex-col justify-between gap-4">
            <div>
              <p className="text-on-dark font-bold text-lg">{t("dash.uploadBannerTitle")}</p>
              <p className="text-on-dark/80 text-sm mt-1">{t("dash.uploadBannerDesc")}</p>
            </div>
            <Button variant="hero" size="default" className="w-full sm:w-auto self-start" onClick={() => navigate("/upload")}>
              <Upload className="w-4 h-4" /> {t("uploadPrescription")}
            </Button>
          </motion.div>

          <motion.div {...fadeIn(0.3)} className="rounded-2xl bg-card border-2 border-emerald-500/30 p-5 flex flex-col justify-between gap-4 shadow-card">
            <div>
              <div className="flex items-center gap-2 text-success font-extrabold text-sm uppercase tracking-wider mb-1">
                <Store className="w-4 h-4" /> {t("dash.refills")}
              </div>
              <p className="font-extrabold text-lg text-foreground">{t("dash.pharmacyBannerTitle")}</p>
              <p className="text-muted-foreground text-sm mt-1">{t("dash.pharmacyBannerDesc")}</p>
            </div>
            <Button variant="outline" size="default" className="w-full sm:w-auto self-start rounded-xl font-bold border-emerald-500/40 text-success hover:bg-emerald-50 dark:hover:bg-emerald-950/30" onClick={() => navigate("/pharmacies")}>
              <MapPin className="w-4 h-4 mr-2" /> {t("dash.findPharmacies")}
            </Button>
          </motion.div>
        </div>

        {/* Stats */}
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[1,2,3,4].map(i => <Skeleton key={i} className="h-28 rounded-2xl" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {statCards.map((s, i) => (
              <motion.div key={s.label} {...fadeIn(i + 1)} className="bg-card rounded-2xl border p-5 shadow-card hover:shadow-card-hover transition-shadow">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center mb-3 ${s.color}`}>
                  <s.icon className="w-5 h-5" />
                </div>
                <p className="text-2xl font-extrabold leading-tight">{s.value}</p>
                {s.sub && <p className="text-sm text-muted-foreground">{s.sub}</p>}
                <p className="text-sm text-muted-foreground">{s.label}</p>
              </motion.div>
            ))}
          </div>
        )}

        {/* Pie Chart + Family Card row */}
        <div className="grid lg:grid-cols-2 gap-6">
          <motion.div {...fadeIn(5)}>
            <MedicineTrackingChart schedule={chartSchedule} loading={loading || dosesLoading} />
          </motion.div>

          <motion.div {...fadeIn(6)} className="bg-card rounded-2xl border p-5 shadow-card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">{t("dash.familyTitle")}</h2>
              <Button variant="warm" size="sm" onClick={() => navigate("/family-alerts")}>
                <Plus className="w-4 h-4" /> {t("add")}
              </Button>
            </div>
            {familyMembers.length === 0 ? (
              <div className="text-center py-6">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <Users className="w-7 h-7 text-primary" />
                </div>
                <p className="font-semibold mb-1">{t("dash.noCaregivers")}</p>
                <p className="text-sm text-muted-foreground mb-4">{t("dash.noCaregiversDesc")}</p>
                <Button variant="hero" size="sm" onClick={() => navigate("/family-alerts")}>{t("dash.addCaregiver")}</Button>
              </div>
            ) : (
              <>
                <div className="flex -space-x-2 mb-3">
                  {familyMembers.slice(0, 3).map((m) => (
                    <div key={m.id} title={m.full_name} className={`w-11 h-11 rounded-full flex items-center justify-center text-xs font-bold border-2 border-card ${relColorMap[m.relationship] || "bg-muted text-foreground"}`}>
                      {getInitials(m.full_name)}
                    </div>
                  ))}
                  {familyMembers.length > 3 && (
                    <div className="w-11 h-11 rounded-full flex items-center justify-center text-xs font-bold bg-muted text-muted-foreground border-2 border-card">
                      +{familyMembers.length - 3}
                    </div>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mb-4">{t(familyMembers.length === 1 ? "dash.caregiverConnected" : "dash.caregiversConnected", { count: familyMembers.length })}</p>
                <div className="space-y-2">
                  {familyMembers.slice(0, 3).map((m) => (
                    <div key={m.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-muted/40">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold ${relColorMap[m.relationship] || "bg-muted text-foreground"}`}>
                        {getInitials(m.full_name)}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">{m.full_name}</p>
                        <p className="text-xs text-muted-foreground">{tOr(`rel.${m.relationship}`, m.relationship)}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <Button variant="ghost" className="w-full mt-3 text-primary" onClick={() => navigate("/family-alerts")}>
                  {t("viewAll")} →
                </Button>
              </>
            )}
          </motion.div>
        </div>

        {/* Schedule with Taken/Missed actions */}
        <motion.div {...fadeIn(7)} className="bg-card rounded-2xl border shadow-card">
          <div className="flex items-center justify-between p-5 pb-0">
            <h2 className="text-xl font-bold">{t("dash.todaySchedule")}</h2>
            <button className="text-sm font-semibold text-primary hover:underline" onClick={() => navigate("/log")}>{t("viewAll")}</button>
          </div>
          <div className="p-3 sm:p-5">
            <TodayDoseList doses={doses} loading={loading || dosesLoading} canManage onMarkTaken={markTaken} savingKey={savingKey} limit={6} />
          </div>
        </motion.div>
      </div>
    </DashboardLayout>
  );
};

export default Dashboard;
