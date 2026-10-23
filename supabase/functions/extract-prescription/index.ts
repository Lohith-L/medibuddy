/**
 * extract-prescription edge function
 *
 * Reads the medicines on a prescription photo with gemini-2.5-flash (Lovable AI
 * gateway). Accurate, reasonably fast and safe:
 *   - one model, medium thinking (low thinking misread handwriting), structured
 *     JSON output (json_schema);
 *   - reads each Rx line literally first (raw_text), then interprets it, with a
 *     guide to Indian prescription shorthand (1-0-1, BD, A/F, x 5d ...);
 *   - 40 s timeout per call, one retry only on a fast 5xx;
 *   - extracts only what is written: never invents medicines, leaves unclear
 *     fields empty and reports confidence + unclear_fields per medicine;
 *   - signed-in users only (JWT), images up to ~2.5 MB (the app resizes first).
 *
 * Request:  POST { imageBase64, mimeType }
 * Response: { medicines: Medicine[], reason: "ok" | "unreadable" | "not_prescription", timings }
 *           Medicine = { raw_text, name, dosage, frequency, instructions, duration_days|null,
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
const CALL_TIMEOUT_MS = 40_000;
const MAX_BYTES = 2.5 * 1024 * 1024;
const FREQUENCIES = ["Once daily", "Twice daily", "Three times daily", "As needed", ""];
const TIMES = ["morning", "afternoon", "evening", "night"];
const FORMS = ["tablet", "capsule", "syrup", "injection", "drops", "cream", "inhaler", "powder", "other", ""];
/** A fast first read; a careful re-read only when it is unsure (and there is time). */
const FAST_EFFORT = "low";
const CAREFUL_EFFORT = "medium";
const CAREFUL_DEADLINE_MS = 14_000;

