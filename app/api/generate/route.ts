import { NextRequest, NextResponse } from "next/server"
import OpenAI from "openai"
import { createClient } from "@supabase/supabase-js"

import {
  GenerateSchema,
  cleanScopeText,
  jsonError,
  assertSameOrigin,
  assertBodySize,
} from "./lib/guards"

import { rateLimit } from "./lib/rateLimit"

import { computeFlooringDeterministic } from "./lib/priceguard/flooringEngine"
import { computeElectricalDeterministic } from "./lib/priceguard/electricalEngine"
import {
  computePlumbingDeterministic,
  hasHeavyPlumbingSignals,
  parsePlumbingFixtureBreakdown,
} from "./lib/priceguard/plumbingEngine"
import { computeDrywallDeterministic } from "./lib/priceguard/drywallEngine"

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
const PRIMARY_MODEL = "gpt-4o" as const

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

type PriceGuardStatus =
  | "verified"
  | "deterministic"
  | "adjusted"
  | "review"
  | "ai"

type PriceGuardReport = {
  status: PriceGuardStatus
  confidence: number // 0–99
  pricingSource: "ai" | "deterministic" | "merged"
  appliedRules: string[]
  assumptions: string[]
  warnings: string[]
  details: {
    stateAdjusted: boolean
    stateAbbrev?: string
    rooms?: number | null
    doors?: number | null
    paintScope?: string | null
    anchorId?: string | null
    detSource?: string | null
    priceGuardAnchorStrict?: boolean
  }
}

function clampConfidence(n: number) {
  const x = Math.round(n)
  return Math.max(0, Math.min(99, x))
}

function buildPriceGuardReport(args: {
  pricingSource: "ai" | "deterministic" | "merged"
  priceGuardVerified: boolean
  priceGuardAnchorStrict: boolean
  stateAbbrev: string
  rooms: number | null
  doors: number | null
  measurements: any | null
  effectivePaintScope: string | null
  anchorId: string | null
  detSource: string | null
  usedNationalBaseline: boolean
}): PriceGuardReport {
  const appliedRules: string[] = []
  const assumptions: string[] = []
  const warnings: string[] = []

  let score = 100

  const stateAdjusted = !args.usedNationalBaseline && !!args.stateAbbrev

  if (args.pricingSource === "deterministic") {
    appliedRules.push("Deterministic pricing engine applied")
    score -= args.priceGuardVerified ? 2 : 8
  } else if (args.pricingSource === "merged") {
    appliedRules.push("PriceGuard safety floor enforced (AI merged with PriceGuard baseline)")
    score -= 10
  } else {
    score -= 40
    warnings.push("Pricing relied primarily on AI due to scope ambiguity or missing quantities.")
  }

  if (!stateAdjusted) {
    score -= 10
    assumptions.push("State not selected — used national baseline labor rates.")
  } else {
    appliedRules.push("State labor adjustment applied")
  }

  const hasDoors = typeof args.doors === "number" && args.doors > 0
  const hasRooms = typeof args.rooms === "number" && args.rooms > 0
  const hasMeas = !!(args.measurements?.totalSqft && args.measurements.totalSqft > 0)

  if (hasDoors) appliedRules.push("Door quantity detected")
  if (hasRooms) appliedRules.push("Room quantity detected")
  if (hasMeas) appliedRules.push("User measurements used")

  if (args.pricingSource === "ai" && !hasDoors && !hasRooms && !hasMeas) {
    score -= 30
    warnings.push("No explicit quantities detected (doors/rooms/sqft). Add quantities for stronger pricing protection.")
  }

  if (args.effectivePaintScope === "doors_only") {
    appliedRules.push("Doors-only scope classification enforced")
    score += 4
  }
  if (hasDoors && hasRooms) {
    appliedRules.push("Mixed scope resolved deterministically (rooms + doors)")
    score += 4
  }

  if (args.anchorId) {
    appliedRules.push(`Pricing anchor applied: ${args.anchorId}`)
    score += 6
  }

  if (hasMeas) score += 6

  score = clampConfidence(score)

  let status: PriceGuardStatus = "ai"
  if (args.priceGuardVerified && args.pricingSource === "deterministic") status = "verified"
  else if (args.pricingSource === "deterministic") status = "deterministic"
  else if (args.pricingSource === "merged") status = "adjusted"
  else status = score >= 70 ? "review" : "ai"

  return {
    status,
    confidence: score,
    pricingSource: args.pricingSource,
    appliedRules,
    assumptions,
    warnings,
    details: {
  stateAdjusted,
  stateAbbrev: args.stateAbbrev || undefined,
  rooms: args.rooms,
  doors: args.doors,
  paintScope: args.effectivePaintScope,
  anchorId: args.anchorId,
  detSource: args.detSource,
  priceGuardAnchorStrict: args.priceGuardAnchorStrict,
},
  }
}

type PricingUnit =
  | "sqft"
  | "linear_ft"
  | "rooms"
  | "doors"
  | "fixtures"
  | "devices"
  | "days"
  | "lump_sum"

type EstimateBasis = {
  units: PricingUnit[]                 // 1–3 items
  quantities: Partial<Record<PricingUnit, number>>
  laborRate: number                    // hourly
  hoursPerUnit?: number                // optional when unit-based
  crewDays?: number                    // optional when days-based
  mobilization: number
  assumptions: string[]
}

type AIResponse = {
  documentType: "Change Order" | "Estimate" | "Change Order / Estimate"
  trade: string
  description: string
  pricing: Pricing
  estimateBasis?: EstimateBasis        // ✅ internal-only, optional
}

type AnchorResult = {
  id: string
  pricing: Pricing
}

type AnchorContext = {
  scope: string
  trade: string
  stateMultiplier: number
  measurements: any | null
  rooms: number | null
  doors: number | null
}

type PricingAnchor = {
  id: string
  when: (ctx: AnchorContext) => boolean
  price: (ctx: AnchorContext) => Pricing | null
}

// -----------------------------
// HELPERS
// -----------------------------

function defaultDeterministicDescription(args: {
  documentType: "Change Order" | "Estimate" | "Change Order / Estimate"
  trade: string
  scopeText: string
  jobType?: string | null
}): string {
  const dt = args.documentType
  const t = args.trade
  const s = (args.scopeText || "").trim()

  if (t === "plumbing" && args.jobType === "fixture_swaps") {
    return `This ${dt} covers fixture-level plumbing work as described, including isolation, removal and replacement, reconnection, functional testing, and cleanup. Scope: ${s}`
  }

  if (t === "electrical" && args.jobType === "device_work") {
    return `This ${dt} covers device-level electrical work as described, including replacement/installation of devices, protection of surrounding finishes, testing, and cleanup. Scope: ${s}`
  }

  if (t === "flooring") {
    return `This ${dt} covers flooring installation work as described, including surface preparation, layout, installation, transitions as applicable, and cleanup. Scope: ${s}`
  }

  if (t === "drywall") {
    return `This ${dt} covers drywall repair work as described, including preparation, patching, finishing, and cleanup. Scope: ${s}`
  }

  return `This ${dt} covers the described scope of work as provided, including labor, materials, protection, and cleanup. Scope: ${s}`
}

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

function isValidEstimateBasis(b: any): b is EstimateBasis {
  if (!b || typeof b !== "object") return false
  if (!Array.isArray(b.units) || b.units.length < 1 || b.units.length > 3) return false
  if (!b.quantities || typeof b.quantities !== "object") return false
  if (!Number.isFinite(Number(b.laborRate)) || Number(b.laborRate) <= 0) return false
  if (!Number.isFinite(Number(b.mobilization)) || Number(b.mobilization) < 0) return false
  if (!Array.isArray(b.assumptions)) return false
  return true
}

function approxEqual(a: number, b: number, pct = 0.08) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  if (b === 0) return a === 0
  return Math.abs(a - b) / Math.abs(b) <= pct
}

type JobComplexityClass = "simple" | "medium" | "complex" | "remodel"

type ComplexityProfile = {
  class: JobComplexityClass
  requireDaysBasis: boolean
  permitLikely: boolean
  multiPhase: boolean
  multiTrade: boolean
  hasDemo: boolean
  notes: string[]

  // guard rails for pricing structure
  minCrewDays: number
  maxCrewDays: number
  minMobilization: number
  minSubs: number

  // ✅ NEW: crew realism
  crewSizeMin: number
  crewSizeMax: number
  hoursPerDayEffective: number // productive hours per person/day (6–8 typical)
  minPhaseVisits: number       // how many "show-ups" (return trips) implied
}

function buildComplexityProfile(args: { scopeText: string; trade: string }): ComplexityProfile {
  const s = (args.scopeText || "").toLowerCase()
  const trade = (args.trade || "").toLowerCase()

  const notes: string[] = []

  const hasDemo =
    /\b(demo|demolition|tear\s*out|remove\s+existing|haul\s*away|dispose|dump)\b/.test(s)

  const remodelSignals =
    /\b(remodel|renovation|gut|rebuild|full\s*replace|convert|conversion)\b/.test(s)

  const permitSignals =
    /\b(permit|inspection|inspector|code|required|city)\b/.test(s) ||
    /\b(panel|service\s*upgrade|meter|subpanel)\b/.test(s)

  const roughInOrRelocate =
    /\b(rough[-\s]*in|relocat(e|ing|ion)|move\s+(drain|supply|valve|line)|new\s+circuit|run\s+new\s+wire|trench)\b/.test(s)

  const wetAreaSignals =
    /\b(shower|tub|pan|curb|waterproof|membrane|red\s*guard|cement\s*board|durock|hardie(backer)?|thinset|mud\s*bed)\b/.test(s)

  const multiPhase =
    hasDemo || roughInOrRelocate || wetAreaSignals || permitSignals

  const multiTradeSignals =
    /\b(plumb|plumbing)\b/.test(s) &&
    /\b(electric|electrical)\b/.test(s)

  const finishTradeSignals =
    /\b(tile|backsplash|cabinet|counter(top)?|floor|flooring|drywall|paint|painting|trim|baseboard)\b/.test(s)

  const multiTrade = multiTradeSignals || (remodelSignals && finishTradeSignals)

  // --- classify ---
  let cls: JobComplexityClass = "simple"

  // “remodel” wins
  if (remodelSignals || (wetAreaSignals && hasDemo)) {
    cls = "remodel"
    notes.push("Remodel / rebuild signals detected.")
  } else if (permitSignals || roughInOrRelocate) {
    cls = "complex"
    notes.push("Permit/rough-in/relocation signals detected.")
  } else if (hasDemo || multiTrade) {
    cls = "medium"
    notes.push("Demo or multi-trade coordination signals detected.")
  } else {
    cls = "simple"
  }

  const permitLikely = permitSignals
  if (permitLikely) notes.push("Permit/inspection likely.")

  if (hasDemo) notes.push("Demolition/haul-away implied.")
  if (roughInOrRelocate) notes.push("Rough-in or relocation scope implied.")
  if (wetAreaSignals) notes.push("Wet-area / waterproofing signals detected.")
  if (multiTrade) notes.push("Multi-trade coordination likely.")

  // --- force “days” basis for complex/remodel (and for heavy electrical/plumbing patterns) ---
  const requireDaysBasis =
    cls === "complex" ||
    cls === "remodel" ||
    (trade === "electrical" && /\b(panel|service\s*upgrade|rewire)\b/.test(s)) ||
    (trade === "plumbing" && /\b(rough[-\s]*in|relocat|move\s+drain|move\s+supply)\b/.test(s))

  // --- guardrail minimums by class ---
  // These are intentionally forgiving but block “0.5 day remodels”
  const bands =
  cls === "simple"
    ? {
        minCrewDays: 0.5, maxCrewDays: 3,
        minMobilization: 175, minSubs: 175,
        crewSizeMin: 1, crewSizeMax: 2,
        hoursPerDayEffective: 7,
        minPhaseVisits: 1,
      }
    : cls === "medium"
      ? {
          minCrewDays: 1, maxCrewDays: 7,
          minMobilization: 350, minSubs: 350,
          crewSizeMin: 1, crewSizeMax: 3,
          hoursPerDayEffective: 7,
          minPhaseVisits: 1,
        }
      : cls === "complex"
        ? {
            minCrewDays: 2, maxCrewDays: 14,
            minMobilization: 550, minSubs: 550,
            crewSizeMin: 2, crewSizeMax: 4,
            hoursPerDayEffective: 6.5,
            minPhaseVisits: 2, // permits/rough-in => return
          }
        : {
            minCrewDays: 3, maxCrewDays: 25,
            minMobilization: 750, minSubs: 750,
            crewSizeMin: 2, crewSizeMax: 5,
            hoursPerDayEffective: 6.25,
            minPhaseVisits: 2, // remodels tend to be multi-visit
          }

  return {
    class: cls,
    requireDaysBasis,
    permitLikely,
    multiPhase,
    multiTrade,
    hasDemo,
    notes,
    ...bands,
  }
}

