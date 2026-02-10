type Pricing = {
  labor: number
  materials: number
  subs: number
  markup: number
  total: number
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

function sumMatches(t: string, re: RegExp) {
  let total = 0
  for (const m of t.matchAll(re)) {
    const n = Number(m[1])
    if (Number.isFinite(n) && n > 0) total += n
  }
  return total
}

export function parsePlumbingFixtureBreakdown(scopeText: string) {
  const t = scopeText.toLowerCase()

  const toilets = sumMatches(t, /(\d{1,4})\s*(toilet|commode)s?\b/g)
  const faucets = sumMatches(t, /(\d{1,4})\s*(faucet)s?\b/g)
  const sinks = sumMatches(t, /(\d{1,4})\s*(sink)s?\b/g)
  const vanities = sumMatches(t, /(\d{1,4})\s*(vanity|vanities)\b/g)
  const showerValves = sumMatches(
    t,
    /(\d{1,4})\s*(shower\s*valve|mixing\s*valve|diverter|trim\s*kit|cartridge)s?\b/g
  )

  const total = toilets + faucets + sinks + vanities + showerValves
  return total > 0
    ? { toilets, faucets, sinks, vanities, showerValves, total }
    : null
}

export function hasHeavyPlumbingSignals(text: string): boolean {
  const t = (text || "").toLowerCase()
  return /\b(repipe|repiping|whole\s*house\s*repipe|water\s*heater|tankless|sewer|main\s*line|drain\s*line|gas\s*line|trench|slab\s*leak|permit|inspection)\b/.test(
    t
  )
}

/** -----------------------------
 * Bath rough-in helpers (merged)
 * ----------------------------- */

function parseRoughInCounts(text: string) {
  const t = text.toLowerCase()

  const valves = sumMatches(
    t,
    /(\d{1,3})\s*(shower\s*valve|mixing\s*valve|valve)s?\b/g
  )
  const drains = sumMatches(
    t,
    /(\d{1,3})\s*(drain|shower\s*drain|tub\s*drain)s?\b/g
  )
  const supplies = sumMatches(
    t,
    /(\d{1,3})\s*(supply\s*line|water\s*line|hot\s*line|cold\s*line|supply)s?\b/g
  )

  const any = valves + drains + supplies > 0
  return any ? { valves, drains, supplies } : null
}

function classifyBathRoughIn(scopeText: string) {
  const s = (scopeText || "").toLowerCase()

  const mentionsBath =
    /\b(bath|bathroom|shower|tub|tub\s*surround)\b/.test(s)

  const roughIn =
    /\b(rough[-\s]*in|rough\s*plumb|new\s*rough[-\s]*in|full\s*rough[-\s]*in)\b/.test(s)

  const valveRelocation =
    /\b(valve\s*relocation|relocat(e|ing)\s+(the\s*)?valve|move\s+(the\s*)?valve)\b/.test(s)

  const newShowerOrTub =
    /\b(new\s+(shower|tub)|install\s+(shower|tub)|convert|conversion|shower\s*to\s*tub|tub\s*to\s*shower)\b/.test(
      s
    )

  const drainWork =
    /\b(move\s+(the\s*)?drain|relocat(e|ion|ing)\s+(the\s*)?drain|new\s+drain|drain\s+line|p[-\s]*trap|trap\s+arm)\b/.test(
      s
    )

  const supplyWork =
    /\b(new\s+(supply|water\s*line)|move\s+(the\s*)?(hot|cold)\s*line|relocat(e|ion|ing)\s+(supply|water\s*line)|run\s+new\s+line)\b/.test(
      s
    )

  const demoOrTileContext =
    /\b(demo|demolition|tear\s*out|gut|tile|wall\s*tile|shower\s*walls?|tub\s*surround|waterproof|backer\s*board|cement\s*board|durock|hardie)\b/.test(
      s
    )

  // IMPORTANT: prevent rough-in from stealing fixture swap jobs
  const fixtureBreakdown = parsePlumbingFixtureBreakdown(scopeText)
  const looksLikeFixtureSwap =
    fixtureBreakdown?.total && fixtureBreakdown.total > 0 &&
    /\b(replace|replacing|swap|swapping|remove\s+and\s+replace)\b/.test(s)

  const shouldActivate =
    !looksLikeFixtureSwap &&
    mentionsBath &&
    (roughIn || valveRelocation || newShowerOrTub || drainWork || supplyWork) &&
    demoOrTileContext

  return {
    shouldActivate,
    signals: {
      mentionsBath,
      roughIn,
      valveRelocation,
      newShowerOrTub,
      drainWork,
      supplyWork,
      demoOrTileContext,
    },
  }
}

function priceBathRoughIn(args: {
  scopeText: string
  stateMultiplier: number
}) {
  const s = (args.scopeText || "").toLowerCase()
  const notes: string[] = []

  const cls = classifyBathRoughIn(args.scopeText)
  const counts = parseRoughInCounts(s)

  const laborRate = 140
  const markup = 25

  let laborHrs = 6.0
  const { roughIn, valveRelocation, newShowerOrTub, drainWork, supplyWork } =
    cls.signals

  if (counts) {
    laborHrs = 6.0
    laborHrs += counts.valves * 4.5
    laborHrs += counts.drains * 4.0
    laborHrs += counts.supplies * 2.5
    notes.push(
      `Used explicit rough-in counts: valves=${counts.valves}, drains=${counts.drains}, supplies=${counts.supplies}`
    )
  } else {
    if (roughIn) laborHrs += 6.0
    if (valveRelocation) laborHrs += 4.5
    if (newShowerOrTub) laborHrs += 3.0
    if (drainWork) laborHrs += 4.0
    if (supplyWork) laborHrs += 3.0
    notes.push("No explicit rough-in counts found; priced by strong signals.")
  }

  laborHrs = Math.max(8, Math.min(28, laborHrs))

  let labor = Math.round(laborHrs * laborRate)
  labor = Math.round(labor * args.stateMultiplier)

  let materials = 0
  if (counts) {
    materials =
      200 +
      counts.valves * 160 +
      counts.drains * 130 +
      counts.supplies * 90
  } else {
    materials += 220
    if (valveRelocation) materials += 180
    if (drainWork) materials += 140
    if (supplyWork) materials += 120
    if (roughIn) materials += 150
  }
  materials = Math.round(materials)

  const mobilization = 300
  const supervision = Math.round((labor + materials) * 0.06)

  const permitMentioned = /\b(permit|inspection)\b/.test(s)
  const permitAllowance = permitMentioned ? 250 : 0
  if (permitMentioned) notes.push("Permit/inspection language detected; added allowance.")

  const subs = mobilization + supervision + permitAllowance

  const base = labor + materials + subs
  const total = Math.round(base * (1 + markup / 100))

  const okForVerified = !!counts || (roughIn && valveRelocation && drainWork)

  return {
    okForDeterministic: true,
    okForVerified,
    pricing: clampPricing({ labor, materials, subs, markup, total }),
    jobType: "bath_plumbing_rough_in" as const,
    signals: { ...cls.signals, count: counts ?? undefined },
    notes,
  }
}

/** -----------------------------
 * Main plumbing deterministic
 * ----------------------------- */

export function computePlumbingDeterministic(args: {
  scopeText: string
  stateMultiplier: number
}): {
  okForDeterministic: boolean
  okForVerified: boolean
  jobType: "fixture_swaps" | "bath_plumbing_rough_in" | "unknown"
  signals: any
  notes: string[]
  pricing: Pricing | null
} {
  const t = (args.scopeText || "").toLowerCase()

  // 1) Bath rough-in gets first chance (because fixture engine blocks remodel/rough-in words)
  const roughCls = classifyBathRoughIn(args.scopeText)
  if (roughCls.shouldActivate) {
    const r = priceBathRoughIn(args)
    return {
      okForDeterministic: r.okForDeterministic,
      okForVerified: r.okForVerified,
      jobType: r.jobType,
      signals: r.signals,
      notes: r.notes,
      pricing: r.pricing,
    }
  }

  // 2) Fixture swaps path (your existing logic)
  const notes: string[] = []

  const heavySignals = hasHeavyPlumbingSignals(args.scopeText)

  const remodelSignals =
    /\b(gut|full\s+remodel|remodel|renovation|rebuild|demo|demolition|tile|waterproof|membrane|shower\s+pan|tub\s+surround|relocat(e|ing)|move\s+(drain|valve|supply))\b/.test(
      t
    )

  if (heavySignals || remodelSignals) {
    return {
      okForDeterministic: false,
      okForVerified: false,
      jobType: "unknown",
      signals: { heavySignals, remodelSignals },
      notes: [
        "Skipped: scope looks like heavy/high-variance plumbing or remodel work.",
      ],
      pricing: null,
    }
  }

  const breakdown = parsePlumbingFixtureBreakdown(args.scopeText)
  if (!breakdown) {
    return {
      okForDeterministic: false,
      okForVerified: false,
      jobType: "unknown",
      signals: { breakdown: null },
      notes: ["Skipped: no explicit fixture counts found for deterministic pricing."],
      pricing: null,
    }
  }

  const isAddWork = /\b(add|adding|install(ing)?|new)\b/.test(t)
  const isSwapWork =
    /\b(replace|replacing|swap|swapping|remove\s+and\s+replace)\b/.test(t)
  const treatAsAdd = isAddWork && !isSwapWork

  const laborRate = 125
  const markup = 25

  const hrsPerToilet = treatAsAdd ? 2.25 : 1.75
  const hrsPerFaucet = treatAsAdd ? 1.6 : 1.1
  const hrsPerSink = treatAsAdd ? 2.25 : 1.5
  const hrsPerVanity = treatAsAdd ? 5.5 : 4.25
  const hrsPerShowerValve = treatAsAdd ? 5.0 : 3.75

  const troubleshootHrs =
    /\b(leak|leaking|clog|clogged|diagnos|troubleshoot|not\s+working)\b/.test(t)
      ? 1.5
      : 0

  const laborHrs =
    breakdown.toilets * hrsPerToilet +
    breakdown.faucets * hrsPerFaucet +
    breakdown.sinks * hrsPerSink +
    breakdown.vanities * hrsPerVanity +
    breakdown.showerValves * hrsPerShowerValve +
    troubleshootHrs +
    1.25

  let labor = Math.round(laborHrs * laborRate)
  labor = Math.round(labor * args.stateMultiplier)

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
    breakdown.total <= 2 ? 225 : breakdown.total <= 6 ? 325 : 450

  const supervision = Math.round((labor + materials) * 0.05)
  const subs = mobilization + supervision

  const base = labor + materials + subs
  const total = Math.round(base * (1 + markup / 100))

  const okForVerified = true
  const pricing = clampPricing({ labor, materials, subs, markup, total })

  notes.push("Deterministic plumbing: fixture-level count-based pricing applied.")
  if (treatAsAdd) notes.push("Detected add/install language (treated as add-work).")
  if (troubleshootHrs > 0)
    notes.push("Troubleshooting/leak/diagnosis allowance included.")

  return {
    okForDeterministic: true,
    okForVerified,
    jobType: "fixture_swaps",
    signals: { breakdown, treatAsAdd, troubleshootHrs },
    notes,
    pricing,
  }
}