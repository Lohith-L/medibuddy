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

const fadeIn = (i: number) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: i * 0.08, duration: 0.4 },
});

interface ReminderEvent {
  id: string;
  medicine_id: string;
  medicineName: string;
  dosage: string;
  instructions: string | null;
  scheduled_time: string;
  status: string;
}

interface ScheduleItem {
  logId: string;
  medicineName: string;
  dosage: string;
  instructions: string | null;
  time: string;
  status: string;
  reminderEventId?: string;
  photoUrl?: string | null;
}

interface FamilyMemberBasic {
  id: string;
  full_name: string;
  relationship: string;
}

const Dashboard = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [medicineCount, setMedicineCount] = useState(0);
  const [patientId, setPatientId] = useState<string | undefined>();
  const [familyMembers, setFamilyMembers] = useState<FamilyMemberBasic[]>([]);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [reminderEvents, setReminderEvents] = useState<ReminderEvent[]>([]);
  const [takenToday, setTakenToday] = useState(0);
  const [totalToday, setTotalToday] = useState(0);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const fetchSchedule = async (pid: string) => {
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();
    const todayDate = today.toISOString().split("T")[0];

    // Fetch reminder_events for today
    const { data: events } = await supabase
      .from("reminder_events")
      .select("id, medicine_id, scheduled_time, status")
      .eq("patient_id", pid)
      .eq("scheduled_date", todayDate)
      .order("scheduled_time", { ascending: true });

    // Fetch medicine_logs for today
    const { data: logs } = await supabase
      .from("medicine_logs")
      .select("id, status, scheduled_time, medicine_id")
      .eq("patient_id", pid)
      .gte("scheduled_time", startOfDay)
      .lt("scheduled_time", endOfDay)
      .order("scheduled_time", { ascending: true });

    // Merge: prefer reminder_events if they exist, else use medicine_logs, else use medicines
    const hasEvents = events && events.length > 0;
    const hasLogs = logs && logs.length > 0;

    if (!hasEvents && !hasLogs) {
      // Build from medicines reminder_times
      const { data: meds } = await supabase
        .from("medicines")
        .select("id, name, dosage, instructions, reminder_times, medicine_photo_url")
        .eq("patient_id", pid)
        .eq("is_active", true);

      if (meds && meds.length > 0) {
        const items: ScheduleItem[] = [];
        for (const med of meds) {
          for (const t of med.reminder_times || []) {
            items.push({
              logId: "",
              medicineName: med.name,
              dosage: med.dosage,
              instructions: med.instructions,
              time: t,
              status: "pending",
              photoUrl: (med as any).medicine_photo_url || null,
            });
          }
        }
        items.sort((a, b) => a.time.localeCompare(b.time));
        setSchedule(items);
        setTotalToday(items.length);
        setTakenToday(0);
      }
      return;
    }

    // Get all medicine IDs involved
    const allMedIds = new Set<string>();
    (events || []).forEach((e: any) => allMedIds.add(e.medicine_id));
    (logs || []).forEach((l: any) => allMedIds.add(l.medicine_id));

    const { data: meds } = await supabase
      .from("medicines")
      .select("id, name, dosage, instructions, medicine_photo_url")
      .in("id", [...allMedIds]);

    const medMap = new Map((meds || []).map((m) => [m.id, m]));

    // Build schedule from reminder_events if available, else from logs
    if (hasEvents) {
      const evtItems: ReminderEvent[] = (events || []).map((e: any) => {
        const med = medMap.get(e.medicine_id);
        return {
          id: e.id,
          medicine_id: e.medicine_id,
          medicineName: med?.name || "Unknown",
          dosage: med?.dosage || "",
          instructions: med?.instructions || null,
          scheduled_time: e.scheduled_time,
          status: e.status,
        };
      });
      setReminderEvents(evtItems);

      const items: ScheduleItem[] = evtItems.map((e) => {
        const med = medMap.get(e.medicine_id);
        return {
          logId: "",
          medicineName: e.medicineName,
          dosage: e.dosage,
          instructions: e.instructions,
          time: e.scheduled_time,
          status: e.status,
          reminderEventId: e.id,
          photoUrl: (med as any)?.medicine_photo_url || null,
        };
      });
      setSchedule(items);
      setTotalToday(items.length);
      setTakenToday(items.filter((i) => i.status === "taken").length);
    } else {
      const items: ScheduleItem[] = (logs || []).map((l: any) => {
        const med = medMap.get(l.medicine_id);
        const dt = new Date(l.scheduled_time);
        return {
          logId: l.id,
          medicineName: med?.name || "Unknown",
          dosage: med?.dosage || "",
          instructions: med?.instructions || null,
          time: dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }),
          status: l.status,
          photoUrl: (med as any)?.medicine_photo_url || null,
        };
      });
      setSchedule(items);
      setTotalToday(items.length);
      setTakenToday(items.filter((i) => i.status === "taken").length);
    }
  };

  const markTaken = async (item: ScheduleItem) => {
    const id = item.reminderEventId || item.logId;
    if (!id) {
      toast.error("No trackable entry for this dose");
      return;
    }
    setUpdatingId(id);

    if (item.reminderEventId) {
      // Update reminder_event
      const { error } = await supabase
        .from("reminder_events")
        .update({ status: "taken", taken_at: new Date().toISOString() })
        .eq("id", item.reminderEventId);

      if (error) { toast.error("Failed to update"); setUpdatingId(null); return; }
    }

    if (item.logId) {
      await supabase
        .from("medicine_logs")
        .update({ status: "taken", taken_at: new Date().toISOString() })
        .eq("id", item.logId);
    }

    toast.success("Marked as Taken! ✅");
    if (patientId) fetchSchedule(patientId);
    setUpdatingId(null);
  };

  const markMissed = async (item: ScheduleItem) => {
    const id = item.reminderEventId || item.logId;
    if (!id) return;
    setUpdatingId(id);

    if (item.reminderEventId) {
      await supabase.from("reminder_events").update({ status: "missed" }).eq("id", item.reminderEventId);
    }
    if (item.logId) {
      await supabase.from("medicine_logs").update({ status: "missed" }).eq("id", item.logId);
    }

    toast.success("Marked as Missed");
    if (patientId) fetchSchedule(patientId);
    setUpdatingId(null);
  };

  const undoStatus = async (item: ScheduleItem) => {
    const id = item.reminderEventId || item.logId;
    if (!id) return;
    setUpdatingId(id);

    if (item.reminderEventId) {
      await supabase.from("reminder_events").update({ status: "pending", taken_at: null }).eq("id", item.reminderEventId);
    }
    if (item.logId) {
      await supabase.from("medicine_logs").update({ status: "pending", taken_at: null }).eq("id", item.logId);
    }

    toast.success("Status reset to Pending");
    if (patientId) fetchSchedule(patientId);
    setUpdatingId(null);
  };

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

        await fetchSchedule(pid);
      }
      setLoading(false);
    };
    fetchData();
  }, []);

  const nextPending = schedule.find((s) => s.status === "pending");

  const statCards = [
    { label: "Total Medicines", value: medicineCount > 0 ? String(medicineCount) : "0", icon: Pill, color: "bg-success/15 text-success" },
    { label: "Taken Today", value: `${takenToday} of ${totalToday || medicineCount}`, icon: Check, color: "bg-accent/15 text-accent-foreground" },
    { label: "Weekly Adherence", value: "—", icon: BarChart3, color: "bg-success/15 text-success" },
    { label: "Next Reminder", value: nextPending?.time || "—", sub: nextPending?.medicineName, icon: Bell, color: "bg-warning/15 text-warning" },
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
    Spouse: "bg-accent", Son: "bg-success", Daughter: "bg-success",
    Parent: "bg-warning", Doctor: "bg-primary",
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-6xl">
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
              <p className="text-primary-foreground font-bold text-lg">Have a new prescription? Upload it now 📋</p>
              <p className="text-primary-foreground/70 text-sm mt-1">Our AI will extract all your medicines automatically</p>
            </div>
            <Button variant="hero" size="default" className="w-full sm:w-auto self-start" onClick={() => navigate("/upload")}>
              <Upload className="w-4 h-4" /> Upload Prescription
            </Button>
          </motion.div>

          <motion.div {...fadeIn(0.3)} className="rounded-2xl bg-card border-2 border-emerald-500/30 p-5 flex flex-col justify-between gap-4 shadow-card">
            <div>
              <div className="flex items-center gap-2 text-emerald-600 font-extrabold text-sm uppercase tracking-wider mb-1">
                <Store className="w-4 h-4" /> Medicine Refills
              </div>
              <p className="font-extrabold text-lg text-foreground">Find Nearby Pharmacies 🏪</p>
              <p className="text-muted-foreground text-sm mt-1">Locate 24/7 chemists, get directions & call stores in 1-click</p>
            </div>
            <Button variant="outline" size="default" className="w-full sm:w-auto self-start rounded-xl font-bold border-emerald-500/40 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30" onClick={() => navigate("/pharmacies")}>
              <MapPin className="w-4 h-4 mr-2" /> Find Pharmacies Near Me
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
            <MedicineTrackingChart schedule={schedule} loading={loading} />
          </motion.div>

          <motion.div {...fadeIn(6)} className="bg-card rounded-2xl border p-5 shadow-card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">Family & Caregivers</h2>
              <Button variant="warm" size="sm" onClick={() => navigate("/family-alerts")}>
                <Plus className="w-4 h-4" /> Add
              </Button>
            </div>
            {familyMembers.length === 0 ? (
              <div className="text-center py-6">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <Users className="w-7 h-7 text-primary" />
                </div>
                <p className="font-semibold mb-1">No caregivers yet</p>
                <p className="text-sm text-muted-foreground mb-4">Add family members to keep them informed</p>
                <Button variant="hero" size="sm" onClick={() => navigate("/family-alerts")}>Add Caregiver</Button>
              </div>
            ) : (
              <>
                <div className="flex -space-x-2 mb-3">
                  {familyMembers.slice(0, 3).map((m) => (
                    <div key={m.id} title={m.full_name} className={`w-11 h-11 rounded-full flex items-center justify-center text-xs font-bold text-primary-foreground border-2 border-card ${relColorMap[m.relationship] || "bg-muted"}`}>
                      {getInitials(m.full_name)}
                    </div>
                  ))}
                  {familyMembers.length > 3 && (
                    <div className="w-11 h-11 rounded-full flex items-center justify-center text-xs font-bold bg-muted text-muted-foreground border-2 border-card">
                      +{familyMembers.length - 3}
                    </div>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mb-4">{familyMembers.length} caregiver{familyMembers.length !== 1 ? "s" : ""} connected</p>
                <div className="space-y-2">
                  {familyMembers.slice(0, 3).map((m) => (
                    <div key={m.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-muted/40">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold text-primary-foreground ${relColorMap[m.relationship] || "bg-muted"}`}>
                        {getInitials(m.full_name)}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">{m.full_name}</p>
                        <p className="text-xs text-muted-foreground">{m.relationship}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <Button variant="ghost" className="w-full mt-3 text-primary" onClick={() => navigate("/family-alerts")}>
                  View All →
                </Button>
              </>
            )}
          </motion.div>
        </div>

        {/* Schedule with Taken/Missed actions */}
        <motion.div {...fadeIn(7)} className="bg-card rounded-2xl border shadow-card">
          <div className="flex items-center justify-between p-5 pb-0">
            <h2 className="text-xl font-bold">Today's Schedule</h2>
            <button className="text-sm font-semibold text-primary hover:underline" onClick={() => navigate("/log")}>View All</button>
          </div>
          <div className="p-5 space-y-3">
            {loading ? (
              [1,2,3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)
            ) : schedule.length === 0 ? (
              <div className="text-center py-8">
                <Pill className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-muted-foreground">No medicines scheduled today</p>
              </div>
            ) : (
              schedule.slice(0, 6).map((med, idx) => {
                const itemId = med.reminderEventId || med.logId || `${med.time}-${med.medicineName}`;
                const isPending = med.status === "pending";
                const isTaken = med.status === "taken";
                const isMissed = med.status === "missed" || med.status === "escalated";

                return (
                  <div key={itemId} className="flex items-center gap-4 p-4 rounded-xl bg-muted/40 hover:bg-muted/70 transition-colors">
                    {/* Medicine Photo */}
                    <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 hidden sm:block">
                      {med.photoUrl ? (
                        <img src={med.photoUrl} alt={med.medicineName} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-primary/10 flex items-center justify-center">
                          <Pill className="w-5 h-5 text-primary" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm sm:text-base truncate">{med.medicineName} — {med.dosage}</p>
                      <p className="text-xs sm:text-sm text-muted-foreground truncate">{med.instructions || ""}</p>
                    </div>
                    <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
                      <p className="text-sm font-medium flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" /> {med.time}
                      </p>
                      <span className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${statusPill(med.status)}`}>
                        {statusIcon(med.status)} {med.status}
                      </span>
                      {isPending && (med.reminderEventId || med.logId) && (
                        <div className="flex gap-1.5 mt-1">
                          <button
                            disabled={updatingId === itemId}
                            onClick={() => markTaken(med)}
                            className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-success/15 text-success hover:bg-success/25 transition-colors disabled:opacity-50"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" /> Taken
                          </button>
                          <button
                            disabled={updatingId === itemId}
                            onClick={() => markMissed(med)}
                            className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-destructive/15 text-destructive hover:bg-destructive/25 transition-colors disabled:opacity-50"
                          >
                            <XCircle className="w-3.5 h-3.5" /> Missed
                          </button>
                        </div>
                      )}
                      {isTaken && (med.reminderEventId || med.logId) && (
                        <button
                          disabled={updatingId === itemId}
                          onClick={() => undoStatus(med)}
                          className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-warning/15 text-warning hover:bg-warning/25 transition-colors disabled:opacity-50 mt-1"
                        >
                          <Hourglass className="w-3.5 h-3.5" /> Undo
                        </button>
                      )}
                      {isMissed && (med.reminderEventId || med.logId) && (
                        <button
                          disabled={updatingId === itemId}
                          onClick={() => markTaken(med)}
                          className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-success/15 text-success hover:bg-success/25 transition-colors disabled:opacity-50 mt-1"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> Mark Taken
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </motion.div>
      </div>
    </DashboardLayout>
  );
};

export default Dashboard;
