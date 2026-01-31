import { NextResponse } from "next/server"
import OpenAI from "openai"
import { createClient } from "@supabase/supabase-js"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

// -----------------------------
// ENV VALIDATION
// -----------------------------
if (!process.env.OPENAI_API_KEY)
  throw new Error("OPENAI_API_KEY missing")

if (!process.env.NEXT_PUBLIC_SUPABASE_URL)
  throw new Error("NEXT_PUBLIC_SUPABASE_URL missing")

if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
  throw new Error("SUPABASE_SERVICE_ROLE_KEY missing")

// -----------------------------
// CLIENTS
// -----------------------------
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// -----------------------------
// CONSTANTS
// -----------------------------
const FREE_LIMIT = 3

// -----------------------------
// TYPES
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

// ✅ Put coercePricing OUTSIDE clampPricing (top-level helper)
function coercePricing(p: any): Pricing {
  return {
    labor: Number(p?.labor ?? 0),
    materials: Number(p?.materials ?? 0),
    subs: Number(p?.subs ?? 0),
    markup: Number(p?.markup ?? 0),
    total: Number(p?.total ?? 0),
  }
}

function clampPricing(pricing: Pricing): Pricing {
  const MAX_TOTAL = 10_000_000

  return {
    labor: Math.max(0, pricing.labor),
    materials: Math.max(0, pricing.materials),
    subs: Math.max(0, pricing.subs),
    markup: Math.min(25, Math.max(15, pricing.markup)),
    total: Math.min(MAX_TOTAL, Math.max(0, pricing.total)),
  }
}

// 🔍 Trade auto-detection
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

// 🧠 Estimate vs Change Order intent hint
function detectIntent(scope: string): string {
  const s = scope.toLowerCase()

  if (
    /(change order|additional work|not included|modify|revision|per original contract)/.test(
      s
    )
  ) {
    return "Likely a Change Order"
  }

  if (
    /(estimate|proposal|pricing for|quote|new work|anticipated work)/.test(s)
  ) {
    return "Likely an Estimate"
  }

  return "Unclear — could be either"
}

function parseRoomCount(text: string): number | null {
  const t = text.toLowerCase()

  const patterns = [
    /paint\s+(\d{1,6})\s+rooms?/i,
    /(\d{1,6})\s+rooms?/i,
    /rooms?\s*[:\-]\s*(\d{1,6})/i,
    /(\d{1,6})\s+guest\s+rooms?/i,
  ]

  for (const p of patterns) {
    const m = t.match(p)
    if (m?.[1]) {
      const n = Number(m[1])
      if (Number.isFinite(n) && n > 0) return n
    }
  }
  return null
}