function inferPhaseVisitsFromSignals(args: {
  scopeText: string
  cp: ComplexityProfile | null
}): { visits: number; phases: string[] } {
  const s = (args.scopeText || "").toLowerCase()
  const cp = args.cp

  const phases: string[] = []

  const hasDemo =
    /\b(demo|demolition|tear\s*out|remove\s+existing|haul\s*away|dispose|dump)\b/.test(s)

  const hasRoughOrRelocate =
    /\b(rough[-\s]*in|relocat(e|ing|ion)|move\s+(drain|supply|valve|line)|new\s+circuit|run\s+new\s+wire|trench)\b/.test(s)

  const hasWetArea =
    /\b(shower|tub|pan|curb|waterproof|membrane|red\s*guard|cement\s*board|durock|hardie(backer)?|thinset|mud\s*bed)\b/.test(s)

  const hasPermit =
    /\b(permit|inspection|inspector|code|required|city)\b/.test(s) ||
    /\b(panel|service\s*upgrade|meter|subpanel)\b/.test(s)

  if (hasDemo) phases.push("demolition/removal")
  if (hasRoughOrRelocate) phases.push("rough-in/relocation")
  if (hasPermit) phases.push("permit/inspection coordination")
  if (hasWetArea) phases.push("wet-area sequencing/cure time")

  // Base visits:
  // - 1 visit: simple single-trip work
  // - 2 visits: demo + return, or rough-in + return, or permits
  // - 3 visits: demo + rough-in + return (common remodel pattern), or wet-area cure
  let visits = 1

  const signals = [hasDemo, hasRoughOrRelocate, hasPermit, hasWetArea].filter(Boolean).length

  if (signals >= 1) visits = 2
  if ((hasDemo && hasRoughOrRelocate) || (hasWetArea && (hasDemo || hasRoughOrRelocate))) visits = 3

  // Respect CP minimums (if provided)
  if (cp?.minPhaseVisits) visits = Math.max(visits, cp.minPhaseVisits)

  return { visits, phases }
}

function validateCrewAndSequencing(args: {
  pricing: Pricing
  basis: EstimateBasis | null
  cp: ComplexityProfile | null
  scopeText: string
}): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  const p = args.pricing
  const b = args.basis
  const cp = args.cp

  if (!cp || !b || !isValidEstimateBasis(b)) return { ok: true, reasons }

  // Only enforce crewDays math when days-based estimate is present
  const hasDays = Array.isArray(b.units) && b.units.includes("days")
  if (!hasDays) return { ok: true, reasons }

  const crewDays = Number(b.crewDays ?? b.quantities?.days ?? 0)
  if (!Number.isFinite(crewDays) || crewDays <= 0) {
    reasons.push("days-based estimate missing/invalid crewDays.")
    return { ok: false, reasons }
  }

  const laborRate = Number(b.laborRate)
  const laborDollars = Number(p.labor)

  if (!Number.isFinite(laborRate) || laborRate <= 0) {
    reasons.push("days-based estimate missing/invalid laborRate.")
    return { ok: false, reasons }
  }
  if (!Number.isFinite(laborDollars) || laborDollars <= 0) {
    reasons.push("days-based estimate missing/invalid labor dollars.")
    return { ok: false, reasons }
  }

  const impliedLaborHours = laborDollars / laborRate

  // Choose a conservative “expected crew size” for validation:
  // Use the MIN crew size so the validation is forgiving (harder to false-flag).
  const crewSize = Math.max(1, Number(cp.crewSizeMin ?? 1))
  const hrsPerDay = Math.max(5.5, Math.min(8, Number(cp.hoursPerDayEffective ?? 7)))

  const impliedCrewDays = impliedLaborHours / (crewSize * hrsPerDay)

  if (Number.isFinite(impliedCrewDays) && impliedCrewDays > 0) {
    // very forgiving tolerance: allow 2.5x mismatch before flagging
    const ratio = impliedCrewDays / crewDays
    if (ratio > 2.5 || ratio < 0.4) {
      reasons.push(
        `CrewDays inconsistent with labor math: implied ${impliedCrewDays.toFixed(1)} crew-day(s) (crew=${crewSize}, ${hrsPerDay}h/day) vs crewDays=${crewDays}.`
      )
    }
  }

  // Sequencing / multi-visit enforcement (prevents “one trip remodel”)
  const phase = inferPhaseVisitsFromSignals({ scopeText: args.scopeText, cp })
  if (phase.visits >= 2) {
    // Minimum crewDays floor by visit count:
    // - 2 visits: at least 1.5 crewDays
    // - 3 visits: at least 2.5 crewDays
    const minByVisits = phase.visits === 2 ? 1.5 : 2.5
    if (crewDays < minByVisits && (cp.class === "complex" || cp.class === "remodel")) {
      reasons.push(
        `Multi-phase scope implies ${phase.visits} visit(s) (${phase.phases.join(", ")}); crewDays too low (${crewDays}).`
      )
    }
  }

  return { ok: reasons.length === 0, reasons }
}

function appendExecutionPlanSentence(args: {
  description: string
  documentType: string
  trade: string
  cp: ComplexityProfile | null
  basis: EstimateBasis | null
  scopeText: string
}): string {
  let d = (args.description || "").trim()
  if (!d) return d

  // Avoid adding repeatedly if the route calls twice
  if (/\bEstimated duration:\b/i.test(d)) return d

  const cp = args.cp
  const b = args.basis
  const { visits, phases } = inferPhaseVisitsFromSignals({ scopeText: args.scopeText, cp })

  // If we have days, state them. Otherwise skip duration sentence.
  const hasDays = !!(b && Array.isArray(b.units) && b.units.includes("days"))
  const cd = Number(b?.crewDays ?? b?.quantities?.days ?? 0)

  // Only add when it’s meaningful
  if (!hasDays || !Number.isFinite(cd) || cd <= 0) return d

  // Round to nearest 0.5 for readability
  const rounded = Math.round(cd * 2) / 2
  const dayWord = rounded === 1 ? "day" : "days"

  const phaseText =
    phases.length > 0
      ? ` with sequencing for ${phases.slice(0, 3).join(", ")}`
      : ""

  const visitText =
    visits >= 2 ? ` across approximately ${visits} site visit(s)` : ""

  // Keep it contract-friendly, not “guarantee-y”
  const sentence = ` Estimated duration: approximately ${rounded} crew-${dayWord}${visitText}${phaseText}.`

  // Ensure description still begins correctly (your prompt wants “This Estimate…”)
  d = d.replace(
    /^This (Change Order|Estimate|Change Order \/ Estimate)\b/,
    `This ${args.documentType}`
  )

  return (d + sentence).trim()
}

function validateAiMath(args: {
  pricing: Pricing
  basis: EstimateBasis | null
  parsedCounts: { rooms: number | null; doors: number | null; sqft: number | null }
  complexity?: ComplexityProfile | null
  scopeText?: string // ✅ NEW
}): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  const p = args.pricing
  const b = args.basis

  // -----------------------------
  // Existing checks (UNCHANGED)
  // -----------------------------

  // 1) Total must match (tight)
  const impliedTotal = Math.round((p.labor + p.materials + p.subs) * (1 + p.markup / 100))
  if (!approxEqual(p.total, impliedTotal, 0.03)) {
    reasons.push("Total does not match base + markup.")
  }

  // 2) If no basis, fail (we want unit checking)
  if (!b || !isValidEstimateBasis(b)) {
    reasons.push("Missing/invalid estimateBasis.")
    return { ok: reasons.length === 0, reasons }
  }

  // 3) Must reflect explicit counts you already parsed (rooms/doors/sqft)
  if (args.parsedCounts.rooms && args.parsedCounts.rooms > 0) {
    const q = Number(b.quantities.rooms ?? 0)
    if (q !== args.parsedCounts.rooms) reasons.push("rooms quantity not carried into estimateBasis.")
  }

  if (args.parsedCounts.doors && args.parsedCounts.doors > 0) {
    const q = Number(b.quantities.doors ?? 0)
    if (q !== args.parsedCounts.doors) reasons.push("doors quantity not carried into estimateBasis.")
  }

  // (Small upgrade: you already parse sqft — enforce it if present)
  if (args.parsedCounts.sqft && args.parsedCounts.sqft > 0) {
    const q = Number(b.quantities.sqft ?? 0)
    if (q !== args.parsedCounts.sqft) reasons.push("sqft quantity not carried into estimateBasis.")
  }

  // 4) Mobilization sanity
  if (b.mobilization < 100 && (args.parsedCounts.doors || args.parsedCounts.rooms || args.parsedCounts.sqft)) {
    reasons.push("mobilization too low for small job.")
  }

  // 5) Labor scaling sanity (simple check)
  const hasCountUnit = b.units.some((u) =>
    ["doors", "rooms", "devices", "fixtures", "sqft", "linear_ft"].includes(u)
  )
  if (hasCountUnit && p.labor <= 0) reasons.push("Labor missing for unit-based estimate.")

  // -----------------------------
  // NEW: Production-rate sanity locking
  // -----------------------------

  // Only apply rate-locking when the AI claims ONE primary unit.
  // Multi-unit bases make "hours per unit" ambiguous and can false-flag.
  const primaryUnit: PricingUnit | null = Array.isArray(b.units) && b.units.length === 1 ? b.units[0] : null

  // Helper: wide, realistic bounds (intentionally forgiving)
  const getBands = (unit: PricingUnit): { min: number; max: number; label: string } | null => {
    switch (unit) {
      case "doors":
        return { min: 0.6, max: 2.5, label: "hrs/door" } // wide: paint doors, install doors, etc.
      case "rooms":
        return { min: 3.0, max: 18.0, label: "hrs/room" } // wide for repaint vs heavy prep
      case "sqft":
        return { min: 0.005, max: 0.25, label: "hrs/sqft" } // 4 sqft/hr (patching) to 200 sqft/hr (painting-ish)
      case "linear_ft":
        return { min: 0.02, max: 1.2, label: "hrs/linear_ft" } // baseboard/carpentry can vary a lot
      case "devices":
        return { min: 0.20, max: 2.5, label: "hrs/device" } // swaps vs add/troubleshoot
      case "fixtures":
        return { min: 0.60, max: 8.0, label: "hrs/fixture" } // faucet vs vanity vs valve
      case "days":
        return { min: 0.5, max: 25, label: "crewDays" } // super wide; still blocks 0 or 1000
      case "lump_sum":
        return null // can't rate-check lump sums
      default:
        return null
    }
  }

  // Only attempt if laborRate is sane and labor exists
  const laborRate = Number(b.laborRate)
  const laborDollars = Number(p.labor)

  if (
    primaryUnit &&
    Number.isFinite(laborRate) &&
    laborRate > 0 &&
    Number.isFinite(laborDollars) &&
    laborDollars > 0
  ) {
    const bands = getBands(primaryUnit)

    if (bands) {
      if (primaryUnit === "days") {
        // For "days" unit, compare to crewDays (preferred) or quantities.days
        const cd = Number(b.crewDays ?? b.quantities.days ?? 0)
        if (!Number.isFinite(cd) || cd <= 0) {
          reasons.push("days-based estimate missing crewDays/quantities.days.")
        } else if (cd < bands.min || cd > bands.max) {
          reasons.push(`Production rate unrealistic: crewDays=${cd} (expected ${bands.min}–${bands.max}).`)
        } else {
          // Optional sanity: implied hours shouldn't be wildly inconsistent with crewDays (assume ~8h/day)
          const impliedLaborHours = laborDollars / laborRate
          const impliedDaysAt8 = impliedLaborHours / 8
          if (Number.isFinite(impliedDaysAt8) && impliedDaysAt8 > 0) {
            // Super forgiving: allow 3x mismatch before flagging
            const ratio = impliedDaysAt8 / cd
            if (ratio > 3.0 || ratio < 0.33) {
              reasons.push(
                `Labor math inconsistent with crewDays: implied ${(impliedDaysAt8).toFixed(1)} day(s) @8h/day vs crewDays=${cd}.`
              )
            }
          }
        }
      } else {
        // For count/sqft/linear_ft/device/fixture/room/door
        const qty = Number(b.quantities?.[primaryUnit] ?? 0)
        if (!Number.isFinite(qty) || qty <= 0) {
          reasons.push(`${primaryUnit} unit selected but quantity missing/zero in estimateBasis.`)
        } else {
          const impliedLaborHours = laborDollars / laborRate
          const impliedHrsPerUnit = impliedLaborHours / qty

          if (!Number.isFinite(impliedHrsPerUnit) || impliedHrsPerUnit <= 0) {
            reasons.push(`Invalid implied production rate for ${primaryUnit}.`)
          } else {
            if (impliedHrsPerUnit < bands.min || impliedHrsPerUnit > bands.max) {
              reasons.push(
                `Production rate unrealistic for ${primaryUnit}: ${impliedHrsPerUnit.toFixed(3)} ${bands.label} (expected ${bands.min}–${bands.max}).`
              )
            }

            // If model provided hoursPerUnit, ensure it roughly matches implied math
            const hpu = Number(b.hoursPerUnit ?? 0)
            if (Number.isFinite(hpu) && hpu > 0) {
              if (!approxEqual(hpu, impliedHrsPerUnit, 0.18)) {
                reasons.push("hoursPerUnit does not match laborRate × quantity math.")
              }
            }
          }
        }
      }
    }
  }

    // -----------------------------
  // NEW: Complexity Profile enforcement
  // -----------------------------
  const cp = args.complexity ?? null

  if (cp?.requireDaysBasis) {
    // Must include "days" + crewDays
    const hasDaysUnit = Array.isArray(b.units) && b.units.includes("days")
    if (!hasDaysUnit) reasons.push(`Complexity requires days-based estimateBasis (missing "days" in units).`)

    const cd = Number(b.crewDays ?? b.quantities?.days ?? 0)
    if (!Number.isFinite(cd) || cd <= 0) {
      reasons.push("Complexity requires crewDays (missing/invalid crewDays).")
    } else {
      if (cd < cp.minCrewDays || cd > cp.maxCrewDays) {
        reasons.push(
          `crewDays out of range for ${cp.class}: ${cd} (expected ${cp.minCrewDays}–${cp.maxCrewDays}).`
        )
      }
    }
  }

  // Mobilization/subs minimums by complexity (for structure realism)
  if (cp) {
    if (Number(b.mobilization) < cp.minMobilization) {
      reasons.push(`mobilization too low for ${cp.class} job (min ${cp.minMobilization}).`)
    }
    if (Number(p.subs) < cp.minSubs) {
      reasons.push(`subs too low for ${cp.class} job (min ${cp.minSubs}).`)
    }
  }

  const cs = validateCrewAndSequencing({
  pricing: p,
  basis: b,
  cp: args.complexity ?? null,
  scopeText: args.scopeText ?? "",
})
if (!cs.ok) reasons.push(...cs.reasons)

  return { ok: reasons.length === 0, reasons }
}

