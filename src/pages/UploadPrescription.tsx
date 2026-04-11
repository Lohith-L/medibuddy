import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Upload as UploadIcon, FileImage, Loader2, Check, Pencil, Trash2, Plus, Clock, X, Camera, ImagePlus, ImageOff, Pill } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { motion } from "framer-motion";
import DashboardLayout from "@/components/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";

interface ExtractedMedicine {
  name: string;
  dosage: string;
  frequency: string;
  instructions: string;
  duration_days: number;
  reminder_times: string[];
  photoFile?: File;
  photoPreview?: string;
  medicine_photo_url?: string;
}

const FREQUENCY_OPTIONS = [
  { label: "Once daily", value: "Once daily", count: 1 },
  { label: "Twice daily", value: "Twice daily", count: 2 },
  { label: "Three times daily", value: "Three times daily", count: 3 },
  { label: "As needed", value: "As needed", count: 0 },
];

function getTimeSlotCount(frequency: string): number {
  const f = frequency.toLowerCase();
  if (f.includes("three") || f.includes("thrice") || f === "3") return 3;
  if (f.includes("twice") || f === "2") return 2;
  if (f.includes("once") || f === "1") return 1;
  if (f.includes("as needed") || f.includes("optional") || f.includes("prn")) return 0;
  return 1;
}

function getDefaultTimes(count: number): string[] {
  if (count === 1) return ["08:00"];
  if (count === 2) return ["08:00", "20:00"];
  if (count === 3) return ["08:00", "14:00", "20:00"];
  return [];
}

