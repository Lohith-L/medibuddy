import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Users, Plus, Pencil, Trash2, Mail, Phone, Globe, Bell, CheckCircle2, XCircle, Clock, AlertTriangle, Filter } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import DashboardLayout from "@/components/DashboardLayout";
import { format } from "date-fns";

interface AlertHistoryItem {
  id: string;
  alert_type: string;
  medicine_name: string | null;
  dosage: string | null;
  recipient_email: string;
  recipient_name: string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  status: string;
  message_preview: string | null;
  error_message: string | null;
  language_used: string | null;
  created_at: string;
}

const relationships = ["Son", "Daughter", "Spouse", "Parent", "Sibling", "Friend", "Doctor", "Other"];
const languages = [
  { value: "en", label: "English" },
  { value: "te", label: "తెలుగు (Telugu)" },
  { value: "hi", label: "हिंदी (Hindi)" },
  { value: "ta", label: "தமிழ் (Tamil)" },
  { value: "kn", label: "ಕನ್ನಡ (Kannada)" },
];

const relColorMap: Record<string, string> = {
  Spouse: "bg-accent text-accent-foreground",
  Son: "bg-success/15 text-success",
  Daughter: "bg-success/15 text-success",
  Parent: "bg-warning/15 text-warning",
  Doctor: "bg-primary/15 text-primary",
};

interface FamilyMember {
  id: string;
  patient_id: string;
  full_name: string;
  relationship: string;
  email: string;
  phone: string | null;
  language: string;
  alert_on_missed: boolean;
  alert_on_weekly_report: boolean;
  alert_on_refill: boolean;
  is_active: boolean;
}

const emptyForm = {
  full_name: "", relationship: "Son", email: "", phone: "", language: "en",
  alert_on_missed: true, alert_on_weekly_report: true, alert_on_refill: false,
};