// 🔍 Trade auto-detection
function autoDetectTrade(scope: string): string {
  const s = scope.toLowerCase()

  // Drywall should come BEFORE painting so "drywall patch" doesn't become painting
  if (/(drywall|sheetrock|skim\s*coat|tape\s*and\s*mud|taping|mudding|texture|orange\s*peel|knockdown)/.test(s))
    return "drywall"

  if (/(paint|painting|prime|primer)/.test(s))
    return "painting"

  if (/(floor|flooring|lvp|vinyl\s*plank|laminate|hardwood|carpet|tile\s+floor|floor\s+tile)/.test(s))
    return "flooring"

  if (/(electrical|outlet|switch|panel|lighting)/.test(s))
    return "electrical"

  if (/(plumb|toilet|sink|faucet|shower|water line)/.test(s))
    return "plumbing"

  if (/(carpentry|trim|baseboard|framing|cabinet)/.test(s))
    return "carpentry"

  return "general renovation"
}

function isMixedRenovation(scope: string) {
  const s = scope.toLowerCase()

  const hasPaint = /\b(paint|painting|repaint|prime|primer)\b/.test(s)
  const hasNonPaint =
    /\b(tile|grout|vanity|toilet|sink|faucet|shower|plumb|plumbing|electrical|outlet|switch|flooring|demo|demolition|remodel|install)\b/.test(s)

  return hasPaint && hasNonPaint
}