const UploadPrescription = () => {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [medicines, setMedicines] = useState<ExtractedMedicine[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleFile = useCallback((f: File) => {
    if (!f.type.startsWith("image/") && f.type !== "application/pdf") {
      toast.error("Please upload an image or PDF file");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      toast.error("File must be under 10MB");
      return;
    }
    setFile(f);
    setMedicines([]);
    if (f.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (e) => setPreview(e.target?.result as string);
      reader.readAsDataURL(f);
    } else {
      setPreview(null);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleExtract = async () => {
    if (!file) return;
    setLoading(true);
    try {
      const base64 = await fileToBase64(file);
      const { data, error } = await supabase.functions.invoke("extract-prescription", {
        body: { imageBase64: base64, mimeType: file.type },
      });

      if (error) throw error;
      if (data?.error) { toast.error(data.error); return; }

      const extracted = (data?.medicines || []).map((m: any) => {
        const count = getTimeSlotCount(m.frequency || "Once daily");
        return {
          ...m,
          frequency: m.frequency || "Once daily",
          reminder_times: getDefaultTimes(count),
        };
      }) as ExtractedMedicine[];

      if (extracted.length === 0) {
        toast.error("No medicines found. Try a clearer image.");
        return;
      }

      setMedicines(extracted);
      toast.success(`${extracted.length} medicines extracted! 🎉`);
    } catch (err: any) {
      console.error("Extraction error:", err);
      toast.error(err.message || "Failed to extract medicines. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const updateMedicine = (index: number, field: keyof ExtractedMedicine, value: any) => {
    setMedicines((prev) => prev.map((m, i) => (i === index ? { ...m, [field]: value } : m)));
  };

  const handleFrequencyChange = (index: number, newFrequency: string) => {
    const count = getTimeSlotCount(newFrequency);
    const currentTimes = medicines[index].reminder_times;
    let newTimes: string[];

    if (count === 0) {
      newTimes = [];
    } else if (count <= currentTimes.length) {
      newTimes = currentTimes.slice(0, count);
    } else {
      newTimes = [...currentTimes, ...getDefaultTimes(count).slice(currentTimes.length)];
    }

    setMedicines((prev) =>
      prev.map((m, i) =>
        i === index ? { ...m, frequency: newFrequency, reminder_times: newTimes } : m
      )
    );
  };

  const updateReminderTime = (medIndex: number, timeIndex: number, value: string) => {
    setMedicines((prev) =>
      prev.map((m, i) => {
        if (i !== medIndex) return m;
        const newTimes = [...m.reminder_times];
        // Check for duplicates
        if (newTimes.includes(value) && newTimes[timeIndex] !== value) {
          toast.error("This time is already set for this medicine");
          return m;
        }
        newTimes[timeIndex] = value;
        return { ...m, reminder_times: newTimes };
      })
    );
  };

  const removeMedicine = (index: number) => {
    setMedicines((prev) => prev.filter((_, i) => i !== index));
  };

  const addMedicine = () => {
    setMedicines((prev) => [
      ...prev,
      { name: "", dosage: "", frequency: "Once daily", instructions: "", duration_days: 30, reminder_times: ["08:00"] },
    ]);
  };

  const handleMedicinePhoto = (index: number, f: File) => {
    if (!f.type.startsWith("image/")) {
      toast.error("Please select an image file (JPG/PNG)");
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      setMedicines((prev) =>
        prev.map((m, i) =>
          i === index ? { ...m, photoFile: f, photoPreview: e.target?.result as string } : m
        )
      );
    };
    reader.readAsDataURL(f);
  };

  const removeMedicinePhoto = (index: number) => {
    setMedicines((prev) =>
      prev.map((m, i) =>
        i === index ? { ...m, photoFile: undefined, photoPreview: undefined, medicine_photo_url: undefined } : m
      )
    );
  };

  const handleSave = async () => {
    if (medicines.length === 0) return;
    const invalid = medicines.some((m) => !m.name.trim() || !m.dosage.trim());
    if (invalid) {
      toast.error("Please fill in at least name and dosage for all medicines.");
      return;
    }

    // Validate times
    for (const med of medicines) {
      const count = getTimeSlotCount(med.frequency);
      if (count > 0 && med.reminder_times.length === 0) {
        toast.error(`Please set reminder times for ${med.name}`);
        return;
      }
      for (const t of med.reminder_times) {
        if (!/^\d{2}:\d{2}$/.test(t)) {
          toast.error(`Invalid time format for ${med.name}. Use HH:MM`);
          return;
        }
      }
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error("Please log in first"); return; }

      const { data: patient } = await supabase
        .from("patients")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!patient) { toast.error("Patient profile not found"); return; }

      const today = new Date().toISOString().split("T")[0];

      // Upload medicine photos first
      const photoUrls: (string | null)[] = await Promise.all(
        medicines.map(async (m) => {
          if (!m.photoFile) return m.medicine_photo_url || null;
          const ext = m.photoFile.name.split(".").pop() || "jpg";
          const path = `${patient.id}/${crypto.randomUUID()}.${ext}`;
          const { error: uploadErr } = await supabase.storage
            .from("medicine-photos")
            .upload(path, m.photoFile, { contentType: m.photoFile.type });
          if (uploadErr) {
            console.error("Photo upload error:", uploadErr);
            return null;
          }
          const { data: urlData } = supabase.storage.from("medicine-photos").getPublicUrl(path);
          return urlData.publicUrl;
        })
      );

      const inserts = medicines.map((m, idx) => ({
        patient_id: patient.id,
        name: m.name,
        dosage: m.dosage,
        frequency: m.frequency,
        instructions: m.instructions,
        reminder_times: m.reminder_times,
        start_date: today,
        is_active: true,
        medicine_photo_url: photoUrls[idx],
      }));

      const { error } = await supabase.from("medicines").insert(inserts);
      if (error) throw error;

      toast.success("Medicines saved with reminder times! ✅");

      // Send confirmation email in background
      supabase.functions.invoke("send-medicine-email", {
        body: { type: "confirmation", patient_id: patient.id },
      }).then(({ error: emailErr }) => {
        if (emailErr) console.error("Confirmation email error:", emailErr);
        else toast.success("Confirmation email sent! 📧");
      });

      navigate("/medicines");
    } catch (err: any) {
      toast.error(err.message || "Failed to save medicines");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="w-full max-w-2xl space-y-6 overflow-x-hidden">
        <h1 className="text-xl sm:text-2xl font-extrabold">Upload Prescription</h1>

        {medicines.length === 0 && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            {/* Upload Options */}
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => document.getElementById("file-input")?.click()}
                className="bg-card border-2 border-dashed rounded-2xl p-6 text-center hover:border-primary hover:bg-primary/5 transition-all shadow-card"
              >
                <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <UploadIcon className="w-8 h-8 text-primary" />
                </div>
                <p className="font-bold text-base">Upload File</p>
                <p className="text-sm text-muted-foreground mt-1">Gallery or Files</p>
              </button>
              <button
                onClick={() => document.getElementById("camera-input")?.click()}
                className="bg-card border-2 border-dashed rounded-2xl p-6 text-center hover:border-secondary hover:bg-secondary/5 transition-all shadow-card"
              >
                <div className="w-16 h-16 rounded-2xl bg-secondary/10 flex items-center justify-center mx-auto mb-3">
                  <Camera className="w-8 h-8 text-secondary" />
                </div>
                <p className="font-bold text-base">Take Photo</p>
                <p className="text-sm text-muted-foreground mt-1">Use Camera</p>
              </button>
            </div>

            <input
              id="file-input"
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
            <input
              id="camera-input"
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />

            {/* Drag & Drop Zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer bg-card ${
                dragOver ? "border-primary bg-primary/5 shadow-card-hover" : "border-border shadow-card"
              }`}
              onClick={() => document.getElementById("file-input")?.click()}
            >
              {preview ? (
                <div className="relative">
                  <img src={preview} alt="Prescription" className="max-h-64 mx-auto rounded-xl mb-4" />
                  <button
                    onClick={(e) => { e.stopPropagation(); setFile(null); setPreview(null); }}
                    className="absolute top-2 right-2 w-8 h-8 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : file ? (
                <div className="flex flex-col items-center gap-2">
                  <FileImage className="w-16 h-16 text-primary" />
                  <p className="font-semibold">{file.name}</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <p className="text-muted-foreground">or drag & drop your prescription here</p>
                </div>
              )}
            </div>

            {file && (
              <Button className="w-full" variant="hero" size="lg" onClick={handleExtract} disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    🤖 AI is reading your prescription...
                  </>
                ) : (
                  "Extract Medicines with AI ✨"
                )}
              </Button>
            )}
          </motion.div>
        )}

        {medicines.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-secondary">
                <Check className="w-6 h-6" />
                <h2 className="text-xl font-extrabold">{medicines.length} medicines found!</h2>
              </div>
              <Button variant="outline" size="sm" onClick={addMedicine} className="gap-1">
                <Plus className="w-4 h-4" /> Add
              </Button>
            </div>

            {medicines.map((med, i) => {
              const timeSlotCount = getTimeSlotCount(med.frequency);

              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="bg-card rounded-2xl border p-4 sm:p-6 shadow-card space-y-4 relative overflow-hidden"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-muted-foreground text-sm">
                      <Pencil className="w-4 h-4" /> Tap to edit
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => removeMedicine(i)} className="text-destructive hover:text-destructive">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <div>
                      <Label className="text-base font-semibold">Medicine Name *</Label>
                      <Input value={med.name} onChange={(e) => updateMedicine(i, "name", e.target.value)} className="mt-1.5 min-h-btn text-base rounded-xl" placeholder="e.g. Paracetamol" />
                    </div>
                    <div>
                      <Label className="text-base font-semibold">Dosage *</Label>
                      <Input value={med.dosage} onChange={(e) => updateMedicine(i, "dosage", e.target.value)} className="mt-1.5 min-h-btn text-base rounded-xl" placeholder="e.g. 500mg" />
                    </div>
                    <div>
                      <Label className="text-base font-semibold">Frequency</Label>
                      <select
                        value={FREQUENCY_OPTIONS.find(o => o.value === med.frequency) ? med.frequency : ""}
                        onChange={(e) => handleFrequencyChange(i, e.target.value)}
                        className="mt-1.5 w-full min-h-btn text-base rounded-xl border bg-background px-3 py-2"
                      >
                        {FREQUENCY_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label className="text-base font-semibold">Instructions</Label>
                      <Input value={med.instructions} onChange={(e) => updateMedicine(i, "instructions", e.target.value)} className="mt-1.5 min-h-btn text-base rounded-xl" placeholder="e.g. After food" />
                    </div>
                  </div>

                  {/* Medicine Photo */}
                  <div className="bg-muted/40 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <ImagePlus className="w-4 h-4 text-primary" />
                      <Label className="text-base font-semibold">Medicine Photo</Label>
                      <span className="text-xs text-muted-foreground">(optional)</span>
                    </div>
                    {med.photoPreview ? (
                      <div className="relative inline-block">
                        <img src={med.photoPreview} alt="Medicine" className="w-24 h-24 object-cover rounded-xl border" />
                        <button
                          onClick={() => removeMedicinePhoto(i)}
                          className="absolute -top-2 -right-2 w-6 h-6 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          onClick={() => document.getElementById(`med-photo-${i}`)?.click()}
                          className="flex items-center gap-2 px-4 py-2 rounded-xl border bg-background hover:bg-primary/5 transition-colors text-sm font-medium"
                        >
                          <ImagePlus className="w-4 h-4" /> Upload
                        </button>
                        <button
                          onClick={() => document.getElementById(`med-camera-${i}`)?.click()}
                          className="flex items-center gap-2 px-4 py-2 rounded-xl border bg-background hover:bg-secondary/5 transition-colors text-sm font-medium"
                        >
                          <Camera className="w-4 h-4" /> Camera
                        </button>
                      </div>
                    )}
                    <input
                      id={`med-photo-${i}`}
                      type="file"
                      accept="image/jpeg,image/png"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && handleMedicinePhoto(i, e.target.files[0])}
                    />
                    <input
                      id={`med-camera-${i}`}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && handleMedicinePhoto(i, e.target.files[0])}
                    />
                  </div>
                  {timeSlotCount > 0 && (
                    <div className="bg-muted/40 rounded-xl p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-primary" />
                        <Label className="text-base font-semibold">Reminder Times</Label>
                      </div>
                      <div className="flex flex-wrap gap-3">
                        {med.reminder_times.map((time, tIdx) => (
                          <div key={tIdx} className="flex items-center gap-2 min-w-[140px] flex-1 sm:flex-none sm:w-auto">
                            <div className="flex-1 relative">
                              <input
                                type="time"
                                value={time}
                                onChange={(e) => updateReminderTime(i, tIdx, e.target.value)}
                                className="w-full min-h-btn text-base rounded-xl border bg-background px-3 py-2 text-center font-semibold"
                              />
                            </div>
                            <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">
                              Dose {tIdx + 1}
                            </span>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Set {timeSlotCount} reminder time{timeSlotCount > 1 ? "s" : ""} in HH:MM format
                      </p>
                    </div>
                  )}

                  {timeSlotCount === 0 && (
                    <div className="bg-muted/40 rounded-xl p-4">
                      <p className="text-sm text-muted-foreground flex items-center gap-2">
                        <Clock className="w-4 h-4" />
                        No fixed schedule — take as needed
                      </p>
                    </div>
                  )}
                </motion.div>
              );
            })}

            <div className="flex flex-col sm:flex-row gap-3">
              <Button variant="outline" className="flex-1" size="lg" onClick={() => { setMedicines([]); setFile(null); setPreview(null); }}>
                Upload Another
              </Button>
              <Button variant="hero" className="flex-1" size="lg" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : "Confirm & Save ✅"}
              </Button>
            </div>
          </motion.div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default UploadPrescription;