function parseRoomDims(text: string) {
  // 12x12 or 12 x 12
  const m = text.toLowerCase().match(/(\d{1,3})\s*x\s*(\d{1,3})/)
  const lengthFt = m ? Number(m[1]) : 14
  const widthFt = m ? Number(m[2]) : 25

  // 8 ft ceilings / 8' ceilings
  const h = text.toLowerCase().match(/(\d{1,2})\s*(ft|')\s*(ceiling|ceilings|high)/)
  const heightFt = h ? Number(h[1]) : 8.5

  return { lengthFt, widthFt, heightFt }
}

function getStateAbbrev(rawState: string) {
  const s = (rawState || "").trim()
  const up = s.toUpperCase()
  if (/^[A-Z]{2}$/.test(up)) return up

  const map: Record<string, string> = {
    CALIFORNIA: "CA",
    "NEW YORK": "NY",
    TEXAS: "TX",
    FLORIDA: "FL",
    WASHINGTON: "WA",
    MASSACHUSETTS: "MA",
    "NEW JERSEY": "NJ",
    COLORADO: "CO",
    ARIZONA: "AZ",
  }
  return map[up] || ""
}

function getStateLaborMultiplier(stateAbbrev: string) {
  const STATE_LABOR_MULTIPLIER: Record<string, number> = {
    AL: 0.98, AK: 1.10, AZ: 1.02, AR: 0.97, CA: 1.25, CO: 1.12, CT: 1.18,
    DE: 1.10, FL: 1.03, GA: 1.02, HI: 1.30, ID: 1.00, IL: 1.10, IN: 1.00,
    IA: 0.98, KS: 0.98, KY: 0.97, LA: 0.99, ME: 1.05, MD: 1.15, MA: 1.18,
    MI: 1.03, MN: 1.04, MS: 0.96, MO: 0.99, MT: 1.00, NE: 0.99, NV: 1.08,
    NH: 1.08, NJ: 1.20, NM: 0.98, NY: 1.22, NC: 1.01, ND: 1.00, OH: 1.00,
    OK: 0.98, OR: 1.12, PA: 1.05, RI: 1.15, SC: 1.00, SD: 0.99, TN: 1.00,
    TX: 1.05, UT: 1.03, VT: 1.06, VA: 1.08, WA: 1.15, WV: 0.96, WI: 1.02,
    WY: 1.00, DC: 1.30,
  }

  return STATE_LABOR_MULTIPLIER[stateAbbrev] ?? 1
}

function pricePaintingRooms(args: {
  scope: string
  rooms: number
  stateMultiplier: number
}): Pricing {
  const { lengthFt, widthFt, heightFt } = parseRoomDims(args.scope)

  const coatsMatch = args.scope.toLowerCase().match(/(\d)\s*coats?/)
  const coats = coatsMatch ? Math.max(1, Number(coatsMatch[1])) : 2

  const includeCeilings =
    /ceiling|ceilings/.test(args.scope.toLowerCase()) ||
    /walls?\s*\+\s*ceilings?/.test(args.scope.toLowerCase())

  const perimeter = 2 * (lengthFt + widthFt)
  const wallArea = perimeter * heightFt
  const ceilingArea = includeCeilings ? lengthFt * widthFt : 0

  const sqftPerRoomPerCoat = wallArea + ceilingArea
  const paintSqftPerRoom = sqftPerRoomPerCoat * coats

  // ---- tunable knobs ----
  const sqftPerLaborHour = 140
  const laborRate = 75
  const coverageSqftPerGallon = 325
  const paintCostPerGallon = 28
  const wasteFactor = 1.12
  const patchingPerRoom = /patch|patching/.test(args.scope.toLowerCase()) ? 25 : 0
  const consumablesPerRoom = 18
  const markup = 25
  const setupHoursPerRoom = 1.25
  // -----------------------

  const laborHoursTotal =
    (paintSqftPerRoom * args.rooms) / sqftPerLaborHour +
    setupHoursPerRoom * args.rooms

  let labor = Math.round(laborHoursTotal * laborRate)
  labor = Math.round(labor * args.stateMultiplier)

  const gallonsTotal =
    ((paintSqftPerRoom * args.rooms) / coverageSqftPerGallon) * wasteFactor

  const paintCost = Math.round(gallonsTotal * paintCostPerGallon)
  const patchCost = args.rooms * patchingPerRoom
  const consumables = args.rooms * consumablesPerRoom

  const materials = paintCost + patchCost + consumables

  const mobilization = 2500
const supervisionPct = args.rooms >= 50 ? 0.10 : 0.06
const supervision = Math.round((labor + materials) * supervisionPct)

// Put these into "subs" so UI math and saved math always match
const subs = mobilization + supervision

const base = labor + materials + subs
const total = Math.round(base * (1 + markup / 100))

return { labor, materials, subs, markup, total }
}

// -----------------------------
// API HANDLER
// -----------------------------
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const measurements = body.measurements ?? null

    const email = body.email
    const scopeChange = body.scopeChange
    const uiTrade = typeof body.trade === "string" ? body.trade.trim() : ""
    const rawState = typeof body.state === "string" ? body.state.trim() : ""

    // -----------------------------
    // BASIC VALIDATION
    // -----------------------------
    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email required" }, { status: 401 })
    }

    const normalizedEmail = email.trim().toLowerCase()

    if (!scopeChange || typeof scopeChange !== "string") {
      return NextResponse.json(
        { error: "Invalid scopeChange" },
        { status: 400 }
      )
    }

    // -----------------------------
    // ENTITLEMENT + FREE LIMIT ENFORCEMENT
    // -----------------------------
    const { data: entitlement, error } = await supabase
  .from("entitlements")
  .select("active, usage_count")
  .eq("email", normalizedEmail)
  .maybeSingle()

if (error) {
  console.error("Supabase entitlement lookup error:", error)
  return NextResponse.json({ error: "Entitlement lookup failed" }, { status: 500 })
}

    const isPaid = entitlement?.active === true
const usageCount =
  typeof entitlement?.usage_count === "number"
    ? entitlement.usage_count
    : 0

    // HARD abuse protection (refresh spam, bots)
if (!isPaid && usageCount > FREE_LIMIT + 1) {
  return NextResponse.json(
    { error: "Rate limited" },
    { status: 429 }
  )
}

// Normal free limit
if (!isPaid && usageCount >= FREE_LIMIT) {
  return NextResponse.json(
    { error: "Free limit reached" },
    { status: 403 }
  )
}

   

    // -----------------------------
    // STATE NORMALIZATION
    // -----------------------------
    const jobState = rawState || "United States"

    // -----------------------------
    // TRADE + INTENT
    // -----------------------------
    const trade = uiTrade || autoDetectTrade(scopeChange)
    const intentHint = detectIntent(scopeChange)

    const rooms = parseRoomCount(scopeChange)
    const stateAbbrev = getStateAbbrev(rawState)
    const stateMultiplier = getStateLaborMultiplier(stateAbbrev)

// Use deterministic pricing only when:
// - painting
// - room count exists and is "big"
// - no measurements override is being used
const looksLikePainting =
  trade === "painting" || /(paint|painting|repaint|prime|primer)/i.test(scopeChange)

const useBigJobPricing =
  looksLikePainting &&
  typeof rooms === "number" &&
  rooms >= 1 &&
  !(measurements?.totalSqft && measurements.totalSqft > 0)

const bigJobPricing: Pricing | null =
  useBigJobPricing ? pricePaintingRooms({ scope: scopeChange, rooms, stateMultiplier }) : null
  
  const usedBigJobPricing = Boolean(bigJobPricing)

    // -----------------------------
    // AI PROMPT (PRODUCTION-LOCKED)
    // -----------------------------
    const measurementSnippet =
  measurements?.totalSqft && measurements.totalSqft > 0
    ? `
MEASUREMENTS (USER-PROVIDED):
- Total area: ${measurements.totalSqft} sq ft
- Areas:
${(measurements.rows || [])
  .map(
    (r: any) =>
      `  - ${r.label || "Area"}: ${Number(r.lengthFt || 0)}ft x ${Number(
        r.heightFt || 0
      )}ft x qty ${Number(r.qty || 1)}`
  )
  .join("\n")}
`
    : ""
    
    const prompt = `
You are an expert U.S. construction estimator and licensed project manager.

Your task is to generate a professional construction document that may be either:
- A Change Order (modifying an existing contract), OR
- An Estimate (proposed or anticipated work)

PRE-ANALYSIS:
${intentHint}

INPUTS:
- Trade Type: ${trade}
- Job State: ${jobState}

SCOPE OF WORK:
${scopeChange}

${measurementSnippet}

DOCUMENT RULES (CRITICAL):
- If modifying existing contract work → "Change Order"
- If proposing new work → "Estimate"
- If unclear → "Change Order / Estimate"
- The opening sentence must begin with “This Change Order…” or “This Estimate…” and clearly identify the nature of the work
- Use professional, contract-ready language
- Describe labor activities, materials, preparation, and intent
- Write 3–5 clear, detailed sentences
- No disclaimers or markdown

DOCUMENT-TYPE TONE RULES (VERY IMPORTANT):

If documentType is "Change Order":
- Reference existing contract or original scope implicitly
- Clearly indicate work is additional, revised, or not previously included
- Use firm, contractual language (e.g., "This Change Order covers…")
- Frame the scope as authorized upon approval, without conditional or speculative language

If documentType is "Estimate":
- Frame work as proposed or anticipated
- Avoid implying an existing contract
- Use conditional language (e.g., "This Estimate outlines the proposed scope…")
- Position pricing as preliminary but professional (no disclaimers)

If documentType is "Change Order / Estimate":
- Use neutral language that could apply in either context
- Avoid firm contractual assumptions
- Clearly describe scope without asserting approval status

ADVANCED DESCRIPTION RULES:
- Reference existing conditions where applicable (e.g., "existing finishes", "current layout")
- Clarify whether work is additive, corrective, or preparatory
- Tie scope to client request or site conditions when possible
- Use neutral, professional contract language (not sales copy)
- Avoid vague phrases like "as needed" or "where required"
- Avoid generic filler phrases such as “ensure a professional finish” or “industry standards”
- Imply scope boundaries without listing exclusions explicitlys

ADVANCED CONTRACT LANGUAGE ENHANCEMENTS (OPTIONAL BUT PREFERRED):
- Reference sequencing or preparatory work when applicable (e.g., surface prep, demolition, protection)
- Imply scope limits by referencing existing conditions without listing exclusions
- Avoid absolute guarantees or warranties
- Use passive contractual phrasing when appropriate (e.g., "Work includes...", "Scope covers...")
- Where applicable, reference coordination with existing trades or finishes
- Avoid repeating sentence structures across documents

HARD STYLE RULE:
- Do not use phrases like “ensure”, “industry standards”, “quality standards”, “compliance”, “durability”, or “aesthetic appeal”.
- Replace them with concrete scope language (prep, masking, coatings, sequencing, protection, coordination).
- If you accidentally use any banned phrase, rewrite that sentence using concrete scope language instead.

PRICING RULES:
- Use realistic 2024–2025 U.S. contractor pricing
- Adjust labor rates based on job state
- Mid-market residential work
- Totals only (no line items)
- Round to whole dollars

MEASUREMENT USAGE RULE (STRICT):
- If measurements are provided, reference the total square footage and (briefly) the labeled areas in the description.
- Use the square footage to influence pricing realism (larger sqft → higher labor/materials).
- If measurements are NOT provided, do NOT mention square footage, dimensions, or area estimates. Do not guess numbers.

TRADE PRICING GUIDANCE:
- Painting → labor-heavy, low materials
- Flooring → materials + install labor
- Electrical → high labor rate
- Plumbing → skilled labor + fixtures
- Tile → labor-intensive
- Carpentry → balanced
- General renovation → balanced

MARKUP RULE:
- Suggest markup between 15–25%

OUTPUT FORMAT (STRICT — REQUIRED):
Return ONLY valid JSON matching EXACTLY this schema.
All fields are REQUIRED. Do not omit any field.

{
  "documentType": "Change Order | Estimate | Change Order / Estimate",
  "trade": "<string>",
  "description": "<string>",
  "pricing": {
    "labor": <number>,
    "materials": <number>,
    "subs": <number>,
    "markup": <number>,
    "total": <number>
  }
}

Rules:
- Use the exact field names shown (case-sensitive)
- Include ALL fields
- Use numbers only for pricing values
`

    // -----------------------------
// OPENAI CALL
// -----------------------------
let completion
try {
  completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.25,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
  })
} catch (err: any) {
  // OpenAI SDK errors typically include: status, code, message
  const status = err?.status
  const code = err?.code

  // Rate limit → return 429 to the client (so your UI shows “Too many requests…”)
  if (status === 429 || code === "rate_limit_exceeded") {
    const retryAfter =
      err?.headers?.get?.("retry-after") ||
      err?.headers?.["retry-after"] ||
      null

    return NextResponse.json(
      {
        error: "OpenAI rate limit exceeded",
        retry_after: retryAfter,
      },
      { status: 429 }
    )
  }

  // Auth/config issues
  if (status === 401) {
    return NextResponse.json(
      { error: "OpenAI auth error (check API key)" },
      { status: 500 }
    )
  }

  console.error("OpenAI call failed:", err)
  return NextResponse.json(
    { error: "AI generation failed" },
    { status: 500 }
  )
}

    const raw = completion.choices[0]?.message?.content
    if (!raw) throw new Error("Empty AI response")


    const parsed: any = JSON.parse(raw)

    const normalized: any = {
  documentType: parsed.documentType ?? parsed.document_type,
  trade: parsed.trade,
  description: parsed.description,
  pricing: parsed.pricing,
}

