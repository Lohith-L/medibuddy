import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";
import nodemailer from "npm:nodemailer@6.9.10";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// IST is UTC+5:30
function getISTNow(): Date {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  return new Date(now.getTime() + istOffset);
}

function getISTDate(ist: Date): string {
  return ist.toISOString().split("T")[0];
}

function getISTTime(ist: Date): string {
  return `${String(ist.getUTCHours()).padStart(2, "0")}:${String(ist.getUTCMinutes()).padStart(2, "0")}`;
}

// ── Static multilingual email templates ──────────────────────────────
interface EmailData {
  name: string;
  medicineName: string;
  dosage: string;
  time: string;
  instructions: string;
  photoUrl?: string | null;
}

function getReminderSubject(lang: string, medicineName: string): string {
  const subjects: Record<string, string> = {
    en: `⏰ Time to take your medicine: ${medicineName}`,
    hi: `⏰ दवा लेने का समय हो गया है: ${medicineName}`,
    kn: `⏰ ನಿಮ್ಮ ಔಷಧಿ ತೆಗೆದುಕೊಳ್ಳುವ ಸಮಯ ಬಂದಿದೆ: ${medicineName}`,
    te: `⏰ మందు తీసుకునే సమయం: ${medicineName}`,
    ta: `⏰ மருந்து எடுக்கும் நேரம்: ${medicineName}`,
    mr: `⏰ औषध घेण्याची वेळ: ${medicineName}`,
  };
  return subjects[lang] || subjects["en"];
}

function getReminderText(lang: string, d: EmailData): string {
  const templates: Record<string, string> = {
    en: `Hello ${d.name},\n\nThis is a reminder to take your medicine.\n\nMedicine: ${d.medicineName}\nDosage: ${d.dosage}\nTime: ${d.time}\nInstructions: ${d.instructions}\n\nPlease take your medicine on time and stay healthy ❤️`,
    hi: `नमस्ते ${d.name},\n\nयह आपकी दवा लेने की याद दिलाने के लिए है।\n\nदवा: ${d.medicineName}\nखुराक: ${d.dosage}\nसमय: ${d.time}\nनिर्देश: ${d.instructions}\n\nकृपया समय पर दवा लें ❤️`,
    kn: `ನಮಸ್ಕಾರ ${d.name},\n\nಇದು ನಿಮ್ಮ ಔಷಧಿ ತೆಗೆದುಕೊಳ್ಳುವ ನೆನಪಿನ ಸಂದೇಶ.\n\nಔಷಧಿ: ${d.medicineName}\nಮಾತ್ರೆ: ${d.dosage}\nಸಮಯ: ${d.time}\nಸೂಚನೆ: ${d.instructions}\n\nದಯವಿಟ್ಟು ಸಮಯಕ್ಕೆ ಔಷಧಿ ತೆಗೆದುಕೊಳ್ಳಿ ❤️`,
    te: `నమస్కారం ${d.name},\n\nమీ మందు తీసుకోవడానికి ఇది రిమైండర్.\n\nమందు: ${d.medicineName}\nమోతాదు: ${d.dosage}\nసమయం: ${d.time}\nసూచనలు: ${d.instructions}\n\nదయచేసి సమయానికి మందు తీసుకోండి ❤️`,
    ta: `வணக்கம் ${d.name},\n\nமருந்து எடுக்க நினைவூட்டல்.\n\nமருந்து: ${d.medicineName}\nஅளவு: ${d.dosage}\nநேரம்: ${d.time}\nஅறிவுரை: ${d.instructions}\n\nதயவுசெய்து நேரத்திற்கு மருந்து எடுங்கள் ❤️`,
    mr: `नमस्कार ${d.name},\n\nहे तुमचे औषध घेण्याचे स्मरणपत्र आहे.\n\nऔषध: ${d.medicineName}\nडोस: ${d.dosage}\nवेळ: ${d.time}\nसूचना: ${d.instructions}\n\nकृपया वेळेवर औषध घ्या ❤️`,
  };
  return templates[lang] || templates["en"];
}

