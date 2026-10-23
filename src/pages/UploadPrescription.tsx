import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useActivePatient } from "@/contexts/CareContext";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Upload as UploadIcon, FileImage, Loader2, Check, Pencil, Trash2, Plus, Clock, X, Camera, ImagePlus, ImageOff, Pill, AlertTriangle, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { motion } from "framer-motion";
import DashboardLayout from "@/components/DashboardLayout";
import { notifyMedicinesChanged } from "@/plugins/medicineAlarm";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { generateUUID } from "@/lib/uuid";
import { prepareForUpload } from "@/lib/prescriptionImage";
import { describeMedicine, findDuplicates, localToday, type ExistingMedicine } from "@/lib/medicineMatch";
import DuplicateMedicinesDialog, { type DuplicateChoice, type DuplicateItem } from "@/components/DuplicateMedicinesDialog";
import {
  validateImageFile,
  createSafePreviewUrl,
  revokeSafePreviewUrl,
  fileToOptimizedDataUrl,
} from "@/lib/imageUtils";

interface ExtractedMedicine {
  name: string;
  dosage: string;
  frequency: string;
  instructions: string;
  /** Only when written on the prescription; never a default. */
  duration_days: number | null;
  reminder_times: string[];
  /** From the AI: the line as written, how sure it is, and which fields it couldn't read. */
  raw_text?: string;
  confidence?: "high" | "medium" | "low";
  unclear_fields?: string[];
  photoFile?: File;
  photoPreview?: string;
  medicine_photo_url?: string;
}

// `value` is stored in the database (English); `labelKey` is shown via t().
const FREQUENCY_OPTIONS = [
  { labelKey: "freq.onceDaily", value: "Once daily", count: 1 },
  { labelKey: "freq.twiceDaily", value: "Twice daily", count: 2 },
  { labelKey: "freq.threeTimesDaily", value: "Three times daily", count: 3 },
  { labelKey: "freq.asNeeded", value: "As needed", count: 0 },
];

function getTimeSlotCount(frequency: string): number {
  const f = frequency.toLowerCase();
  if (f.includes("three") || f.includes("thrice") || f === "3") return 3;
  if (f.includes("twice") || f === "2") return 2;
  if (f.includes("once") || f === "1") return 1;
  if (f.includes("as needed") || f.includes("optional") || f.includes("prn")) return 0;
  return 1;
}

/** Reminder time for each part of the day the prescription names. */
const TIME_OF_DAY: Record<string, string> = { morning: "08:00", afternoon: "14:00", evening: "18:00", night: "21:00" };
const DAY_ORDER = ["morning", "afternoon", "evening", "night"];

/**
 * When to take it, from the AI's "timing" or, for older replies, from the
 * written instructions ("HS", "after dinner", "BBF" ...). [] = not written.
 */
function timingFor(m: { timing?: string[]; instructions?: string; raw_text?: string }): string[] {
  if (Array.isArray(m.timing) && m.timing.length) return DAY_ORDER.filter((d) => m.timing!.includes(d));
  const text = `${m.instructions ?? ""} ${m.raw_text ?? ""}`.toLowerCase();
  const pattern = text.match(/(?:^|[^\d])([01½])\s*-\s*([01½])\s*-\s*([01½])(?:\s*-\s*([01½]))?(?![\d-])/);
  if (pattern) {
    const slots = pattern[4] !== undefined ? ["morning", "afternoon", "evening", "night"] : ["morning", "afternoon", "night"];
    return slots.filter((_, i) => pattern[i + 1] !== "0");
  }
  const out = new Set<string>();
  if (/(?:^|\W)hs(?:\W|$)|bed ?time|after dinner|before dinner|(?:^|\W)night(?:\W|$)/.test(text)) out.add("night");
  if (/(?:^|\W)bbf(?:\W|$)|breakfast|(?:^|\W)morning(?:\W|$)/.test(text)) out.add("morning");
  if (/lunch|afternoon/.test(text)) out.add("afternoon");
  if (/(?:^|\W)evening(?:\W|$)/.test(text)) out.add("evening");
  return DAY_ORDER.filter((d) => out.has(d));
}

/** "1) Tab Acepar.. 1-0-1 x 3d" -> "Acepar": a starting point the user corrects. */
function guessName(line: string): string {
  const noNum = line.replace(/^[\s\-–—.)(\d]+/, "");
  const name = cleanName(noNum)
    .split(/\s+(?=[\d½]|x\s*\d|od\b|bd\b|tds\b|hs\b)/i)[0]
    .replace(/[?.]+$/g, "")
    .trim();
  return name || noNum.trim();
}