function parseSqft(text: string): number | null {
  const m = text
    .toLowerCase()
    .match(/(\d{1,5})\s*(sq\s*ft|sqft|square\s*feet|sf)\b/)
  if (!m?.[1]) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

function parseHasVanity(text: string): boolean {
  return /\bvanity\b/.test(text.toLowerCase())
}

function parseTile(text: string): boolean {
  return /\b(tile|porcelain|ceramic|grout)\b/.test(text.toLowerCase())
}

function parseDemo(text: string): boolean {
  return /\b(demo|demolition|remove|tear\s*out)\b/.test(text.toLowerCase())
}

function parseBathKeyword(text: string): boolean {
  return /\b(bath|bathroom|shower|tub)\b/.test(text.toLowerCase())
}

function parseKitchenKeyword(text: string): boolean {
  return /\b(kitchen|cabinet|cabinets|countertop|counter top|backsplash|sink|faucet|range|cooktop|hood|appliance|dishwasher|microwave)\b/i.test(
    text
  )
}

function parseFlooringKeyword(text: string): boolean {
  return /\b(floor|flooring|lvp|vinyl plank|laminate|hardwood|engineered wood|carpet|tile floor|underlayment|baseboard)\b/i.test(
    text
  )
}

function parseWallTileKeyword(text: string): boolean {
  // helps prevent flooring-only anchor from triggering on shower wall tile jobs
  return /\b(shower\s+walls?|tub\s+surround|wall\s+tile|backsplash)\b/i.test(text)
}

function parseElectricalDeviceBreakdown(text: string) {
  const t = text.toLowerCase()

  const sumMatches = (re: RegExp) => {
    let total = 0
    for (const m of t.matchAll(re)) {
      const n = Number(m[1])
      if (Number.isFinite(n) && n > 0) total += n
    }
    return total
  }

  // Allow up to 2 words between number and the thing
  // e.g. "2 new outlets", "4 existing switches", "6 gfci outlets"
  const outlets = sumMatches(/(\d{1,4})\s+(?:\w+\s+){0,2}(outlet|receptacle|plug)s?\b/g)
  const switches = sumMatches(/(\d{1,4})\s+(?:\w+\s+){0,2}switch(es)?\b/g)

  // e.g. "4 new recessed can lights", "6 can lights", "8 recessed lights"
  const recessed = sumMatches(
    /(\d{1,4})\s+(?:\w+\s+){0,2}(recessed|can)\s+lights?\b/g
  )

  const fixtures = sumMatches(
    /(\d{1,4})\s+(?:\w+\s+){0,2}(light\s*fixture|fixture|sconce)s?\b/g
  )

  const total = outlets + switches + recessed + fixtures
  return total > 0 ? { outlets, switches, recessed, fixtures, total } : null
}

function priceBathroomRemodelAnchor(args: {
  scope: string
  stateMultiplier: number
  measurements?: any | null
}): Pricing | null {
  const s = args.scope.toLowerCase()

  const isBath = parseBathKeyword(s)
  const remodelSignals =
    /\b(remodel|renovation|gut|rebuild|demo|demolition|tile|waterproof|membrane|shower\s*pan|tub\s*surround|install\s+vanity|relocat(e|ing|ion)|move\s+(drain|valve|supply))\b/.test(s)

  if (!isBath || !remodelSignals) return null

  // Prefer user measurements; else parse; else assume small bath floor area
  const bathFloorSqft =
    (args.measurements?.totalSqft && args.measurements.totalSqft > 0
      ? Number(args.measurements.totalSqft)
      : null) ??
    parseSqft(s) ??
    60

  const hasDemo = parseDemo(s)
  const hasWallTile = /\b(tile|wall\s*tile|shower\s*walls?|tub\s*surround)\b/.test(s)
  const hasWaterproof = /\b(waterproof|membrane|red\s*guard|pan|curb)\b/.test(s)
  const hasVanity = parseHasVanity(s)
  const hasValveRelocate = /\b(relocat(e|ing|ion)|move\s+(the\s*)?valve|relocate\s+valve)\b/.test(s)

  // Estimate shower wall tile sqft when wall-tile is mentioned
  // Typical: 3 walls * (5ft wide * 8ft high) ≈ 120 sqft
  const wallTileSqft = hasWallTile ? 120 : 0

  // ---- Tunable anchors (bath remodel wet-area) ----
  const laborRate = 115 // was 85 (too low)
  const markup = 25

  // Labor hours (rough but realistic)
  let laborHrs = 0
  laborHrs += hasDemo ? 16 : 10                         // demo + haul prep
  laborHrs += hasValveRelocate ? 10 : 0                 // open wall + relocate + test
  laborHrs += hasWaterproof ? 10 : 0                    // prep + membrane/paint-on + details
  laborHrs += hasWallTile ? Math.max(28, wallTileSqft * 0.30) : 0 // tile walls incl layout/cuts
  laborHrs += hasVanity ? 6 : 0                         // set vanity + hook-ups
  laborHrs += 10                                        // protection, cleanup, coordination, returns

  // Hard floor so remodels can't come out “one day”
  laborHrs = Math.max(70, laborHrs)

  let labor = Math.round(laborHrs * laborRate)
  labor = Math.round(labor * args.stateMultiplier)

  // Materials allowances (mid-market; not luxury finishes)
  let materials = 0
  materials += hasDemo ? 150 : 75                       // protection/consumables
  materials += hasValveRelocate ? 300 : 0               // fittings/valve misc (not designer trim kits)
  materials += hasWaterproof ? 350 : 0                  // membrane/roll-on + accessories
  materials += hasWallTile ? Math.max(900, wallTileSqft * 10) : 0 // tile + setting materials allowance
  materials += hasVanity ? 250 : 0                      // supplies, traps, stops, misc
  materials = Math.round(materials)

  // Subs / overhead (dump + supervision + mobilization)
  const mobilization = 750
  const dumpFee = hasDemo ? 450 : 0
  const supervision = Math.round((labor + materials) * 0.10)
  const subs = mobilization + dumpFee + supervision

  const base = labor + materials + subs
  const total = Math.round(base * (1 + markup / 100))

  return { labor, materials, subs, markup, total }
}

function priceKitchenRefreshAnchor(args: {
  scope: string
  stateMultiplier: number
  measurements?: any | null
}): Pricing | null {
  const s = args.scope.toLowerCase()

  const isKitchen = /\bkitchen\b/.test(s) || parseKitchenKeyword(s)
  if (!isKitchen) return null

  // If it's a total gut/layout change, skip this anchor (future “kitchen_remodel” anchor)
  const majorRemodel =
  /\b(remodel|renovation|demo|demolition|gut|rebuild|rebuild|full\s*replace|replace\s+all|move\s+wall|remove\s+wall|relocat(e|ing)\s+plumb|relocat(e|ing)\s+electrical|new\s+layout|structural)\b/.test(s)
  if (majorRemodel) return null

  // Size signal (you said it will usually exist in text or measurements)
  const sqft =
    (args.measurements?.totalSqft && args.measurements.totalSqft > 0
      ? Number(args.measurements.totalSqft)
      : null) ??
    parseSqft(s) ??
    225

  // Cabinet intent
  const newCabinets =
    /\b(new\s+cabinets?|install\s+cabinets?|replace\s+cabinets?)\b/.test(s)

  const repaintCabinets =
    /\b(repaint\s+cabinets?|paint\s+cabinets?|cabinet\s+repaint|refinish\s+cabinets?)\b/.test(s)

  const hasBacksplash = /\b(backsplash|tile\s+backsplash)\b/.test(s)
  const hasPaint = /\b(paint|painting|prime|primer|repaint)\b/.test(s)
  const hasSinkFaucet = /\b(sink|faucet)\b/.test(s)
  const hasFlooring = /\b(floor|flooring|lvp|vinyl\s+plank|laminate|hardwood|tile\s+floor)\b/.test(s)
  const hasDemo = parseDemo(s)

  // Flooring type (only if flooring is included)
  const floorIsTile = hasFlooring && /\b(tile|porcelain|ceramic)\b/.test(s)
  const floorIsLvp = hasFlooring && /\b(lvp|vinyl\s+plank|luxury\s+vinyl)\b/.test(s)
  const floorIsLam = hasFlooring && /\b(laminate)\b/.test(s)

  const laborRate = 95
  const markup = 25

  // ---- Labor (tunable) ----
  let laborHrs = 0
  laborHrs += hasDemo ? 10 : 5

  // Cabinets:
  if (newCabinets) laborHrs += 26
  if (repaintCabinets) laborHrs += 22

  // Backsplash + paint + sink
  laborHrs += hasBacksplash ? 14 : 0
  laborHrs += hasPaint ? 10 : 0
  laborHrs += hasSinkFaucet ? 4 : 0

  // Optional flooring in kitchen scope (use sqft)
  if (hasFlooring) {
    const installHrsPerSqft =
      floorIsTile ? 0.10 :
      (floorIsLvp || floorIsLam) ? 0.045 :
      0.05

    const demoHrsPerSqft = hasDemo ? 0.02 : 0
    laborHrs += sqft * (installHrsPerSqft + demoHrsPerSqft)
  }

  // Minimum baseline for a “kitchen refresh” coordination
  laborHrs = Math.max(28, laborHrs + 6)

  let labor = Math.round(laborHrs * laborRate)
  labor = Math.round(labor * args.stateMultiplier)

  // ---- Materials allowances (mid-market) ----
  let materials = 0

  if (newCabinets) materials += 6500
  if (repaintCabinets) materials += 350

  if (hasBacksplash) materials += 750
  if (hasPaint) materials += 200
  if (hasSinkFaucet) materials += 450

  if (hasFlooring) {
    const matPerSqft =
      floorIsTile ? 6.5 :
      floorIsLvp ? 3.8 :
      floorIsLam ? 3.2 :
      4.0

    const underlaymentPerSqft = floorIsTile ? 0 : 0.6
    materials += Math.round(sqft * (matPerSqft + underlaymentPerSqft) + 180)
  }

  materials = Math.round(materials)

  // ---- Subs / overhead ----
  const mobilization = 500
  const dumpFee = hasDemo ? 300 : 0
  const supervision = Math.round((labor + materials) * 0.08)
  const subs = mobilization + dumpFee + supervision

  const base = labor + materials + subs
  const total = Math.round(base * (1 + markup / 100))

  return { labor, materials, subs, markup, total }
}

function priceKitchenRemodelAnchor(args: {
  scope: string
  stateMultiplier: number
  measurements?: any | null
}): Pricing | null {
  const s = args.scope.toLowerCase()

  const isKitchen = /\bkitchen\b/.test(s) || parseKitchenKeyword(s)
  if (!isKitchen) return null

  // Must look like a remodel (not just a refresh)
  const remodelSignals =
    /\b(remodel|renovation|gut|demo|demolition|rebuild|full\s*replace|replace\s+all|new\s+layout)\b/.test(s)

  if (!remodelSignals) return null

  const sqft =
    (args.measurements?.totalSqft && args.measurements.totalSqft > 0
      ? Number(args.measurements.totalSqft)
      : null) ??
    parseSqft(s) ??
    225

  const hasCabinets =
    /\b(cabinets?|cabinetry|install\s+cabinets?|replace\s+cabinets?)\b/.test(s)
  const hasCounters =
    /\b(counter(top)?s?|countertop|quartz|granite|laminate\s+counter)\b/.test(s)
  const hasBacksplash = /\b(backsplash|tile\s+backsplash)\b/.test(s)
  const hasSinkFaucet = /\b(sink|faucet)\b/.test(s)
  const hasFlooring =
    /\b(floor|flooring|lvp|vinyl\s+plank|laminate|hardwood|tile\s+floor)\b/.test(s)
  const hasPaint = /\b(paint|painting|prime|primer|repaint)\b/.test(s)

  const hasDemo = parseDemo(s) || /\b(remove\s+existing|tear\s*out)\b/.test(s)

  const floorIsTile = hasFlooring && /\b(tile|porcelain|ceramic)\b/.test(s)
  const floorIsLvp = hasFlooring && /\b(lvp|vinyl\s+plank|luxury\s+vinyl)\b/.test(s)
  const floorIsLam = hasFlooring && /\b(laminate)\b/.test(s)

  const laborRate = 105
  const markup = 25

  let laborHrs = 0
  laborHrs += hasDemo ? 18 : 10
  laborHrs += hasCabinets ? 40 : 20
  laborHrs += hasCounters ? 10 : 6
  laborHrs += hasBacksplash ? 16 : 0
  laborHrs += hasPaint ? 12 : 0
  laborHrs += hasSinkFaucet ? 6 : 0

  if (hasFlooring) {
    const installHrsPerSqft =
      floorIsTile ? 0.12 :
      (floorIsLvp || floorIsLam) ? 0.05 :
      0.055
    const demoHrsPerSqft = hasDemo ? 0.03 : 0
    laborHrs += sqft * (installHrsPerSqft + demoHrsPerSqft)
  }

  laborHrs = Math.max(70, laborHrs + 10)

  let labor = Math.round(laborHrs * laborRate)
  labor = Math.round(labor * args.stateMultiplier)

  let materials = 0
  materials += hasCabinets ? 9500 : 3500
  materials += hasCounters ? 2800 : 900
  materials += hasBacksplash ? 900 : 0
  materials += hasSinkFaucet ? 600 : 0
  materials += hasPaint ? 250 : 0

  if (hasFlooring) {
    const matPerSqft =
      floorIsTile ? 7.0 :
      floorIsLvp ? 4.1 :
      floorIsLam ? 3.4 :
      4.2
    const underlaymentPerSqft = floorIsTile ? 0 : 0.7
    materials += Math.round(sqft * (matPerSqft + underlaymentPerSqft) + 250)
  }

  materials = Math.round(materials)

  const mobilization = 650
  const dumpFee = hasDemo ? 450 : 150
  const supervision = Math.round((labor + materials) * 0.10)
  const coordinationAllowance = 500

  const subs = mobilization + dumpFee + supervision + coordinationAllowance

  const base = labor + materials + subs
  const total = Math.round(base * (1 + markup / 100))

  return { labor, materials, subs, markup, total }
}

function priceElectricalDeviceSwapsAnchor(args: {
  scope: string
  stateMultiplier: number
}): Pricing | null {
  const s = args.scope.toLowerCase()

  // Must be device-level work (not panels/rewires)
  const isDeviceWork =
    /\b(outlet|receptacle|switch|recessed|can\s*light|light\s*fixture|fixture|sconce|device)\b/.test(s)

  const isHeavyElectrical =
    /\b(panel|service|rewire|new\s+circuit|rough[-\s]*in|subpanel|meter|trench)\b/.test(s)

  if (!isDeviceWork || isHeavyElectrical) return null

  // Require explicit counts (your real-world workflow)
  const breakdown = parseElectricalDeviceBreakdown(s)
  if (!breakdown) return null

  const laborRate = 115
  const markup = 25

  const isAddWork =
  /\b(add|adding|install(ing)?|new\s+(circuit|run|line|home\s*run)|rough[-\s]*in)\b/.test(s)

const isSwapWork =
  /\b(replace|replacing|swap|swapping|change\s*out|remove\s+and\s+replace)\b/.test(s)

// If it explicitly says swap/replace, treat as swap even if “install” appears
const treatAsAdd = isAddWork && !isSwapWork

const hrsPerOutlet = treatAsAdd ? 0.85 : 0.45
const hrsPerSwitch = treatAsAdd ? 0.75 : 0.40
const hrsPerRecessed = treatAsAdd ? 1.10 : 0.70
const hrsPerFixture = treatAsAdd ? 0.95 : 0.65

  const troubleshootingAllowanceHrs =
    /\b(troubleshoot|not\s+working|diagnos)\b/.test(s) ? 1.5 : 0

  const laborHrs =
    breakdown.outlets * hrsPerOutlet +
    breakdown.switches * hrsPerSwitch +
    breakdown.recessed * hrsPerRecessed +
    breakdown.fixtures * hrsPerFixture +
    troubleshootingAllowanceHrs +
    1.25 // setup, protection, testing

  let labor = Math.round(laborHrs * laborRate)
  labor = Math.round(labor * args.stateMultiplier)

  // Materials allowance per device (mid-market, not luxury fixtures)
  const matPerOutlet = 16
  const matPerSwitch = 14
  const matPerRecessed = 28
  const matPerFixture = 22

  const materials = Math.round(
    breakdown.outlets * matPerOutlet +
      breakdown.switches * matPerSwitch +
      breakdown.recessed * matPerRecessed +
      breakdown.fixtures * matPerFixture
  )

  const mobilization =
    breakdown.total <= 6 ? 225 :
    breakdown.total <= 15 ? 325 :
    450

  const supervision = Math.round((labor + materials) * 0.05)
  const subs = mobilization + supervision

  const base = labor + materials + subs
  const total = Math.round(base * (1 + markup / 100))

  return { labor, materials, subs, markup, total }
}

function priceFlooringOnlyAnchor(args: {
  scope: string
  stateMultiplier: number
  measurements?: any | null
}): Pricing | null {
  const s = args.scope.toLowerCase()

  // Must be flooring-ish
  const isFlooring = parseFlooringKeyword(s)
  if (!isFlooring) return null

  // Don’t let it catch wall tile / shower surround
  if (parseWallTileKeyword(s)) return null
  if (parseBathKeyword(s) && /\b(shower|tub)\b/.test(s)) return null

  // Sqft: prefer measurements.totalSqft, then parse, then default
  const sqft =
    (args.measurements?.totalSqft && args.measurements.totalSqft > 0
      ? Number(args.measurements.totalSqft)
      : null) ??
    parseSqft(s) ??
    180

  // Demo signal
  const hasDemo =
    parseDemo(s) || /\b(remove\s+existing|tear\s*out|haul\s*away|dispose)\b/.test(s)

  // Material class
  const isTile = /\b(tile|porcelain|ceramic)\b/.test(s) && /\bfloor\b/.test(s)
  const isHardwood = /\b(hardwood|engineered\s*wood)\b/.test(s)
  const isLaminate = /\b(laminate)\b/.test(s)
  const isCarpet = /\b(carpet)\b/.test(s)
  const isLvp = /\b(lvp|vinyl\s+plank|luxury\s+vinyl)\b/.test(s)

  const laborRate = 85
  const markup = 25

  // Labor hours per sqft (tunable)
  const installHrsPerSqft =
    isTile ? 0.12 :
    isHardwood ? 0.09 :
    isCarpet ? 0.06 :
    (isLaminate || isLvp) ? 0.05 :
    0.06

  const demoHrsPerSqft = hasDemo ? 0.03 : 0
  const baseHrs = sqft * (installHrsPerSqft + demoHrsPerSqft) + 8 // protection/transitions/cleanup

  let labor = Math.round(baseHrs * laborRate)
  labor = Math.round(labor * args.stateMultiplier)

  // Materials allowance per sqft (mid-market)
  const matPerSqft =
    isTile ? 6.5 :
    isHardwood ? 7.5 :
    isCarpet ? 4.0 :
    isLaminate ? 3.2 :
    isLvp ? 3.8 :
    4.0

  const underlaymentPerSqft = isTile ? 0.0 : 0.6
  const transitionAllowance = 160

  const materials = Math.round(sqft * (matPerSqft + underlaymentPerSqft) + transitionAllowance)

  const mobilization = 400
  const dumpFee = hasDemo ? 300 : 0
  const supervision = Math.round((labor + materials) * 0.06)
  const subs = mobilization + dumpFee + supervision

  const base = labor + materials + subs
  const total = Math.round(base * (1 + markup / 100))

  return { labor, materials, subs, markup, total }
}

function pricePlumbingFixtureSwapsAnchor(args: {
  scope: string
  stateMultiplier: number
}): Pricing | null {
  const s = args.scope.toLowerCase()

  // Must be fixture-level work
  const isFixtureWork =
  /\b(toilet|commode|faucet|sink|vanity|shower\s*valve|mixing\s*valve|diverter|cartridge|trim\s*kit)\b/.test(s)

  // Exclude high-variance plumbing
  const isHeavyPlumbing = hasHeavyPlumbingSignals(s)
  // Exclude remodel scopes (should be handled elsewhere)
  const isRemodelScope =
    /\b(remodel|renovation|gut|rebuild|demo|demolition)\b/.test(s)

  if (!isFixtureWork || isHeavyPlumbing || isRemodelScope) return null

  // Require explicit counts
  const breakdown = parsePlumbingFixtureBreakdown(s)
  if (!breakdown) return null

  const laborRate = 125
  const markup = 25

  const isAddWork = /\b(add|adding|install(ing)?|new)\b/.test(s)
  const isSwapWork = /\b(replace|replacing|swap|swapping|remove\s+and\s+replace)\b/.test(s)
  const treatAsAdd = isAddWork && !isSwapWork

  // Tunable hours per fixture
  const hrsPerToilet = treatAsAdd ? 2.25 : 1.75
  const hrsPerFaucet = treatAsAdd ? 1.6 : 1.1
  const hrsPerSink = treatAsAdd ? 2.25 : 1.5
  const hrsPerVanity = treatAsAdd ? 5.5 : 4.25
  const hrsPerShowerValve = treatAsAdd ? 5.0 : 3.75

  const troubleshootHrs =
    /\b(leak|leaking|clog|clogged|diagnos|troubleshoot|not\s+working)\b/.test(s)
      ? 1.5
      : 0

  const laborHrs =
    breakdown.toilets * hrsPerToilet +
    breakdown.faucets * hrsPerFaucet +
    breakdown.sinks * hrsPerSink +
    breakdown.vanities * hrsPerVanity +
    breakdown.showerValves * hrsPerShowerValve +
    troubleshootHrs +
    1.25 // setup/protection/test

  let labor = Math.round(laborHrs * laborRate)
  labor = Math.round(labor * args.stateMultiplier)

  // Mid-market supplies allowance per fixture (NOT the fixture itself)
  const matPerToilet = 85
  const matPerFaucet = 45
  const matPerSink = 65
  const matPerVanity = 140
  const matPerShowerValve = 95

  const materials = Math.round(
    breakdown.toilets * matPerToilet +
      breakdown.faucets * matPerFaucet +
      breakdown.sinks * matPerSink +
      breakdown.vanities * matPerVanity +
      breakdown.showerValves * matPerShowerValve
  )

  const mobilization =
    breakdown.total <= 2 ? 225 :
    breakdown.total <= 6 ? 325 :
    450

  const supervision = Math.round((labor + materials) * 0.05)
  const subs = mobilization + supervision

  const base = labor + materials + subs
  const total = Math.round(base * (1 + markup / 100))

  return { labor, materials, subs, markup, total }
}

function isPlumbingRemodelConflict(args: {
  scopeText: string
  complexity: ComplexityProfile | null
}): boolean {
  const s = (args.scopeText || "").toLowerCase()
  const cp = args.complexity

  const isBath =
    /\b(bath|bathroom|shower|tub)\b/.test(s)

  const remodelSignals =
    /\b(remodel|renovation|gut|rebuild|demo|demolition|tear\s*out)\b/.test(s)

  // “Not plumbing-only” signals (tile/wet-area/finish coordination)
  const nonPlumbingSignals =
    /\b(tile|wall\s*tile|tub\s*surround|shower\s+walls?|backsplash|waterproof|membrane|red\s*guard|cement\s*board|durock|hardie(backer)?|thinset|grout)\b/.test(s)

  // Rough-in / relocation is often part of remodel and should not be priced as “only plumbing”
  const relocateSignals =
    /\b(rough[-\s]*in|relocat(e|ing|ion)|move\s+(drain|supply|valve|line))\b/.test(s)

  // If complexity already classified as remodel/multiTrade, trust it
  const cpSaysRemodel = cp?.class === "remodel" || cp?.multiTrade === true

  // Conflict means: bathroom remodel patterns present + not plumbing-only
  return isBath && (remodelSignals || cpSaysRemodel) && (nonPlumbingSignals || relocateSignals)
}

const PRICEGUARD_ANCHORS: PricingAnchor[] = [
  
  // 1) Kitchen refresh (before bathroom so it doesn’t get “general renovation” collisions later)
  {
  id: "kitchen_remodel_v1",
  when: (ctx) => {
    const s = ctx.scope.toLowerCase()
    const isKitchen = /\bkitchen\b/.test(s) || parseKitchenKeyword(s)
    if (!isKitchen) return false

    return /\b(remodel|renovation|gut|demo|demolition|rebuild|full\s*replace|replace\s+all|new\s+layout)\b/.test(s)
  },
  price: (ctx) =>
    priceKitchenRemodelAnchor({
      scope: ctx.scope,
      stateMultiplier: ctx.stateMultiplier,
      measurements: ctx.measurements,
    }),
},
  
  {
    id: "kitchen_refresh_v1",
    when: (ctx) => /\bkitchen\b/i.test(ctx.scope) || parseKitchenKeyword(ctx.scope),
    price: (ctx) =>
      priceKitchenRefreshAnchor({
        scope: ctx.scope,
        stateMultiplier: ctx.stateMultiplier,
        measurements: ctx.measurements,
      }),
  },

  // 2) Bathroom remodel
  {
    id: "bathroom_remodel_v1",
    when: (ctx) => /\b(bath|bathroom|shower|tub)\b/i.test(ctx.scope),
    price: (ctx) =>
      priceBathroomRemodelAnchor({
        scope: ctx.scope,
        stateMultiplier: ctx.stateMultiplier,
        measurements: ctx.measurements,
      }),
  },

  // 3) Flooring-only
{
  id: "flooring_only_v1",
  when: (ctx) => {
    // ✅ Flooring trade should be handled by the flooring deterministic engine,
    // not by this generic anchor.
    if (ctx.trade === "flooring") return false

    const s = ctx.scope.toLowerCase()

    // Only trigger this anchor when flooring is IMPLIED inside another trade
    // (ex: kitchen refresh mentions flooring, general renovation mentions flooring, etc.)
    const mentionsFlooring =
      /\b(floor|flooring|lvp|vinyl\s+plank|laminate|hardwood|carpet|tile\s+floor)\b/.test(s)

    if (!mentionsFlooring) return false

    // Exclude *remodel* signals, not just the words kitchen/bath
    const looksLikeKitchenRemodel =
      (/\bkitchen\b/.test(s) || parseKitchenKeyword(s)) &&
      /\b(remodel|renovation|gut|cabinets?|counter(top)?|backsplash|sink)\b/.test(s)

    const looksLikeBathRemodel =
      (/\b(bath|bathroom)\b/.test(s) || parseBathKeyword(s)) &&
      /\b(remodel|renovation|gut|shower|tub|vanity|tile\s+walls?|surround)\b/.test(s)

    return !looksLikeKitchenRemodel && !looksLikeBathRemodel
  },
  price: (ctx) =>
    priceFlooringOnlyAnchor({
      scope: ctx.scope,
      stateMultiplier: ctx.stateMultiplier,
      measurements: ctx.measurements,
    }),
},

// 4) Plumbing fixture swaps (strict, count-based)
{
  id: "plumbing_fixture_swaps_v1",
  when: (ctx) => {
  const s = ctx.scope.toLowerCase()

  // Must mention plumbing fixtures
  const hasFixtureWords =
    /\b(toilet|commode|faucet|sink|vanity|shower\s*valve|mixing\s*valve|diverter|cartridge|trim\s*kit)\b/.test(s)
  if (!hasFixtureWords) return false

  // Require explicit counts
  const breakdown = parsePlumbingFixtureBreakdown(s)
  if (!breakdown) return false

  // HARD plumbing signals (always block)
  const heavySignals = hasHeavyPlumbingSignals(s)

  // General remodel signals (non-fixture scope)
  const remodelSignals =
    /\b(remodel|renovation|gut|rebuild|demo|demolition|tile|backsplash|cabinets?|counter(top)?|shower\s+walls?|tub\s+surround)\b/.test(s)

  // SOFT bath-build block
  const mentionsBathWetArea =
    /\b(shower|tub|bath|bathroom|tub\s*surround)\b/.test(s)

  const bathBuildSignals =
    /\b(tile|wall\s*tile|shower\s*walls?|tub\s*surround|surround|pan|shower\s*pan|curb|waterproof|membrane|red\s*guard|backer\s*board|cement\s*board|hardie(backer)?|durock|mud\s*bed|thinset|grout|demo|demolition|tear\s*out|gut|rebuild|rough[-\s]*in|relocat(e|ion|ing)|move\s+(drain|valve|supply)|new\s+(shower|tub)|convert|conversion)\b/.test(s)

  const valveRelocation =
    /\b(valve\s*relocation|relocat(e|ing)\s+(the\s*)?valve|move\s+(the\s*)?valve)\b/.test(s)

  const softBathBuildBlock =
    mentionsBathWetArea && (bathBuildSignals || valveRelocation)

  return !heavySignals && !remodelSignals && !softBathBuildBlock
},
  price: (ctx) =>
    pricePlumbingFixtureSwapsAnchor({
      scope: ctx.scope,
      stateMultiplier: ctx.stateMultiplier,
    }),
},
  
  // 5) Electrical device swaps (strict, count-based)
  {
  id: "electrical_device_swaps_v1",
  when: (ctx) => {

    const s = ctx.scope.toLowerCase()

    const hasDeviceWords =
      /\b(outlet|receptacle|switch|recessed|can\s*light|light\s*fixture|fixture|sconce|devices?)\b/.test(s)

    const hasRemodelSignals =
      /\b(remodel|renovation|gut|demo|tile|vanity|toilet|shower|tub|kitchen|cabinets?|counter(top)?|backsplash)\b/.test(s)

    return hasDeviceWords && !hasRemodelSignals
  },
  price: (ctx) =>
    priceElectricalDeviceSwapsAnchor({
      scope: ctx.scope,
      stateMultiplier: ctx.stateMultiplier,
    }),
},
]

function runPriceGuardAnchors(ctx: AnchorContext): AnchorResult | null {
  for (const a of PRICEGUARD_ANCHORS) {
    if (!a.when(ctx)) continue
    const pricing = a.price(ctx)
    if (pricing) return { id: a.id, pricing }
  }
  return null
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

function parseDoorCount(text: string): number | null {
  const t = text.toLowerCase()

  const patterns = [
    // paint 12 doors / paint 12 interior doors / paint 12 prehung interior doors
    /paint\s+(\d{1,4})\s+(?:\w+\s+){0,2}doors?\b/i,

    // 12 doors / 12 interior doors / 12 prehung interior doors
    /(\d{1,4})\s+(?:\w+\s+){0,2}doors?\b/i,

    // doors: 12 / doors - 12
    /doors?\s*[:\-]\s*(\d{1,4})\b/i,
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
  paintScope: "walls" | "walls_ceilings" | "full"
}): Pricing {
  const s = args.scope.toLowerCase()
  const { lengthFt, widthFt, heightFt } = parseRoomDims(args.scope)

  const coatsMatch = s.match(/(\d)\s*coats?/)
  const coats = coatsMatch ? Math.max(1, Number(coatsMatch[1])) : 2

  // ✅ authoritative scope comes from dropdown
  const includeCeilings = args.paintScope !== "walls"
  const includeTrimDoors = args.paintScope === "full"

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
  const patchingPerRoom = /patch|patching/.test(s) ? 25 : 0
  const consumablesPerRoom = 18
  const markup = 25
  const setupHoursPerRoom = 1.25

  const trimDoorLaborHoursPerRoom = includeTrimDoors ? 0.75 : 0
  const trimDoorMaterialsPerRoom = includeTrimDoors ? 12 : 0
  // -----------------------

  const laborHoursTotal =
    (paintSqftPerRoom * args.rooms) / sqftPerLaborHour +
    setupHoursPerRoom * args.rooms +
    trimDoorLaborHoursPerRoom * args.rooms

  let labor = Math.round(laborHoursTotal * laborRate)
  labor = Math.round(labor * args.stateMultiplier)

  const gallonsTotal =
    ((paintSqftPerRoom * args.rooms) / coverageSqftPerGallon) * wasteFactor

  const paintCost = Math.round(gallonsTotal * paintCostPerGallon)
  const patchCost = args.rooms * patchingPerRoom
  const consumables = args.rooms * consumablesPerRoom

  const materials =
    paintCost + patchCost + consumables + (trimDoorMaterialsPerRoom * args.rooms)

  const mobilization =
  args.rooms <= 2 ? 250 :
  args.rooms <= 5 ? 450 :
  args.rooms <= 10 ? 750 :
  1200
  const supervisionPct = args.rooms >= 50 ? 0.10 : 0.06
  const supervision = Math.round((labor + materials) * supervisionPct)

  const subs = mobilization + supervision
  const base = labor + materials + subs
  const total = Math.round(base * (1 + markup / 100))

  return { labor, materials, subs, markup, total }
}

function pricePaintingDoors(args: {
  doors: number
  stateMultiplier: number
  includeDoorTrim?: boolean
  explicitTrimRequested?: boolean
}): Pricing {
  const laborRate = 75
  const markup = 25

  // Door slab baseline
  const laborHoursPerDoor = 0.9
  const materialPerDoor = 18

  // Door casing/frames baseline (DEFAULT ON for doors-only)
  const trimLaborHoursPerDoor = args.includeDoorTrim ? 0.35 : 0
  const trimMaterialPerDoor = args.includeDoorTrim ? 6 : 0

  // Optional bump if user explicitly mentions trim/casing/frames (small extra allowance)
  const explicitTrimBumpLaborHrsPerDoor = args.explicitTrimRequested ? 0.15 : 0
  const explicitTrimBumpMatPerDoor = args.explicitTrimRequested ? 2 : 0

  let laborHours =
    args.doors * (laborHoursPerDoor + trimLaborHoursPerDoor + explicitTrimBumpLaborHrsPerDoor)

  let labor = Math.round(laborHours * laborRate)
  labor = Math.round(labor * args.stateMultiplier)

  const materials = Math.round(
    args.doors * (materialPerDoor + trimMaterialPerDoor + explicitTrimBumpMatPerDoor)
  )

  const subs = args.doors <= 6 ? 200 : 350

  const base = labor + materials + subs
  const total = Math.round(base * (1 + markup / 100))

  return { labor, materials, subs, markup, total }
}

// -----------------------------
// API HANDLER
// -----------------------------
export async function POST(req: NextRequest) {
  try {
    // -----------------------------
  // HARDENED FRONT DOOR
  // -----------------------------
  if (!assertBodySize(req, 40_000)) {
    return jsonError(413, "BODY_TOO_LARGE", "Request too large.")
  }

  if (!assertSameOrigin(req)) {
    return jsonError(403, "BAD_ORIGIN", "Invalid request origin.")
  }

  // Rate limit (IP + email). Email needs body, so parse first safely.
  let raw: any
  try {
    raw = await req.json()
  } catch {
    return jsonError(400, "BAD_JSON", "Invalid JSON body.")
  }

  const inputParsed = GenerateSchema.safeParse(raw)
if (!inputParsed.success) {
  return jsonError(400, "BAD_INPUT", "Invalid request fields.")
}

const body = inputParsed.data
  body.scopeChange = cleanScopeText(body.scopeChange)

  const normalizedEmail = body.email.trim().toLowerCase()

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"

  const rl1 = rateLimit(`gen:ip:${ip}`, 20, 60_000)
  if (!rl1.ok) {
    return NextResponse.json(
      {
        ok: false,
        code: "RATE_LIMIT",
        message: "Too many requests.",
        retry_after: Math.ceil((rl1.resetAt - Date.now()) / 1000),
      },
      { status: 429 }
    )
  }

  const rl2 = rateLimit(`gen:email:${normalizedEmail}`, 12, 60_000)
  if (!rl2.ok) {
    return NextResponse.json(
      {
        ok: false,
        code: "RATE_LIMIT",
        message: "Too many requests.",
        retry_after: Math.ceil((rl2.resetAt - Date.now()) / 1000),
      },
      { status: 429 }
    )
  }
    const measurements = body.measurements ?? null

    type PaintScope = "walls" | "walls_ceilings" | "full"
    type EffectivePaintScope = PaintScope | "doors_only"

const paintScope: PaintScope | null =
  body.paintScope === "walls" ||
  body.paintScope === "walls_ceilings" ||
  body.paintScope === "full"
    ? body.paintScope
    : null

    const scopeChange = body.scopeChange
    const uiTradeRaw =
      typeof body.trade === "string" ? body.trade.trim().toLowerCase() : ""

    const uiTrade =
  uiTradeRaw === "auto-detect" ||
  uiTradeRaw === "auto detect" ||
  uiTradeRaw === "autodetect" ||
  uiTradeRaw === "auto"
    ? ""
    : uiTradeRaw === "bathroom_tile" || uiTradeRaw === "general_renovation"
      ? "general renovation"
      : uiTradeRaw
    const rawState = typeof body.state === "string" ? body.state.trim() : ""

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
    const usageCount = typeof entitlement?.usage_count === "number" ? entitlement.usage_count : 0

async function incrementUsageIfFree() {
  if (isPaid) return

  const { error } = await supabase.rpc("increment_usage", {
    p_email: normalizedEmail,
  })

  if (error) console.error("usage increment failed:", error)
}

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
    const jobState = rawState || "N/A"

    // -----------------------------
// TRADE + INTENT
// -----------------------------
let trade = uiTrade || autoDetectTrade(scopeChange)
trade = trade.trim().toLowerCase()

// If scope includes paint + other renovation work, don't let it become "painting"
if (trade === "painting" && isMixedRenovation(scopeChange)) {
  trade = "general renovation"
}

const paintScopeForJob: PaintScope | null =
  trade === "painting" ? paintScope : null

const intentHint = detectIntent(scopeChange)

const complexityProfile = buildComplexityProfile({
  scopeText: scopeChange,
  trade,
})

// Start with raw scope
let effectiveScopeChange = scopeChange

// Parse quantities from the raw scope (before we append extra lines)
const rooms = parseRoomCount(scopeChange)
const doors = parseDoorCount(scopeChange)

const stateAbbrev = getStateAbbrev(rawState)
const usedNationalBaseline = !(typeof stateAbbrev === "string" && stateAbbrev.length === 2)
const stateMultiplier = getStateLaborMultiplier(stateAbbrev)

// -----------------------------
// Flooring deterministic engine (PriceGuard™)
// -----------------------------
const flooringDet =
  trade === "flooring"
    ? computeFlooringDeterministic({
        scopeText: scopeChange,
        stateMultiplier,
        measurements,
      })
    : null

// ✅ apply deterministic pricing if possible (even if not verified)
const flooringDetPricing: Pricing | null =
  flooringDet?.okForDeterministic
    ? clampPricing(coercePricing(flooringDet.pricing))
    : null

  // Electrical deterministic engine (PriceGuard™)
const electricalDet =
  trade === "electrical"
    ? computeElectricalDeterministic({
        scopeText: scopeChange,
        stateMultiplier,
      })
    : null

    console.log("PG ELECTRICAL DET", electricalDet)

const electricalDetPricing: Pricing | null =
  electricalDet?.okForDeterministic
    ? clampPricing(coercePricing(electricalDet.pricing))
    : null

const plumbingDet =
  trade === "plumbing"
    ? computePlumbingDeterministic({
        scopeText: scopeChange,
        stateMultiplier,
      })
    : null

const plumbingScopeConflict =
  trade === "plumbing" &&
  isPlumbingRemodelConflict({
    scopeText: scopeChange,
    complexity: complexityProfile,
  })

const plumbingDetPricing: Pricing | null =
  plumbingScopeConflict
    ? null
    : plumbingDet?.okForDeterministic
      ? clampPricing(coercePricing(plumbingDet.pricing))
      : null

console.log("PG PLUMBING CONFLICT", {
  plumbingScopeConflict,
  jobType: plumbingDet?.jobType ?? null,
  okForDeterministic: plumbingDet?.okForDeterministic ?? null,
})

    // Drywall deterministic engine (PriceGuard™)
const drywallDet =
  trade === "drywall"
    ? computeDrywallDeterministic({
        scopeText: scopeChange,
        stateMultiplier,
        measurements,
      })
    : null

const drywallDetPricing: Pricing | null =
  drywallDet?.okForDeterministic
    ? clampPricing(coercePricing(drywallDet.pricing))
    : null

    
   
  console.log("PG FLAGS", {
  trade,
  electrical_ok: electricalDet?.okForDeterministic,
  plumbing_ok: plumbingDet?.okForDeterministic,
  drywall_ok: drywallDet?.okForDeterministic,
  plumbing_type: plumbingDet?.jobType,
  drywall_type: drywallDet?.jobType,
})

// Only treat as painting when the final trade is painting
const looksLikePainting = trade === "painting"

// PriceGuard™ v2 — Orchestration table (anchors only for non-deterministic trades)
const allowAnchors =
  // normal rule: anchors for non-deterministic trades
  !(trade === "electrical" || trade === "plumbing" || trade === "flooring" || trade === "drywall")
  // exception: if deterministic pricing is NOT available, allow anchors
  || (trade === "plumbing" && !plumbingDetPricing)
  || (trade === "electrical" && !electricalDetPricing)
  || (trade === "flooring" && !flooringDetPricing)
  || (trade === "drywall" && !drywallDetPricing)

const allowBathAnchorInPlumbing =
  trade === "plumbing" && /\b(bath|bathroom|shower|tub)\b/i.test(scopeChange)

const anchorHit =
  (trade === "electrical" ||
   trade === "flooring" ||
   trade === "drywall" ||
   (trade === "plumbing" && !allowBathAnchorInPlumbing))
    ? null
    : runPriceGuardAnchors({
        scope: scopeChange,
        trade,
        stateMultiplier,
        measurements,
        rooms,
        doors,
      })

console.log("PG ANCHOR", { hit: anchorHit?.id ?? null })

const anchorPricing: Pricing | null = anchorHit?.pricing ?? null

console.log("PG ANCHOR PRICING", {
  hit: anchorHit?.id ?? null,
  hasAnchorPricing: !!anchorPricing,
  anchorTotal: anchorPricing?.total ?? null,
})

const useBigJobPricing =
  looksLikePainting &&
  typeof rooms === "number" &&
  rooms >= 50 &&
  !(measurements?.totalSqft && measurements.totalSqft > 0)

const roomishRe =
  /\b(rooms?|hallway|living\s*room|family\s*room|bed(room)?|kitchen|bath(room)?|dining|office|closet|stair|entry|walls?|ceilings?)\b/i

// Words that imply door-associated trim/casing/frames (allowed in doors-only)
const doorTrimRe =
  /\b(trim|casing|casings|door\s*frame(s)?|frames?|jambs?|door\s*trim|door\s*casing)\b/i

// Doors-only intent:
// - Painting + explicit door count
// - No rooms/walls/ceilings / named rooms
// - Door-trim language is allowed and still counts as doors-only
const doorsOnlyIntent =
  looksLikePainting &&
  typeof doors === "number" &&
  doors > 0 &&
  !roomishRe.test(scopeChange)

const mentionsDoorTrim = doorsOnlyIntent && doorTrimRe.test(scopeChange)

const useDoorPricing =
  doorsOnlyIntent &&
  doors <= 100 &&
  !(measurements?.totalSqft && measurements.totalSqft > 0)

// If doors-only job, paintScope is irrelevant
const effectivePaintScope: EffectivePaintScope =
  useDoorPricing ? "doors_only" : (paintScopeForJob ?? "walls")

  console.log("PG PARSE", {
  trade,
  stateAbbrev,
  paintScopeFromUI: paintScopeForJob,
  rooms,
  doors,
  looksLikePainting,
  doorsOnlyIntent,
  effectivePaintScope,
  scope: scopeChange,
})

// Paint scope normalization (so description matches dropdown)
if (looksLikePainting) {
  if (effectivePaintScope === "doors_only") {
    effectiveScopeChange = `${scopeChange}\n\nPaint scope selected: doors only (includes door slabs + frames/casing).`
  } else if (effectivePaintScope === "walls_ceilings") {
    effectiveScopeChange = `${scopeChange}\n\nPaint scope selected: walls and ceilings.`
  } else if (effectivePaintScope === "full") {
    effectiveScopeChange = `${scopeChange}\n\nPaint scope selected: walls, ceilings, trim, and doors.`
  } else {
    effectiveScopeChange = `${scopeChange}\n\nPaint scope selected: walls only.`
  }
}

const bigJobPricing: Pricing | null =
  useBigJobPricing && typeof rooms === "number"
    ? pricePaintingRooms({
        scope: effectiveScopeChange,
        rooms,
        stateMultiplier,
        paintScope: (paintScopeForJob ?? "walls"),
      })
    : null

const doorPricing: Pricing | null =
  useDoorPricing && typeof doors === "number"
    ? pricePaintingDoors({
        doors,
        stateMultiplier,
        includeDoorTrim: true,              // ✅ ALWAYS include casing/frames by default for doors-only
        explicitTrimRequested: mentionsDoorTrim, // ✅ optional bump if they explicitly say trim/casing/frames
      })
    : null

    const mixedPaintPricing: Pricing | null =
  looksLikePainting &&
  typeof rooms === "number" && rooms > 0 &&
  typeof doors === "number" && doors > 0 &&
  !(measurements?.totalSqft && measurements.totalSqft > 0)
    ? (() => {
        const roomDet = pricePaintingRooms({
          scope: effectiveScopeChange,
          rooms,
          stateMultiplier,
          paintScope: (paintScopeForJob ?? "walls"),
        })

        const doorDet = pricePaintingDoors({
          doors,
          stateMultiplier,
          includeDoorTrim: true,
          explicitTrimRequested: doorTrimRe.test(scopeChange),
        })

        const labor = roomDet.labor + doorDet.labor
        const materials = roomDet.materials + doorDet.materials
        const subs = roomDet.subs + doorDet.subs // or Math.max(...) if you prefer
        const markup = Math.max(roomDet.markup, doorDet.markup)

        const base = labor + materials + subs
        const total = Math.round(base * (1 + markup / 100))

        return { labor, materials, subs, markup, total }
      })()
    : null

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
- Paint Scope: ${looksLikePainting ? effectivePaintScope : "N/A"}

COMPLEXITY PROFILE (SYSTEM-LOCKED — FOLLOW STRICTLY):
- class: ${complexityProfile.class}
- requireDaysBasis: ${complexityProfile.requireDaysBasis ? "YES" : "NO"}
- permitLikely: ${complexityProfile.permitLikely ? "YES" : "NO"}
- notes:
${complexityProfile.notes.map(n => `- ${n}`).join("\n")}
- minimums:
  - min crewDays: ${complexityProfile.minCrewDays}
  - min mobilization: ${complexityProfile.minMobilization}
  - min subs: ${complexityProfile.minSubs}

RULE:
If requireDaysBasis is YES, your estimateBasis MUST include:
- units includes "days"
- crewDays is set and realistic for the class

SCOPE OF WORK:
${effectiveScopeChange}

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

ESTIMATING METHOD (STRICT):
You must price using a human estimator workflow:
1) Identify the primary "pricing units" for the scope (pick 1–3): sqft, linear ft, rooms, doors, fixtures, devices, days, lump sum.

QUANTITY EXTRACTION (REQUIRED):
If the scope includes an explicit quantity (e.g., "25 doors", "12 outlets", "3 toilets", "800 sqft"),
you MUST use that quantity in pricing. Do not treat count-based scopes as lump sums.
If a quantity is implied but not explicit, make a conservative assumption and price accordingly.

PRICING UNITS (REQUIRED):
You must choose pricing units ONLY from this list:
- sqft
- linear_ft
- rooms
- doors
- fixtures
- devices
- days
- lump_sum

Pick 1–3 units max and base labor/materials on those units.

2) Choose realistic production rates (labor hours per unit) for mid-market residential work.
3) Use typical U.S. mid-market contractor labor rates (do NOT adjust for state/location; state multiplier is handled by the system).
4) Set a materials allowance that matches the scope (paint/primer/trim caulk; tile/setting materials; plumbing fixtures; electrical devices).
5) Include a reasonable mobilization/overhead amount for small jobs.
6) Apply markup 15–25%.
7) Perform a final sanity check: total should scale with quantity (double scope ≈ meaningfully higher total).

