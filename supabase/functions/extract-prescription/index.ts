import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { imageBase64, mimeType } = await req.json();
    
    if (!imageBase64) {
      return new Response(JSON.stringify({ error: "No image provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const systemPrompt = `You are an expert medical prescription reader with years of experience reading Indian doctors' handwriting. Your job is to extract ALL medicines from prescription images.

CRITICAL RULES:
1. NEVER refuse or say you cannot read the prescription. Always try your best.
2. Even if handwriting is messy, make your best guess for each medicine name.
3. If you can partially read a medicine name, include your best interpretation.
4. Common Indian prescription medicines include: Paracetamol, Amoxicillin, Azithromycin, Metformin, Amlodipine, Atorvastatin, Pantoprazole, Omeprazole, Cefixime, Dolo, Crocin, Combiflam, Augmentin, Shelcal, Becosules, Limcee, Allegra, Montelukast, Cetirizine, Ranitidine, Domperidone, Ondansetron, Metronidazole, Ciprofloxacin, Levofloxacin, Doxycycline, Prednisolone, Budecort, Asthalin, Deriphyllin, Glycomet, Jalra, Telma, Ecosprin, Clopidogrel, Rosuvastatin, Telmisartan, Losartan, Enalapril, etc.
5. Use context clues: dosage numbers (500mg, 250mg, etc.), frequency marks (OD, BD, TDS, QID), and duration to help identify medicines.
6. Look for abbreviations common in Indian prescriptions: Tab (tablet), Cap (capsule), Syp (syrup), Inj (injection).

Return ONLY a valid JSON array. Each object must have:
- "name": medicine name (string) - your best guess even if uncertain
- "dosage": dosage with unit (string, e.g. "500mg", "250mg")  
- "frequency": how often (string: "Once daily", "Twice daily", "Three times daily")
- "instructions": when/how to take (string, e.g. "After food", "Before breakfast", "At bedtime")
- "duration_days": number of days (number, default 30 if not visible)

If absolutely nothing is visible, return []. But TRY HARD before returning empty.`;

    const imageContent = {
      type: "image_url" as const,
      image_url: { url: `data:${mimeType || "image/jpeg"};base64,${imageBase64}` },
    };

    const messages = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          imageContent,
          { type: "text", text: "Extract ALL medicines from this prescription. Even if handwriting is difficult, give your best interpretation. Return ONLY the JSON array, no other text." },
        ],
      },
    ];

    // Try with primary model first, then fallback
    const models = ["google/gemini-2.5-flash", "google/gemini-2.5-pro"];
    let medicines: any[] = [];
    let lastError = "";

    for (const model of models) {
      try {
        console.log(`Trying model: ${model}`);
        const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ model, messages }),
        });

        if (!response.ok) {
          const errText = await response.text();
          console.error(`Model ${model} error:`, response.status, errText);
          
          if (response.status === 429) {
            return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
              status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          if (response.status === 402) {
            return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
              status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          lastError = errText;
          continue;
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || "[]";
        console.log(`Model ${model} raw response length:`, content.length);

        // Check if AI refused instead of extracting
        if (content.toLowerCase().includes("cannot") && content.toLowerCase().includes("read") && !content.includes("[")) {
          console.warn(`Model ${model} refused to extract, trying next model...`);
          lastError = "AI refused to extract";
          continue;
        }

        // Parse JSON from response
        const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        
        // Find the JSON array in the response
        const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          medicines = JSON.parse(arrayMatch[0]);
          if (Array.isArray(medicines) && medicines.length > 0) {
            console.log(`Successfully extracted ${medicines.length} medicines with ${model}`);
            break;
          }
        }
        
        lastError = "No medicines found in response";
      } catch (parseErr) {
        console.error(`Error with model ${model}:`, parseErr);
        lastError = String(parseErr);
        continue;
      }
    }

    if (!Array.isArray(medicines)) medicines = [];

    return new Response(JSON.stringify({ medicines }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-prescription error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