/** "Tab Dolo" -> "Dolo" (the alarm speaks the name). */
const cleanName = (n: string) => n.trim().replace(/^(tab|tabs|tablet|cap|caps|capsule|syp|syr|syrup|inj|oint|susp)\.?\s+/i, "");

function getDefaultTimes(count: number): string[] {
  if (count === 1) return ["08:00"];
  if (count === 2) return ["08:00", "20:00"];
  if (count === 3) return ["08:00", "14:00", "20:00"];
  return [];
}

const UploadPrescription = () => {
  const { active } = useActivePatient();
  const navigate = useNavigate();
  const { t, locale } = useLanguage();

  /** Me, or the patient I manage as a caregiver (no auto-create here). */
  const resolvePatientId = useCallback(async (): Promise<string | null> => {
    if (active && active.canManage) return active.patientId;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: own } = await supabase.from("patients").select("id").eq("user_id", user.id).maybeSingle();
    return own?.id ?? null;
  }, [active]);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [medicines, setMedicines] = useState<ExtractedMedicine[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Blocks a second save from a double tap before `saving` re-renders the button. */
  const savingRef = useRef(false);

  // ── Duplicate check: the patient's active medicines, loaded once per patient ──
  const [existingMeds, setExistingMeds] = useState<ExistingMedicine[]>([]);
  const existingForRef = useRef<string | null>(null);
  const [dupOpen, setDupOpen] = useState(false);
  const [dupChoices, setDupChoices] = useState<Record<number, DuplicateChoice>>({});
  const dupChoicesRef = useRef<Record<number, DuplicateChoice>>({});
  dupChoicesRef.current = dupChoices;
  /** The dialog was answered: the next save applies the choices. */
  const dupResolvedRef = useRef(false);
  /** Extraction progress: preparing the photo, uploading, the AI reading it. */
  const [stage, setStage] = useState<"idle" | "preparing" | "uploading" | "reading">("idle");
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  /** Why the last extraction gave nothing (shown with Try again / Enter manually). */
  const [failure, setFailure] = useState<null | "timeout" | "unreadable" | "not_prescription" | "offline" | "error">(null);
  /** AI-read medicines must be checked against the prescription before saving. */
  const [fromAi, setFromAi] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  /** Medicine lines the AI could see but not read: the user adds them by hand. */
  const [unreadableLines, setUnreadableLines] = useState(0);
  /** The cards are only the AI's partial reading of the lines (all fields to check). */
  const [partlyRead, setPartlyRead] = useState(false);

  // Seconds counter while extracting.
  useEffect(() => {
    if (!loading) return;
    const start = Date.now();
    setElapsed(0);
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [loading]);

  const handleFile = useCallback((f: File) => {
    if (!f.type.startsWith("image/") && f.type !== "application/pdf") {
      toast.error(t("upload.wrongFileType"));
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      toast.error(t("upload.fileTooLarge"));
      return;
    }
    setFile(f);
    setMedicines([]);
    setFailure(null);
    setFromAi(false);
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

  // Server: 40 s per model call plus upload; medium thinking needs more than the old 45 s.
  // The patient's active medicines, once the review list appears (once per patient).
  const hasList = medicines.length > 0;
  useEffect(() => {
    if (!hasList) return;
    let cancelled = false;
    void (async () => {
      const patientId = await resolvePatientId();
      if (!patientId || cancelled || existingForRef.current === patientId) return;
      existingForRef.current = patientId;
      const { data, error } = await supabase
        .from("medicines")
        .select("id, name, dosage, frequency, instructions, reminder_times, is_active, end_date, start_date")
        .eq("patient_id", patientId)
        .eq("is_active", true);
      if (error) {
        console.warn("[duplicates] could not load current medicines:", error.message);
        existingForRef.current = null;
        return;
      }
      if (!cancelled) setExistingMeds((data ?? []) as ExistingMedicine[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [hasList, resolvePatientId]);

  /** Per card: matches an active medicine, or repeats an earlier card. */
  const dupInfo = useMemo(() => findDuplicates(medicines, existingMeds, localToday()), [medicines, existingMeds]);

  const dupItems: DuplicateItem[] = useMemo(
    () =>
      dupInfo
        .map((d, i) => ({ d, i }))
        .filter(({ d }) => d.existing || d.twiceOf !== null)
        .map(({ d, i }) => ({
          index: i,
          name: medicines[i].name || t("upload.medicineName"),
          newDetails: describeMedicine(medicines[i], locale),
          currentDetails: d.existing ? describeMedicine(d.existing, locale) : null,
          possible: d.existingKind === "possible",
          twiceOf: d.existing ? null : d.twiceOf,
        })),
    [dupInfo, medicines, locale, t],
  );

  const EXTRACT_TIMEOUT_MS = 60_000;

  const handleExtract = async () => {
    if (!file) return;
    // Offline: say so at once instead of preparing and uploading first.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setFailure("offline");
      return;
    }
    setLoading(true);
    setFailure(null);
    const ctl = new AbortController();
    abortRef.current = ctl;
    const timeout = window.setTimeout(() => ctl.abort("timeout"), EXTRACT_TIMEOUT_MS);
    let readingTimer: number | undefined;
    const t0 = performance.now();
    try {
      setStage("preparing");
      const img = await prepareForUpload(file);
      console.info(`[extract] photo ${Math.round(img.originalBytes / 1024)} KB -> ${Math.round(img.bytes / 1024)} KB in ${img.ms} ms`);
      if (ctl.signal.aborted) throw new DOMException("Aborted", "AbortError");

      setStage("uploading");
      // The request is one call; after the upload time the AI is reading.
      readingTimer = window.setTimeout(() => setStage("reading"), Math.min(4000, 800 + img.bytes / 200));
      const call = () =>
        supabase.functions.invoke("extract-prescription", {
          body: { imageBase64: img.base64, mimeType: img.mimeType },
          signal: ctl.signal,
        });
      const isServerError = (e: unknown) => ((e as { context?: Response })?.context?.status ?? 0) >= 500;
      let { data, error } = await call();
      // A broken AI answer or a server error: try once more by itself before giving up.
      if (!ctl.signal.aborted && (data?.reason === "parse_error" || isServerError(error))) {
        console.warn("[extract] retrying once:", data?.reason ?? (error as Error)?.message);
        ({ data, error } = await call());
      }
      console.info(
        `[extract] total ${Math.round(performance.now() - t0)} ms, reason ${data?.reason}, medicines ${data?.medicines?.length ?? 0}, ` +
          `partial_lines ${data?.partial_lines?.length ?? 0}, unreadable_lines ${data?.unreadable_lines ?? 0}, timings ${JSON.stringify(data?.timings ?? null)}`,
      );
      if (ctl.signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.reason === "parse_error") throw new Error("parse_error");

      const extracted = (data?.medicines || []).map((m: Partial<ExtractedMedicine> & { timing?: string[] }) => {
        const count = getTimeSlotCount(m.frequency || "");
        // Reminder times from when the doctor said (night for 0-0-1 / HS ...), else defaults.
        const when = timingFor(m);
        const frequency =
          m.frequency || (when.length === 1 ? "Once daily" : when.length === 2 ? "Twice daily" : when.length === 3 ? "Three times daily" : "");
        const times = when.length && when.length === (getTimeSlotCount(frequency) || when.length)
          ? when.map((d) => TIME_OF_DAY[d])
          : frequency ? getDefaultTimes(getTimeSlotCount(frequency)) : [];
        void count;
        return {
          name: cleanName(m.name ?? ""),
          dosage: m.dosage ?? "",
          frequency,
          instructions: m.instructions ?? "",
          duration_days: m.duration_days ?? null,
          raw_text: m.raw_text ?? "",
          confidence: m.confidence ?? "low",
          unclear_fields: m.unclear_fields ?? [],
          // Unknown frequency: no reminder times until the user picks one.
          reminder_times: times,
        };
      }) as ExtractedMedicine[];

      // Nothing read for sure, but lines are visible: offer them as suggestions to check
      // (all fields amber; nothing is saved until the user confirms).
      const partial: string[] = Array.isArray(data?.partial_lines) ? data.partial_lines.filter((x: unknown) => typeof x === "string" && x.trim()) : [];
      const fromPartial = extracted.length === 0 && partial.length > 0 && data?.reason !== "not_prescription";
      if (fromPartial) {
        for (const line of partial) {
          extracted.push({
            name: guessName(line),
            dosage: "",
            frequency: "",
            instructions: "",
            duration_days: null,
            raw_text: line,
            confidence: "low",
            unclear_fields: ["name", "dosage", "frequency", "instructions", "duration_days"],
            reminder_times: [],
          });
        }
      }
      setPartlyRead(fromPartial);

      if (extracted.length === 0) {
        // "unreadable" only when there are no medicines AND no partly read lines.
        setFailure(data?.reason === "not_prescription" ? "not_prescription" : "unreadable");
        return;
      }
      setMedicines(extracted);
      setUnreadableLines(Math.max(0, Number(data?.unreadable_lines) || 0));
      setFromAi(true);
      setConfirmed(false);
      toast.success(t("upload.extracted", { count: extracted.length }));
    } catch (err: unknown) {
      const reason = ctl.signal.reason;
      if (reason === "user") {
        toast(t("upload.cancelled"));
      } else if (reason === "timeout" || (err as { context?: Response })?.context?.status === 504) {
        setFailure("timeout");
      } else if (!navigator.onLine || /fetch|network|Failed to send/i.test(String((err as Error)?.message))) {
        setFailure("offline");
      } else {
        console.error("Extraction error:", err);
        setFailure("error");
      }
    } finally {
      window.clearTimeout(timeout);
      if (readingTimer) window.clearTimeout(readingTimer);
      abortRef.current = null;
      setStage("idle");
      setLoading(false);
    }
  };

  const cancelExtract = () => abortRef.current?.abort("user");

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
          toast.error(t("upload.duplicateTime"));
          return m;
        }
        newTimes[timeIndex] = value;
        return { ...m, reminder_times: newTimes };
      })
    );
  };

  const removeMedicine = (index: number) => {
    const prevPreview = medicines[index]?.photoPreview;
    revokeSafePreviewUrl(prevPreview);
    setMedicines((prev) => prev.filter((_, i) => i !== index));
  };

  const addMedicine = () => {
    setMedicines((prev) => [
      ...prev,
      { name: "", dosage: "", frequency: "Once daily", instructions: "", duration_days: null, reminder_times: ["08:00"] },
    ]);
  };

  const handleMedicinePhoto = (index: number, f: File) => {
    const validation = validateImageFile(f);
    if (!validation.valid) {
      toast.error(validation.error || "Please select a valid image file");
      return;
    }

    // Revoke previous blob URL if any to prevent memory leaks
    const prevPreview = medicines[index]?.photoPreview;
    revokeSafePreviewUrl(prevPreview);

    const objectUrl = createSafePreviewUrl(f);
    setMedicines((prev) =>
      prev.map((m, i) =>
        i === index ? { ...m, photoFile: f, photoPreview: objectUrl } : m
      )
    );
  };

  const removeMedicinePhoto = (index: number) => {
    const prevPreview = medicines[index]?.photoPreview;
    revokeSafePreviewUrl(prevPreview);
    setMedicines((prev) =>
      prev.map((m, i) =>
        i === index ? { ...m, photoFile: undefined, photoPreview: undefined, medicine_photo_url: undefined } : m
      )
    );
  };

  // Revoke object URLs on component unmount
  useEffect(() => {
    return () => {
      medicines.forEach((m) => revokeSafePreviewUrl(m.photoPreview));
    };
  }, [medicines]);

  const handleSave = async () => {
    if (fromAi && !confirmed) {
      toast.error(t("upload.confirmFirst"));
      return;
    }
    const noFreq = medicines.find((m) => !FREQUENCY_OPTIONS.some((o) => o.value === m.frequency));
    if (noFreq) {
      toast.error(t("upload.chooseFrequencyFor", { name: noFreq.name || t("upload.medicineName") }));
      return;
    }
    if (medicines.length === 0) return;
    const invalid = medicines.some((m) => !m.name.trim() || !m.dosage.trim());
    if (invalid) {
      toast.error(t("upload.fillNameDosage"));
      return;
    }

    // Validate times
    for (const med of medicines) {
      const count = getTimeSlotCount(med.frequency);
      if (count > 0 && med.reminder_times.length === 0) {
        toast.error(t("upload.setTimesFor", { name: med.name }));
        return;
      }
      for (const time of med.reminder_times) {
        if (!/^\d{2}:\d{2}$/.test(time)) {
          toast.error(t("upload.invalidTime", { name: med.name }));
          return;
        }
      }
    }

    // Already set for reminders: ask first (nothing is saved until the dialog is answered).
    if (dupItems.length && !dupResolvedRef.current) {
      setDupChoices(Object.fromEntries(dupItems.map((d) => [d.index, "skip" as DuplicateChoice])));
      setDupOpen(true);
      return;
    }
    if (savingRef.current) return; // double tap
    savingRef.current = true;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error(t("upload.loginFirst")); return; }

      // Me, or the patient I'm viewing as a 'manage' caregiver.
      let patient: { id: string } | null = active && active.canManage ? { id: active.patientId } : null;
      if (active && !active.canManage) { toast.error(t("care.viewOnlyCannotAdd", { name: active.name })); return; }

      if (!patient) {
        const { data: own } = await supabase.from("patients").select("id").eq("user_id", user.id).maybeSingle();
        patient = own;
      }

      if (!patient) {
        // Attempt to auto-create patient profile if missing
        const { data: newPatient, error: createPatientErr } = await supabase
          .from("patients")
          .insert({
            user_id: user.id,
            full_name: user.user_metadata?.full_name || "Patient",
          })
          .select("id")
          .single();

        if (createPatientErr || !newPatient) {
          toast.error(t("upload.noPatient"));
          return;
        }
        patient = newPatient;
      }

      const today = new Date().toISOString().split("T")[0];

      // What to do with each card: add (new), update an existing medicine, or skip.
      const plan: DuplicateChoice[] = medicines.map((_, i) => {
        const d = dupInfo[i];
        if (d && (d.existing || d.twiceOf !== null)) return dupChoicesRef.current[i] ?? "skip";
        return "add";
      });

      // Upload medicine photos with safe UUID and fallback (only for medicines that are saved)
      const photoUrls: (string | null)[] = await Promise.all(
        medicines.map(async (m, idx) => {
          if (plan[idx] === "skip") return null;
          if (!m.photoFile) return m.medicine_photo_url || null;

          const ext = (m.photoFile.name.split(".").pop() || "jpg").toLowerCase();
          const uniqueId = generateUUID();
          const path = `${patient.id}/${uniqueId}.${ext}`;

          let publicUrl: string | null = null;

          // Attempt upload to Supabase storage bucket
          try {
            const { error: uploadErr } = await supabase.storage
              .from("medicine-photos")
              .upload(path, m.photoFile, { contentType: m.photoFile.type, upsert: true });

            if (!uploadErr) {
              const { data: urlData } = supabase.storage
                .from("medicine-photos")
                .getPublicUrl(path);
              if (urlData?.publicUrl) {
                publicUrl = urlData.publicUrl;
              }
            } else {
              console.warn("Supabase storage bucket upload notice:", uploadErr.message);
            }
          } catch (storageErr) {
            console.warn("Storage upload exception, using resilient persistence fallback:", storageErr);
          }

          if (publicUrl) {
            return publicUrl;
          }

          // Resilient persistence fallback: convert the photo to an optimized base64 Data URL
          // so it is permanently saved in the database text column and never lost.
          try {
            const dataUrl = await fileToOptimizedDataUrl(m.photoFile);
            return dataUrl || null;
          } catch (convErr: any) {
            console.error("Failed to convert image to data URL:", convErr);
            throw new Error(`Failed to process photo for ${m.name}`);
          }
        })
      );

      const inserts = medicines
        .map((m, idx) => ({ m, idx }))
        .filter(({ idx }) => plan[idx] === "add")
        .map(({ m, idx }) => ({
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
      if (inserts.length) {
        const { error } = await supabase.from("medicines").insert(inserts);
        if (error) throw error;
      }

      // "Update existing": replace dosage, frequency, times, instructions and dates; no new row.
      let updated = 0;
      for (let idx = 0; idx < medicines.length; idx++) {
        const existing = dupInfo[idx]?.existing;
        if (plan[idx] !== "update" || !existing) continue;
        const m = medicines[idx];
        const { error } = await supabase
          .from("medicines")
          .update({
            dosage: m.dosage,
            frequency: m.frequency,
            instructions: m.instructions || null,
            reminder_times: m.reminder_times,
            start_date: today,
            end_date: null,
            is_active: true,
            ...(photoUrls[idx] ? { medicine_photo_url: photoUrls[idx] } : {}),
          })
          .eq("id", existing.id);
        if (error) throw error;
        updated++;
      }
      const skipped = plan.filter((c) => c === "skip").length;

      // Re-sync every phone alarm from the database: new times set, old ones removed.
      if (inserts.length || updated) notifyMedicinesChanged();

      if (dupItems.length) {
        toast.success(t("dup.summary", { added: inserts.length, updated, skipped }));
      } else {
        toast.success(t("upload.saved"));
      }
      if (!inserts.length && !updated) {
        navigate("/medicines");
        return;
      }

      // Send confirmation email in background
      supabase.functions.invoke("send-medicine-email", {
        body: { type: "confirmation", patient_id: patient.id },
      }).then(({ error: emailErr }) => {
        if (emailErr) console.error("Confirmation email error:", emailErr);
        else toast.success(t("upload.emailSent"));
      });

      // Revoke any remaining preview URLs
      medicines.forEach((m) => revokeSafePreviewUrl(m.photoPreview));

      navigate("/medicines");
    } catch (err: any) {
      console.error("Save medicines error:", err);
      toast.error(err.message || "Failed to save medicines");
    } finally {
      savingRef.current = false;
      dupResolvedRef.current = false;
      setDupOpen(false);
      setSaving(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="w-full max-w-2xl space-y-6 overflow-x-hidden">
        <h1 className="text-xl sm:text-2xl font-extrabold">
          {active && !active.isSelf ? t("care.uploadFor", { name: active.name }) : t("uploadPrescription")}
        </h1>
        {active && !active.canManage && (
          <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{t("care.viewOnlyCannotAdd", { name: active.name })}</p>
        )}

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
                <p className="font-bold text-base">{t("upload.uploadFile")}</p>
                <p className="text-sm text-muted-foreground mt-1">{t("upload.galleryOrFiles")}</p>
              </button>
              <button
                onClick={() => document.getElementById("camera-input")?.click()}
                className="bg-card border-2 border-dashed rounded-2xl p-6 text-center hover:border-secondary hover:bg-secondary/5 transition-all shadow-card"
              >
                <div className="w-16 h-16 rounded-2xl bg-secondary/10 flex items-center justify-center mx-auto mb-3">
                  <Camera className="w-8 h-8 text-secondary" />
                </div>
                <p className="font-bold text-base">{t("upload.takePhoto")}</p>
                <p className="text-sm text-muted-foreground mt-1">{t("upload.useCamera")}</p>
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
                  <img src={preview} alt={t("upload.prescriptionAlt")} className="max-h-64 mx-auto rounded-xl mb-4" />
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
                  <p className="text-muted-foreground">{t("upload.dragDrop")}</p>
                </div>
              )}
            </div>

            {file && !loading && (
              <Button className="w-full" variant="hero" size="lg" onClick={handleExtract}>
                {t("upload.extract")}
              </Button>
            )}
            {loading && (
              <div className="rounded-2xl border bg-muted/40 p-4 space-y-3" role="status" aria-live="polite">
                <div className="flex items-center gap-3">
                  <Loader2 className="w-6 h-6 animate-spin text-primary shrink-0" />
                  <p className="flex-1 font-semibold">
                    {stage === "reading" ? t("upload.stageReading") : stage === "uploading" ? t("upload.stageUploading") : t("upload.stagePreparing")}
                  </p>
                  <span className="text-sm tabular-nums text-muted-foreground">{t("upload.elapsed", { s: elapsed })}</span>
                </div>
                <Button variant="outline" className="w-full min-h-[48px]" onClick={cancelExtract}>
                  <X className="w-4 h-4 mr-1.5" /> {t("upload.cancel")}
                </Button>
              </div>
            )}
            {failure && !loading && (
              <div role="alert" className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-3 text-amber-950 dark:text-amber-50">
                <p className="flex items-start gap-2 font-semibold">
                  <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-warning" />
                  <span>
                    {failure === "timeout"
                      ? t("upload.failTimeout")
                      : failure === "offline"
                        ? t("upload.failOffline")
                        : failure === "not_prescription"
                          ? t("upload.failNotPrescription")
                          : failure === "unreadable"
                            ? t("upload.failUnreadable")
                            : t("upload.failSomethingWrong")}
                  </span>
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button variant="outline" className="min-h-[48px] bg-card" onClick={handleExtract}>
                    <RefreshCw className="w-4 h-4 mr-1.5" /> {t("upload.tryAgain")}
                  </Button>
                  <Button variant="outline" className="min-h-[48px] bg-card" onClick={() => { setFailure(null); addMedicine(); }}>
                    <Pencil className="w-4 h-4 mr-1.5" /> {t("upload.enterManually")}
                  </Button>
                </div>
              </div>
            )}

            <div className="text-center pt-2">
              <button
                type="button"
                onClick={addMedicine}
                className="text-sm font-semibold text-primary hover:underline inline-flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" /> {t("upload.manual")}
              </button>
            </div>
          </motion.div>
        )}

        {medicines.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-secondary">
                <Check className="w-6 h-6" />
                <h2 className="text-xl font-extrabold">{t("upload.foundCount", { count: medicines.length })}</h2>
              </div>
              <Button variant="outline" size="sm" onClick={addMedicine} className="gap-1">
                <Plus className="w-4 h-4" /> {t("add")}
              </Button>
            </div>

            {partlyRead && (

              <p role="status" className="flex items-start gap-2 rounded-2xl border-2 border-amber-500 bg-amber-500/10 p-4 text-base font-bold text-amber-950 dark:text-amber-50">

                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-warning" />

                {t("upload.partlyRead")}

              </p>

            )}

            {unreadableLines > 0 && (

              <p role="status" className="flex items-start gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-base font-semibold text-amber-950 dark:text-amber-50">

                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-warning" />

                {t("upload.unreadableLines", { count: unreadableLines })}

              </p>

            )}


            {medicines.map((med, i) => {
              const timeSlotCount = getTimeSlotCount(med.frequency);
              const unclear = new Set(med.unclear_fields ?? []);
              const needsCheck = med.confidence === "low" || med.confidence === "medium" || unclear.size > 0;
              const fieldCls = (f: string) => (unclear.has(f) ? " border-amber-500 ring-2 ring-amber-500/30" : "");

              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className={`bg-card rounded-2xl border p-4 sm:p-6 shadow-card space-y-4 relative overflow-hidden${needsCheck ? " border-2 border-amber-500" : ""}`}
                >
                  {needsCheck && (
                    <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-950 dark:text-amber-50">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-warning" />
                      {t("upload.checkPrescription")}
                    </p>
                  )}
                  {(dupInfo[i]?.existing || dupInfo[i]?.twiceOf !== null) && (
                    <div className="rounded-xl border-2 border-amber-500 bg-amber-500/10 px-3 py-2 text-amber-950 dark:text-amber-50" data-testid="dup-badge">
                      <p className="flex items-center gap-2 text-base font-bold">
                        <AlertTriangle className="w-5 h-5 shrink-0 text-warning" />
                        {dupInfo[i].existing
                          ? t(dupInfo[i].existingKind === "possible" ? "dup.badgePossible" : "dup.badgeExisting")
                          : t("dup.badgeTwice")}
                      </p>
                      <p className="mt-0.5 text-sm">
                        {dupInfo[i].existing
                          ? t("dup.current", { details: describeMedicine(dupInfo[i].existing!, locale) })
                          : t("dup.twiceOfNote", { n: (dupInfo[i].twiceOf ?? 0) + 1 })}
                      </p>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-muted-foreground text-sm">
                      <Pencil className="w-4 h-4" /> {t("upload.tapToEdit")}
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => removeMedicine(i)} className="text-destructive hover:text-destructive">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <div>
                      <Label className="text-base font-semibold">{t("upload.medicineName")}</Label>
                      <Input value={med.name} onChange={(e) => updateMedicine(i, "name", e.target.value)} className={"mt-1.5 min-h-btn text-base rounded-xl" + (med.confidence === "low" ? " border-amber-500 ring-2 ring-amber-500/30" : fieldCls("name"))} placeholder={t("upload.namePlaceholder")} />
                      {med.raw_text && (
                        <p className="mt-1.5 text-sm text-muted-foreground break-words">
                          {t("upload.writtenAs")} <span className="font-medium text-foreground">{med.raw_text}</span>
                        </p>
                      )}
                    </div>
                    <div>
                      <Label className="text-base font-semibold">{t("meds.dosageRequiredLabel")}</Label>
                      <Input value={med.dosage} onChange={(e) => updateMedicine(i, "dosage", e.target.value)} className={"mt-1.5 min-h-btn text-base rounded-xl" + fieldCls("dosage")} placeholder={t("upload.dosagePlaceholder")} />
                    </div>
                    <div>
                      <Label className="text-base font-semibold">{t("meds.frequency")}</Label>
                      <select
                        value={FREQUENCY_OPTIONS.find(o => o.value === med.frequency) ? med.frequency : ""}
                        onChange={(e) => handleFrequencyChange(i, e.target.value)}
                        className={"mt-1.5 w-full min-h-btn text-base rounded-xl border bg-background px-3 py-2" + fieldCls("frequency")}
                      >
                        {!FREQUENCY_OPTIONS.find((o) => o.value === med.frequency) && <option value="">{t("upload.chooseFrequency")}</option>}
                        {FREQUENCY_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label className="text-base font-semibold">{t("meds.instructions")}</Label>
                      <Input value={med.instructions} onChange={(e) => updateMedicine(i, "instructions", e.target.value)} className={"mt-1.5 min-h-btn text-base rounded-xl" + fieldCls("instructions")} placeholder={t("meds.instructionsPlaceholder")} />
                    </div>
                  </div>

                  {/* Medicine Photo */}
                  <div className="bg-muted/40 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <ImagePlus className="w-4 h-4 text-primary" />
                      <Label className="text-base font-semibold">{t("upload.medicinePhoto")}</Label>
                      <span className="text-xs text-muted-foreground">{t("upload.optional")}</span>
                    </div>
                    {med.photoPreview ? (
                      <div className="relative inline-block">
                        <img src={med.photoPreview} alt={t("upload.medicineAlt")} className="w-24 h-24 object-cover rounded-xl border" />
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
                          <ImagePlus className="w-4 h-4" /> {t("upload")}
                        </button>
                        <button
                          onClick={() => document.getElementById(`med-camera-${i}`)?.click()}
                          className="flex items-center gap-2 px-4 py-2 rounded-xl border bg-background hover:bg-secondary/5 transition-colors text-sm font-medium"
                        >
                          <Camera className="w-4 h-4" /> {t("upload.camera")}
                        </button>
                      </div>
                    )}
                    <input
                      id={`med-photo-${i}`}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const selectedFile = e.target.files?.[0];
                        if (selectedFile) handleMedicinePhoto(i, selectedFile);
                        e.target.value = "";
                      }}
                    />
                    <input
                      id={`med-camera-${i}`}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => {
                        const selectedFile = e.target.files?.[0];
                        if (selectedFile) handleMedicinePhoto(i, selectedFile);
                        e.target.value = "";
                      }}
                    />
                  </div>
                  {timeSlotCount > 0 && (
                    <div className="bg-muted/40 rounded-xl p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-primary" />
                        <Label className="text-base font-semibold">{t("meds.reminderTimes")}</Label>
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
                              {t("meds.doseN", { n: tIdx + 1 })}
                            </span>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t(timeSlotCount > 1 ? "upload.setTimesHelpMany" : "upload.setTimesHelpOne", { count: timeSlotCount })}
                      </p>
                    </div>
                  )}

                  {timeSlotCount === 0 && (
                    <div className="bg-muted/40 rounded-xl p-4">
                      <p className="text-sm text-muted-foreground flex items-center gap-2">
                        <Clock className="w-4 h-4" />
                        {t("upload.asNeeded")}
                      </p>
                    </div>
                  )}
                </motion.div>
              );
            })}

            {fromAi && (
              <label className="flex items-start gap-3 rounded-2xl border-2 border-primary/30 bg-primary/5 p-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-1 h-5 w-5 shrink-0 accent-primary"
                />
                <span className="text-base font-semibold">{t("upload.confirmChecked")}</span>
              </label>
            )}

            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                variant="outline"
                className="flex-1"
                size="lg"
                onClick={() => {
                  setFromAi(false);
                  setUnreadableLines(0);
                  setPartlyRead(false);
                  medicines.forEach((m) => revokeSafePreviewUrl(m.photoPreview));
                  setMedicines([]);
                  setFile(null);
                  setPreview(null);
                }}
              >
                {t("upload.another")}
              </Button>
              <Button variant="hero" className="flex-1" size="lg" onClick={handleSave} disabled={saving || (fromAi && !confirmed)}>
                {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : t("upload.confirmSave")}
              </Button>
            </div>
          </motion.div>
        )}
      </div>
      <DuplicateMedicinesDialog
        open={dupOpen}
        items={dupItems}
        choices={dupChoices}
        onChoice={(index, choice) => setDupChoices((c) => ({ ...c, [index]: choice }))}
        saving={saving}
        onCancel={() => {
          dupResolvedRef.current = false;
          setDupOpen(false);
        }}
        onSave={() => {
          dupResolvedRef.current = true;
          void handleSave();
        }}
      />
    </DashboardLayout>
  );
};

export default UploadPrescription;