PRICING RULES:
- Use realistic 2024–2025 U.S. contractor pricing
- Mid-market residential work
- Totals only (no line items)
- Round to whole dollars

MOBILIZATION MINIMUM (SMALL JOBS):
If the job is small (e.g., <= 6 doors, <= 6 devices, <= 2 fixtures, or <= 150 sqft),
include a mobilization/overhead minimum in "subs" of at least $150–$350 depending on the trade (do NOT adjust for state/location).

MEASUREMENT USAGE RULE (STRICT):
- If measurements are provided, reference the total square footage and (briefly) the labeled areas in the description.
- Use the square footage to influence pricing realism (larger sqft → higher labor/materials).
- If measurements are NOT provided, do NOT mention square footage, dimensions, or area estimates. Do not guess numbers.

TRADE PRICING GUIDANCE:
Use the "PRICING ANCHORS" section below to choose realistic units, production rates, and allowances per trade.

PRICING ANCHORS (HUMAN-LIKE BASELINES — USE AS GUIDES, NOT LINE ITEMS):
Painting:
- Interior repaint labor is usually dominant; materials are low.
- Doors: price must scale per door (count-based), not flat.
- Rooms: price scales per room and whether ceilings/trim/doors are included.

Flooring / Tile:
- Pricing typically scales by sqft for floors and by sqft for wall tile.
- Include demo/haulaway if implied, otherwise assume install only.

