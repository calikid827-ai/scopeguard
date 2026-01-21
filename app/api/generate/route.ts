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
// TYPES (SOURCE OF TRUTH)
// -----------------------------
type Pricing = {
  labor: number
  materials: number
  subcontractors: number
  markupPercent: number
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
    typeof p?.subcontractors === "number" &&
    typeof p?.markupPercent === "number" &&
    typeof p?.total === "number"
  )
}

function clampPricing(pricing: Pricing): Pricing {
  const MAX_TOTAL = 250_000

  return {
    labor: Math.max(0, pricing.labor),
    materials: Math.max(0, pricing.materials),
    subcontractors: Math.max(0, pricing.subcontractors),
    markupPercent: Math.min(40, Math.max(10, pricing.markupPercent)),
    total: Math.min(MAX_TOTAL, Math.max(0, pricing.total)),
  }
}

// -----------------------------
// API HANDLER
// -----------------------------
export async function POST(req: Request) {
  try {
    const { scopeChange, trade = "general renovation", state = "US" } =
      await req.json()

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
You are a senior U.S. construction estimator.

Trade Type: ${trade}
Location: ${state}

Use realistic U.S. renovation pricing based on trade and location.

PRICING GUIDANCE:
- Painting: labor-heavy, low materials
- Flooring: materials + installation labor
- Electrical: high labor rate, code compliance
- Plumbing: skilled labor + fixtures
- Tile: labor-intensive with material waste
- General renovation: balanced estimate

RETURN ONLY VALID JSON.
NO prose. NO markdown. NO explanations.

JSON SCHEMA:
{
  "trade": string,
  "description": string,
  "pricing": {
    "labor": number,
    "materials": number,
    "subcontractors": number,
    "markupPercent": number,
    "total": number
  }
}

SCOPE OF CHANGE:
${scopeChange}
`

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

    return NextResponse.json({
      trade: parsed.trade || trade,
      description: parsed.description,
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