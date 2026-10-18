/**
 * extract-prescription edge function
 *
 * Reads the medicines on a prescription photo with gemini-2.5-flash (Lovable AI
 * gateway). Fast and safe:
 *   - one model only, thinking kept low, structured JSON output (json_schema);
 *   - 30 s timeout per call, one retry only on a 5xx / timeout;
 *   - extracts only what is written: never invents medicines, leaves unclear
 *     fields empty and reports confidence + unclear_fields per medicine;
 *   - signed-in users only (JWT), images up to ~2 MB (the app resizes first).
 *
 * Request:  POST { imageBase64, mimeType }
 * Response: { medicines: Medicine[], reason: "ok" | "unreadable" | "not_prescription", timings }
 *           Medicine = { name, dosage, frequency, instructions, duration_days|null,
 *                        confidence: "high"|"medium"|"low", unclear_fields: string[] }
 * Errors:   401 not signed in · 413 too large · 429 / 402 gateway limits ·
 *           504 the model took too long · 500 other
 *
 * Deploy:   supabase functions deploy extract-prescription  (verify_jwt = true)
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const MODEL = "google/gemini-2.5-flash";
const CALL_TIMEOUT_MS = 30_000;
const MAX_BYTES = 2 * 1024 * 1024;
const FREQUENCIES = ["Once daily", "Twice daily", "Three times daily", "As needed", ""];

const SYSTEM_PROMPT = `You read medical prescriptions (often Indian, printed or handwritten) and list the medicines that are written on them.

SAFETY RULES (a patient will take these medicines; a wrong medicine can harm them):
1. Extract ONLY what is actually written. Never add, guess or "complete" a medicine that you cannot read.
2. If a medicine name is only partly readable, write exactly the readable part and set confidence "low". If you cannot read the name at all, leave that medicine out.
3. If any other field (dosage, frequency, instructions, duration) is not written or unclear, leave it empty ("" or null) and list it in "unclear_fields". Do not fill in typical values.
4. "frequency" must be one of: "Once daily", "Twice daily", "Three times daily", "As needed", or "" if not clear. Map OD -> Once daily, BD/BID -> Twice daily, TDS/TID -> Three times daily, SOS/PRN -> As needed; 1-0-1 style means the number of 1s per day.
5. "duration_days": a number only if a duration is written (e.g. "x 5 days" -> 5); otherwise null.
6. "confidence": "high" if every written field is clearly legible, "medium" if some letters were uncertain, "low" if the name itself is uncertain.
7. If the image is not a prescription, return medicines: [] and reason "not_prescription". If it is a prescription but you cannot read any medicine reliably, return medicines: [] and reason "unreadable". Otherwise reason "ok".`;

const SCHEMA = {
  name: "prescription",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["reason", "medicines"],
    properties: {
      reason: { type: "string", enum: ["ok", "unreadable", "not_prescription"] },
      medicines: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "dosage", "frequency", "instructions", "duration_days", "confidence", "unclear_fields"],
          properties: {
            name: { type: "string" },
            dosage: { type: "string" },
            frequency: { type: "string", enum: FREQUENCIES },
            instructions: { type: "string" },
            duration_days: { type: ["integer", "null"] },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            unclear_fields: { type: "array", items: { type: "string", enum: ["name", "dosage", "frequency", "instructions", "duration_days"] } },
          },
        },
      },
    },
  },
};

interface Medicine {
  name: string;
  dosage: string;
  frequency: string;
  instructions: string;
  duration_days: number | null;
  confidence: "high" | "medium" | "low";
  unclear_fields: string[];
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** One gateway call. `features` can be dropped if the gateway rejects them (400). */
async function callModel(apiKey: string, messages: unknown[], features: { schema: boolean; lowThinking: boolean }) {
  const body: Record<string, unknown> = { model: MODEL, messages, temperature: 0 };
  if (features.schema) body.response_format = { type: "json_schema", json_schema: SCHEMA };
  if (features.lowThinking) body.reasoning_effort = "low"; // small thinking budget on Gemini 2.5 Flash
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  if (!res.ok) throw new HttpError(res.status, (await res.text()).slice(0, 500));
  const data = await res.json();
  return String(data.choices?.[0]?.message?.content ?? "");
}

