import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";
import nodemailer from "npm:nodemailer@6.9.10";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Static multilingual escalation templates ─────────────────────────
interface EscalationData {
  caretakerName: string;
  patientName: string;
  medicineName: string;
  dosage: string;
  scheduledTime: string;
  instructions: string;
}

function getEscalationSubject(lang: string, patientName: string, medicineName: string): string {
  const subjects: Record<string, string> = {
    en: `⚠️ URGENT: ${patientName} missed ${medicineName} — Please check!`,
    hi: `⚠️ तुरंत: ${patientName} ने ${medicineName} नहीं ली — कृपया जांचें!`,
    kn: `⚠️ ತುರ್ತು: ${patientName} ${medicineName} ತೆಗೆದುಕೊಂಡಿಲ್ಲ — ದಯವಿಟ್ಟು ಪರಿಶೀಲಿಸಿ!`,
    te: `⚠️ అత్యవసరం: ${patientName} ${medicineName} తీసుకోలేదు — దయచేసి చూడండి!`,
    ta: `⚠️ அவசரம்: ${patientName} ${medicineName} எடுக்கவில்லை — தயவுசெய்து சரிபாருங்கள்!`,
    mr: `⚠️ तातडी: ${patientName} ने ${medicineName} घेतले नाही — कृपया तपासा!`,
  };
  return subjects[lang] || subjects["en"];
}

function getEscalationText(lang: string, d: EscalationData): string {
  const templates: Record<string, string> = {
    en: `Dear ${d.caretakerName},\n\nURGENT ALERT: Patient ${d.patientName} has NOT confirmed taking their medicine within 2 minutes.\n\nMedicine: ${d.medicineName}\nDosage: ${d.dosage}\nScheduled Time: ${d.scheduledTime}\nInstructions: ${d.instructions}\n\nPlease check on the patient immediately.\n\nStay Healthy ❤️\nMedBuddy`,
    hi: `प्रिय ${d.caretakerName},\n\nतुरंत सूचना: मरीज ${d.patientName} ने 2 मिनट के अंदर दवा लेने की पुष्टि नहीं की है।\n\nदवा: ${d.medicineName}\nखुराक: ${d.dosage}\nसमय: ${d.scheduledTime}\nनिर्देश: ${d.instructions}\n\nकृपया तुरंत मरीज की जांच करें।\n\nस्वस्थ रहें ❤️\nMedBuddy`,
    kn: `ಪ್ರಿಯ ${d.caretakerName},\n\nತುರ್ತು ಎಚ್ಚರಿಕೆ: ರೋಗಿ ${d.patientName} 2 ನಿಮಿಷಗಳಲ್ಲಿ ಔಷಧಿ ತೆಗೆದುಕೊಂಡಿರುವುದನ್ನು ದೃಢಪಡಿಸಿಲ್ಲ.\n\nಔಷಧಿ: ${d.medicineName}\nಮಾತ್ರೆ: ${d.dosage}\nಸಮಯ: ${d.scheduledTime}\nಸೂಚನೆ: ${d.instructions}\n\nದಯವಿಟ್ಟು ತಕ್ಷಣ ರೋಗಿಯನ್ನು ಪರಿಶೀಲಿಸಿ.\n\nಆರೋಗ್ಯವಾಗಿರಿ ❤️\nMedBuddy`,
    te: `ప్రియ ${d.caretakerName},\n\nఅత్యవసర హెచ్చరిక: రోగి ${d.patientName} 2 నిమిషాలలో మందు తీసుకున్నట్లు నిర్ధారించలేదు.\n\nమందు: ${d.medicineName}\nమోతాదు: ${d.dosage}\nసమయం: ${d.scheduledTime}\nసూచనలు: ${d.instructions}\n\nదయచేసి వెంటనే రోగిని చూడండి.\n\nఆరోగ్యంగా ఉండండి ❤️\nMedBuddy`,
    ta: `அன்புள்ள ${d.caretakerName},\n\nஅவசர எச்சரிக்கை: நோயாளி ${d.patientName} 2 நிமிடங்களுக்குள் மருந்து எடுத்ததை உறுதிப்படுத்தவில்லை.\n\nமருந்து: ${d.medicineName}\nஅளவு: ${d.dosage}\nநேரம்: ${d.scheduledTime}\nஅறிவுரை: ${d.instructions}\n\nதயவுசெய்து உடனடியாக நோயாளியை சரிபாருங்கள்.\n\nஆரோக்கியமாக இருங்கள் ❤️\nMedBuddy`,
    mr: `प्रिय ${d.caretakerName},\n\nतातडीची सूचना: रुग्ण ${d.patientName} ने 2 मिनिटांत औषध घेतल्याची पुष्टी केली नाही.\n\nऔषध: ${d.medicineName}\nडोस: ${d.dosage}\nवेळ: ${d.scheduledTime}\nसूचना: ${d.instructions}\n\nकृपया तात्काळ रुग्णाची तपासणी करा.\n\nनिरोगी रहा ❤️\nMedBuddy`,
  };
  return templates[lang] || templates["en"];
}