Electrical:
- Most items are priced per device/fixture (count-based), plus troubleshooting time if implied.
- Panel work is high labor + permit/inspection coordination allowances.

Plumbing:
- Fixtures are priced per fixture (toilet, faucet, vanity, shower valve).
- Include shutoff/drain/test time; materials vary widely based on fixture class.

Carpentry:
- Trim/baseboards scale per linear foot; door installs are per door; cabinets are lump sum or per linear run.

General Renovation:
- If scope is broad, use a realistic lump sum that reflects multiple trades and multiple days of labor.

MARKUP RULE:
- Suggest markup between 15–25%

MISSING INFO POLICY:
If key details are missing (brand level, finish level, demolition extent, access constraints),
make conservative mid-market assumptions and reflect them in pricing.
Do NOT ask questions. Do NOT add disclaimers.
Choose reasonable assumptions (e.g., standard materials, normal access, occupied home protection).

SCALING RULE (STRICT):
If the scope is count-based (doors/devices/fixtures), the total must increase meaningfully with the count.
If count increases by 50% or more, total should increase by at least 30% unless scope clearly changes in the opposite direction.

SCALING SANITY CHECK (REQUIRED):
If scope includes an explicit count N:
- Labor must scale with N (labor should not be identical for 5 vs 25).
- Materials must scale with N when materials are per-item (paint, devices, fixtures).
- If you output identical totals for different explicit counts, you MUST revise your pricing until totals scale.