function getReminderHtml(lang: string, d: EmailData): string {
  const i18n: Record<string, { heading: string; greeting: string; body: string; medLabel: string; dosageLabel: string; timeLabel: string; instrLabel: string; footer: string }> = {
    en: { heading: "⏰ Medicine Reminder", greeting: `Hello <b>${d.name}</b>,`, body: "This is a reminder to take your medicine.", medLabel: "Medicine", dosageLabel: "Dosage", timeLabel: "Time", instrLabel: "Instructions", footer: "Please take your medicine on time. Stay healthy ❤️" },
    hi: { heading: "⏰ दवा रिमाइंडर", greeting: `नमस्ते <b>${d.name}</b>,`, body: "यह आपकी दवा लेने की याद दिलाने के लिए है।", medLabel: "दवा", dosageLabel: "खुराक", timeLabel: "समय", instrLabel: "निर्देश", footer: "कृपया समय पर दवा लें ❤️" },
    kn: { heading: "⏰ ಔಷಧಿ ನೆನಪು", greeting: `ನಮಸ್ಕಾರ <b>${d.name}</b>,`, body: "ಇದು ನಿಮ್ಮ ಔಷಧಿ ತೆಗೆದುಕೊಳ್ಳುವ ನೆನಪಿನ ಸಂದೇಶ.", medLabel: "ಔಷಧಿ", dosageLabel: "ಮಾತ್ರೆ", timeLabel: "ಸಮಯ", instrLabel: "ಸೂಚನೆ", footer: "ದಯವಿಟ್ಟು ಸಮಯಕ್ಕೆ ಔಷಧಿ ತೆಗೆದುಕೊಳ್ಳಿ ❤️" },
    te: { heading: "⏰ మందు రిమైండర్", greeting: `నమస్కారం <b>${d.name}</b>,`, body: "మీ మందు తీసుకోవడానికి ఇది రిమైండర్.", medLabel: "మందు", dosageLabel: "మోతాదు", timeLabel: "సమయం", instrLabel: "సూచనలు", footer: "దయచేసి సమయానికి మందు తీసుకోండి ❤️" },
    ta: { heading: "⏰ மருந்து நினைவூட்டல்", greeting: `வணக்கம் <b>${d.name}</b>,`, body: "மருந்து எடுக்க நினைவூட்டல்.", medLabel: "மருந்து", dosageLabel: "அளவு", timeLabel: "நேரம்", instrLabel: "அறிவுரை", footer: "தயவுசெய்து நேரத்திற்கு மருந்து எடுங்கள் ❤️" },
    mr: { heading: "⏰ औषध स्मरणपत्र", greeting: `नमस्कार <b>${d.name}</b>,`, body: "हे तुमचे औषध घेण्याचे स्मरणपत्र आहे.", medLabel: "औषध", dosageLabel: "डोस", timeLabel: "वेळ", instrLabel: "सूचना", footer: "कृपया वेळेवर औषध घ्या ❤️" },
  };
  const t = i18n[lang] || i18n["en"];

  return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;padding:20px;background:#f0faf5;margin:0;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:#52B788;padding:18px 24px;text-align:center;">
      <h2 style="margin:0;color:#fff;font-size:22px;">${t.heading}</h2>
    </div>
    <div style="padding:24px;">
      <p style="font-size:16px;color:#333;">${t.greeting}</p>
      <p style="font-size:16px;color:#555;">${t.body}</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;" border="1" cellpadding="10">
        <tr style="background:#e8f5e9;">
          <th style="text-align:left;color:#333;">${t.medLabel}</th>
          <th style="text-align:left;color:#333;">${t.dosageLabel}</th>
          <th style="text-align:left;color:#333;">${t.timeLabel}</th>
        </tr>
        <tr>
          <td style="color:#222;font-weight:bold;">${d.medicineName}</td>
          <td style="color:#222;">${d.dosage}</td>
          <td style="color:#222;">${d.time}</td>
        </tr>
      </table>
      <p style="font-size:15px;color:#555;"><b>${t.instrLabel}:</b> ${d.instructions}</p>
      ${d.photoUrl ? `<div style="text-align:center;margin:16px 0;"><img src="${d.photoUrl}" alt="${d.medicineName}" style="max-width:150px;border-radius:8px;border:1px solid #e0e0e0;" /></div>` : ""}
      <p style="font-size:16px;color:#52B788;font-weight:bold;margin-top:24px;text-align:center;">${t.footer}</p>
    </div>
    <div style="background:#f0faf5;padding:12px;text-align:center;font-size:12px;color:#999;">
      MEDDIBUDDY — Your Medicine Companion
    </div>
  </div>
</body>
</html>`;
}

// ── Email sender using nodemailer ────────────────────────────────────
async function sendEmail(to: string, subject: string, html: string, text: string) {
  const gmailUser = Deno.env.get("GMAIL_USER");
  const gmailPass = Deno.env.get("GMAIL_APP_PASSWORD");
  if (!gmailUser || !gmailPass) throw new Error("Gmail credentials not configured");

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: gmailUser, pass: gmailPass },
  });

  await transporter.sendMail({
    from: `MEDDIBUDDY <${gmailUser}>`,
    to,
    subject,
    html,
    text,
  });
}

function normalizeLanguageCode(lang: string): string {
  if (!lang) return "en";
  const lower = lang.toLowerCase().trim();
  const map: Record<string, string> = {
    english: "en", hindi: "hi", kannada: "kn",
    telugu: "te", tamil: "ta", marathi: "mr",
    en: "en", hi: "hi", kn: "kn", te: "te", ta: "ta", mr: "mr",
  };
  return map[lower] || "en";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const debugMode = req.method === "POST";
  let debugPayload: any = {};

  try {
    if (debugMode) {
      try { debugPayload = await req.json(); } catch { debugPayload = {}; }
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const utcNow = new Date();
    const istNow = getISTNow();
    const currentDate = getISTDate(istNow);
    const currentTime = getISTTime(istNow);

    console.log(`[reminder-cron] ===== RUN START =====`);
    console.log(`[reminder-cron] UTC:  ${utcNow.toISOString()}`);
    console.log(`[reminder-cron] IST:  ${istNow.toISOString()}`);
    console.log(`[reminder-cron] Date: ${currentDate} | Time: ${currentTime}`);

    // Fetch all active medicines
    const { data: allMedicines, error: medErr } = await supabase
      .from("medicines")
      .select("id, name, dosage, frequency, instructions, reminder_times, patient_id, start_date, end_date, medicine_photo_url")
      .eq("is_active", true);

    if (medErr) throw medErr;

    console.log(`[reminder-cron] Total active medicines: ${(allMedicines || []).length}`);

    // Filter: time must match AND date must be in range
    const matchingMeds = (allMedicines || []).filter((m: any) => {
      const times: string[] = m.reminder_times || [];
      if (times.length === 0) return false;
      if (!times.includes(currentTime)) return false;

      // Date range check
      if (m.start_date && currentDate < m.start_date) return false;
      if (m.end_date && currentDate > m.end_date) return false;

      return true;
    });

    console.log(`[reminder-cron] Matching medicines for ${currentDate} ${currentTime}: ${matchingMeds.length}`);

    if (matchingMeds.length === 0) {
      // Log skip reasons for debugging
      const skipReasons: string[] = [];
      for (const m of (allMedicines || [])) {
        const times: string[] = m.reminder_times || [];
        if (times.length === 0) {
          skipReasons.push(`${m.name}: no reminder_times set`);
        } else if (!times.includes(currentTime)) {
          skipReasons.push(`${m.name}: times ${JSON.stringify(times)} don't match ${currentTime}`);
        } else if (m.start_date && currentDate < m.start_date) {
          skipReasons.push(`${m.name}: before start_date ${m.start_date}`);
        } else if (m.end_date && currentDate > m.end_date) {
          skipReasons.push(`${m.name}: after end_date ${m.end_date}`);
        }
      }
      console.log(`[reminder-cron] Skip reasons:`, JSON.stringify(skipReasons.slice(0, 10)));
    }

    let sentCount = 0;
    let errorCount = 0;
    let skipCount = 0;
    const results: any[] = [];

    for (const med of matchingMeds) {
      try {
        // Deduplication via reminder_send_logs
        const { data: existingLog } = await supabase
          .from("reminder_send_logs")
          .select("id")
          .eq("medicine_id", med.id)
          .eq("scheduled_for_date", currentDate)
          .eq("scheduled_for_time", currentTime)
          .eq("status", "sent")
          .maybeSingle();

        if (existingLog) {
          console.log(`[reminder-cron] SKIP duplicate: ${med.name} at ${currentTime}`);
          skipCount++;
          results.push({ medicine: med.name, status: "skipped", reason: "already sent" });
          continue;
        }

        // Also dedup via reminder_events
        const { data: existingEvent } = await supabase
          .from("reminder_events")
          .select("id")
          .eq("medicine_id", med.id)
          .eq("scheduled_date", currentDate)
          .eq("scheduled_time", currentTime)
          .maybeSingle();

        if (existingEvent) {
          console.log(`[reminder-cron] SKIP existing event: ${med.name} at ${currentTime}`);
          skipCount++;
          results.push({ medicine: med.name, status: "skipped", reason: "event exists" });
          continue;
        }

        // Fetch patient
        const { data: patient } = await supabase
          .from("patients")
          .select("id, name, email, language, caregiver_email")
          .eq("id", med.patient_id)
          .single();

        if (!patient) {
          console.error(`[reminder-cron] No patient for medicine ${med.id}`);
          results.push({ medicine: med.name, status: "skipped", reason: "no patient" });
          skipCount++;
          continue;
        }

        if (!patient.email) {
          console.error(`[reminder-cron] No email for patient ${patient.id}`);
          results.push({ medicine: med.name, status: "skipped", reason: "no email" });
          skipCount++;
          continue;
        }

        const langCode = normalizeLanguageCode(patient.language);

        // Create reminder_event
        await supabase.from("reminder_events").insert({
          medicine_id: med.id,
          patient_id: patient.id,
          caretaker_email: patient.caregiver_email,
          scheduled_date: currentDate,
          scheduled_time: currentTime,
          status: "pending",
          sent_at: new Date().toISOString(),
        });

        // Create medicine_log
        const scheduledDateTime = new Date(`${currentDate}T${currentTime}:00+05:30`);
        await supabase.from("medicine_logs").insert({
          medicine_id: med.id,
          patient_id: patient.id,
          scheduled_time: scheduledDateTime.toISOString(),
          status: "pending",
        });

        // Build and send email using static templates
        const emailData: EmailData = {
          name: patient.name,
          medicineName: med.name,
          dosage: med.dosage,
          time: currentTime,
          instructions: med.instructions || (langCode === "en" ? "No special instructions" : "—"),
          photoUrl: med.medicine_photo_url,
        };

        const subject = getReminderSubject(langCode, med.name);
        const html = getReminderHtml(langCode, emailData);
        const text = getReminderText(langCode, emailData);

        await sendEmail(patient.email, subject, html, text);
        sentCount++;

        // Log success
        await supabase.from("reminder_send_logs").insert({
          medicine_id: med.id,
          patient_id: patient.id,
          patient_email: patient.email,
          scheduled_for_date: currentDate,
          scheduled_for_time: currentTime,
          status: "sent",
          sent_at: new Date().toISOString(),
          language_used: langCode,
          delivery_channel: "email",
        });

        console.log(`[reminder-cron] ✅ Sent: ${med.name} → ${patient.email}`);
        results.push({ medicine: med.name, status: "sent", email: patient.email });
      } catch (err: any) {
        errorCount++;
        console.error(`[reminder-cron] ❌ Failed: ${med.name}:`, err.message);

        // Log failure
        const supabaseUrl2 = Deno.env.get("SUPABASE_URL")!;
        const supabaseKey2 = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const sb2 = createClient(supabaseUrl2, supabaseKey2);
        try {
          await sb2.from("reminder_send_logs").insert({
            medicine_id: med.id,
            patient_id: med.patient_id,
            patient_email: "unknown",
            scheduled_for_date: currentDate,
            scheduled_for_time: currentTime,
            status: "failed",
            error_message: err.message?.substring(0, 500),
            language_used: "en",
            delivery_channel: "email",
          });
        } catch {
          // Ignore secondary logging failures so the cron run can continue.
        }

        results.push({ medicine: med.name, status: "failed", error: err.message });
      }
    }

    console.log(`[reminder-cron] ===== SUMMARY: sent=${sentCount} errors=${errorCount} skipped=${skipCount} =====`);

    return new Response(
      JSON.stringify({
        success: true,
        timezone: "IST (UTC+5:30)",
        utc_time: utcNow.toISOString(),
        ist_date: currentDate,
        ist_time: currentTime,
        total_active: (allMedicines || []).length,
        matched: matchingMeds.length,
        sent: sentCount,
        errors: errorCount,
        skipped: skipCount,
        ...(debugMode ? { results } : {}),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("[reminder-cron] Fatal error:", e.message);
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