// 🔒 Coerce AI pricing to numbers (prevents string math bugs)
normalized.pricing = clampPricing(coercePricing(normalized.pricing))

// ✅ Override pricing for large painting room jobs (hotel / multi-unit)
if (bigJobPricing) {
  normalized.pricing = clampPricing(bigJobPricing)
}

const allowedTypes = [
  "Change Order",
  "Estimate",
  "Change Order / Estimate",
]

if (!allowedTypes.includes(normalized.documentType)) {
  normalized.documentType = "Change Order / Estimate"
}

    if (
  typeof normalized.documentType !== "string" ||
  typeof normalized.description !== "string" ||
  !isValidPricing(normalized.pricing)
) {
  return NextResponse.json(
    { error: "AI response invalid", parsed },
    { status: 500 }
  )
}

// -----------------------------
// PRICING REALISM (SKIP WHEN BIG-JOB PRICING IS USED)
// -----------------------------
if (!usedBigJobPricing) {
  // -----------------------------
  // PRICING REALISM v2 (MARKET-ANCHORED)
  // -----------------------------
  const p = normalized.pricing

  // ---- Markup realism (true contractor ranges) ----
  if (p.markup < 12) p.markup = 15
  if (p.markup > 30) p.markup = 25

  // ---- Labor vs material ratios by trade ----
  switch (trade) {
    case "painting":
      // 65–80% labor typical
      if (p.materials > p.labor * 0.5) {
        p.materials = Math.round(p.labor * 0.35)
      }
      break

    case "flooring":
    case "tile":
      // Materials often equal or exceed labor, but not wildly
      if (p.materials < p.labor * 0.6) {
        p.materials = Math.round(p.labor * 0.8)
      }
      if (p.materials > p.labor * 1.8) {
        p.materials = Math.round(p.labor * 1.4)
      }
      break

    case "electrical":
    case "plumbing":
      // Skilled labor dominant
      if (p.materials > p.labor * 0.75) {
        p.materials = Math.round(p.labor * 0.5)
      }
      break

    case "carpentry":
    case "general renovation":
      // Balanced trades
      if (p.materials < p.labor * 0.4) {
        p.materials = Math.round(p.labor * 0.6)
      }
      break
  }

  // ---- Subs realism ----
  const base = p.labor + p.materials
  if (p.subs > base * 0.5) {
    p.subs = Math.round(base * 0.3)
  }

  // ---- Total sanity (protect against AI math drift) ----
  const impliedTotal =
    p.labor + p.materials + p.subs +
    Math.round((p.labor + p.materials + p.subs) * (p.markup / 100))

  if (Math.abs(p.total - impliedTotal) / impliedTotal > 0.2) {
    p.total = impliedTotal
  }

  // -----------------------------
  // PRICING REALISM v3 — STATE LABOR MULTIPLIER
  // -----------------------------
  const stateAbbrev2 = getStateAbbrev(rawState)
  const stateMultiplier2 = getStateLaborMultiplier(stateAbbrev2)

  p.labor = Math.round(p.labor * stateMultiplier2)

  p.total =
    p.labor + p.materials + p.subs +
    Math.round((p.labor + p.materials + p.subs) * (p.markup / 100))

  normalized.pricing = clampPricing(p)
} else {
  // Big job pricing already includes state multiplier + total math
  normalized.pricing = clampPricing(normalized.pricing)
}

const safePricing = normalized.pricing

    // Increment usage for free users only
    if (!isPaid) {
  // Update if row exists
  const { data: updated } = await supabase
    .from("entitlements")
    .update({ usage_count: usageCount + 1 })
    .eq("email", normalizedEmail)
    .select("email")
    .maybeSingle()

  // If row doesn't exist, insert
  if (!updated) {
    await supabase.from("entitlements").insert({
      email: normalizedEmail,
      usage_count: 1,
      active: false,
    })
  }
}

return NextResponse.json({
  documentType: normalized.documentType,
  trade: normalized.trade || trade,
  text: normalized.description,
  pricing: safePricing,
})
  } catch (err) {
    console.error("Generate failed:", err)
    return NextResponse.json(
      { error: "Generation failed" },
      { status: 500 }
    )
  }
}