ESTIMATE BASIS RULE (CRITICAL):
- You MUST include "estimateBasis" and it MUST match the pricing math (labor + materials + subs, then markup).
- "units" must be 1–3 items from the allowed list.
- If you detect explicit counts (doors/rooms/sqft/devices/fixtures), quantities must include them.

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
  },
  "estimateBasis": {
    "units": ["sqft | linear_ft | rooms | doors | fixtures | devices | days | lump_sum"],
    "quantities": {
      "sqft": <number>,
      "linear_ft": <number>,
      "rooms": <number>,
      "doors": <number>,
      "fixtures": <number>,
      "devices": <number>,
      "days": <number>,
      "lump_sum": <number>
    },
    "laborRate": <number>,
    "hoursPerUnit": <number>,
    "crewDays": <number>,
    "mobilization": <number>,
    "assumptions": ["<string>"]
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
    model: PRIMARY_MODEL,
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

    const rawContent = completion.choices[0]?.message?.content
if (!rawContent) throw new Error("Empty AI response")

let aiParsed: any
try {
  aiParsed = JSON.parse(rawContent)
} catch (e) {
  console.error("AI returned non-JSON:", rawContent)
  return NextResponse.json(
    { error: "AI response was not valid JSON" },
    { status: 500 }
  )
}

const normalized: any = {
  documentType: aiParsed.documentType ?? aiParsed.document_type,
  trade: aiParsed.trade,
  description: aiParsed.description,
  pricing: aiParsed.pricing,
  estimateBasis: aiParsed.estimateBasis ?? null,
}

// 🔒 Coerce AI pricing to numbers (prevents string math bugs)
normalized.pricing = clampPricing(coercePricing(normalized.pricing))

// --- AI unit + math validation (one-shot repair if needed) ---
const parsedSqft = parseSqft(scopeChange) // uses your existing helper
const aiBasis = (normalized.estimateBasis ?? null) as EstimateBasis | null

const v = validateAiMath({
  pricing: normalized.pricing,
  basis: aiBasis,
  parsedCounts: { rooms, doors, sqft: parsedSqft },
  complexity: complexityProfile,
  scopeText: scopeChange, // ✅
})

if (!v.ok) {
  const repairPrompt = `${prompt}

REPAIR REQUIRED:
The prior JSON failed validation for these reasons:
- ${v.reasons.join("\n- ")}

Return corrected JSON using the SAME schema, and make estimateBasis match the pricing math exactly. Do not add extra fields.`

  // ✅ #2: Do NOT let repair failures crash the route
  try {
    const repair = await openai.chat.completions.create({
      model: PRIMARY_MODEL,
      temperature: 0.15,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: repairPrompt }],
    })

    const repairContent = repair.choices[0]?.message?.content
    if (repairContent) {
      try {
        const repaired = JSON.parse(repairContent)

        normalized.documentType = repaired.documentType ?? normalized.documentType
        normalized.trade = repaired.trade ?? normalized.trade
        normalized.description = repaired.description ?? normalized.description
        normalized.pricing = clampPricing(coercePricing(repaired.pricing))
        normalized.estimateBasis = repaired.estimateBasis ?? normalized.estimateBasis
      } catch {
        console.warn("AI repair returned invalid JSON; continuing with original output.")
      }
    }
  } catch (e) {
    console.warn("AI repair call failed; continuing with original output.", e)
  }

  // ✅ #3: Re-validate once after repair (or attempted repair)
  const v2 = validateAiMath({
  pricing: normalized.pricing,
  basis: (normalized.estimateBasis ?? null) as EstimateBasis | null,
  parsedCounts: { rooms, doors, sqft: parsedSqft },
  complexity: complexityProfile,
  scopeText: scopeChange,
})

  if (!v2.ok) {
    console.warn("AI output still failing validation after repair:", v2.reasons)
    // Optional (safe default): do nothing — your deterministic/merge safety floor still protects you later.
    // If you ever want to force non-AI behavior when it fails twice, this is the spot to do it.
  }
}

// ✅ Normalize documentType BEFORE any early returns (deterministic path included)
const allowedTypes = [
  "Change Order",
  "Estimate",
  "Change Order / Estimate",
] as const

if (!allowedTypes.includes(normalized.documentType)) {
  normalized.documentType = "Change Order / Estimate"
}

if (typeof normalized.description !== "string" || normalized.description.trim().length < 10) {
  const tradeLabel = typeof trade === "string" && trade.length ? trade : "the selected"
  normalized.description =
    `This ${normalized.documentType} covers the described scope of work as provided, including labor, materials, protection, and cleanup associated with ${tradeLabel} scope.`
}

// Clean up duplicated document type tokens in the first sentence
if (typeof normalized.description === "string") {
  normalized.description = normalized.description
    .replace(
      /^This\s+Change Order\s*\/\s*Estimate\s*\/\s*Estimate\b/i,
      "This Change Order / Estimate"
    )
    .replace(/^This\s+Estimate\s*\/\s*Estimate\b/i, "This Estimate")
    .trim()
}

// Start from AI as default
let pricingSource: "ai" | "deterministic" | "merged" = "ai"
let priceGuardVerified = false
let pricingFinal: Pricing = normalized.pricing
let detSource: string | null = null

// ✅ Treat kitchen remodel anchor as deterministic-owned (no merge)
if (anchorHit?.id === "kitchen_remodel_v1" && anchorPricing) {
  pricingFinal = clampPricing(coercePricing(anchorPricing))
  pricingSource = "deterministic"
  detSource = `anchor:${anchorHit.id}`
  priceGuardVerified = true
}

if (anchorHit?.id === "bathroom_remodel_v1" && anchorPricing) {
  pricingFinal = clampPricing(coercePricing(anchorPricing))
  pricingSource = "deterministic"
  detSource = `anchor:${anchorHit.id}`
  priceGuardVerified = true
}

// ✅ Rooms + doors mixed painting deterministic-owned
if (
  pricingSource !== "deterministic" &&
  looksLikePainting &&
  typeof rooms === "number" && rooms > 0 &&
  typeof doors === "number" && doors > 0 &&
  mixedPaintPricing
) {
  pricingFinal = clampPricing(coercePricing(mixedPaintPricing))
  pricingSource = "deterministic"
  detSource = "painting_rooms_plus_doors"
  priceGuardVerified = false
}

// ✅ Doors-only painting deterministic-owned
if (
  pricingSource !== "deterministic" &&
  looksLikePainting &&
  effectivePaintScope === "doors_only" &&
  doorPricing
) {
  pricingFinal = clampPricing(coercePricing(doorPricing))
  pricingSource = "deterministic"
  detSource = "painting_doors_only"
  priceGuardVerified = false
}

