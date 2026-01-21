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
  documentType: "Change Order" | "Estimate" | "Change Order / Estimate"
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
    markup: Math.min(25, Math.max(15, pricing.markup)),
    total: Math.min(MAX_TOTAL, Math.max(0, pricing.total)),
  }
}

// 🔍 Simple, reliable trade auto-detection
function autoDetectTrade(scope: string): string {
  const s = scope.toLowerCase()

  if (/(paint|painting|prime|primer|drywall patch|patch drywall)/.test(s))
    return "painting"
  if (/(floor|flooring|tile|grout)/.test(s)) return "flooring"
  if (/(electrical|outlet|switch|panel|lighting)/.test(s))
    return "electrical"
  if (/(plumb|toilet|sink|faucet|shower|water line)/.test(s))
    return "plumbing"
  if (/(carpentry|trim|baseboard|framing|cabinet)/.test(s))
    return "carpentry"

  return "general renovation"
}

// -----------------------------
// API HANDLER
// -----------------------------
export async function POST(req: Request) {
  try {
    const body = await req.json()

    const scopeChange = body.scopeChange
    const uiTrade = typeof body.trade === "string" ? body.trade.trim() : ""
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

    // ✅ Use auto-detect ONLY if user did not select a trade
    const trade = uiTrade || autoDetectTrade(scopeChange)

    // -----------------------------
    // AI PROMPT (STRICT JSON ONLY)
    // -----------------------------
    const prompt = `
You are an expert U.S. construction estimator and licensed project manager.

Your task is to generate a professional construction document that may be either:
- A Change Order (for work modifying an existing contract), OR
- An Estimate (for proposed or anticipated work)

You must determine which label is most appropriate based on the scope.

INPUTS:
- Trade Type: ${trade}
- Job State: ${state}

SCOPE OF WORK:
${scopeChange}

DOCUMENT RULES (CRITICAL):
- If the scope modifies existing work → "Change Order"
- If the scope proposes new work → "Estimate"
- If unclear → "Change Order / Estimate"
- The opening sentence MUST explicitly state the document type
- Use professional, contract-ready language
- Be detailed and specific about the scope of work
- Describe labor activities, materials, and intent clearly
- Do NOT include disclaimers or markdown
- Write 3–5 professional sentences describing the scope in detail

PRICING RULES:
- Use realistic 2024–2025 U.S. contractor pricing
- Adjust labor rates based on the job state
- Mid-market residential work
- Totals only (no line items)
- Round to whole dollars

MARKUP RULE:
- Suggest a markup between 15–25%

OUTPUT FORMAT:
Return ONLY valid JSON.

{
  "documentType": "Change Order | Estimate | Change Order / Estimate",
  "trade": "<confirmed trade>",
  "description": "<professional description beginning with the document type>",
  "pricing": {
    "labor": <number>,
    "materials": <number>,
    "subs": <number>,
    "markup": <number>,
    "total": <number>
  }
}
`

    // -----------------------------
    // OPENAI CALL (JSON ENFORCED)
    // -----------------------------
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.25,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    })

    const raw = completion.choices[0]?.message?.content
    if (!raw) throw new Error("Empty AI response")

    const parsed: AIResponse = JSON.parse(raw)

    if (
      typeof parsed.description !== "string" ||
      !isValidPricing(parsed.pricing)
    ) {
      return NextResponse.json(
        { error: "AI response schema invalid", parsed },
        { status: 500 }
      )
    }

    const safePricing = clampPricing(parsed.pricing)

    return NextResponse.json({
      documentType: parsed.documentType,
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