/** Parses the model's JSON (structured output, or a fenced JSON block as a fallback). */
function parse(content: string): { reason: string; medicines: Medicine[] } {
  const cleaned = content.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  let obj: unknown;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/) ?? cleaned.match(/\[[\s\S]*\]/);
    obj = m ? JSON.parse(m[0]) : { reason: "unreadable", medicines: [] };
  }
  const raw = Array.isArray(obj) ? { reason: "ok", medicines: obj } : (obj as { reason?: string; medicines?: unknown[] });
  const medicines = (Array.isArray(raw.medicines) ? raw.medicines : [])
    .map((m) => m as Record<string, unknown>)
    .map((m): Medicine => {
      const unclear = Array.isArray(m.unclear_fields) ? m.unclear_fields.map(String) : [];
      const freq = FREQUENCIES.includes(String(m.frequency ?? "")) ? String(m.frequency ?? "") : "";
      if (!freq && !unclear.includes("frequency")) unclear.push("frequency");
      const dur = Number(m.duration_days);
      const conf = ["high", "medium", "low"].includes(String(m.confidence)) ? (String(m.confidence) as Medicine["confidence"]) : "low";
      return {
        name: String(m.name ?? "").trim(),
        dosage: String(m.dosage ?? "").trim(),
        frequency: freq,
        instructions: String(m.instructions ?? "").trim(),
        duration_days: Number.isFinite(dur) && dur > 0 ? Math.round(dur) : null,
        confidence: conf,
        unclear_fields: unclear,
      };
    })
    .filter((m) => m.name.length > 0); // never return a medicine without a readable name
  const reason = medicines.length ? "ok" : raw.reason === "not_prescription" ? "not_prescription" : "unreadable";
  return { reason, medicines };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const t0 = performance.now();
  const timings: Record<string, number> = {};

  // ── Signed-in users only ──
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
  const { data: auth } = await supabase.auth.getUser(jwt);
  if (!auth?.user) return json({ error: "Please sign in again." }, 401);
  timings.auth = Math.round(performance.now() - t0);

  try {
    const t1 = performance.now();
    const { imageBase64, mimeType } = await req.json();
    if (!imageBase64 || typeof imageBase64 !== "string") return json({ error: "No image provided" }, 400);
    const bytes = Math.floor((imageBase64.length * 3) / 4);
    if (bytes > MAX_BYTES) return json({ error: "Image too large. Please retake the photo." }, 413);
    timings.decode = Math.round(performance.now() - t1);

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mimeType || "image/jpeg"};base64,${imageBase64}` } },
          { type: "text", text: "List the medicines written on this prescription, following the safety rules." },
        ],
      },
    ];

    // Model call: one retry, only for a 5xx / timeout. If the gateway rejects the
    // structured-output or thinking options (400), repeat once without them.
    const features = { schema: true, lowThinking: true };
    let content = "";
    let retried = false;
    for (let attempt = 1; ; attempt++) {
      const t2 = performance.now();
      try {
        content = await callModel(apiKey, messages, features);
        timings[`model_${attempt}`] = Math.round(performance.now() - t2);
        break;
      } catch (e) {
        timings[`model_${attempt}`] = Math.round(performance.now() - t2);
        const status = e instanceof HttpError ? e.status : (e as Error).name === "TimeoutError" ? 504 : 500;
        console.warn(`[extract] attempt ${attempt} failed: ${status} ${(e as Error).message.slice(0, 200)}`);
        if (status === 429) return json({ error: "Too many requests. Please try again in a moment.", timings }, 429);
        if (status === 402) return json({ error: "AI credits exhausted.", timings }, 402);
        if (status === 400 && (features.schema || features.lowThinking)) {
          // Gateway doesn't accept an optional parameter: same request without them.
          features.schema = false;
          features.lowThinking = false;
          continue;
        }
        // One retry for a server error / timeout, only if it can still finish
        // within the app's 45 s limit (a fast 5xx, not a 30 s timeout).
        if (status >= 500 && !retried && performance.now() - t0 < 12_000) {
          retried = true;
          continue;
        }
        return json({ error: status === 504 ? "The AI took too long. Please try again." : "Couldn't read the prescription.", timings }, status === 504 ? 504 : 500);
      }
    }

    const t3 = performance.now();
    const result = parse(content);
    timings.parse = Math.round(performance.now() - t3);
    timings.total = Math.round(performance.now() - t0);
    console.log(
      `[extract] ${bytes} bytes, ${result.medicines.length} medicines, reason ${result.reason}, ` +
        `schema ${features.schema}, lowThinking ${features.lowThinking}, timings ${JSON.stringify(timings)}`,
    );
    return json({ ...result, timings });
  } catch (e) {
    console.error("[extract] error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error", timings }, 500);
  }
});