function getEscalationHtml(lang: string, d: EscalationData): string {
  const i18n: Record<string, { heading: string; greeting: string; alert: string; medLabel: string; dosageLabel: string; timeLabel: string; instrLabel: string; action: string; footer: string }> = {
    en: { heading: "⚠️ Urgent Medicine Alert", greeting: `Dear <b>${d.caretakerName}</b>,`, alert: `Patient <b>${d.patientName}</b> has <span style="color:#E24B4A;font-weight:bold;">NOT confirmed</span> taking their medicine within 2 minutes.`, medLabel: "Medicine", dosageLabel: "Dosage", timeLabel: "Scheduled Time", instrLabel: "Instructions", action: "Please check on the patient immediately.", footer: "Stay Healthy ❤️" },
    hi: { heading: "⚠️ तुरंत दवा सूचना", greeting: `प्रिय <b>${d.caretakerName}</b>,`, alert: `मरीज <b>${d.patientName}</b> ने 2 मिनट के अंदर दवा लेने की <span style="color:#E24B4A;font-weight:bold;">पुष्टि नहीं</span> की है।`, medLabel: "दवा", dosageLabel: "खुराक", timeLabel: "समय", instrLabel: "निर्देश", action: "कृपया तुरंत मरीज की जांच करें।", footer: "स्वस्थ रहें ❤️" },
    kn: { heading: "⚠️ ತುರ್ತು ಔಷಧಿ ಎಚ್ಚರಿಕೆ", greeting: `ಪ್ರಿಯ <b>${d.caretakerName}</b>,`, alert: `ರೋಗಿ <b>${d.patientName}</b> 2 ನಿಮಿಷಗಳಲ್ಲಿ ಔಷಧಿ ತೆಗೆದುಕೊಂಡಿರುವುದನ್ನು <span style="color:#E24B4A;font-weight:bold;">ದೃಢಪಡಿಸಿಲ್ಲ</span>.`, medLabel: "ಔಷಧಿ", dosageLabel: "ಮಾತ್ರೆ", timeLabel: "ಸಮಯ", instrLabel: "ಸೂಚನೆ", action: "ದಯವಿಟ್ಟು ತಕ್ಷಣ ರೋಗಿಯನ್ನು ಪರಿಶೀಲಿಸಿ.", footer: "ಆರೋಗ್ಯವಾಗಿರಿ ❤️" },
    te: { heading: "⚠️ అత్యవసర మందు హెచ్చరిక", greeting: `ప్రియ <b>${d.caretakerName}</b>,`, alert: `రోగి <b>${d.patientName}</b> 2 నిమిషాలలో మందు తీసుకున్నట్లు <span style="color:#E24B4A;font-weight:bold;">నిర్ధారించలేదు</span>.`, medLabel: "మందు", dosageLabel: "మోతాదు", timeLabel: "సమయం", instrLabel: "సూచనలు", action: "దయచేసి వెంటనే రోగిని చూడండి.", footer: "ఆరోగ్యంగా ఉండండి ❤️" },
    ta: { heading: "⚠️ அவசர மருந்து எச்சரிக்கை", greeting: `அன்புள்ள <b>${d.caretakerName}</b>,`, alert: `நோயாளி <b>${d.patientName}</b> 2 நிமிடங்களுக்குள் மருந்து எடுத்ததை <span style="color:#E24B4A;font-weight:bold;">உறுதிப்படுத்தவில்லை</span>.`, medLabel: "மருந்து", dosageLabel: "அளவு", timeLabel: "நேரம்", instrLabel: "அறிவுரை", action: "தயவுசெய்து உடனடியாக நோயாளியை சரிபாருங்கள்.", footer: "ஆரோக்கியமாக இருங்கள் ❤️" },
    mr: { heading: "⚠️ तातडीची औषध सूचना", greeting: `प्रिय <b>${d.caretakerName}</b>,`, alert: `रुग्ण <b>${d.patientName}</b> ने 2 मिनिटांत औषध घेतल्याची <span style="color:#E24B4A;font-weight:bold;">पुष्टी केली नाही</span>.`, medLabel: "औषध", dosageLabel: "डोस", timeLabel: "वेळ", instrLabel: "सूचना", action: "कृपया तात्काळ रुग्णाची तपासणी करा.", footer: "निरोगी रहा ❤️" },
  };
  const t = i18n[lang] || i18n["en"];

  return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;padding:20px;background:#fef3e2;margin:0;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
    <div style="background:linear-gradient(135deg,#EF9F27,#E24B4A);padding:18px 24px;text-align:center;">
      <h2 style="margin:0;color:#fff;font-size:22px;">${t.heading}</h2>
    </div>
    <div style="padding:24px;">
      <p style="font-size:16px;color:#333;">${t.greeting}</p>
      <p style="font-size:16px;color:#555;background:#fff3cd;padding:12px;border-radius:8px;border-left:4px solid #EF9F27;">${t.alert}</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;" border="1" cellpadding="10">
        <tr style="background:#fef3e2;">
          <th style="text-align:left;color:#333;">${t.medLabel}</th>
          <th style="text-align:left;color:#333;">${t.dosageLabel}</th>
          <th style="text-align:left;color:#333;">${t.timeLabel}</th>
        </tr>
        <tr>
          <td style="color:#222;font-weight:bold;">${d.medicineName}</td>
          <td style="color:#222;">${d.dosage}</td>
          <td style="color:#222;">${d.scheduledTime}</td>
        </tr>
      </table>
      <p style="font-size:15px;color:#555;"><b>${t.instrLabel}:</b> ${d.instructions}</p>
      <p style="font-size:16px;color:#E24B4A;font-weight:bold;margin-top:20px;text-align:center;">${t.action}</p>
      <p style="font-size:16px;color:#EF9F27;font-weight:bold;text-align:center;margin-top:16px;">${t.footer}</p>
    </div>
    <div style="background:#fef3e2;padding:12px;text-align:center;font-size:12px;color:#999;">
      MedBuddy — Your Medicine Companion
    </div>
  </div>
</body>
</html>`;
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
    from: `MedBuddy <${gmailUser}>`,
    to,
    subject,
    html,
    text,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Find reminder_events that are still "pending" and were sent more than 2 minutes ago
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();

    console.log(`[escalation-check] ===== RUN START =====`);
    console.log(`[escalation-check] Looking for pending events sent before ${twoMinAgo}`);

    const { data: pendingEvents, error } = await supabase
      .from("reminder_events")
      .select("*, medicines(name, dosage, instructions), patients(name, email, language, caregiver_email)")
      .eq("status", "pending")
      .not("sent_at", "is", null)
      .lt("sent_at", twoMinAgo);

    if (error) {
      console.error("[escalation-check] Query error:", error);
      throw error;
    }

    console.log(`[escalation-check] Found ${pendingEvents?.length || 0} pending events to escalate`);

    let escalatedCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    const results: any[] = [];

    for (const event of pendingEvents || []) {
      try {
        const medicine = event.medicines as any;
        const patient = event.patients as any;

        if (!patient || !medicine) {
          console.error(`[escalation-check] SKIP: Missing patient/medicine for event ${event.id}`);
          skippedCount++;
          results.push({ eventId: event.id, status: "skipped", reason: "missing patient/medicine data" });
          continue;
        }

        // Collect caretaker emails
        const caretakerEmails: string[] = [];

        if (event.caretaker_email) caretakerEmails.push(event.caretaker_email);
        if (patient.caregiver_email && !caretakerEmails.includes(patient.caregiver_email)) {
          caretakerEmails.push(patient.caregiver_email);
        }

        // Also get family members with alert_on_missed
        const { data: familyMembers } = await supabase
          .from("family_members")
          .select("email, full_name, relationship, language")
          .eq("patient_id", event.patient_id)
          .eq("is_active", true)
          .eq("alert_on_missed", true);

        console.log(`[escalation-check] Family members with alert_on_missed for patient ${patient.name}: ${familyMembers?.length || 0}`);

        for (const member of familyMembers || []) {
          if (!caretakerEmails.includes(member.email)) {
            caretakerEmails.push(member.email);
          }
        }

        if (caretakerEmails.length === 0) {
          console.log(`[escalation-check] SKIP: No caretakers for patient ${patient.name}, marking as missed`);
          await supabase
            .from("reminder_events")
            .update({ status: "missed" })
            .eq("id", event.id);
          skippedCount++;
          results.push({ eventId: event.id, patient: patient.name, medicine: medicine.name, status: "skipped", reason: "no caretaker emails" });
          continue;
        }

        console.log(`[escalation-check] Sending escalation for ${medicine.name} to ${caretakerEmails.length} recipients: ${caretakerEmails.join(", ")}`);

        // Send escalation emails using static templates
        for (const email of caretakerEmails) {
          const member = (familyMembers || []).find((m: any) => m.email === email);
          const memberLang = normalizeLanguageCode(member?.language || "en");
          const memberName = member?.full_name || "Caretaker";

          const escalationData: EscalationData = {
            caretakerName: memberName,
            patientName: patient.name,
            medicineName: medicine.name,
            dosage: medicine.dosage,
            scheduledTime: event.scheduled_time,
            instructions: medicine.instructions || "No special instructions",
          };

          const subject = getEscalationSubject(memberLang, patient.name, medicine.name);
          const html = getEscalationHtml(memberLang, escalationData);
          const text = getEscalationText(memberLang, escalationData);

          await sendEmail(email, subject, html, text);
          console.log(`[escalation-check] ✅ Escalation sent to ${email} for ${medicine.name}`);
        }

        // Update status to escalated
        await supabase
          .from("reminder_events")
          .update({
            status: "escalated",
            escalation_sent_at: new Date().toISOString(),
          })
          .eq("id", event.id);

        // Also update medicine_log if exists
        await supabase
          .from("medicine_logs")
          .update({ status: "missed" })
          .eq("medicine_id", event.medicine_id)
          .eq("patient_id", event.patient_id)
          .gte("scheduled_time", `${event.scheduled_date}T00:00:00`)
          .lt("scheduled_time", `${event.scheduled_date}T23:59:59`);

        escalatedCount++;
        results.push({ eventId: event.id, patient: patient.name, medicine: medicine.name, status: "escalated", recipients: caretakerEmails });
      } catch (err: any) {
        errorCount++;
        console.error(`[escalation-check] ❌ Error escalating event ${event.id}:`, err.message);
        results.push({ eventId: event.id, status: "failed", error: err.message });
      }
    }

    console.log(`[escalation-check] ===== SUMMARY: escalated=${escalatedCount} errors=${errorCount} skipped=${skippedCount} =====`);

    return new Response(
      JSON.stringify({ success: true, escalated: escalatedCount, errors: errorCount, skipped: skippedCount, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("[escalation-check] Fatal error:", e.message);
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