const SYSTEM_PROMPT = `You are an experienced Indian pharmacist reading a doctor's prescription (printed or handwritten, sometimes with Kannada/Hindi/other Indian-language notes) and listing every medicine on it.

HOW TO READ
1. Find the medicine lines: usually below "Rx" / "℞", often numbered, each starting with Tab / Cap / Syp / Syr / Inj / Oint / Drops / Susp. Read ALL of them, top to bottom, including ones squeezed into margins.
2. Ignore everything that is not a medicine: clinic name, doctor details, registration numbers, patient name/age/date, vitals (BP, SpO2, GRBS, weight), diagnosis, lab tests (CBC, LFT, X-ray, USG...), advice ("review after 5 days", "plenty of fluids"), signatures.
3. For each medicine line, first copy what is written exactly, letter by letter, into "raw_text" (e.g. "Tab. Dolo 650 1-0-1 x 5d A/F"). Then fill the other fields from it.
4. Medicine names are usually Indian brand names (Dolo, Crocin, Calpol, Pan-D, Pantop, Razo, Augmentin, Azee, Taxim-O, Zerodol-SP, Montair-LC, Allegra, Telma, Glycomet, Ecosprin, Shelcal, Becosules, Limcee, Ascoril, Benadryl, Cetzine, Okacet ...) or generic names (Paracetamol, Amoxicillin, Pantoprazole, Metformin, Amlodipine ...). Use this knowledge ONLY to correct the spelling of a word whose letters you can actually see (e.g. "Pantop D" -> "Pantop-D"). Never pick a brand just because it is common.
5. "name": brand or generic name plus any suffix that is part of the name (-D, -DSR, -SP, -LC, -XL, -MR, CV, GP 1, Forte, Plus). Do not include Tab/Cap/Syp or the strength. "form": tablet / capsule / syrup / injection / drops / cream / inhaler / powder (from Tab, Cap, Syp/Syr, Inj, Drops, Oint/Cream, Inh/Rotacap, Sachet), "" if not written.
6. "dosage": strength with unit as written ("650 mg", "500mg", "5 ml"). A bare number after the name is usually the strength in mg ("Dolo 650" -> "650 mg", "Shelcal 500" -> "500 mg"). If no strength is written at all, give the amount per dose instead ("1 tablet", "1 capsule", "5 ml", "½ tablet") from the dose pattern or form. Leave it empty only if neither is written.
7. Frequency shorthand: OD / QD / 1-0-0 / 0-0-1 / HS -> "Once daily"; BD / BID / 1-0-1 / 1-1-0 / 0-1-1 -> "Twice daily"; TDS / TID / 1-1-1 -> "Three times daily"; QID / 1-1-1-1 -> "Three times daily" and add "four times a day" to instructions; SOS / PRN / "if needed" / "if fever" -> "As needed"; STAT -> "Once daily" and "single dose now" in instructions. ½ means half a tablet: put "½ tablet" in instructions.
8. "instructions": timing and how to take, in plain English: A/F, AF, p.c. -> "After food"; B/F, BF, a.c., empty stomach -> "Before food"; HS -> "At bedtime"; morning/night pattern from 1-0-1 ("Morning and night"). Translate Kannada/Hindi notes (ಊಟದ ನಂತರ / खाने के बाद -> "After food").
9. "timing": WHEN in the day each dose is taken, as a list of "morning", "afternoon", "evening", "night". 1-0-1 -> ["morning","night"]; 0-0-1 -> ["night"]; 0-1-0 -> ["afternoon"]; 1-1-1 -> ["morning","afternoon","night"]; 1-1-1-1 -> ["morning","afternoon","evening","night"]; HS / at bedtime / after dinner -> ["night"]; BBF / before or after breakfast / empty stomach in the morning -> ["morning"]; after lunch -> ["afternoon"]; BD without a pattern -> ["morning","night"]; TDS without a pattern -> ["morning","afternoon","night"]. OD with no time written, or SOS -> [].
10. "duration_days": only if written: "x 5d", "5 days", "×5" -> 5; "1 wk" -> 7; "2 weeks" -> 14; "1 month" -> 30. Otherwise null.

SAFETY RULES (a patient will take these medicines; a wrong medicine can harm them)
- Extract ONLY what is actually written. Never add, guess or "complete" a medicine you cannot read.
- If a name is only partly readable, write exactly the readable part, set confidence "low" and add "name" to unclear_fields. If you cannot read the name at all, leave that medicine out.
- If any other field is not written or unclear, leave it empty ("" or null) and list it in "unclear_fields". Do not fill in typical values.
- "frequency" must be one of: "Once daily", "Twice daily", "Three times daily", "As needed", or "" if not clear.
- "confidence": "high" if every written field is clearly legible, "medium" if some letters were uncertain, "low" if the name itself is uncertain.
- Judge EACH medicine line on its own. Doctors' handwriting is often messy: return every line you can read (with confidence "medium"/"low" where unsure) even if other lines are illegible. Never give up on the whole prescription because one line is unreadable.
- "unreadable_lines": how many medicine lines you could see but not read (0 if none). The patient will add those by hand.
- If the image is not a prescription, return medicines: [] and reason "not_prescription". Use reason "unreadable" ONLY if not a single medicine line can be read. Otherwise reason "ok".`;

