import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Pill, Clock, CheckCircle2, XCircle, Hourglass, Calendar as CalendarIcon } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";

interface LogItem {
  id: string;
  medicineName: string;
  dosage: string;
  instructions: string | null;
  scheduledTime: string;
  timeLabel: string;
  status: string;
}

const MedicineLog = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [patientId, setPatientId] = useState<string | null>(null);

  const fetchLogs = async (pid: string) => {
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();

    const { data: rawLogs } = await supabase
      .from("medicine_logs")
      .select("id, status, scheduled_time, medicine_id, taken_at")
      .eq("patient_id", pid)
      .gte("scheduled_time", startOfDay)
      .lt("scheduled_time", endOfDay)
      .order("scheduled_time", { ascending: true });

    if (!rawLogs || rawLogs.length === 0) {
      setLogs([]);
      setLoading(false);
      return;
    }

    const medIds = [...new Set(rawLogs.map((l) => l.medicine_id))];
    const { data: meds } = await supabase
      .from("medicines")
      .select("id, name, dosage, instructions")
      .in("id", medIds);

    const medMap = new Map((meds || []).map((m) => [m.id, m]));

    setLogs(
      rawLogs.map((l) => {
        const med = medMap.get(l.medicine_id);
        const dt = new Date(l.scheduled_time);
        return {
          id: l.id,
          medicineName: med?.name || "Unknown",
          dosage: med?.dosage || "",
          instructions: med?.instructions || null,
          scheduledTime: l.scheduled_time,
          timeLabel: dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }),
          status: l.status,
        };
      })
    );
    setLoading(false);
  };

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: patients } = await supabase
        .from("patients")
        .select("id")
        .eq("user_id", user.id)
        .limit(1);
      if (patients && patients.length > 0) {
        const pid = patients[0].id;
        setPatientId(pid);
        await fetchLogs(pid);
      } else {
        setLoading(false);
      }
    };
    init();
  }, []);

  const updateStatus = async (logId: string, newStatus: string) => {
    setUpdatingId(logId);
    const updateData: any = { status: newStatus };
    if (newStatus === "taken") {
      updateData.taken_at = new Date().toISOString();
    } else {
      updateData.taken_at = null;
    }
    const { error } = await supabase.from("medicine_logs").update(updateData).eq("id", logId);
    if (error) {
      toast.error("Failed to update");
    } else {
      toast.success(`Marked as ${newStatus}`);
      if (patientId) await fetchLogs(patientId);
    }
    setUpdatingId(null);
  };

  const statusPill = (status: string) => {
    const map: Record<string, string> = {
      taken: "bg-success/15 text-success",
      pending: "bg-warning/15 text-warning",
      missed: "bg-destructive/15 text-destructive",
      snoozed: "bg-primary/15 text-primary",
    };
    return map[status] || "";
  };

  const statusIcon = (status: string) => {
    if (status === "taken") return "✅";
    if (status === "missed") return "❌";
    return "⏳";
  };

  const taken = logs.filter((l) => l.status === "taken").length;
  const missed = logs.filter((l) => l.status === "missed").length;
  const pending = logs.filter((l) => l.status === "pending").length;

  return (
    <DashboardLayout>
      <div className="max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-extrabold">Today's Medicine Log</h1>
        </div>

        {/* Summary pills */}
        {!loading && logs.length > 0 && (
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-success/10">
              <CheckCircle2 className="w-4 h-4 text-success" />
              <span className="text-sm font-semibold text-success">{taken} Taken</span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-warning/10">
              <Hourglass className="w-4 h-4 text-warning" />
              <span className="text-sm font-semibold text-warning">{pending} Pending</span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-destructive/10">
              <XCircle className="w-4 h-4 text-destructive" />
              <span className="text-sm font-semibold text-destructive">{missed} Missed</span>
            </div>
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-2xl" />)}
          </div>
        ) : logs.length === 0 ? (
          <div className="bg-card rounded-2xl border p-10 text-center shadow-card">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <CalendarIcon className="w-8 h-8 text-primary" />
            </div>
            <p className="text-lg font-semibold mb-1">No logs for today</p>
            <p className="text-muted-foreground mb-6">
              Upload a prescription and your schedule will appear here
            </p>
            <Button variant="hero" onClick={() => navigate("/upload")}>
              Upload Prescription
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {logs.map((log, i) => (
              <motion.div
                key={log.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05, duration: 0.3 }}
                className="bg-card rounded-2xl border p-5 shadow-card hover:shadow-card-hover transition-shadow"
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <Pill className="w-6 h-6 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-lg truncate">{log.medicineName}</p>
                    <p className="text-sm text-muted-foreground">{log.dosage}</p>
                    {log.instructions && (
                      <p className="text-xs text-muted-foreground mt-0.5">{log.instructions}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold flex items-center gap-1 justify-end">
                      <Clock className="w-4 h-4" /> {log.timeLabel}
                    </p>
                    <span className={`inline-block mt-1.5 text-xs font-semibold px-3 py-1 rounded-full capitalize ${statusPill(log.status)}`}>
                      {statusIcon(log.status)} {log.status}
                    </span>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex gap-2 mt-4 justify-end">
                  {log.status === "pending" && (
                    <>
                      <button
                        disabled={updatingId === log.id}
                        onClick={() => updateStatus(log.id, "taken")}
                        className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-xl bg-success/15 text-success hover:bg-success/25 transition-colors disabled:opacity-50 min-h-[44px]"
                      >
                        <CheckCircle2 className="w-4 h-4" /> Mark Taken
                      </button>
                      <button
                        disabled={updatingId === log.id}
                        onClick={() => updateStatus(log.id, "missed")}
                        className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-xl bg-destructive/15 text-destructive hover:bg-destructive/25 transition-colors disabled:opacity-50 min-h-[44px]"
                      >
                        <XCircle className="w-4 h-4" /> Mark Missed
                      </button>
                    </>
                  )}
                  {log.status === "taken" && (
                    <button
                      disabled={updatingId === log.id}
                      onClick={() => updateStatus(log.id, "pending")}
                      className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-xl bg-warning/15 text-warning hover:bg-warning/25 transition-colors disabled:opacity-50 min-h-[44px]"
                    >
                      <Hourglass className="w-4 h-4" /> Undo
                    </button>
                  )}
                  {log.status === "missed" && (
                    <button
                      disabled={updatingId === log.id}
                      onClick={() => updateStatus(log.id, "taken")}
                      className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-xl bg-success/15 text-success hover:bg-success/25 transition-colors disabled:opacity-50 min-h-[44px]"
                    >
                      <CheckCircle2 className="w-4 h-4" /> Mark Taken
                    </button>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default MedicineLog;