const FamilyAlerts = () => {
  const navigate = useNavigate();
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [patientId, setPatientId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [tab, setTab] = useState<"caregivers" | "history">("caregivers");
  const [alerts, setAlerts] = useState<AlertHistoryItem[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertFilter, setAlertFilter] = useState<string>("all");

  const fetchMembers = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: patients } = await supabase.from("patients").select("id").eq("user_id", user.id).limit(1);
    if (!patients?.length) { setLoading(false); return; }
    setPatientId(patients[0].id);
    const { data } = await supabase.from("family_members").select("*").eq("patient_id", patients[0].id).eq("is_active", true);
    setMembers((data as FamilyMember[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetchMembers(); }, []);

  const fetchAlerts = async () => {
    if (!patientId) return;
    setAlertsLoading(true);
    const { data } = await supabase
      .from("alert_history")
      .select("*")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false })
      .limit(50);
    setAlerts((data as AlertHistoryItem[]) || []);
    setAlertsLoading(false);
  };

  useEffect(() => {
    if (tab === "history" && patientId) fetchAlerts();
  }, [tab, patientId]);

  // Realtime subscription for new alerts
  useEffect(() => {
    if (!patientId) return;
    const channel = supabase
      .channel("alert_history_changes")
      .on(
        "postgres_changes" as any,
        { event: "INSERT", schema: "public", table: "alert_history", filter: `patient_id=eq.${patientId}` },
        () => { if (tab === "history") fetchAlerts(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [patientId, tab]);

  const alertTypeLabel = (type: string) => {
    const map: Record<string, string> = {
      reminder: "Reminder",
      confirmation: "Confirmation",
      family_alert: "Family Alert",
      escalation: "Escalation",
      weekly_report: "Weekly Report",
    };
    return map[type] || type;
  };

  const alertTypeIcon = (type: string) => {
    if (type === "family_alert" || type === "escalation") return <AlertTriangle className="w-4 h-4" />;
    if (type === "weekly_report") return <Bell className="w-4 h-4" />;
    if (type === "reminder") return <Clock className="w-4 h-4" />;
    return <Mail className="w-4 h-4" />;
  };

  const alertTypeBg = (type: string) => {
    if (type === "family_alert" || type === "escalation") return "bg-warning/15 text-warning";
    if (type === "weekly_report") return "bg-primary/15 text-primary";
    if (type === "reminder") return "bg-accent/15 text-accent-foreground";
    return "bg-muted text-muted-foreground";
  };

  const statusBadge = (status: string) => {
    if (status === "sent") return <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-success/15 text-success"><CheckCircle2 className="w-3 h-3" />Sent</span>;
    if (status === "failed") return <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-destructive/15 text-destructive"><XCircle className="w-3 h-3" />Failed</span>;
    return <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-warning/15 text-warning"><Clock className="w-3 h-3" />Pending</span>;
  };

  const filteredAlerts = alertFilter === "all" ? alerts : alerts.filter(a => a.alert_type === alertFilter);

  const openAdd = () => { setEditingId(null); setForm(emptyForm); setModalOpen(true); };
  const openEdit = (m: FamilyMember) => {
    setEditingId(m.id);
    setForm({ full_name: m.full_name, relationship: m.relationship, email: m.email, phone: m.phone || "", language: m.language, alert_on_missed: m.alert_on_missed, alert_on_weekly_report: m.alert_on_weekly_report, alert_on_refill: m.alert_on_refill });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.full_name.trim()) { toast.error("Name is required"); return; }
    if (!form.email.trim() || !form.email.includes("@")) { toast.error("Valid email is required"); return; }
    if (!patientId) { toast.error("Patient profile not found"); return; }
    setSaving(true);
    try {
      if (editingId) {
        const { error } = await supabase.from("family_members").update({
          full_name: form.full_name, relationship: form.relationship, email: form.email,
          phone: form.phone || null, language: form.language, alert_on_missed: form.alert_on_missed,
          alert_on_weekly_report: form.alert_on_weekly_report, alert_on_refill: form.alert_on_refill,
        }).eq("id", editingId);
        if (error) throw error;
        toast.success("Caregiver updated! ✅");
      } else {
        const { error } = await supabase.from("family_members").insert({
          patient_id: patientId, full_name: form.full_name, relationship: form.relationship,
          email: form.email, phone: form.phone || null, language: form.language,
          alert_on_missed: form.alert_on_missed, alert_on_weekly_report: form.alert_on_weekly_report,
          alert_on_refill: form.alert_on_refill,
        });
        if (error) throw error;
        toast.success("Caregiver added! 🎉");
      }
      setModalOpen(false);
      fetchMembers();
    } catch (err: any) {
      toast.error(err.message || "Failed to save");
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from("family_members").delete().eq("id", deleteId);
    if (error) toast.error(error.message);
    else { toast.success("Caregiver removed"); fetchMembers(); }
    setDeleteId(null);
  };

  const handleToggle = async (id: string, field: "alert_on_missed" | "alert_on_weekly_report" | "alert_on_refill", value: boolean) => {
    await supabase.from("family_members").update({ [field]: value } as any).eq("id", id);
    setMembers((prev) => prev.map((m) => m.id === id ? { ...m, [field]: value } : m));
  };

  const getInitials = (name: string) => name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  const getRelColor = (rel: string) => relColorMap[rel] || "bg-muted text-muted-foreground";

  return (
    <DashboardLayout>
      <div className="w-full max-w-full sm:max-w-5xl space-y-4 sm:space-y-6 overflow-x-hidden">
        {/* Header */}
        <div className="flex flex-col gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold">Family & Caregivers</h1>
            <p className="text-sm text-muted-foreground">People who care about your health</p>
          </div>
          <Button variant="hero" className="w-full sm:w-auto" onClick={openAdd}><Plus className="w-4 h-4" /> Add Family Member</Button>
        </div>

        {/* Tabs */}
        <div className="flex bg-muted rounded-xl p-1 w-full sm:w-fit">
          {(["caregivers", "history"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`flex-1 sm:flex-none px-4 sm:px-5 py-2.5 rounded-lg font-semibold text-sm capitalize transition-all ${tab === t ? "bg-card shadow-card text-foreground" : "text-muted-foreground"}`}>{t === "caregivers" ? "Caregivers" : "Alert History"}</button>
          ))}
        </div>

        {tab === "caregivers" && (
          <>
            {loading ? (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1,2,3].map(i => <Skeleton key={i} className="h-64 rounded-2xl" />)}
              </div>
            ) : members.length === 0 ? (
              <div className="bg-card rounded-2xl border p-10 text-center shadow-card">
                <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <Users className="w-8 h-8 text-primary" />
                </div>
                <p className="text-lg font-semibold mb-1">No caregivers added yet</p>
                <p className="text-muted-foreground mb-6">Add family members to keep them informed about your health</p>
                <Button variant="hero" onClick={openAdd}><Plus className="w-4 h-4" /> Add First Caregiver</Button>
              </div>
            ) : (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {members.map((m, i) => (
                  <motion.div key={m.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }} className="bg-card rounded-2xl border p-4 sm:p-5 shadow-card hover:shadow-card-hover transition-shadow overflow-hidden">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-bold text-sm ${getRelColor(m.relationship)}`}>
                          {getInitials(m.full_name)}
                        </div>
                        <div>
                          <p className="font-bold text-lg">{m.full_name}</p>
                          <span className={`inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full ${getRelColor(m.relationship)}`}>{m.relationship}</span>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => openEdit(m)}><Pencil className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive hover:bg-destructive/10" onClick={() => setDeleteId(m.id)}><Trash2 className="w-4 h-4" /></Button>
                      </div>
                    </div>

                    <div className="space-y-2 text-sm mb-4">
                      <div className="flex items-center gap-2 text-muted-foreground min-w-0"><Mail className="w-4 h-4 shrink-0" /> <span className="truncate">{m.email}</span></div>
                      {m.phone && <div className="flex items-center gap-2 text-muted-foreground"><Phone className="w-4 h-4" /> {m.phone}</div>}
                      <div className="flex items-center gap-2 text-muted-foreground"><Globe className="w-4 h-4" /> {languages.find(l => l.value === m.language)?.label || m.language}</div>
                    </div>

                    <div className="border-t pt-3 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Missed dose alerts</span>
                        <Switch checked={m.alert_on_missed} onCheckedChange={(v) => handleToggle(m.id, "alert_on_missed", v)} />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Weekly report</span>
                        <Switch checked={m.alert_on_weekly_report} onCheckedChange={(v) => handleToggle(m.id, "alert_on_weekly_report", v)} />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Refill reminders</span>
                        <Switch checked={m.alert_on_refill} onCheckedChange={(v) => handleToggle(m.id, "alert_on_refill", v)} />
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === "history" && (
          <div className="space-y-4">
            {/* Filter bar */}
            <div className="flex flex-wrap items-center gap-2">
              <Filter className="w-4 h-4 text-muted-foreground shrink-0" />
              {["all", "reminder", "family_alert", "escalation", "weekly_report", "confirmation"].map(f => (
                <button
                  key={f}
                  onClick={() => setAlertFilter(f)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${alertFilter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                >
                  {f === "all" ? "All" : alertTypeLabel(f)}
                </button>
              ))}
            </div>

            {alertsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}
              </div>
            ) : filteredAlerts.length === 0 ? (
              <div className="bg-card rounded-2xl border p-6 sm:p-10 text-center shadow-card">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <Bell className="w-7 h-7 text-primary" />
                </div>
                <p className="text-lg font-semibold mb-1">No alerts yet</p>
                <p className="text-muted-foreground text-sm">Alert notifications will appear here once reminders and family alerts start sending.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredAlerts.map((a) => (
                  <motion.div
                    key={a.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-card rounded-xl border p-3 sm:p-4 shadow-sm hover:shadow-card transition-shadow"
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${alertTypeBg(a.alert_type)}`}>
                        {alertTypeIcon(a.alert_type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2">
                          <p className="font-semibold text-sm break-words">
                            {a.medicine_name ? `${a.medicine_name}${a.dosage ? ` ${a.dosage}` : ""}` : alertTypeLabel(a.alert_type)}
                          </p>
                          {statusBadge(a.status)}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 break-words">
                          To: {a.recipient_name || a.recipient_email}
                          {a.scheduled_time && ` · ${a.scheduled_time}`}
                        </p>
                        {a.message_preview && (
                          <p className="text-xs text-muted-foreground mt-1 break-words line-clamp-2">{a.message_preview}</p>
                        )}
                        {a.error_message && (
                          <p className="text-xs text-destructive mt-1 break-words line-clamp-2">Error: {a.error_message}</p>
                        )}
                        <p className="text-[10px] text-muted-foreground/70 mt-1">
                          {format(new Date(a.created_at), "dd MMM yyyy, hh:mm a")}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl">{editingId ? "Edit" : "Add"} Family Member</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label className="font-semibold">Full Name *</Label>
              <Input value={form.full_name} onChange={(e) => setForm(p => ({ ...p, full_name: e.target.value }))} className="mt-1.5 min-h-[48px] rounded-xl" placeholder="e.g. Ramesh Kumar" />
            </div>
            <div>
              <Label className="font-semibold">Relationship</Label>
              <select value={form.relationship} onChange={(e) => setForm(p => ({ ...p, relationship: e.target.value }))} className="mt-1.5 w-full min-h-[48px] rounded-xl border bg-background px-4 text-base focus:outline-none focus:ring-2 focus:ring-ring">
                {relationships.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <Label className="font-semibold">Email Address *</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm(p => ({ ...p, email: e.target.value }))} className="mt-1.5 min-h-[48px] rounded-xl" placeholder="email@example.com" />
            </div>
            <div>
              <Label className="font-semibold">Phone Number</Label>
              <Input type="tel" value={form.phone} onChange={(e) => setForm(p => ({ ...p, phone: e.target.value }))} className="mt-1.5 min-h-[48px] rounded-xl" placeholder="+91 98765 43210" />
            </div>
            <div>
              <Label className="font-semibold">Alert Language</Label>
              <select value={form.language} onChange={(e) => setForm(p => ({ ...p, language: e.target.value }))} className="mt-1.5 w-full min-h-[48px] rounded-xl border bg-background px-4 text-base focus:outline-none focus:ring-2 focus:ring-ring">
                {languages.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </div>
            <div className="border-t pt-3 space-y-3">
              <p className="font-semibold text-sm">Alert Preferences</p>
              <div className="flex items-center justify-between"><span className="text-sm">Send missed dose alerts</span><Switch checked={form.alert_on_missed} onCheckedChange={(v) => setForm(p => ({ ...p, alert_on_missed: v }))} /></div>
              <div className="flex items-center justify-between"><span className="text-sm">Send weekly health report</span><Switch checked={form.alert_on_weekly_report} onCheckedChange={(v) => setForm(p => ({ ...p, alert_on_weekly_report: v }))} /></div>
              <div className="flex items-center justify-between"><span className="text-sm">Send refill reminders</span><Switch checked={form.alert_on_refill} onCheckedChange={(v) => setForm(p => ({ ...p, alert_on_refill: v }))} /></div>
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="hero" className="flex-1" onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
              <Button variant="outline" className="flex-1" onClick={() => setModalOpen(false)}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove caregiver?</AlertDialogTitle>
            <AlertDialogDescription>They will no longer receive alerts about your medicines.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDelete}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
};

export default FamilyAlerts;