const SCHEMA = {
  name: "prescription",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["reason", "unreadable_lines", "medicines"],
    properties: {
      reason: { type: "string", enum: ["ok", "unreadable", "not_prescription"] },
      unreadable_lines: { type: "integer" },
      medicines: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["raw_text", "name", "form", "dosage", "frequency", "timing", "instructions", "duration_days", "confidence", "unclear_fields"],
          properties: {
            raw_text: { type: "string" },
            name: { type: "string" },
            form: { type: "string", enum: FORMS },
            timing: { type: "array", items: { type: "string", enum: TIMES } },
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
  /** The medicine line exactly as written, shown to the user for checking. */
  raw_text: string;
  name: string;
  /** tablet / capsule / syrup ... ("" if not written) */
  form: string;
  dosage: string;
  /** When in the day: morning / afternoon / evening / night (empty if not written). */
  timing: string[];
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
async function callModel(apiKey: string, messages: unknown[], features: { schema: boolean; lowThinking: boolean }, effort: string) {
  const body: Record<string, unknown> = { model: MODEL, messages, temperature: 0 };
  if (features.schema) body.response_format = { type: "json_schema", json_schema: SCHEMA };
  // "low" for the fast first read; "medium" re-reads unsure prescriptions
  // (it is slower but reads messy handwriting and shorthand better).
  if (features.lowThinking) body.reasoning_effort = effort;
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
function parse(content: string): { reason: string; medicines: Medicine[]; unreadable_lines: number } {
  const cleaned = content.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  let obj: unknown;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/) ?? cleaned.match(/\[[\s\S]*\]/);
    obj = m ? JSON.parse(m[0]) : { reason: "unreadable", medicines: [] };
  }
  const raw = Array.isArray(obj) ? { reason: "ok", medicines: obj } : (obj as { reason?: string; medicines?: unknown[]; unreadable_lines?: number });
  const medicines = (Array.isArray(raw.medicines) ? raw.medicines : [])
    .map((m) => m as Record<string, unknown>)
    .map((m): Medicine => {
      const unclear = Array.isArray(m.unclear_fields) ? m.unclear_fields.map(String) : [];
      const freq = FREQUENCIES.includes(String(m.frequency ?? "")) ? String(m.frequency ?? "") : "";
      if (!freq && !unclear.includes("frequency")) unclear.push("frequency");
      const dur = Number(m.duration_days);
      const conf = ["high", "medium", "low"].includes(String(m.confidence)) ? (String(m.confidence) as Medicine["confidence"]) : "low";
      return {
        raw_text: String(m.raw_text ?? "").trim(),
        // Safety net: a form word left in front of the name ("Tab Dolo" -> "Dolo").
        name: String(m.name ?? "").trim().replace(/^(tab|tabs|tablet|cap|caps|capsule|syp|syr|syrup|inj|oint|susp)\.?\s+/i, ""),
        form: FORMS.includes(String(m.form ?? "")) ? String(m.form ?? "") : "",
        timing: Array.isArray(m.timing) ? [...new Set(m.timing.map(String).filter((x) => TIMES.includes(x)))] : [],
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
  const unreadable = Math.max(0, Math.min(20, Math.round(Number((raw as { unreadable_lines?: number }).unreadable_lines) || 0)));
  return { reason, medicines, unreadable_lines: unreadable };
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
          { type: "text", text: "List every medicine written on this prescription. Read each Rx line literally into raw_text first, then fill the fields, following the safety rules." },
        ],
      },
    ];

    // Model call: one retry, only for a 5xx / timeout. If the gateway rejects the
    // structured-output or thinking options (400), repeat once without them.
    const features = { schema: true, lowThinking: true };
    let pass = 0;
    const read = async (effort: string): Promise<string | Response> => {
      pass++;
      let retried = false;
      for (let attempt = 1; ; attempt++) {
        const key = `model_${pass === 1 ? "fast" : "careful"}_${attempt}`;
        const t2 = performance.now();
        try {
          const content = await callModel(apiKey, messages, features, effort);
          timings[key] = Math.round(performance.now() - t2);
          return content;
        } catch (e) {
          timings[key] = Math.round(performance.now() - t2);
          const status = e instanceof HttpError ? e.status : (e as Error).name === "TimeoutError" ? 504 : 500;
          console.warn(`[extract] ${key} failed: ${status} ${(e as Error).message.slice(0, 200)}`);
          if (status === 429) return json({ error: "Too many requests. Please try again in a moment.", timings }, 429);
          if (status === 402) return json({ error: "AI credits exhausted.", timings }, 402);
          if (status === 400 && (features.schema || features.lowThinking)) {
            // Gateway doesn't accept an optional parameter: same request without them.
            features.schema = false;
            features.lowThinking = false;
            continue;
          }
          // One retry for a server error / timeout, only if it can still finish in time.
          if (status >= 500 && !retried && performance.now() - t0 < 12_000) {
            retried = true;
            continue;
          }
          return json({ error: status === 504 ? "The AI took too long. Please try again." : "Couldn't read the prescription.", timings }, status === 504 ? 504 : 500);
        }
      }
    };

    const first = await read(FAST_EFFORT);
    if (first instanceof Response) return first;
    let content = first;
    let result = parse(content);
    // Unsure about anything (a name, a dose) or nothing readable: read it again carefully.
    const unsure =
      result.medicines.length === 0 ||
      result.unreadable_lines > 0 ||
      result.medicines.some((m) => m.confidence !== "high" || m.unclear_fields.includes("name"));
    if (unsure && result.reason !== "not_prescription" && features.lowThinking && performance.now() - t0 < CAREFUL_DEADLINE_MS) {
      const second = await read(CAREFUL_EFFORT);
      if (typeof second === "string") {
        const careful = parse(second);
        // Keep the careful read unless it found fewer medicines than the fast one.
        if (careful.medicines.length >= result.medicines.length) {
          content = second;
          result = careful;
        }
      }
    }

    timings.passes = pass;
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
