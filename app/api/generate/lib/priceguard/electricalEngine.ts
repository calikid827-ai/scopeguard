// ./lib/priceguard/electricalEngine.ts

type Pricing = {
  labor: number
  materials: number
  subs: number
  markup: number
  total: number
}

export type ElectricalDeterministicResult = {
  okForDeterministic: boolean
  okForVerified: boolean
  pricing: Pricing | null
  jobType:
    | "device_work"
    | "dedicated_circuits"
    | "panel_replacement"
    | "ev_charger"
    | "unknown"
  signals: {
    devices?: {
      outlets: number
      switches: number
      recessed: number
      fixtures: number
      total: number
    } | null
    dedicatedCircuits?: number | null
    hasTroubleshooting?: boolean
    treatAsAdd?: boolean
    mentionsPanel?: boolean
    panelCount?: number | null
    evChargerCount?: number | null
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

// Device breakdown: outlets/switches/recessed/fixtures
function parseElectricalDeviceBreakdown(scopeText: string) {
  const t = scopeText.toLowerCase()

  const sumMatchesLocal = (re: RegExp) => {
    let total = 0
    for (const m of t.matchAll(re)) {
      const n = Number(m[1])
      if (Number.isFinite(n) && n > 0) total += n
    }
    return total
  }

  // allow optional adjectives like "new", "existing", "dedicated" between number and noun
  const mid = String.raw`(?:\s+\w+){0,2}\s+`

  const outlets = sumMatchesLocal(
    new RegExp(String.raw`(\d{1,4})${mid}(outlet|receptacle|plug)s?\b`, "g")
  )

  const switches = sumMatchesLocal(
    new RegExp(String.raw`(\d{1,4})${mid}switch(es)?\b`, "g")
  )

  // matches:
  // "4 recessed can lights"
  // "4 new recessed can lights"
  // "4 can lights"
  // "4 new can lights"
  // "4 recessed lights"
  const recessed = sumMatchesLocal(
    new RegExp(
      String.raw`(\d{1,4})${mid}(?:recessed(?:\s+can)?|can)\s+lights?\b`,
      "g"
    )
  )

  // fixtures/fans
  const fixtures = sumMatchesLocal(
    new RegExp(
      String.raw`(\d{1,4})${mid}(light\s*fixture|fixture|sconce|ceiling\s*fan|fan)s?\b`,
      "g"
    )
  )

  const total = outlets + switches + recessed + fixtures
  return total > 0 ? { outlets, switches, recessed, fixtures, total } : null
}

function parseDedicatedCircuits(scopeText: string): number | null {
  const t = scopeText.toLowerCase()

  // “add 2 circuits”, “2 new circuits”, “run 1 dedicated circuit”
  const n1 = sumMatches(t, /(\d{1,3})\s*(new\s*)?(dedicated\s*)?circuits?\b/g)
  if (n1 > 0) return n1

  // “(1) 20a circuit”, “2x 240v circuits”
  const n2 = sumMatches(t, /(\d{1,3})\s*(x\s*)?(20\s*a|30\s*a|40\s*a|50\s*a|240v|220v)\s*(dedicated\s*)?circuits?\b/g)
  if (n2 > 0) return n2

  // EV charger often implies at least one circuit (unless they explicitly say existing circuit)
  const ev = parseEvChargerCount(scopeText)
  if (ev && ev > 0) return ev

  return null
}

function parsePanelCount(scopeText: string): number | null {
  const t = scopeText.toLowerCase()

  // “replace panel”, “new panel”, “service panel upgrade”
  const mentions = /\b(panel|service\s*panel|main\s*panel|breaker\s*panel|load\s*center)\b/.test(t)
  if (!mentions) return null

  // If they specify a count, use it; else default to 1 if panel replacement is clearly mentioned
  const explicit = sumMatches(t, /(\d{1,3})\s*(panel|service\s*panel|breaker\s*panel|load\s*center)s?\b/g)
  if (explicit > 0) return explicit

  const replacementSignal =
    /\b(replace|replacement|swap|upgrade|install\s+new|new\s+panel|service\s+upgrade)\b/.test(t)

  return replacementSignal ? 1 : null
}

function parseEvChargerCount(scopeText: string): number | null {
  const t = scopeText.toLowerCase()
  const mentions = /\b(ev\s*charger|electric\s*vehicle\s*charger|tesla\s*charger|wall\s*connector)\b/.test(t)
  if (!mentions) return null

  const explicit = sumMatches(t, /(\d{1,3})\s*(ev\s*charger|chargers?|wall\s*connector|tesla\s*charger)s?\b/g)
  if (explicit > 0) return explicit

  // If mentioned but no count, assume 1
  return 1
}

function isHeavyElectrical(scopeText: string): boolean {
  const t = scopeText.toLowerCase()
  return /\b(panel|service\s*upgrade|rewire|whole\s*home\s*rewire|trench|meter|subpanel|main\s*disconnect)\b/.test(t)
}

function hasRemodelSignals(scopeText: string): boolean {
  const t = scopeText.toLowerCase()
  return /\b(remodel|renovation|gut|demo|tile|vanity|toilet|shower|tub|kitchen|cabinets?|counter(top)?|backsplash|rough[-\s]*in)\b/.test(t)
}

function hasTroubleshooting(scopeText: string): boolean {
  const t = scopeText.toLowerCase()
  return /\b(troubleshoot|not\s+working|diagnos|intermittent|flicker|dead)\b/.test(t)
}

function isAddWork(scopeText: string): boolean {
  const t = scopeText.toLowerCase()
  return /\b(add|adding|install(ing)?|new\s+(device|outlet|switch|fixture|light|recessed|can\s*light|run|line|home\s*run|circuit)|rough[-\s]*in)\b/.test(t)
}

function isSwapWork(scopeText: string): boolean {
  const t = scopeText.toLowerCase()
  return /\b(replace|replacing|swap|swapping|change\s*out|remove\s+and\s+replace)\b/.test(t)
}

// -----------------------------
// MAIN ENGINE
// -----------------------------
export function computeElectricalDeterministic(args: {
  scopeText: string
  stateMultiplier: number
}): ElectricalDeterministicResult {
  const notes: string[] = []
  const scope = (args.scopeText || "").trim()
  const t = scope.toLowerCase()

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

  const remodelLike = hasRemodelSignals(scope)
  const troubleshooting = hasTroubleshooting(scope)
  const heavy = isHeavyElectrical(scope)

  const devices = parseElectricalDeviceBreakdown(scope)
  console.log("PG ELECTRICAL DEVICES PARSED", { scope, devices })
  const dedicatedCircuits = parseDedicatedCircuits(scope)
  const panelCount = parsePanelCount(scope)
  const evChargerCount = parseEvChargerCount(scope)

  const addWork = isAddWork(scope)
  const swapWork = isSwapWork(scope)
  const treatAsAdd = addWork && !swapWork

  const mentionsPanel = /\b(panel|service\s*panel|breaker\s*panel|load\s*center)\b/.test(t)

  // Guardrails: if it smells like a remodel scope, do NOT go deterministic unless counts are explicit and it is clearly device-level.
  if (remodelLike && !devices && !dedicatedCircuits && !panelCount) {
    return {
      okForDeterministic: false,
      okForVerified: false,
      pricing: null,
      jobType: "unknown",
      signals: { devices: null, dedicatedCircuits: null, hasTroubleshooting: troubleshooting, treatAsAdd, mentionsPanel, panelCount, evChargerCount },
      notes: ["Remodel/gut signals present without explicit electrical counts → avoid deterministic"],
    }
  }

  // -----------------------------
  // Job type selection
  // -----------------------------
  // Panel replacement dominates if clearly present
  if (panelCount && panelCount > 0) {
    notes.push(`Panel replacement detected (count=${panelCount}).`)

    const pricing = pricePanelReplacement({
      panelCount,
      stateMultiplier: args.stateMultiplier,
      includeTroubleshooting: troubleshooting,
      scopeText: scope,
    })

    // Verified if explicit count OR clear replacement language; (panelCount already implies)
    const okForVerified = true
    return {
      okForDeterministic: true,
      okForVerified,
      pricing,
      jobType: "panel_replacement",
      signals: { devices: devices ?? null, dedicatedCircuits: dedicatedCircuits ?? null, hasTroubleshooting: troubleshooting, treatAsAdd, mentionsPanel, panelCount, evChargerCount },
      notes,
    }
  }

  // EV charger: treat as dedicated circuit unless heavy panel work is included
  if (evChargerCount && evChargerCount > 0) {
    notes.push(`EV charger detected (count=${evChargerCount}).`)

    // If they mention panel/service upgrade too, don't deterministic unless panelCount parsed
    if (mentionsPanel && heavy && !panelCount) {
      return {
        okForDeterministic: false,
        okForVerified: false,
        pricing: null,
        jobType: "ev_charger",
        signals: { devices: devices ?? null, dedicatedCircuits: dedicatedCircuits ?? null, hasTroubleshooting: troubleshooting, treatAsAdd, mentionsPanel, panelCount, evChargerCount },
        notes: [...notes, "Panel/service work mentioned but not clearly scoped → avoid deterministic"],
      }
    }

    const pricing = priceDedicatedCircuits({
      circuitCount: evChargerCount,
      stateMultiplier: args.stateMultiplier,
      includeTroubleshooting: troubleshooting,
      scopeText: scope,
      isEvCharger: true,
    })

    // Verified because EV charger count defaults to 1 even if not explicit;
    // mark verified only if explicit count was stated in text.
    const explicitEvCount = sumMatches(t, /(\d{1,3})\s*(ev\s*charger|chargers?|wall\s*connector|tesla\s*charger)s?\b/g) > 0
    return {
      okForDeterministic: true,
      okForVerified: explicitEvCount,
      pricing,
      jobType: "ev_charger",
      signals: { devices: devices ?? null, dedicatedCircuits: dedicatedCircuits ?? null, hasTroubleshooting: troubleshooting, treatAsAdd, mentionsPanel, panelCount, evChargerCount },
      notes,
    }
  }

  // Dedicated circuits (not panel)
  if (dedicatedCircuits && dedicatedCircuits > 0) {
    notes.push(`Dedicated circuits detected (count=${dedicatedCircuits}).`)

    // If remodel-like + circuits are the only clear signal, it’s still ok (count-based and safe)
    const pricing = priceDedicatedCircuits({
      circuitCount: dedicatedCircuits,
      stateMultiplier: args.stateMultiplier,
      includeTroubleshooting: troubleshooting,
      scopeText: scope,
      isEvCharger: false,
    })

    // Verified only if explicit circuit count appeared (not inferred)
    const explicitCircuitCount =
      sumMatches(t, /(\d{1,3})\s*(new\s*)?(dedicated\s*)?circuits?\b/g) > 0 ||
      sumMatches(t, /(\d{1,3})\s*(x\s*)?(20\s*a|30\s*a|40\s*a|50\s*a|240v|220v)\s*(dedicated\s*)?circuits?\b/g) > 0

    return {
      okForDeterministic: true,
      okForVerified: explicitCircuitCount,
      pricing,
      jobType: "dedicated_circuits",
      signals: { devices: devices ?? null, dedicatedCircuits, hasTroubleshooting: troubleshooting, treatAsAdd, mentionsPanel, panelCount, evChargerCount },
      notes,
    }
  }

  // Device work (needs explicit counts)
  if (devices && devices.total > 0) {
    notes.push(`Device work detected (total devices=${devices.total}). treatAsAdd=${treatAsAdd}`)

    // If it’s heavy electrical and only device counts are present, still ok — device work is safe.
    const pricing = priceDeviceWork({
      devices,
      stateMultiplier: args.stateMultiplier,
      treatAsAdd,
      includeTroubleshooting: troubleshooting,
      scopeText: scope,
    })

    // Verified because device counts are explicit by definition
    return {
      okForDeterministic: true,
      okForVerified: true,
      pricing,
      jobType: "device_work",
      signals: { devices, dedicatedCircuits: null, hasTroubleshooting: troubleshooting, treatAsAdd, mentionsPanel, panelCount, evChargerCount },
      notes,
    }
  }

  // If scope is clearly heavy electrical but we can't parse a deterministic unit → do not override AI
  if (heavy) {
    return {
      okForDeterministic: false,
      okForVerified: false,
      pricing: null,
      jobType: "unknown",
      signals: { devices: null, dedicatedCircuits: null, hasTroubleshooting: troubleshooting, treatAsAdd, mentionsPanel, panelCount, evChargerCount },
      notes: ["Heavy electrical signals but no countable units parsed → avoid deterministic"],
    }
  }

  return {
    okForDeterministic: false,
    okForVerified: false,
    pricing: null,
    jobType: "unknown",
    signals: { devices: null, dedicatedCircuits: null, hasTroubleshooting: troubleshooting, treatAsAdd, mentionsPanel, panelCount, evChargerCount },
    notes: ["No deterministic electrical pattern matched"],
  }
}

// -----------------------------
// PRICERS
// -----------------------------
function priceDeviceWork(args: {
  devices: { outlets: number; switches: number; recessed: number; fixtures: number; total: number }
  stateMultiplier: number
  treatAsAdd: boolean
  includeTroubleshooting: boolean
  scopeText: string
}): Pricing {
  const laborRate = 115
  const markup = 25

  const hrsPerOutlet = args.treatAsAdd ? 0.85 : 0.45
  const hrsPerSwitch = args.treatAsAdd ? 0.75 : 0.40
  const hrsPerRecessed = args.treatAsAdd ? 1.10 : 0.70
  const hrsPerFixture = args.treatAsAdd ? 0.95 : 0.65

  const troubleshootingHrs = args.includeTroubleshooting ? 1.5 : 0

  const laborHrs =
    args.devices.outlets * hrsPerOutlet +
    args.devices.switches * hrsPerSwitch +
    args.devices.recessed * hrsPerRecessed +
    args.devices.fixtures * hrsPerFixture +
    troubleshootingHrs +
    1.25 // setup, protection, testing

  let labor = Math.round(laborHrs * laborRate)
  labor = Math.round(labor * args.stateMultiplier)

  // Materials allowance (mid-market devices, not designer fixtures)
  const matPerOutlet = 16
  const matPerSwitch = 14
  const matPerRecessed = 28
  const matPerFixture = 22

  const materials = Math.round(
    args.devices.outlets * matPerOutlet +
      args.devices.switches * matPerSwitch +
      args.devices.recessed * matPerRecessed +
      args.devices.fixtures * matPerFixture
  )

  const mobilization =
    args.devices.total <= 6 ? 225 :
    args.devices.total <= 15 ? 325 :
    450

  const supervision = Math.round((labor + materials) * 0.05)
  const subs = mobilization + supervision

  const base = labor + materials + subs
  const total = Math.round(base * (1 + markup / 100))

  return clampPricing({ labor, materials, subs, markup, total })
}

function priceDedicatedCircuits(args: {
  circuitCount: number
  stateMultiplier: number
  includeTroubleshooting: boolean
  scopeText: string
  isEvCharger: boolean
}): Pricing {
  const laborRate = 125
  const markup = 25

  // Dedicated circuit (run + termination) hours
  // EV chargers tend to be longer pulls + heavier gauge work
  const hrsPerCircuit = args.isEvCharger ? 4.5 : 3.25

  const troubleshootingHrs = args.includeTroubleshooting ? 1.25 : 0

  const laborHrs =
    args.circuitCount * hrsPerCircuit +
    troubleshootingHrs +
    1.5 // planning, layout, test, label

  let labor = Math.round(laborHrs * laborRate)
  labor = Math.round(labor * args.stateMultiplier)

  // Materials per circuit: wire + breaker + misc
  const matPerCircuit = args.isEvCharger ? 240 : 145
  const materials = Math.round(args.circuitCount * matPerCircuit + 55)

  const mobilization = args.circuitCount <= 1 ? 300 : 450
  const permitAllowance = args.isEvCharger ? 175 : 0
  const supervision = Math.round((labor + materials) * 0.06)
  const subs = mobilization + permitAllowance + supervision

  const base = labor + materials + subs
  const total = Math.round(base * (1 + markup / 100))

  return clampPricing({ labor, materials, subs, markup, total })
}

function pricePanelReplacement(args: {
  panelCount: number
  stateMultiplier: number
  includeTroubleshooting: boolean
  scopeText: string
}): Pricing {
  const laborRate = 135
  const markup = 25

  // Base hours per panel swap/upgrade (residential mid-market)
  const hrsPerPanel = 10.5
  const troubleshootingHrs = args.includeTroubleshooting ? 1.5 : 0

  const laborHrs =
    args.panelCount * hrsPerPanel +
    troubleshootingHrs +
    2.0 // coordination, labeling, testing

  let labor = Math.round(laborHrs * laborRate)
  labor = Math.round(labor * args.stateMultiplier)

  // Materials allowance: panel + breakers + connectors
  const matPerPanel = 950
  const materials = Math.round(args.panelCount * matPerPanel + 250)

  // Subs: mobilization + permit/inspection coordination allowance
  const mobilization = 650
  const permitAllowance = 450
  const supervision = Math.round((labor + materials) * 0.08)
  const subs = mobilization + permitAllowance + supervision

  const base = labor + materials + subs
  const total = Math.round(base * (1 + markup / 100))

  return clampPricing({ labor, materials, subs, markup, total })
}