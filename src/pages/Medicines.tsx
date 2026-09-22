import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pill, Plus, Trash2, Camera, Pencil, X, Clock, ImageOff, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import DashboardLayout from "@/components/DashboardLayout";
import { generateUUID } from "@/lib/uuid";
import { validateImageFile, fileToOptimizedDataUrl } from "@/lib/imageUtils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Medicine {
  id: string;
  name: string;
  dosage: string;
  frequency: string;
  instructions: string | null;
  reminder_times: string[] | null;
  is_active: boolean;
  medicine_photo_url: string | null;
  patient_id: string;
}

const FREQUENCY_OPTIONS = [
  { label: "Once daily", value: "Once daily" },
  { label: "Twice daily", value: "Twice daily" },
  { label: "Three times daily", value: "Three times daily" },
  { label: "As needed", value: "As needed" },
  { label: "Weekly", value: "Weekly" },
];

function getTimeSlotCount(frequency: string): number {
  const f = frequency.toLowerCase();
  if (f.includes("three") || f.includes("thrice")) return 3;
  if (f.includes("twice")) return 2;
  if (f.includes("once") || f.includes("weekly")) return 1;
  if (f.includes("as needed")) return 0;
  return 1;
}

function getDefaultTimes(count: number): string[] {
  if (count === 1) return ["08:00"];
  if (count === 2) return ["08:00", "20:00"];
  if (count === 3) return ["08:00", "14:00", "20:00"];
  return [];
}

const demoMedicines: Medicine[] = [
  { id: "demo-1", name: "Paracetamol", dosage: "500mg", frequency: "Twice daily", instructions: "After food", reminder_times: ["08:00", "20:00"], is_active: true, medicine_photo_url: null, patient_id: "" },
  { id: "demo-2", name: "Metformin", dosage: "500mg", frequency: "Once daily", instructions: null, reminder_times: ["14:00"], is_active: true, medicine_photo_url: null, patient_id: "" },
];