// ✅ Big painting jobs deterministic-owned
if (
  pricingSource !== "deterministic" &&
  looksLikePainting &&
  useBigJobPricing &&
  bigJobPricing
) {
  pricingFinal = clampPricing(coercePricing(bigJobPricing))
  pricingSource = "deterministic"
  detSource = "painting_big_job"
  priceGuardVerified = false
}

function applyDeterministicOwnership(args: {
  pricing: Pricing | null
  okForVerified?: boolean
  sourceVerifiedId: string
  sourceId: string
}) {
  if (!args.pricing) return false

  pricingFinal = clampPricing(coercePricing(args.pricing))
  pricingSource = "deterministic"
  detSource = args.okForVerified ? args.sourceVerifiedId : args.sourceId
  priceGuardVerified = !!args.okForVerified
  return true
}

const deterministicOwned =
  pricingSource === "deterministic" ||
  (trade === "flooring" &&
    applyDeterministicOwnership({
      pricing: flooringDetPricing,
      okForVerified: !!flooringDet?.okForVerified,
      sourceVerifiedId: "flooring_engine_v1_verified",
      sourceId: "flooring_engine_v1",
    })) ||
  (trade === "electrical" &&
    applyDeterministicOwnership({
      pricing: electricalDetPricing,
      okForVerified: !!electricalDet?.okForVerified,
      sourceVerifiedId: "electrical_engine_v1_verified",
      sourceId: "electrical_engine_v1",
    })) ||
  (trade === "plumbing" &&
  !plumbingScopeConflict &&
  applyDeterministicOwnership({
    pricing: plumbingDetPricing,
    okForVerified: !!plumbingDet?.okForVerified,
    sourceVerifiedId: "plumbing_engine_v1_verified",
    sourceId: "plumbing_engine_v1",
  })) ||
  (trade === "drywall" &&
    applyDeterministicOwnership({
      pricing: drywallDetPricing,
      okForVerified: !!drywallDet?.okForVerified,
      sourceVerifiedId: "drywall_engine_v1_verified",
      sourceId: "drywall_engine_v1",
    }))

if (deterministicOwned) {
  const safePricing = clampPricing(pricingFinal)
  const priceGuardProtected = true

  normalized.trade = trade

  // --- Description sync when deterministic owns pricing (prevents wrong narrative) ---
if (trade === "electrical" && electricalDet?.jobType) {
  if (electricalDet.jobType === "device_work") {
    normalized.description = normalized.description.replace(
      /^This (Change Order|Estimate|Change Order \/ Estimate)\b/,
      `This ${normalized.documentType}`
    )
    // Add a short scope-lock sentence if missing
    if (!/outlet|switch|recessed|fixture/i.test(normalized.description)) {
      normalized.description += " Work covers device-level electrical installation/replacement as described, including protection, testing, and cleanup."
    }
  }
  if (electricalDet.jobType === "panel_replacement" && !/panel/i.test(normalized.description)) {
    normalized.description += " Scope includes electrical panel replacement activities as described, including labeling, changeover coordination, testing, and cleanup."
  }
}

if (trade === "plumbing" && plumbingDet?.jobType) {
  if (plumbingDet.jobType === "fixture_swaps" && !/toilet|faucet|sink|vanity|valve/i.test(normalized.description)) {
    normalized.description += " Scope covers fixture-level plumbing work as described, including isolation, removal/install, test, and cleanup."
  }
}

if (trade === "drywall" && drywallDet?.jobType) {
  if (drywallDet.jobType === "patch_repair" && !/patch|repair/i.test(normalized.description)) {
    normalized.description += " Work includes drywall patch/repair steps as described, including prep, finish work, and site cleanup."
  }
}

normalized.description = appendExecutionPlanSentence({
  description: normalized.description,
  documentType: normalized.documentType,
  trade,
  cp: complexityProfile,
  basis: (normalized.estimateBasis ?? null) as EstimateBasis | null,
  scopeText: scopeChange,
})

  const pg = buildPriceGuardReport({
    pricingSource,
    priceGuardVerified,
    priceGuardAnchorStrict: false,
    stateAbbrev,
    rooms,
    doors,
    measurements,
    effectivePaintScope: looksLikePainting ? effectivePaintScope : null,
    anchorId: anchorHit?.id ?? null,
    detSource,
    usedNationalBaseline,
  })

  await incrementUsageIfFree()

  return NextResponse.json({
    documentType: normalized.documentType,
    trade: normalized.trade || trade,
    text: normalized.description,
    pricing: safePricing,

    pricingSource,
    detSource,
    priceGuardAnchor: anchorHit?.id ?? null,
    priceGuardVerified,
    priceGuardProtected,
    priceGuard: pg,

    flooring: flooringDet
      ? {
          okForDeterministic: flooringDet.okForDeterministic,
          okForVerified: flooringDet.okForVerified,
          flooringType: flooringDet.flooringType,
          sqft: flooringDet.sqft,
          notes: flooringDet.notes,
        }
      : null,

    electrical: electricalDet
      ? {
          okForDeterministic: electricalDet.okForDeterministic,
          okForVerified: electricalDet.okForVerified,
          jobType: electricalDet.jobType,
          signals: electricalDet.signals ?? null,
          notes: electricalDet.notes,
        }
      : null,

    plumbing: plumbingDet
      ? {
          okForDeterministic: plumbingDet.okForDeterministic,
          okForVerified: plumbingDet.okForVerified,
          jobType: plumbingDet.jobType,
          signals: plumbingDet.signals ?? null,
          notes: plumbingDet.notes,
        }
      : null,

    drywall: drywallDet
      ? {
          okForDeterministic: drywallDet.okForDeterministic,
          okForVerified: drywallDet.okForVerified,
          jobType: drywallDet.jobType,
          signals: drywallDet.signals ?? null,
          notes: drywallDet.notes,
        }
      : null,
  })
}

// IMPORTANT: Make sure your later logic respects this:
// - Only run your "merged" (anchor/bigJob/door/mixed) block when pricingSource !== "deterministic"
// - Only run AI realism when pricingSource === "ai"
// =============================

// ✅ Deterministic safety pricing ...
// Only run merge/AI fallback when deterministic did NOT claim ownership.
if (pricingSource !== "deterministic") {
  const detPickedRaw: Pricing | null =
    anchorPricing ?? bigJobPricing ?? doorPricing ?? mixedPaintPricing ?? null

  // ✅ detSource must be based on the raw winner (reference identity)
  detSource =
    detPickedRaw === anchorPricing ? `anchor:${anchorHit?.id}` :
    detPickedRaw === bigJobPricing ? "painting_big_job" :
    detPickedRaw === doorPricing ? "painting_doors_only" :
    detPickedRaw === mixedPaintPricing ? "painting_rooms_plus_doors" :
    null

  // ✅ safe normalized deterministic baseline used for math
  const detPicked = detPickedRaw ? clampPricing(coercePricing(detPickedRaw)) : null

  if (detPicked) {
    const ai = normalized.pricing
    const aiMarkup = Number.isFinite(ai.markup) ? ai.markup : 20
    const mergedMarkup = Math.min(25, Math.max(15, Math.max(aiMarkup, detPicked.markup)))

    const merged: Pricing = {
      labor: Math.max(ai.labor, detPicked.labor),
      materials: Math.max(ai.materials, detPicked.materials),
      subs: Math.max(ai.subs, detPicked.subs),
      markup: mergedMarkup,
      total: 0,
    }

    const base = merged.labor + merged.materials + merged.subs
    merged.total = Math.round(base * (1 + merged.markup / 100))

    pricingFinal = clampPricing(merged)
    pricingSource = "merged"
    priceGuardVerified = false
  } else {
    pricingFinal = normalized.pricing
    pricingSource = "ai"
    priceGuardVerified = false
    detSource = null
  }
}

console.log("PG AFTER MERGE DECISION", {
  pricingSource,
  detSource,
  total: pricingFinal.total,
})

    if (
  typeof normalized.documentType !== "string" ||
  typeof normalized.description !== "string" ||
  !isValidPricing(pricingFinal)
) {
  return NextResponse.json(
  { error: "AI response invalid", aiParsed },
  { status: 500 }
)
}

const shouldRunAiRealism = pricingSource === "ai"

if (shouldRunAiRealism) {
  // ✅ run realism on the actual current pricing
  const p = { ...pricingFinal } // copy so we don't mutate references unexpectedly

  // ---- Markup realism (true contractor ranges) ----
  if (p.markup < 12) p.markup = 15
  if (p.markup > 30) p.markup = 25

  // ---- Labor vs material ratios by trade ----
  switch (trade) {
    case "painting":
      if (p.materials > p.labor * 0.5) p.materials = Math.round(p.labor * 0.35)
      break

    case "flooring":
    case "tile":
      if (p.materials < p.labor * 0.6) p.materials = Math.round(p.labor * 0.8)
      if (p.materials > p.labor * 1.8) p.materials = Math.round(p.labor * 1.4)
      break

    case "electrical":
    case "plumbing":
      if (p.materials > p.labor * 0.75) p.materials = Math.round(p.labor * 0.5)
      break

    case "carpentry":
    case "general renovation":
      if (p.materials < p.labor * 0.4) p.materials = Math.round(p.labor * 0.6)
      break
  }

  // ---- Subs realism ----
  const base = p.labor + p.materials
  if (p.subs > base * 0.5) p.subs = Math.round(base * 0.3)

  // ---- Total sanity ----
  const impliedTotal =
    p.labor + p.materials + p.subs +
    Math.round((p.labor + p.materials + p.subs) * (p.markup / 100))

  if (impliedTotal > 0 && Math.abs(p.total - impliedTotal) / impliedTotal > 0.2) {
    p.total = impliedTotal
  }

  p.total =
    p.labor + p.materials + p.subs +
    Math.round((p.labor + p.materials + p.subs) * (p.markup / 100))

  pricingFinal = clampPricing(p)

  // ✅ keep normalized in sync for the response payload
  normalized.pricing = pricingFinal
} else {
  pricingFinal = clampPricing(pricingFinal)
}

const safePricing = pricingFinal

const priceGuardProtected = (["merged", "deterministic"] as readonly string[]).includes(
  pricingSource
)

console.log("PG RESULT", { pricingSource, detSource, total: pricingFinal.total })

const pg = buildPriceGuardReport({
  pricingSource,
  priceGuardVerified,
  priceGuardAnchorStrict: false, // ✅ ADD THIS
  stateAbbrev,
  rooms,
  doors,
  measurements,
  effectivePaintScope: looksLikePainting ? effectivePaintScope : null,
  anchorId: anchorHit?.id ?? null,
  detSource,
  usedNationalBaseline,
})

normalized.trade = trade

normalized.description = appendExecutionPlanSentence({
  description: normalized.description,
  documentType: normalized.documentType,
  trade,
  cp: complexityProfile,
  basis: (normalized.estimateBasis ?? null) as EstimateBasis | null,
  scopeText: scopeChange,
})

await incrementUsageIfFree()

return NextResponse.json({
  documentType: normalized.documentType,
  trade: normalized.trade || trade,
  text: normalized.description,
  pricing: safePricing,

  pricingSource, // "ai" | "deterministic" | "merged"
  detSource,
  priceGuardAnchor: anchorHit?.id ?? null,
  priceGuardVerified,
  priceGuardProtected,
  priceGuard: pg,

  flooring: flooringDet
    ? {
        okForDeterministic: flooringDet.okForDeterministic,
        okForVerified: flooringDet.okForVerified,
        flooringType: flooringDet.flooringType,
        sqft: flooringDet.sqft,
        notes: flooringDet.notes,
      }
    : null,

   electrical: electricalDet
    ? {
        okForDeterministic: electricalDet.okForDeterministic,
        okForVerified: electricalDet.okForVerified,
        jobType: electricalDet.jobType,
        signals: electricalDet.signals ?? null,
        notes: electricalDet.notes,
      }
    : null,

    plumbing: plumbingDet
  ? {
      okForDeterministic: plumbingDet.okForDeterministic,
      okForVerified: plumbingDet.okForVerified,
      jobType: plumbingDet.jobType,
      signals: plumbingDet.signals ?? null,
      notes: plumbingDet.notes,
    }
  : null,

  drywall: drywallDet
  ? {
      okForDeterministic: drywallDet.okForDeterministic,
      okForVerified: drywallDet.okForVerified,
      jobType: drywallDet.jobType,
      signals: drywallDet.signals ?? null,
      notes: drywallDet.notes,
    }
  : null,
})

  } catch (err) {
    console.error("Generate failed:", err)
    return NextResponse.json(
      { error: "Generation failed" },
      { status: 500 }
    )
  }
}