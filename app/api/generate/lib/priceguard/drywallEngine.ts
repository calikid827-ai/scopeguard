// ./lib/priceguard/drywallEngine.ts

type Pricing = {
  labor: number
  materials: number
  subs: number
  markup: number
  total: number
}

export type DrywallDeterministicResult = {
  okForDeterministic: boolean
  okForVerified: boolean
  pricing: Pricing | null
  jobType: "install_finish" | "patch_repair" | "unknown"
  signals: {
    sqft?: number | null
    sheets?: number | null
    patchCount?: number | null
    includesCeilings?: boolean
    finishLevel?: 3 | 4 | 5 | null
    isTextureMatch?: boolean
    isCeilingPatch?: boolean
  }
  notes: string[]
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

function sumMatches(text: string, re: RegExp): number {
  let total = 0
  for (const m of text.matchAll(re)) {
    const n = Number(m[1])
    if (Number.isFinite(n) && n > 0) total += n
  }
  return total
}

function parseSqftFromText(scopeText: string): number | null {
  const t = scopeText.toLowerCase()
  const m = t.match(/(\d{1,6})\s*(sq\s*ft|sqft|square\s*feet|sf)\b/)
  if (!m?.[1]) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

function parseSheets(scopeText: string): { sheets: number; sheetSqft: number } | null {
  const t = scopeText.toLowerCase()

  // Common sheet sizes: 4x8 (32 sqft), 4x10 (40), 4x12 (48)
  // Examples:
  // "12 sheets of drywall", "8 4x8 sheets", "10 sheets 4x12"
  const sheets = sumMatches(t, /(\d{1,4})\s*(sheets?|boards?)\s*(of\s*)?(drywall|sheetrock)\b/g)
  if (sheets <= 0) return null

  let sheetSqft = 32 // default to 4x8
  if (/\b4\s*x\s*10\b/.test(t)) sheetSqft = 40
  if (/\b4\s*x\s*12\b/.test(t)) sheetSqft = 48
  if (/\b4\s*x\s*8\b/.test(t)) sheetSqft = 32

  return { sheets, sheetSqft }
}

function parsePatchCount(scopeText: string): number | null {
  const t = scopeText.toLowerCase()

  // "patch 6 holes", "repair 3 holes", "fix 4 patches"
  const holes = sumMatches(t, /(\d{1,4})\s*(holes?|patches?|repairs?)\b/g)
  if (holes > 0) return holes

  // "patching: 5"
  const colon = t.match(/patch(ing)?\s*[:\-]\s*(\d{1,4})\b/)
  if (colon?.[2]) {
    const n = Number(colon[2])
    if (Number.isFinite(n) && n > 0) return n
  }

  return null
}

function hasInstallFinishSignals(scopeText: string): boolean {
  const t = scopeText.toLowerCase()
  return /\b(hang|install|sheetrock|drywall)\b/.test(t) && /\b(tape|mud|finish|skim|texture)\b/.test(t)
}

function hasPatchSignals(scopeText: string): boolean {
  const t = scopeText.toLowerCase()
  return /\b(patch|patching|repair|fix|hole|crack|dent)\b/.test(t)
}

function parseFinishLevel(scopeText: string): 3 | 4 | 5 | null {
  const t = scopeText.toLowerCase()
  const m = t.match(/\blevel\s*(3|4|5)\b/)
  if (!m?.[1]) return null
  const n = Number(m[1])
  if (n === 3 || n === 4 || n === 5) return n
  return null
}

function includesCeilings(scopeText: string): boolean {
  const t = scopeText.toLowerCase()
  return /\bceiling|ceilings\b/.test(t)
}

function isCeilingPatch(scopeText: string): boolean {
  const t = scopeText.toLowerCase()
  return /\bceiling|ceilings\b/.test(t) && /\bpatch|repair|hole|crack\b/.test(t)
}

function isTextureMatch(scopeText: string): boolean {
  const t = scopeText.toLowerCase()
  return /\b(texture|knockdown|orange\s*peel|skip\s*trowel|match\s*texture)\b/.test(t)
}

// -----------------------------
// MAIN ENGINE
// -----------------------------
export function computeDrywallDeterministic(args: {
  scopeText: string
  stateMultiplier: number
  measurements?: any | null
}): DrywallDeterministicResult {
  const notes: string[] = []
  const scope = (args.scopeText || "").trim()
  if (!scope) {
    return {
      okForDeterministic: false,
      okForVerified: false,
      pricing: null,
      jobType: "unknown",
      signals: {},
      notes: ["Empty scopeText"],
    }
  }

  // Prefer measurement sqft if provided
  const measSqft =
    args.measurements?.totalSqft && Number(args.measurements.totalSqft) > 0
      ? Number(args.measurements.totalSqft)
      : null

  const textSqft = parseSqftFromText(scope)
  const sheetsInfo = parseSheets(scope)
  const patchCount = parsePatchCount(scope)

  const finishLevel = parseFinishLevel(scope)
  const ceilingFlag = includesCeilings(scope)
  const textureFlag = isTextureMatch(scope)
  const ceilingPatchFlag = isCeilingPatch(scope)

  // Decide a working sqft
  const sqftFromSheets = sheetsInfo ? Math.round(sheetsInfo.sheets * sheetsInfo.sheetSqft) : null
  const sqft =
    measSqft ??
    textSqft ??
    sqftFromSheets ??
    null

  const patchLike = hasPatchSignals(scope)
  const installLike = hasInstallFinishSignals(scope)

  // -----------------------------
  // Job type selection
  // -----------------------------
  // 1) Patch/repair (count-based OR sqft-based)
  if (patchLike) {
    // Require explicit patchCount OR explicit sqft OR sheets
    if (!patchCount && !sqft) {
      return {
        okForDeterministic: false,
        okForVerified: false,
        pricing: null,
        jobType: "patch_repair",
        signals: {
          sqft: null,
          sheets: sheetsInfo?.sheets ?? null,
          patchCount: patchCount ?? null,
          includesCeilings: ceilingFlag,
          finishLevel,
          isTextureMatch: textureFlag,
          isCeilingPatch: ceilingPatchFlag,
        },
        notes: ["Patch/repair language present but no explicit quantities (count/sqft/sheets) → avoid deterministic"],
      }
    }

    const pricing = priceDrywallPatchRepair({
      patchCount: patchCount ?? null,
      sqft: sqft ?? null,
      stateMultiplier: args.stateMultiplier,
      finishLevel,
      textureMatch: textureFlag,
      ceilingPatch: ceilingPatchFlag,
    })

    const okForVerified = !!patchCount || !!textSqft || !!sheetsInfo // measurement-only sqft is deterministic but not “verified”
    return {
      okForDeterministic: true,
      okForVerified,
      pricing,
      jobType: "patch_repair",
      signals: {
        sqft: sqft ?? null,
        sheets: sheetsInfo?.sheets ?? null,
        patchCount: patchCount ?? null,
        includesCeilings: ceilingFlag,
        finishLevel,
        isTextureMatch: textureFlag,
        isCeilingPatch: ceilingPatchFlag,
      },
      notes: ["Drywall patch/repair pricing applied"],
    }
  }

  // 2) Install + tape/finish
  if (installLike) {
    // Must have sqft or sheets or measurement sqft
    if (!sqft) {
      return {
        okForDeterministic: false,
        okForVerified: false,
        pricing: null,
        jobType: "install_finish",
        signals: {
          sqft: null,
          sheets: sheetsInfo?.sheets ?? null,
          patchCount: null,
          includesCeilings: ceilingFlag,
          finishLevel,
          isTextureMatch: textureFlag,
          isCeilingPatch: false,
        },
        notes: ["Install/finish language present but no sqft/sheets parsed → avoid deterministic"],
      }
    }

    const pricing = priceDrywallInstallFinish({
      sqft,
      stateMultiplier: args.stateMultiplier,
      includesCeilings: ceilingFlag,
      finishLevel,
      textureMatch: textureFlag,
    })

    // Verified if sqft was explicit in text or sheets were explicit (measurement-only sqft = deterministic, not verified)
    const okForVerified = !!textSqft || !!sheetsInfo
    return {
      okForDeterministic: true,
      okForVerified,
      pricing,
      jobType: "install_finish",
      signals: {
        sqft,
        sheets: sheetsInfo?.sheets ?? null,
        patchCount: null,
        includesCeilings: ceilingFlag,
        finishLevel,
        isTextureMatch: textureFlag,
        isCeilingPatch: false,
      },
      notes: ["Drywall install + finish pricing applied"],
    }
  }

  // 3) Drywall-ish but ambiguous: only go deterministic if sqft/sheets explicitly exist
  if (/\b(drywall|sheetrock)\b/i.test(scope) && sqft) {
    const pricing = priceDrywallInstallFinish({
      sqft,
      stateMultiplier: args.stateMultiplier,
      includesCeilings: ceilingFlag,
      finishLevel,
      textureMatch: textureFlag,
    })

    const okForVerified = !!textSqft || !!sheetsInfo
    return {
      okForDeterministic: true,
      okForVerified,
      pricing,
      jobType: "install_finish",
      signals: {
        sqft,
        sheets: sheetsInfo?.sheets ?? null,
        patchCount: null,
        includesCeilings: ceilingFlag,
        finishLevel,
        isTextureMatch: textureFlag,
        isCeilingPatch: false,
      },
      notes: ["Drywall mentioned; sqft available → applied install/finish baseline"],
    }
  }

  return {
    okForDeterministic: false,
    okForVerified: false,
    pricing: null,
    jobType: "unknown",
    signals: {
      sqft: sqft ?? null,
      sheets: sheetsInfo?.sheets ?? null,
      patchCount: patchCount ?? null,
      includesCeilings: ceilingFlag,
      finishLevel,
      isTextureMatch: textureFlag,
      isCeilingPatch: ceilingPatchFlag,
    },
    notes: ["No deterministic drywall pattern matched"],
  }
}

// -----------------------------
// PRICERS
// -----------------------------
function priceDrywallInstallFinish(args: {
  sqft: number
  stateMultiplier: number
  includesCeilings: boolean
  finishLevel: 3 | 4 | 5 | null
  textureMatch: boolean
}): Pricing {
  const laborRate = 95
  const markup = 25

  // Base labor hours per sqft (hang + tape + finish) mid-market
  let hrsPerSqft = 0.09

  // Ceilings are slower
  if (args.includesCeilings) hrsPerSqft += 0.02

  // Finish level adjustments (Level 4 common, Level 5 more skim)
  if (args.finishLevel === 3) hrsPerSqft -= 0.01
  if (args.finishLevel === 5) hrsPerSqft += 0.03

  // Texture match adds time
  if (args.textureMatch) hrsPerSqft += 0.015

  const laborHrs = args.sqft * hrsPerSqft + 4.5 // setup, masking, cleanup, trip time
  let labor = Math.round(laborHrs * laborRate)
  labor = Math.round(labor * args.stateMultiplier)

  // Materials per sqft: board + mud + tape + screws + beads
  // Keep this “allowance-like” since sqft may be measured area rather than sheet count
  const matPerSqft = 1.05
  const materials = Math.round(args.sqft * matPerSqft + 160)

  // Subs/overhead: mobilization + disposal + supervision
  const mobilization =
    args.sqft <= 150 ? 275 :
    args.sqft <= 400 ? 425 :
    650

  const dumpFee = args.sqft >= 350 ? 180 : 0
  const supervision = Math.round((labor + materials) * 0.06)
  const subs = mobilization + dumpFee + supervision

  const base = labor + materials + subs
  const total = Math.round(base * (1 + markup / 100))

  return clampPricing({ labor, materials, subs, markup, total })
}

function priceDrywallPatchRepair(args: {
  patchCount: number | null
  sqft: number | null
  stateMultiplier: number
  finishLevel: 3 | 4 | 5 | null
  textureMatch: boolean
  ceilingPatch: boolean
}): Pricing {
  const laborRate = 95
  const markup = 25

  // If they gave explicit patch count, use per-patch model with strong minimums.
  const patchCount = args.patchCount ?? 0

  // Patch labor hours
  let laborHrs = 0
  if (patchCount > 0) {
    // Per patch baseline assumes small/medium holes
    let hrsPerPatch = 1.1
    if (args.ceilingPatch) hrsPerPatch += 0.25
    if (args.finishLevel === 5) hrsPerPatch += 0.35
    if (args.textureMatch) hrsPerPatch += 0.25

    laborHrs = patchCount * hrsPerPatch + 2.75 // setup/cleanup/return trip allowance
  } else if (args.sqft && args.sqft > 0) {
    // If sqft exists but no count, price as small-area repair
    let hrsPerSqft = 0.14
    if (args.ceilingPatch) hrsPerSqft += 0.03
    if (args.finishLevel === 5) hrsPerSqft += 0.04
    if (args.textureMatch) hrsPerSqft += 0.02

    laborHrs = args.sqft * hrsPerSqft + 3.25
  } else {
    // Should not happen because caller guards, but keep safe
    laborHrs = 5.0
  }

  let labor = Math.round(laborHrs * laborRate)
  labor = Math.round(labor * args.stateMultiplier)

  // Materials for patching: mud, tape, corner bead, texture, sanding, primer touch-up allowance
  const materials =
    patchCount > 0
      ? Math.round(Math.max(95, patchCount * 18) + (args.textureMatch ? 35 : 0))
      : Math.round(Math.max(120, (args.sqft ?? 0) * 1.25) + (args.textureMatch ? 35 : 0))

  // Strong mobilization minimum for repair calls
  const mobilization = 250
  const supervision = Math.round((labor + materials) * 0.05)
  const subs = mobilization + supervision

  const base = labor + materials + subs
  const total = Math.round(base * (1 + markup / 100))

  return clampPricing({ labor, materials, subs, markup, total })
}