const Medicines = () => {
  const navigate = useNavigate();
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [targetMedId, setTargetMedId] = useState<string | null>(null);

  // Edit state
  const [editingMed, setEditingMed] = useState<Medicine | null>(null);
  const [editForm, setEditForm] = useState({ name: "", dosage: "", frequency: "", instructions: "", reminder_times: [] as string[] });
  const [saving, setSaving] = useState(false);

  // Delete state
  const [deletingMed, setDeletingMed] = useState<Medicine | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchMedicines = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: patients } = await supabase.from("patients").select("id").eq("user_id", user.id).limit(1);
    if (patients && patients.length > 0) {
      const { data } = await supabase
        .from("medicines")
        .select("*")
        .eq("patient_id", patients[0].id)
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      if (data && data.length > 0) {
        setMedicines(data as Medicine[]);
        setIsDemo(false);
      } else {
        setMedicines(demoMedicines);
        setIsDemo(true);
      }
    } else {
      setMedicines(demoMedicines);
      setIsDemo(true);
    }
    setLoading(false);
  };

  useEffect(() => { fetchMedicines(); }, []);

  // ── Photo upload ───────────────────────────────────────────────────
  const handlePhotoUpload = async (file: File, medicineId: string) => {
    const validation = validateImageFile(file);
    if (!validation.valid) {
      toast.error(validation.error || "Please select a valid image");
      return;
    }

    setUploadingId(medicineId);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const uniqueId = generateUUID();
      const filePath = `${medicineId}_${uniqueId}.${ext}`;
      let finalPhotoUrl: string | null = null;

      try {
        const { error: uploadError } = await supabase.storage
          .from("medicine-photos")
          .upload(filePath, file, { contentType: file.type, upsert: true });

        if (!uploadError) {
          const { data: urlData } = supabase.storage.from("medicine-photos").getPublicUrl(filePath);
          if (urlData?.publicUrl) {
            finalPhotoUrl = urlData.publicUrl;
          }
        }
      } catch (storageErr) {
        console.warn("Storage upload exception, using fallback:", storageErr);
      }

      if (!finalPhotoUrl) {
        finalPhotoUrl = await fileToOptimizedDataUrl(file);
      }

      const { error: updateError } = await supabase
        .from("medicines")
        .update({ medicine_photo_url: finalPhotoUrl } as any)
        .eq("id", medicineId);
      if (updateError) throw updateError;

      setMedicines((prev) =>
        prev.map((m) => (m.id === medicineId ? { ...m, medicine_photo_url: finalPhotoUrl } : m))
      );
      toast.success("Medicine photo updated! 📸");
    } catch (err: any) {
      console.error("Photo upload error:", err);
      toast.error(err.message || "Failed to upload photo");
    } finally {
      setUploadingId(null);
    }
  };

  const removePhoto = async (med: Medicine) => {
    try {
      // Try to remove from storage (best effort — may fail if different extension)
      const extensions = ["jpg", "jpeg", "png", "webp"];
      for (const ext of extensions) {
        await supabase.storage.from("medicine-photos").remove([`${med.id}.${ext}`]);
      }

      const { error } = await supabase.from("medicines").update({ medicine_photo_url: null } as any).eq("id", med.id);
      if (error) throw error;

      setMedicines((prev) => prev.map((m) => m.id === med.id ? { ...m, medicine_photo_url: null } : m));
      toast.success("Photo removed");
    } catch (err: any) {
      toast.error(err.message || "Failed to remove photo");
    }
  };

  const triggerPhotoUpload = (medicineId: string) => {
    setTargetMedId(medicineId);
    fileInputRef.current?.click();
  };

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && targetMedId) handlePhotoUpload(file, targetMedId);
    e.target.value = "";
  };

  // ── Edit ────────────────────────────────────────────────────────────
  const openEdit = (med: Medicine) => {
    setEditingMed(med);
    setEditForm({
      name: med.name,
      dosage: med.dosage,
      frequency: med.frequency,
      instructions: med.instructions || "",
      reminder_times: [...(med.reminder_times || [])],
    });
  };

  const handleFrequencyChange = (newFreq: string) => {
    const count = getTimeSlotCount(newFreq);
    const current = editForm.reminder_times;
    let newTimes: string[];
    if (count === 0) newTimes = [];
    else if (count <= current.length) newTimes = current.slice(0, count);
    else newTimes = [...current, ...getDefaultTimes(count).slice(current.length)];
    setEditForm((f) => ({ ...f, frequency: newFreq, reminder_times: newTimes }));
  };

  const updateReminderTime = (idx: number, value: string) => {
    setEditForm((f) => {
      const newTimes = [...f.reminder_times];
      newTimes[idx] = value;
      return { ...f, reminder_times: newTimes };
    });
  };

  const handleSaveEdit = async () => {
    if (!editingMed) return;
    if (!editForm.name.trim() || !editForm.dosage.trim()) {
      toast.error("Name and dosage are required");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("medicines")
        .update({
          name: editForm.name.trim(),
          dosage: editForm.dosage.trim(),
          frequency: editForm.frequency,
          instructions: editForm.instructions.trim() || null,
          reminder_times: editForm.reminder_times,
        })
        .eq("id", editingMed.id);

      if (error) throw error;

      setMedicines((prev) =>
        prev.map((m) =>
          m.id === editingMed.id
            ? { ...m, name: editForm.name.trim(), dosage: editForm.dosage.trim(), frequency: editForm.frequency, instructions: editForm.instructions.trim() || null, reminder_times: editForm.reminder_times }
            : m
        )
      );
      toast.success("Medicine updated ✅");
      setEditingMed(null);
    } catch (err: any) {
      toast.error(err.message || "Failed to update");
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ──────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!deletingMed) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from("medicines").delete().eq("id", deletingMed.id);
      if (error) throw error;

      // Clean up photo from storage (best effort)
      if (deletingMed.medicine_photo_url) {
        const extensions = ["jpg", "jpeg", "png", "webp"];
        for (const ext of extensions) {
          await supabase.storage.from("medicine-photos").remove([`${deletingMed.id}.${ext}`]);
        }
      }

      setMedicines((prev) => prev.filter((m) => m.id !== deletingMed.id));
      toast.success("Medicine deleted");
      setDeletingMed(null);
    } catch (err: any) {
      toast.error(err.message || "Failed to delete");
    } finally {
      setDeleting(false);
    }
  };

  const timeSlotCount = editForm.frequency ? getTimeSlotCount(editForm.frequency) : 0;

  return (
    <DashboardLayout>
      <div className="max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-extrabold">My Medicines</h1>
          <Button size="sm" variant="hero" onClick={() => navigate("/upload")}>
            <Plus className="w-4 h-4" /> Add
          </Button>
        </div>

        <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={onFileSelected} />

        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
          </div>
        ) : medicines.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Pill className="w-10 h-10 text-primary" />
            </div>
            <p className="text-xl font-bold mb-2">No medicines yet</p>
            <p className="text-muted-foreground mb-6">Upload a prescription to get started</p>
            <Button variant="hero" size="lg" onClick={() => navigate("/upload")}>Upload Prescription</Button>
          </div>
        ) : (
          <div className="space-y-4">
            {medicines.map((med, i) => (
              <motion.div
                key={med.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                className="bg-card rounded-2xl border p-5 shadow-card hover:shadow-card-hover transition-shadow"
              >
                <div className="flex items-start gap-4">
                  {/* Medicine Photo */}
                  <button
                    onClick={() => !isDemo && triggerPhotoUpload(med.id)}
                    disabled={uploadingId === med.id || isDemo}
                    className="relative w-14 h-14 rounded-xl overflow-hidden flex items-center justify-center shadow-card group shrink-0"
                  >
                    {med.medicine_photo_url ? (
                      <>
                        <img src={med.medicine_photo_url} alt={med.name} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <Camera className="w-5 h-5 text-white" />
                        </div>
                      </>
                    ) : (
                      <div className="w-full h-full gradient-warm flex items-center justify-center group-hover:opacity-80 transition-opacity">
                        {uploadingId === med.id ? (
                          <Loader2 className="w-5 h-5 text-primary-foreground animate-spin" />
                        ) : (
                          <Pill className="w-6 h-6 text-primary-foreground" />
                        )}
                      </div>
                    )}
                  </button>

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-bold truncate">{med.name}</h3>
                    <p className="text-muted-foreground text-sm">{med.dosage} · {med.frequency}</p>
                    {med.instructions && <p className="text-muted-foreground text-xs mt-0.5">{med.instructions}</p>}
                    {med.reminder_times && med.reminder_times.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {med.reminder_times.map((t) => (
                          <span key={t} className="bg-primary/10 text-primary font-semibold px-3 py-1 rounded-full text-xs">
                            🕐 {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  {!isDemo && (
                    <div className="flex flex-col gap-1 shrink-0">
                      <Button variant="ghost" size="icon" className="h-9 w-9 text-primary hover:bg-primary/10" onClick={() => openEdit(med)}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      {med.medicine_photo_url && (
                        <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:bg-muted" onClick={() => removePhoto(med)} title="Remove photo">
                          <ImageOff className="w-4 h-4" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive hover:bg-destructive/10" onClick={() => setDeletingMed(med)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* ── Edit Dialog ─────────────────────────────────────────────── */}
      <Dialog open={!!editingMed} onOpenChange={(open) => !open && setEditingMed(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Edit Medicine</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label className="text-base font-semibold">Name *</Label>
              <Input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} className="mt-1.5 min-h-btn text-base rounded-xl" />
            </div>
            <div>
              <Label className="text-base font-semibold">Dosage *</Label>
              <Input value={editForm.dosage} onChange={(e) => setEditForm((f) => ({ ...f, dosage: e.target.value }))} className="mt-1.5 min-h-btn text-base rounded-xl" />
            </div>
            <div>
              <Label className="text-base font-semibold">Frequency</Label>
              <select
                value={editForm.frequency}
                onChange={(e) => handleFrequencyChange(e.target.value)}
                className="mt-1.5 w-full min-h-btn text-base rounded-xl border bg-background px-3 py-2"
              >
                {FREQUENCY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-base font-semibold">Instructions</Label>
              <Input value={editForm.instructions} onChange={(e) => setEditForm((f) => ({ ...f, instructions: e.target.value }))} className="mt-1.5 min-h-btn text-base rounded-xl" placeholder="e.g. After food" />
            </div>

            {timeSlotCount > 0 && (
              <div className="bg-muted/40 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary" />
                  <Label className="text-base font-semibold">Reminder Times</Label>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {editForm.reminder_times.map((time, tIdx) => (
                    <div key={tIdx} className="flex items-center gap-2">
                      <input
                        type="time"
                        value={time}
                        onChange={(e) => updateReminderTime(tIdx, e.target.value)}
                        className="w-full min-h-btn text-base rounded-xl border bg-background px-3 py-2 text-center font-semibold"
                      />
                      <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">Dose {tIdx + 1}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1" size="lg" onClick={() => setEditingMed(null)}>Cancel</Button>
              <Button variant="hero" className="flex-1" size="lg" onClick={handleSaveEdit} disabled={saving}>
                {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : "Save Changes ✅"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation ────────────────────────────────────── */}
      <AlertDialog open={!!deletingMed} onOpenChange={(open) => !open && setDeletingMed(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deletingMed?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this medicine and its photo. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
};

export default Medicines;
