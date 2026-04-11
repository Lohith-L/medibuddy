import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import nodemailer from "npm:nodemailer@6.9.10";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface EmailRequest {
  type: "confirmation" | "reminder" | "missed_dose" | "weekly_report";
  patient_id: string;
  medicine_id?: string;
  medicine_log_id?: string;
}

async function generateEmailContent(prompt: string): Promise<string> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content: "You are MedBuddy's email generator. Generate warm, caring HTML emails. Keep medicine names and dosages in English. Use inline CSS styles. Make emails mobile-friendly. Return ONLY the HTML content, no markdown code blocks.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("AI error:", response.status, errText);
    throw new Error(`AI generation failed: ${response.status}`);
  }

  const data = await response.json();
  let content = data.choices?.[0]?.message?.content || "";
  content = content.replace(/```html\n?/g, "").replace(/```\n?/g, "").trim();
  return content;
}

async function sendEmail(to: string, subject: string, html: string) {
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
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { type, patient_id, medicine_id, medicine_log_id } = await req.json() as EmailRequest;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Helper to log alerts to alert_history
    const logAlert = async (params: {
      alert_type: string;
      recipient_email: string;
      recipient_name?: string;
      medicine_id?: string;
      medicine_name?: string;
      dosage?: string;
      scheduled_date?: string;
      scheduled_time?: string;
      status: string;
      language_used?: string;
      message_preview?: string;
      error_message?: string;
    }) => {
      try {
        await supabase.from("alert_history").insert({
          patient_id,
          alert_type: params.alert_type,
          recipient_email: params.recipient_email,
          recipient_name: params.recipient_name || null,
          medicine_id: params.medicine_id || null,
          medicine_name: params.medicine_name || null,
          dosage: params.dosage || null,
          scheduled_date: params.scheduled_date || null,
          scheduled_time: params.scheduled_time || null,
          status: params.status,
          language_used: params.language_used || "en",
          message_preview: params.message_preview || null,
          error_message: params.error_message || null,
          delivery_channel: "email",
        });
      } catch (e) {
        console.error("Failed to log alert:", e);
      }
    };

    // Fetch patient
    const { data: patient, error: patientErr } = await supabase
      .from("patients")
      .select("*")
      .eq("id", patient_id)
      .single();

    if (patientErr || !patient) throw new Error("Patient not found");

    const lang = patient.language || "English";

    if (type === "confirmation") {
      // Fetch all active medicines for patient
      const { data: medicines } = await supabase
        .from("medicines")
        .select("*")
        .eq("patient_id", patient_id)
        .eq("is_active", true);

      const medList = (medicines || [])
        .map((m: any) => `- ${m.name} ${m.dosage} (${m.frequency})${m.instructions ? ` — ${m.instructions}` : ""}`)
        .join("\n");

      const prompt = `Generate a warm congratulations email in ${lang} for a patient named ${patient.name} whose medicine reminders are now set.

Include:
- Congratulations message
- Table of medicines with timings:
${medList}
- Next reminder info
- Warm encouraging closing message

Keep medicine names and dosages in English. Translate everything else to ${lang}. Use a calming green (#52B788) color scheme. Return only HTML email content.`;

      const html = await generateEmailContent(prompt);
      const subject = lang === "English"
        ? "🎉 Your MedBuddy reminders are set!"
        : `🎉 MedBuddy - ${lang === "हिंदी" ? "आपके रिमाइंडर सेट हो गए!" : lang === "తెలుగు" ? "మీ రిమైండర్లు సెట్ అయ్యాయి!" : "Your reminders are set!"}`;

      try {
        await sendEmail(patient.email, subject, html);
        await logAlert({ alert_type: "confirmation", recipient_email: patient.email, recipient_name: patient.name, status: "sent", language_used: lang, message_preview: subject });
      } catch (e) {
        await logAlert({ alert_type: "confirmation", recipient_email: patient.email, recipient_name: patient.name, status: "failed", language_used: lang, message_preview: subject, error_message: e instanceof Error ? e.message : "Unknown error" });
        throw e;
      }
      return new Response(JSON.stringify({ success: true, type: "confirmation" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (type === "reminder") {
      if (!medicine_id) throw new Error("medicine_id required for reminder");

      const { data: medicine } = await supabase
        .from("medicines")
        .select("*")
        .eq("id", medicine_id)
        .single();

      if (!medicine) throw new Error("Medicine not found");

      const appUrl = Deno.env.get("SITE_URL") || supabaseUrl.replace(".supabase.co", ".lovable.app");

      const prompt = `Generate a medicine reminder email in ${lang} for patient ${patient.name}.

Medicine: ${medicine.name} ${medicine.dosage}
Frequency: ${medicine.frequency}
Instructions: ${medicine.instructions || "No special instructions"}

Include two prominent buttons:
1. ✅ Mark as Taken (green button)
2. ⏭️ Snooze 30 mins (amber button)

Make it warm and caring, not clinical. Keep medicine name in English. Use green (#52B788) and amber (#EF9F27) colors. Return only HTML.`;

      const html = await generateEmailContent(prompt);
      const subject = `💊 Time for ${medicine.name} ${medicine.dosage}`;

      try {
        await sendEmail(patient.email, subject, html);
        await logAlert({ alert_type: "reminder", recipient_email: patient.email, recipient_name: patient.name, medicine_id, medicine_name: medicine.name, dosage: medicine.dosage, status: "sent", language_used: lang, message_preview: subject });
      } catch (e) {
        await logAlert({ alert_type: "reminder", recipient_email: patient.email, recipient_name: patient.name, medicine_id, medicine_name: medicine.name, dosage: medicine.dosage, status: "failed", language_used: lang, message_preview: subject, error_message: e instanceof Error ? e.message : "Unknown error" });
        throw e;
      }
      return new Response(JSON.stringify({ success: true, type: "reminder" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (type === "missed_dose") {
      if (!medicine_id) throw new Error("medicine_id required for missed_dose");

      const { data: medicine } = await supabase
        .from("medicines")
        .select("*")
        .eq("id", medicine_id)
        .single();

      if (!medicine) throw new Error("Medicine not found");

      // Send to caregiver and all active family members with alert_on_missed
      const recipients: string[] = [];
      if (patient.caregiver_email) recipients.push(patient.caregiver_email);

      const { data: familyMembers } = await supabase
        .from("family_members")
        .select("*")
        .eq("patient_id", patient_id)
        .eq("is_active", true)
        .eq("alert_on_missed", true);

      for (const member of familyMembers || []) {
        const memberLang = member.language || "English";
        const prompt = `Generate a missed dose alert email in ${memberLang} for caregiver ${member.full_name} (${member.relationship}).

Patient ${patient.name} missed their ${medicine.name} ${medicine.dosage} dose.
The dose was scheduled but not taken within 1 hour.

Include:
- Alert heading
- Patient name and missed medicine details
- Warm message asking them to check on the patient
- MedBuddy branding

Keep medicine name in English. Use amber (#EF9F27) and red (#E24B4A) colors for urgency. Return only HTML.`;

        try {
          const html = await generateEmailContent(prompt);
          const subject = `⚠️ ${patient.name} missed ${medicine.name} dose`;
          await sendEmail(member.email, subject, html);
          await logAlert({ alert_type: "family_alert", recipient_email: member.email, recipient_name: member.full_name, medicine_id, medicine_name: medicine.name, dosage: medicine.dosage, status: "sent", language_used: memberLang, message_preview: subject });
        } catch (e) {
          await logAlert({ alert_type: "family_alert", recipient_email: member.email, recipient_name: member.full_name, medicine_id, medicine_name: medicine.name, dosage: medicine.dosage, status: "failed", language_used: memberLang, message_preview: `⚠️ ${patient.name} missed ${medicine.name} dose`, error_message: e instanceof Error ? e.message : "Unknown error" });
          console.error(`Failed to send to ${member.email}:`, e);
        }
      }

      // Also send to caregiver_email if set
      if (patient.caregiver_email) {
        try {
          const prompt = `Generate a missed dose alert email in English for the caregiver of patient ${patient.name}.

Patient missed their ${medicine.name} ${medicine.dosage} dose.
Please check on them. Use amber/red colors. Return only HTML.`;

          const html = await generateEmailContent(prompt);
          const cgSubject = `⚠️ ${patient.name} missed ${medicine.name}`;
          await sendEmail(patient.caregiver_email, cgSubject, html);
          await logAlert({ alert_type: "escalation", recipient_email: patient.caregiver_email, medicine_id, medicine_name: medicine.name, dosage: medicine.dosage, status: "sent", message_preview: cgSubject });
        } catch (e) {
          await logAlert({ alert_type: "escalation", recipient_email: patient.caregiver_email, medicine_id, medicine_name: medicine.name, dosage: medicine.dosage, status: "failed", error_message: e instanceof Error ? e.message : "Unknown error" });
          console.error(`Failed to send to caregiver:`, e);
        }
      }

      return new Response(JSON.stringify({ success: true, type: "missed_dose", recipients_count: (familyMembers?.length || 0) + (patient.caregiver_email ? 1 : 0) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (type === "weekly_report") {
      // Get this week's logs
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);

      const { data: logs } = await supabase
        .from("medicine_logs")
        .select("*, medicines(name, dosage)")
        .eq("patient_id", patient_id)
        .gte("scheduled_time", weekAgo.toISOString());

      const { data: medicines } = await supabase
        .from("medicines")
        .select("*")
        .eq("patient_id", patient_id)
        .eq("is_active", true);

      const totalLogs = logs?.length || 0;
      const takenLogs = logs?.filter((l: any) => l.status === "taken").length || 0;
      const missedLogs = logs?.filter((l: any) => l.status === "missed").length || 0;
      const adherence = totalLogs > 0 ? Math.round((takenLogs / totalLogs) * 100) : 0;

      const medSummary = (medicines || []).map((m: any) => {
        const medLogs = logs?.filter((l: any) => l.medicine_id === m.id) || [];
        const taken = medLogs.filter((l: any) => l.status === "taken").length;
        const total = medLogs.length;
        return `- ${m.name} ${m.dosage}: ${taken}/${total} doses taken`;
      }).join("\n");

      // Send to patient
      const patientPrompt = `Generate a weekly health report email in ${lang} for patient ${patient.name}.

Weekly Adherence: ${adherence}%
Total doses scheduled: ${totalLogs}
Taken: ${takenLogs}
Missed: ${missedLogs}

Medicine breakdown:
${medSummary}

Include:
- Weekly summary with adherence percentage (big, bold)
- Medicine-by-medicine breakdown table
- Encouraging message based on adherence
- If adherence > 90%: celebration message
- If adherence 50-90%: gentle encouragement
- If adherence < 50%: caring concern and motivation

Keep medicine names in English. Use green (#52B788) color scheme. Return only HTML.`;

      const patientHtml = await generateEmailContent(patientPrompt);
      const reportSubject = `📊 Your Weekly MedBuddy Report — ${adherence}% adherence`;
      try {
        await sendEmail(patient.email, reportSubject, patientHtml);
        await logAlert({ alert_type: "weekly_report", recipient_email: patient.email, recipient_name: patient.name, status: "sent", language_used: lang, message_preview: reportSubject });
      } catch (e) {
        await logAlert({ alert_type: "weekly_report", recipient_email: patient.email, recipient_name: patient.name, status: "failed", language_used: lang, message_preview: reportSubject, error_message: e instanceof Error ? e.message : "Unknown error" });
        console.error(`Failed to send weekly report to patient:`, e);
      }

      // Send to family members who want weekly reports
      const { data: reportMembers } = await supabase
        .from("family_members")
        .select("*")
        .eq("patient_id", patient_id)
        .eq("is_active", true)
        .eq("alert_on_weekly_report", true);

      for (const member of reportMembers || []) {
        const memberLang = member.language || "English";
        const caregiverPrompt = `Generate a weekly report email in ${memberLang} for ${member.full_name} (${member.relationship}) about patient ${patient.name}.

Weekly Adherence: ${adherence}%
Taken: ${takenLogs}/${totalLogs} doses
Missed: ${missedLogs}

Medicine breakdown:
${medSummary}

Make it informative yet warm. Keep medicine names in English. Return only HTML.`;

        const memberSubject = `📊 ${patient.name}'s Weekly Report — ${adherence}%`;
        try {
          const caregiverHtml = await generateEmailContent(caregiverPrompt);
          await sendEmail(member.email, memberSubject, caregiverHtml);
          await logAlert({ alert_type: "weekly_report", recipient_email: member.email, recipient_name: member.full_name, status: "sent", language_used: memberLang, message_preview: memberSubject });
        } catch (e) {
          await logAlert({ alert_type: "weekly_report", recipient_email: member.email, recipient_name: member.full_name, status: "failed", language_used: memberLang, message_preview: memberSubject, error_message: e instanceof Error ? e.message : "Unknown error" });
          console.error(`Failed to send report to ${member.email}:`, e);
        }
      }

      return new Response(JSON.stringify({ success: true, type: "weekly_report", adherence }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid email type" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-medicine-email error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
