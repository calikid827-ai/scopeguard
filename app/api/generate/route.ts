import { NextResponse } from "next/server"
import OpenAI from "openai"

export const dynamic = "force-dynamic"

// -----------------------------
// ENV VALIDATION (HARD FAIL)
// -----------------------------
if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is missing")
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

// -----------------------------
// TYPES (UI-ALIGNED)
// -----------------------------
type Pricing = {
  labor: number
  materials: number
  subs: number
  markup: number
  total: number
}

type AIResponse = {
  trade: string
  description: string
  pricing: Pricing
}

// -----------------------------
// HELPERS
// -----------------------------
function isValidPricing(p: any): p is Pricing {
  return (
    typeof p?.labor === "number" &&
    typeof p?.materials === "number" &&
    typeof p?.subs === "number" &&
    typeof p?.markup === "number" &&
    typeof p?.total === "number"
  )
}

function clampPricing(pricing: Pricing): Pricing {
  const MAX_TOTAL = 250_000

  return {
    labor: Math.max(0, pricing.labor),
    materials: Math.max(0, pricing.materials),
    subs: Math.max(0, pricing.subs),
    markup: Math.min(40, Math.max(10, pricing.markup)),
    total: Math.min(MAX_TOTAL, Math.max(0, pricing.total)),
  }
}

// -----------------------------
// API HANDLER
// -----------------------------
export async function POST(req: Request) {
  try {
    const body = await req.json()

    const scopeChange = body.scopeChange
    const trade =
      typeof body.trade === "string" && body.trade.trim()
        ? body.trade
        : "general renovation"
    const state =
      typeof body.state === "string" && body.state.trim()
        ? body.state
        : "United States"

    if (!scopeChange || typeof scopeChange !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid scopeChange" },
        { status: 400 }
      )
    }

    // -----------------------------
    // AI PROMPT (STRICT JSON ONLY)
    // -----------------------------
    const prompt = `
You are an expert U.S. construction estimator and licensed project manager.

Your task is to:
1) Write a professional construction Change Order / Estimate description suitable for contractor-client use.
2) Generate realistic cost estimates appropriate for the trade and job location

INPUTS:
- Trade Type (authoritative if provided): ${trade || "auto-detect"}
- Job State: ${state || "United States (national average pricing)"}

SCOPE OF CHANGE:
${scopeChange}

────────────────────────────────────────
CRITICAL RULES (FOLLOW STRICTLY)
────────────────────────────────────────
DOCUMENT INTENT:
- The document must be suitable for use as either:
  • A pre-construction estimate, OR
  • A post-contract change order
- Do NOT state whether the document is binding
- Use neutral professional construction language

TRADE DETECTION:
- If Trade Type is provided by the user, you MUST use it
- If Trade Type is "auto-detect":
  - You MUST infer the correct trade from the scope
  - Do NOT default to "general renovation" unless multiple unrelated trades are involved
  - If the scope clearly matches one trade, you MUST select that trade

KEYWORD GUIDANCE:
- Painting → paint, repaint, walls, ceilings, trim, drywall patch, primer
- Flooring → flooring, LVP, hardwood, tile floor, remove carpet
- Electrical → outlets, lighting, wiring, panel, switches
- Plumbing → plumbing, fixtures, sinks, toilets, piping
- Tile / Bathroom → tile, shower, backsplash, waterproofing
- Carpentry → framing, trim, doors, cabinetry
- General renovation → only if multiple trades are involved

PRICING RULES:
- Use realistic 2024–2025 U.S. residential contractor pricing
- Adjust LABOR rates based on Job State:
  - High-cost states (CA, NY, WA, MA): higher labor
  - Mid-cost states (TX, FL, CO, AZ): national average
  - Lower-cost states: slightly reduced labor
- Do NOT invent detailed line items
- Return TOTALS ONLY (editable by contractor)
- Round all dollar amounts to whole numbers

TRADE COST CHARACTERISTICS:
- Painting → labor-heavy, low materials
- Flooring → materials + install labor
- Electrical → high labor, code compliance
- Plumbing → skilled labor + fixtures
- Tile / Bathroom → labor-intensive, material waste
- Carpentry → balanced labor + materials
- General renovation → balanced estimate

MARKUP:
- Suggest a reasonable contractor markup between 15%–25%

────────────────────────────────────────
OUTPUT FORMAT (JSON ONLY — NO EXTRA TEXT)
────────────────────────────────────────

Return ONLY valid JSON in this exact structure:

{
  "trade": "<final detected or confirmed trade>",
  "description": "<professional contract-ready change order description>",
  "pricing": {
    "labor": <number>,
    "materials": <number>,
    "subs": <number>,
    "markup": <percentage number>,
    "total": <number>
  }
}

IMPORTANT:
- Description must read like a real construction contract
- Do NOT include disclaimers
- Do NOT include explanations
- Do NOT include markdown
- JSON must be parseable without modification
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.25,
      messages: [{ role: "user", content: prompt }],
    })

    const raw = completion.choices[0]?.message?.content

    if (!raw) {
      throw new Error("Empty AI response")
    }

    // -----------------------------
    // PARSE & VALIDATE JSON
    // -----------------------------
    let parsed: AIResponse

    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      console.error("AI returned invalid JSON:", raw)
      return NextResponse.json(
        { error: "AI returned invalid JSON", raw },
        { status: 500 }
      )
    }

    if (
      typeof parsed.description !== "string" ||
      !isValidPricing(parsed.pricing)
    ) {
      console.error("AI schema validation failed:", parsed)
      return NextResponse.json(
        { error: "AI response schema invalid", parsed },
        { status: 500 }
      )
    }

    // -----------------------------
    // SAFETY CLAMPS
    // -----------------------------
    const safePricing = clampPricing(parsed.pricing)

    // -----------------------------
    // FINAL RESPONSE (UI-READY)
    // -----------------------------
    return NextResponse.json({
      trade: parsed.trade || trade,
      text: parsed.description,
      pricing: safePricing,
    })
  } catch (error) {
    console.error("AI generation failed:", error)
    return NextResponse.json(
      { error: "AI generation failed" },
      { status: 500 }
    )
  }
}