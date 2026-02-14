"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import React from "react"

type PaintScope = "walls" | "walls_ceilings" | "full"
type EffectivePaintScope = PaintScope | "doors_only"
type DocumentType = "Change Order" | "Estimate" | "Change Order / Estimate"

export default function Home() {
  const FREE_LIMIT = 3
  const generatingRef = useRef(false)

// Prevent out-of-order entitlement responses from overwriting newer state
const entitlementReqId = useRef(0)
  
  const PAINT_SCOPE_OPTIONS = [
  { label: "Walls only", value: "walls" },
  { label: "Walls + ceilings", value: "walls_ceilings" },
  { label: "Full interior (walls, ceilings, trim & doors)", value: "full" },
] as const

    // -------------------------
  // Optional Measurements
  // -------------------------
  type MeasureRow = {
    label: string
    lengthFt: number
    heightFt: number
    qty: number
  }

  const [measureEnabled, setMeasureEnabled] = useState(false)

  const [measureRows, setMeasureRows] = useState<MeasureRow[]>([
    { label: "Area 1", lengthFt: 0, heightFt: 0, qty: 1 },
  ])

  const rowSqft = (r: MeasureRow) =>
    Math.round((r.lengthFt || 0) * (r.heightFt || 0) * (r.qty || 1) * 10) / 10

  const totalSqft =
    Math.round(measureRows.reduce((sum, r) => sum + rowSqft(r), 0) * 10) / 10

    type SavedDoc = {
  id: string
  createdAt: number
  // what you already save today (adjust names if yours differ)
  result: string
  pricing: {
    labor: number
    materials: number
    subs: number
    markup: number
    total: number
  }
  trade?: string
  state?: string
  jobDetails?: {
    clientName: string
    jobName: string
    changeOrderNo: string
    jobAddress: string
    date: string
  }
  companyProfile?: {
    name: string
    address: string
    phone: string
    email: string
  }
}

type Invoice = {
  id: string
  createdAt: number
  fromEstimateId: string
  invoiceNo: string
  issueDate: string
  dueDate: string
  billToName: string
  jobName: string
  jobAddress: string
  lineItems: { label: string; amount: number }[]
  subtotal: number
  total: number
  notes: string
    deposit?: {
    enabled: boolean
    type: "percent" | "fixed"
    value: number
    depositDue: number
    remainingBalance: number
    estimateTotal: number
  }
}

  // -------------------------
// Email (required for entitlement)
// -------------------------
const [email, setEmail] = useState("")
const [paid, setPaid] = useState(false)
const [remaining, setRemaining] = useState(FREE_LIMIT)
const [showUpgrade, setShowUpgrade] = useState(false)
const EMAIL_KEY = "jobestimatepro_email"
const COMPANY_KEY = "jobestimatepro_company"
const JOB_KEY = "jobestimatepro_job"
const INVOICE_KEY = "jobestimatepro_invoices"

// -------------------------
// Saved Estimate History (localStorage)
// -------------------------
const HISTORY_KEY = "jobestimatepro_history_v1"
type PricingSource = "ai" | "deterministic" | "merged"

type PriceGuardStatus = "verified" | "deterministic" | "adjusted" | "review" | "ai"

type PriceGuardReport = {
  status: PriceGuardStatus
  confidence: number
  pricingSource: PricingSource
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
  }
}

type UiTrade =
  | ""
  | "painting"
  | "drywall"
  | "flooring"
  | "electrical"
  | "plumbing"
  | "bathroom_tile"
  | "carpentry"
  | "general_renovation"

const normalizeTrade = (t: any): UiTrade => {
  if (t === "general renovation") return "general_renovation"

  const allowed: UiTrade[] = [
    "",
    "painting",
    "drywall",
    "flooring",
    "electrical",
    "plumbing",
    "bathroom_tile",
    "carpentry",
    "general_renovation",
  ]

  return allowed.includes(t) ? (t as UiTrade) : ""
}

type EstimateHistoryItem = {
  id: string
  createdAt: number
  documentType: "Change Order" | "Estimate" | "Change Order / Estimate"
  
  // job context snapshot
  jobDetails: {
    clientName: string
    jobName: string
    changeOrderNo: string
    jobAddress: string
    date: string
  }
  trade: UiTrade
  state: string
  scopeChange: string

  // generated outputs snapshot
  result: string
  pricing: {
    labor: number
    materials: number
    subs: number
    markup: number
    total: number
  }
  pricingSource?: PricingSource
  priceGuardVerified?: boolean

    deposit?: {
    enabled: boolean
    type: "percent" | "fixed"
    value: number
  }
}

const [history, setHistory] = useState<EstimateHistoryItem[]>([])


const [jobDetails, setJobDetails] = useState({
  clientName: "",
  jobName: "",
  changeOrderNo: "",
  jobAddress: "",
  date: "", // optional override; blank = auto-today in PDF
})

useEffect(() => {
  if (typeof window === "undefined") return

  // migrate old key once if it exists
  const old = localStorage.getItem("scopeguard_email")
  if (old) {
    localStorage.setItem(EMAIL_KEY, old)
    localStorage.removeItem("scopeguard_email")
    setEmail(old)
    return
  }

  const saved = localStorage.getItem(EMAIL_KEY)
  if (saved) setEmail(saved)
}, [])

useEffect(() => {
  if (typeof window === "undefined") return

  if (email) {
    localStorage.setItem(EMAIL_KEY, email)
  } else {
    localStorage.removeItem(EMAIL_KEY)
  }
}, [email])

   async function checkEntitlementNow() {
  const reqId = ++entitlementReqId.current

  const e = email.trim().toLowerCase()
  if (!e) return

  try {
    const res = await fetch("/api/entitlement", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: e }),
    })

    // ignore stale responses
    if (reqId !== entitlementReqId.current) return

    if (!res.ok) {
      setPaid(false)
      setRemaining(FREE_LIMIT) // optional fallback
      setShowUpgrade(false) // optional fallback
      return
    }

    const data = await res.json()

    // ignore stale responses (in case JSON parse was slow)
    if (reqId !== entitlementReqId.current) return

    const entitled = data?.entitled === true
    setPaid(entitled)

    const used = typeof data?.usage_count === "number" ? data.usage_count : 0
    const limit =
      typeof data?.free_limit === "number" ? data.free_limit : FREE_LIMIT

    if (!entitled) {
      const remainingNow = Math.max(0, limit - used)
      setRemaining(remainingNow)
      setShowUpgrade(remainingNow <= 0)
    } else {
      setRemaining(FREE_LIMIT) // optional
      setShowUpgrade(false)
    }
  } catch {
    // ignore stale responses
    if (reqId !== entitlementReqId.current) return

    setPaid(false)
    setRemaining(FREE_LIMIT)
    setShowUpgrade(false)
  }
}

useEffect(() => {
  const e = email.trim().toLowerCase()
  if (!e) {
    setPaid(false)
    setRemaining(FREE_LIMIT)
    setShowUpgrade(false)
    return
  }
  checkEntitlementNow()
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [email])


  // -------------------------
  // Company profile (persisted)
  // -------------------------
  const [companyProfile, setCompanyProfile] = useState({
  name: "",
  address: "",
  phone: "",
  email: "",
  logo: "",
  license: "",
  paymentTerms: "Due upon approval.",
})

  useEffect(() => {
  if (typeof window === "undefined") return

  const old = localStorage.getItem("scopeguard_company")
  if (old) {
    localStorage.setItem(COMPANY_KEY, old)
    localStorage.removeItem("scopeguard_company")
    try {
      setCompanyProfile(JSON.parse(old))
    } catch {}
    return
  }

  const saved = localStorage.getItem(COMPANY_KEY)
  if (saved) {
    try {
      setCompanyProfile(JSON.parse(saved))
    } catch {}
  }
}, [])

  useEffect(() => {
  if (typeof window === "undefined") return
  localStorage.setItem(COMPANY_KEY, JSON.stringify(companyProfile))
}, [companyProfile])
  
useEffect(() => {
  if (typeof window === "undefined") return

  const saved = localStorage.getItem(JOB_KEY)
  if (saved) setJobDetails(JSON.parse(saved))
}, [])

useEffect(() => {
  if (typeof window === "undefined") return
  localStorage.setItem(JOB_KEY, JSON.stringify(jobDetails))
}, [jobDetails])

useEffect(() => {
  if (typeof window === "undefined") return

  const saved = localStorage.getItem(HISTORY_KEY)
  if (saved) {
    try {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed)) {
  const cleaned: EstimateHistoryItem[] = parsed.map((x: any) => ({
    id: String(x?.id ?? `${Date.now()}_${Math.random().toString(16).slice(2)}`),
    createdAt: Number(x?.createdAt ?? Date.now()),
    documentType:
  x?.documentType === "Change Order" ||
  x?.documentType === "Estimate" ||
  x?.documentType === "Change Order / Estimate"
    ? x.documentType
    : "Change Order / Estimate",
    jobDetails: {
      clientName: String(x?.jobDetails?.clientName ?? ""),
      jobName: String(x?.jobDetails?.jobName ?? ""),
      changeOrderNo: String(x?.jobDetails?.changeOrderNo ?? ""),
      jobAddress: String(x?.jobDetails?.jobAddress ?? ""),
      date: String(x?.jobDetails?.date ?? ""),
    },
    trade: normalizeTrade(x?.trade), // ✅ key fix
    state: String(x?.state ?? ""),
    scopeChange: String(x?.scopeChange ?? ""),
    result: String(x?.result ?? ""),
    pricing: {
      labor: Number(x?.pricing?.labor ?? 0),
      materials: Number(x?.pricing?.materials ?? 0),
      subs: Number(x?.pricing?.subs ?? 0),
      markup: Number(x?.pricing?.markup ?? 0),
      total: Number(x?.pricing?.total ?? 0),
    },
        deposit: x?.deposit
      ? {
          enabled: Boolean(x.deposit.enabled),
          type: x.deposit.type === "fixed" ? "fixed" : "percent",
          value: Number(x.deposit.value || 0),
        }
      : undefined,
    pricingSource: (x?.pricingSource as PricingSource) ?? "ai",
    priceGuardVerified: Boolean(x?.priceGuardVerified),
  }))

  setHistory(cleaned)
}
    } catch {
      // ignore bad data
    }
  }
}, [])

  // -------------------------
  // App state
  // -------------------------
  const [scopeChange, setScopeChange] = useState("")
  const [result, setResult] = useState("")
  const [documentType, setDocumentType] = useState<
  "Change Order" | "Estimate" | "Change Order / Estimate"
>("Change Order / Estimate")
  const [trade, setTrade] = useState<UiTrade>("")
  const [state, setState] = useState("")
  const [paintScope, setPaintScope] = useState<PaintScope>("walls")
  
const text = scopeChange.toLowerCase()

const hasPaintWord = /\b(?:paint|painting|repaint|prime|primer)\b/i.test(text)

const showPaintScope =
  trade === "painting" || (trade === "" && hasPaintWord)

// explicit door count only (matches server)
const doorCount = (() => {
  const m = text.match(/\b(\d{1,4})\s+doors?\b/i)
  if (!m?.[1]) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
})()

const roomCount = (() => {
  const m = text.match(/\b(\d{1,4})\s+rooms?\b/i)
  if (!m?.[1]) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
})()

const isMixedPaintScope =
  (trade === "painting" || trade === "") &&
  hasPaintWord &&
  doorCount !== null &&
  roomCount !== null

const roomishRe =
  /\b(rooms?|hallway|living\s*room|family\s*room|bed(room)?|kitchen|bath(room)?|dining|office|closet|stair|entry|walls?|ceilings?)\b/i

const looksLikeDoorsOnly =
  (trade === "painting" || trade === "") &&
  hasPaintWord &&
  doorCount !== null &&
  !roomishRe.test(text)

const effectivePaintScope: EffectivePaintScope =
  looksLikeDoorsOnly ? "doors_only" : paintScope
  
  const [pricing, setPricing] = useState({
    labor: 0,
    materials: 0,
    subs: 0,
    markup: 20,
    total: 0,
  })

  // -------------------------
// Deposit (optional)
// -------------------------
const [depositEnabled, setDepositEnabled] = useState(false)
const [depositType, setDepositType] = useState<"percent" | "fixed">("percent")
const [depositValue, setDepositValue] = useState<number>(25)

// Derived amounts (based on current total)
const depositDue = useMemo(() => {
  const total = Number(pricing.total || 0)
  if (!depositEnabled || total <= 0) return 0

  if (depositType === "percent") {
    const pct = Math.max(0, Math.min(100, Number(depositValue || 0)))
    return Math.round(total * (pct / 100))
  }

  const fixed = Math.max(0, Number(depositValue || 0))
  return Math.min(total, Math.round(fixed))
}, [depositEnabled, depositType, depositValue, pricing.total])

const remainingBalance = useMemo(() => {
  const total = Number(pricing.total || 0)
  return Math.max(0, total - depositDue)
}, [pricing.total, depositDue])
  
  const [pricingSource, setPricingSource] = useState<PricingSource>("ai")
  const [pricingEdited, setPricingEdited] = useState(false)
  const [showPriceGuardDetails, setShowPriceGuardDetails] = useState(false)
  const [priceGuard, setPriceGuard] = useState<PriceGuardReport | null>(null)
  const [priceGuardVerified, setPriceGuardVerified] = useState(false)

  useEffect(() => {
  function onDocClick(e: MouseEvent) {
    const t = e.target as HTMLElement
    if (t.closest?.("[data-priceguard]")) return
    setShowPriceGuardDetails(false)
  }

  if (showPriceGuardDetails) {
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }
}, [showPriceGuardDetails])
  
  const [status, setStatus] = useState("")
  const [loading, setLoading] = useState(false)

  const [invoices, setInvoices] = useState<Invoice[]>([])

  useEffect(() => {
  if (typeof window === "undefined") return

  const saved = localStorage.getItem(INVOICE_KEY)
  if (!saved) return

  try {
    const parsed = JSON.parse(saved)
    if (Array.isArray(parsed)) setInvoices(parsed)
  } catch {
    // ignore bad data
  }
}, [])

useEffect(() => {
  if (typeof window === "undefined") return
  localStorage.setItem(INVOICE_KEY, JSON.stringify(invoices))
}, [invoices])
  
  useEffect(() => {
  if (paid) setShowUpgrade(false)
}, [paid])



  // -------------------------
  // Auto-calc total
  // -------------------------
  useEffect(() => {
    const base =
      pricing.labor + pricing.materials + pricing.subs
    const total = Math.round(
      base * (1 + pricing.markup / 100)
    )
    setPricing((p) => ({ ...p, total }))
  }, [
    pricing.labor,
    pricing.materials,
    pricing.subs,
    pricing.markup,
  ])

  // -------------------------
// Generate AI document
// -------------------------
async function generate() {
  if (generatingRef.current) return
  generatingRef.current = true

  if (loading) {
    generatingRef.current = false
    return
  }

  const e = email.trim().toLowerCase()
  if (!e) {
    setStatus("Please enter the email used at checkout.")
    generatingRef.current = false
    return
  }

  if (!scopeChange.trim()) {
    setStatus("Please describe the scope change.")
    generatingRef.current = false
    return
  }

  if (!paid && remaining <= 0) {
    setStatus("Free limit reached. Please upgrade.")
    setShowUpgrade(true)
    generatingRef.current = false
    return
  }

  setLoading(true)
  setStatus("") // prevents duplicate “Generating…” line
  setResult("")
  setDocumentType("Change Order / Estimate")
  setPricingSource("ai")
  setShowPriceGuardDetails(false)
  setPriceGuard(null)
  setPricingEdited(false)
  setPriceGuardVerified(false)

const sendPaintScope =
  trade === "painting" || (trade === "" && hasPaintWord)

const paintScopeToSend = sendPaintScope
  ? (effectivePaintScope === "doors_only" ? "walls" : paintScope)
  : null

const tradeToSend =
  trade === "bathroom_tile" || trade === "general_renovation"
    ? "general renovation"
    : trade

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: e,
        scopeChange,
        trade: tradeToSend,
        state,
        paintScope: paintScopeToSend,
        measurements: measureEnabled
          ? { rows: measureRows, totalSqft, units: "ft" }
          : null,
      }),
    })

    if (res.status === 403) {
      setStatus("Free limit reached. Please upgrade.")
      setShowUpgrade(true)
      setRemaining(0)
      return
    }

    if (res.status === 429) {
      const payload = await res.json().catch(() => null)
      const retry = payload?.retry_after
      setStatus(
        retry
          ? `Too many requests. Try again later. (retry-after: ${retry}s)`
          : "Too many requests. Please try again in a moment."
      )
      return
    }

    if (!res.ok) {
      const msg = await res.text().catch(() => "")
      setStatus(`Server error (${res.status}). ${msg}`)
      return
    }

    const data = await res.json()
    console.log("pricingSource:", data.pricingSource)

    const nextVerified = data?.priceGuardVerified === true
    setPriceGuardVerified(nextVerified)
    setPriceGuard(data?.priceGuard ?? null)

    const nextDocumentType =
     data?.documentType === "Change Order" ||
     data?.documentType === "Estimate" ||
     data?.documentType === "Change Order / Estimate"
      ? data.documentType
      : "Change Order / Estimate"

    setDocumentType(nextDocumentType)

const nextResult = data.text || data.description || ""
const nextPricing = data.pricing ? data.pricing : pricing
const nextPricingSource =
  (data?.pricingSource as PricingSource) || "ai"

setResult(nextResult)
setPricing(nextPricing)
setPricingSource(nextPricingSource)
const nextTrade: UiTrade = trade ? trade : normalizeTrade(data?.trade)
if (!trade && nextTrade) setTrade(nextTrade)

saveToHistory({
  id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
  createdAt: Date.now(),
  jobDetails: { ...jobDetails },
  documentType: nextDocumentType,
  trade: nextTrade,
  state: state || "",
  scopeChange: scopeChange || "",
  result: nextResult,
  pricing: {
    labor: Number(nextPricing.labor || 0),
    materials: Number(nextPricing.materials || 0),
    subs: Number(nextPricing.subs || 0),
    markup: Number(nextPricing.markup || 0),
    total: Number(nextPricing.total || 0),
  },
  pricingSource: nextPricingSource,
  priceGuardVerified: nextVerified,

    deposit: depositEnabled
  ? {
      enabled: true,
      type: depositType,
      value: Number(depositValue || 0),
    }
  : undefined,
})

await checkEntitlementNow()
  } catch (err) {
    console.error(err)
    setStatus("Error generating document.")
  } finally {
    setLoading(false)
    generatingRef.current = false
  }
}

  // -------------------------
// Stripe upgrade
// -------------------------
async function upgrade() {
  try {
    const e = email.trim().toLowerCase()

    if (!e) {
      setStatus("Please enter the email used at checkout.")
      return
    }

    setStatus("Redirecting to secure checkout…")

    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: e }), // ✅ SEND EMAIL
    })

    if (!res.ok) {
      throw new Error("Checkout request failed")
    }

    const data = await res.json()

    if (!data?.url) {
      throw new Error("No checkout URL returned")
    }

   // 🔑 Force full-page navigation
window.location.assign(data.url)
} catch (err) {
  console.error(err)
  setStatus("Checkout error.")
}
}

// ✅ Save History
function saveToHistory(item: EstimateHistoryItem) {
  setHistory((prev) => {
    const next = [item, ...prev].slice(0, 25)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
    return next
  })
}

// ✅ Delete single history item
function deleteHistoryItem(id: string) {
  setHistory((prev) => {
    const next = prev.filter((h) => h.id !== id)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
    return next
  })
}

// ✅ Clear history
function clearHistory() {
  setHistory([])
  localStorage.setItem(HISTORY_KEY, JSON.stringify([]))
}

// ✅ Load history item back into the form
function loadHistoryItem(item: EstimateHistoryItem) {
  setJobDetails(item.jobDetails)
  setDocumentType(item.documentType || "Change Order / Estimate")
  setTrade(item.trade || "")
  setState(item.state || "")
  setScopeChange(item.scopeChange || "")
  setPricingEdited(false)
  setResult(item.result || "")
  setPricing(item.pricing)

    // restore deposit settings (if present)
  if (item.deposit) {
    setDepositEnabled(Boolean(item.deposit.enabled))
    setDepositType(item.deposit.type === "fixed" ? "fixed" : "percent")
    setDepositValue(Number(item.deposit.value || 0))
  } else {
    setDepositEnabled(false)
    setDepositType("percent")
    setDepositValue(25)
  }
  
  const src = (item.pricingSource ?? "ai") as PricingSource
  setPricingSource(src)

  setShowPriceGuardDetails(false)
  setStatus("Loaded saved estimate from history.")
}

    // -------------------------
  // PDF generation (Branded)
  // -------------------------
  function downloadPDF() {
    if (!result) {
      setStatus("Generate a document first, then download the PDF.")
      return
    }

    const brandName = "JobEstimate Pro"
    const companyName = companyProfile.name?.trim() || "Contractor"
    const companyAddress = companyProfile.address?.trim() || ""
    const companyPhone = companyProfile.phone?.trim() || ""
    const companyEmail = companyProfile.email?.trim() || ""
    const companyLicense = companyProfile.license?.trim() || ""
    const paymentTerms = companyProfile.paymentTerms?.trim() || "Due upon approval."
    const companyLogo = companyProfile.logo || ""
    const clientName = jobDetails.clientName?.trim() || ""
    const jobName = jobDetails.jobName?.trim() || ""
    const jobAddress = jobDetails.jobAddress?.trim() || ""
    const changeOrderNo = jobDetails.changeOrderNo?.trim() || ""
    const showPriceGuardNote =
    pdfShowPriceGuard && documentType !== "Change Order"

    const win = window.open("", "", "width=900,height=1100")
    if (!win) {
      setStatus("Pop-up blocked. Please allow pop-ups to download the PDF.")
      return
    }

    // Basic HTML escaping to prevent broken PDFs if user types special chars
    const esc = (s: any) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")

    const safeResult = esc(result || "")

    win.document.write(`
      <html>
        <head>
          <title>${esc(brandName)} — ${esc(documentType || "Change Order / Estimate")} — ${esc(jobName || "")}</title>
          <meta charset="utf-8" />
          <style>
            @page { margin: 22mm 18mm; }
            body {
              font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
              color: #111;
            }
            .header {
              display: flex;
              align-items: flex-start;
              justify-content: space-between;
              gap: 16px;
              margin-bottom: 18px;
              padding-bottom: 14px;
              border-bottom: 2px solid #111;
            }
            .brand {
              font-size: 14px;
              font-weight: 600;
              color: #444;
              letter-spacing: 0.2px;
            }
            .brandTag {
              margin-top: 4px;
              font-size: 11px;
              color: #666;
            }
            .company {
              text-align: right;
              font-size: 12px;
              line-height: 1.5;
              color: #222;
              max-width: 55%;
              word-wrap: break-word;
            }
            h1 {
              font-size: 18px;
              margin: 18px 0 6px;
            }
            .muted {
              color: #555;
              font-size: 12px;
            }
            .section {
              margin-top: 18px;
            }
            .box {
  margin-top: 10px;
  padding: 14px;
  border: 1px solid #cfcfcf;
  border-radius: 10px;
  background: #fff;
  white-space: pre-wrap;
  line-height: 1.55;
  font-size: 13px;
}
            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 10px;
              font-size: 13px;
            }
            td, th {
              padding: 10px;
              border-bottom: 1px solid #e5e5e5;
            }
            th {
              text-align: left;
              font-size: 12px;
              color: #444;
            }
            .totalRow td {
              font-weight: 800;
              border-top: 2px solid #111;
            }
            .badge {
              display: inline-block;
              padding: 4px 8px;
              border-radius: 999px;
              font-size: 11px;
              background: #f0f0f0;
              color: #333;
              margin-left: 8px;
            }
            .sign {
              margin-top: 34px;
              display: flex;
              justify-content: space-between;
              gap: 24px;
            }
            .sigBlock {
              flex: 1;
            }
            .line {
              border-top: 1px solid #111;
              margin-top: 46px;
              width: 100%;
            }
            .sigLabel {
              margin-top: 8px;
              font-size: 12px;
              color: #333;
            }
              /* -------------------------
   Approvals (compact + 2-up)
   ------------------------- */
.approvalsRow{
  margin-top: 10px;             /* tighter */
  padding-top: 8px;             /* tighter */
  border-top: 1px solid #e5e5e5;
  display: flex;
  gap: 16px;
  align-items: flex-start;
  justify-content: space-between;
  page-break-inside: avoid;
  break-inside: avoid;
}

.approval{
  flex: 1;
  padding: 10px 12px;           /* tighter */
  border: 1px solid #e5e5e5;
  border-radius: 10px;
  page-break-inside: avoid;
  break-inside: avoid;
}

.approvalTitle{
  font-size: 12px;
  font-weight: 700;
  color: #111;
  margin: 0 0 8px;              /* tighter */
}

.approvalGrid{
  display: grid;
  grid-template-columns: 1fr 0.7fr;  /* signature + date */
  gap: 14px;
  align-items: end;
}

.approvalField{
  display: flex;
  flex-direction: column;
}

.approvalLine{
  border-top: 1px solid #111;
  margin-top: 18px;             /* tighter */
  width: 100%;
}

.approvalHint{
  margin-top: 6px;              /* was 8 */
  font-size: 11px;
  color: #333;
  white-space: nowrap;
}

.approvalNote{
  margin-top: 6px;              /* tighter */
  font-size: 10px;              /* slightly smaller */
  color: #555;
  line-height: 1.3;
}
            .footer {
  margin-top: 10px;     /* was 26 */
  padding-top: 6px;     /* was 10 */
  border-top: 1px solid #eee;
  font-size: 11px;
  color: #666;
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
          
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <div class="brand">${esc(brandName)}</div>
              <div class="brandTag">Professional change orders & estimates — generated instantly.</div>
            </div>
            <div class="company">
  ${
    companyLogo
      ? `<img src="${companyLogo}" style="max-height:42px; margin-bottom:6px;" />`
      : ""
  }

  <div style="font-weight:700; font-size:16px; color:#111;">
    ${esc(companyName)}
  </div>

  ${companyAddress ? `<div>${esc(companyAddress)}</div>` : ""}
  ${companyPhone ? `<div>${esc(companyPhone)}</div>` : ""}
  ${companyLicense ? `<div><strong>License #:</strong> ${esc(companyLicense)}</div>` : ""}
  ${companyEmail ? `<div>${esc(companyEmail)}</div>` : ""}
</div>
          </div>

          <h1>${esc(documentType || "Change Order / Estimate")}
            ${
              pdfShowPriceGuard
                ? `<span class="badge">${esc(pdfPriceGuardLabel)}</span>`
                : pdfEdited
                ? `<span class="badge">Edited</span>`
                : ""
             }
          </h1>

<div class="muted" style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap;">
  <div>
    ${clientName ? `<div><strong>Client:</strong> ${esc(clientName)}</div>` : ""}
    ${jobName ? `<div><strong>Job:</strong> ${esc(jobName)}</div>` : ""}
    ${jobAddress ? `<div><strong>Address:</strong> ${esc(jobAddress)}</div>` : ""}
  </div>

  <div style="text-align:right;">
    ${changeOrderNo ? `<div><strong>Change Order #:</strong> ${esc(changeOrderNo)}</div>` : ""}
    <div><strong>Date:</strong> ${esc(jobDetails.date ? new Date(jobDetails.date).toLocaleDateString() : new Date().toLocaleDateString())}</div>
  </div>
</div>

<div class="muted" style="margin-top:6px;">Generated by ${esc(brandName)}</div>

          <div class="section">
            <div class="muted" style="margin-bottom:6px;">Scope / Description</div>
            <div class="box">${safeResult}</div>
          </div>

          <div class="section">
            <div class="muted" style="margin-bottom:6px;">Pricing Summary</div>
            <table>
              <tr><th>Category</th><th style="text-align:right;">Amount</th></tr>
              <tr><td>Labor</td><td style="text-align:right;">$${Number(pricing.labor || 0).toLocaleString()}</td></tr>
              <tr><td>Materials</td><td style="text-align:right;">$${Number(pricing.materials || 0).toLocaleString()}</td></tr>
              <tr><td>Other / Mobilization</td><td style="text-align:right;">$${Number(pricing.subs || 0).toLocaleString()}</td></tr>
              <tr><td>Markup</td><td style="text-align:right;">${Number(pricing.markup || 0)}%</td></tr>
              <tr class="totalRow"><td>Total</td><td style="text-align:right;">$${Number(pricing.total || 0).toLocaleString()}</td></tr>
                            ${
                depositEnabled
                  ? `<tr><td>Deposit Due Now</td><td style="text-align:right;">$${Number(depositDue || 0).toLocaleString()}</td></tr>
                     <tr><td>Remaining Balance</td><td style="text-align:right;">$${Number(remainingBalance || 0).toLocaleString()}</td></tr>`
                  : ""
              }
            </table>

            ${pdfEdited ? `
  <div class="muted" style="margin-top:8px; line-height:1.4;">
    <strong>Edited:</strong> Pricing was updated to reflect job-specific details (site conditions, selections, or confirmed measurements).
  </div>
` : ""}

            ${showPriceGuardNote ? `
  <div class="muted" style="margin-top:8px; line-height:1.4;">
    <strong>${esc(pdfPriceGuardLabel)} (Informational):</strong>
    Pricing reflects the scope described above and typical site conditions at time of preparation.
    If site conditions, selections, quantities, or scope change after issuance, the final price will be adjusted accordingly.
  </div>
` : ""}

</div>   
   
<div class="approvalsRow">
  <div class="approval">
    <div class="approvalTitle">Contractor Approval</div>

    <div class="approvalGrid">
      <div class="approvalField">
        <div class="approvalLine"></div>
        <div class="approvalHint">Contractor Signature</div>
      </div>

      <div class="approvalField">
        <div class="approvalLine"></div>
        <div class="approvalHint">
          Date (${esc(jobDetails.date ? new Date(jobDetails.date).toLocaleDateString() : new Date().toLocaleDateString())})
        </div>
      </div>
    </div>
  </div>

  <div class="approval">
    <div class="approvalTitle">Customer Approval</div>

    <div class="approvalGrid">
      <div class="approvalField">
        <div class="approvalLine"></div>
        <div class="approvalHint">Customer Signature</div>
      </div>

      <div class="approvalField">
        <div class="approvalLine"></div>
        <div class="approvalHint">
          Date (${esc(jobDetails.date ? new Date(jobDetails.date).toLocaleDateString() : new Date().toLocaleDateString())})
        </div>
      </div>
    </div>

    <div class="approvalNote">
      By signing above, the customer approves the scope of work and pricing described in this document.
      Payment terms: <strong>${esc(paymentTerms)}</strong>
    </div>
  </div>
</div>

          <div class="footer">
            <div>${esc(brandName)}</div>
            <div>${esc(jobDetails.date ? new Date(jobDetails.date).toLocaleDateString() : new Date().toLocaleDateString())}</div>
          </div>
        </body>
      </html>
    `)

    win.document.close()
    win.focus()
    win.print()
    win.close()
  }

  function downloadInvoicePDF(inv: Invoice) {
  const brandName = "JobEstimate Pro"
  const companyName = companyProfile.name?.trim() || "Contractor"
  const companyAddress = companyProfile.address?.trim() || ""
  const companyPhone = companyProfile.phone?.trim() || ""
  const companyEmail = companyProfile.email?.trim() || ""

  const win = window.open("", "", "width=900,height=1100")
  if (!win) {
    setStatus("Pop-up blocked. Please allow pop-ups to download the PDF.")
    return
  }

  const esc = (s: any) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")

  const money = (n: number) => `$${Number(n || 0).toLocaleString()}`

  const rows = inv.lineItems
    .map(
      (li) => `
        <tr>
          <td>${esc(li.label)}</td>
          <td style="text-align:right;">${money(li.amount)}</td>
        </tr>
      `
    )
    .join("")

  win.document.write(`
    <html>
      <head>
        <title>${esc(brandName)} — Invoice ${esc(inv.invoiceNo)}</title>
        <meta charset="utf-8" />
        <style>
          @page { margin: 22mm 18mm; }
          body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #111; }
          .header { display:flex; justify-content:space-between; gap:16px; padding-bottom:12px; border-bottom:2px solid #111; }
          .brand { font-size:14px; font-weight:600; color:#444; letter-spacing:0.2px; }
          .company { text-align:right; font-size:12px; line-height:1.5; color:#222; max-width:55%; word-wrap:break-word; }
          h1 { font-size:18px; margin:16px 0 6px; }
          .muted { color:#555; font-size:12px; }
          table { width:100%; border-collapse:collapse; margin-top:10px; font-size:13px; }
          td, th { padding:10px; border-bottom:1px solid #e5e5e5; }
          th { text-align:left; font-size:12px; color:#444; }
          .totalRow td { font-weight:800; border-top:2px solid #111; }
          .meta { display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-top:8px; }
          .box { margin-top:10px; padding:12px; border:1px solid #e5e5e5; border-radius:10px; font-size:12px; color:#333; }
          .approvalsRow{ margin-top:14px; padding-top:10px; border-top:1px solid #e5e5e5; display:flex; gap:16px; }
          .approval{ flex:1; padding:10px 12px; border:1px solid #e5e5e5; border-radius:10px; }
          .approvalTitle{ font-size:12px; font-weight:700; margin:0 0 8px; }
          .approvalGrid{ display:grid; grid-template-columns:1fr 0.7fr; gap:14px; align-items:end; }
          .approvalLine{ border-top:1px solid #111; margin-top:22px; width:100%; }
          .approvalHint{ margin-top:6px; font-size:11px; color:#333; white-space:nowrap; }
          .footer { margin-top:22px; padding-top:10px; border-top:1px solid #eee; font-size:11px; color:#666; display:flex; justify-content:space-between; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="brand">${esc(brandName)}</div>
            <div class="muted">Invoice</div>
          </div>
          <div class="company">
            <div style="font-weight:700; font-size:16px; color:#111;">${esc(companyName)}</div>
            ${companyAddress ? `<div>${esc(companyAddress)}</div>` : ""}
            ${companyPhone ? `<div>${esc(companyPhone)}</div>` : ""}
            ${companyEmail ? `<div>${esc(companyEmail)}</div>` : ""}
          </div>
        </div>

        <h1>Invoice <span style="font-weight:700;">${esc(inv.invoiceNo)}</span></h1>

        <div class="meta muted">
          <div>
            <div><strong>Bill To:</strong> ${esc(inv.billToName)}</div>
            <div><strong>Job:</strong> ${esc(inv.jobName)}</div>
            ${inv.jobAddress ? `<div><strong>Address:</strong> ${esc(inv.jobAddress)}</div>` : ""}
          </div>
          <div style="text-align:right;">
            <div><strong>Issue Date:</strong> ${esc(new Date(inv.issueDate).toLocaleDateString())}</div>
            <div><strong>Due Date:</strong> ${esc(new Date(inv.dueDate).toLocaleDateString())}</div>
          </div>
        </div>

        <div style="margin-top:16px;">
          <div class="muted" style="margin-bottom:6px;">Invoice Summary</div>
          <table>
            <tr><th>Description</th><th style="text-align:right;">Amount</th></tr>
            ${rows}
            <tr class="totalRow"><td>Total Due</td><td style="text-align:right;">${money(inv.total)}</td></tr>
          </table>
        </div>

        ${
  inv.deposit?.enabled
    ? `<div class="box">
         <strong>Deposit Invoice:</strong><br/>
         Estimate Total: ${money(inv.deposit.estimateTotal)}<br/>
         Deposit Due Now: ${money(inv.deposit.depositDue)}<br/>
         Remaining Balance: ${money(inv.deposit.remainingBalance)}
       </div>`
    : ""
}

${inv.notes ? `<div class="box"><strong>Notes:</strong> ${esc(inv.notes)}</div>` : ""}

        <div class="approvalsRow">
          <div class="approval">
            <div class="approvalTitle">Contractor Approval</div>
            <div class="approvalGrid">
              <div>
                <div class="approvalLine"></div>
                <div class="approvalHint">Contractor Signature</div>
              </div>
              <div>
                <div class="approvalLine"></div>
                <div class="approvalHint">Date</div>
              </div>
            </div>
          </div>

          <div class="approval">
            <div class="approvalTitle">Customer Approval</div>
            <div class="approvalGrid">
              <div>
                <div class="approvalLine"></div>
                <div class="approvalHint">Customer Signature</div>
              </div>
              <div>
                <div class="approvalLine"></div>
                <div class="approvalHint">Date</div>
              </div>
            </div>
          </div>
        </div>

        <div class="footer">
          <div>${esc(brandName)}</div>
          <div>${esc(new Date().toLocaleDateString())}</div>
        </div>
      </body>
    </html>
  `)

  win.document.close()
  win.focus()
  win.print()
  win.close()
}

  function makeInvoiceNo() {
  // simple + unique enough for now
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  const rand = Math.floor(Math.random() * 900 + 100)
  return `INV-${y}${m}${day}-${rand}`
}

function toISODate(d: Date) {
  // yyyy-mm-dd
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function createInvoiceFromEstimate(est: EstimateHistoryItem) {
  const issue = new Date()
  const due = new Date()
  due.setDate(due.getDate() + 7)

  const client = est?.jobDetails?.clientName || jobDetails.clientName || "Client"
  const jobNm = est?.jobDetails?.jobName || jobDetails.jobName || "Job"
  const jobAddr = est?.jobDetails?.jobAddress || jobDetails.jobAddress || ""

  const labor = Number(est?.pricing?.labor || 0)
  const materials = Number(est?.pricing?.materials || 0)
  const subs = Number(est?.pricing?.subs || 0)
  const subtotal = labor + materials + subs
  const total = Number(est?.pricing?.total || 0)

  // --- deposit calculation (from the estimate snapshot) ---
  const depEnabled = Boolean(est.deposit?.enabled)
  const depType = est.deposit?.type === "fixed" ? "fixed" : "percent"
  const depValue = Number(est.deposit?.value || 0)

  const estimateTotal = Number(est?.pricing?.total || 0)
  let depDue = 0

  if (depEnabled && estimateTotal > 0) {
    if (depType === "percent") {
      const pct = Math.max(0, Math.min(100, depValue))
      depDue = Math.round(estimateTotal * (pct / 100))
    } else {
      depDue = Math.min(estimateTotal, Math.round(Math.max(0, depValue)))
    }
  }

  const depRemain = Math.max(0, estimateTotal - depDue)

  // --- build line items ---
  const lineItems: { label: string; amount: number }[] = []

  if (depEnabled) {
    const label =
      depType === "percent"
        ? `Deposit (${Math.max(0, Math.min(100, depValue))}% of estimate total)`
        : `Deposit (fixed amount)`
    lineItems.push({ label, amount: depDue })
  } else {
    if (labor) lineItems.push({ label: "Labor", amount: labor })
    if (materials) lineItems.push({ label: "Materials", amount: materials })
    if (subs) lineItems.push({ label: "Other / Mobilization", amount: subs })
  }

  const inv: Invoice = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    fromEstimateId: est.id,
    invoiceNo: makeInvoiceNo(),
    issueDate: toISODate(issue),
    dueDate: toISODate(due),
    billToName: client,
    jobName: jobNm,
    jobAddress: jobAddr,
    lineItems,

    subtotal: depEnabled ? depDue : subtotal,
    total: depEnabled ? depDue : (total || subtotal),

    notes: depEnabled
      ? `Deposit invoice. Remaining balance after deposit: $${Number(depRemain || 0).toLocaleString()}. Payment terms: ${
          companyProfile.paymentTerms?.trim() || "Due upon approval."
        }`
      : `Payment terms: ${companyProfile.paymentTerms?.trim() || "Due upon approval."}`,

    deposit: depEnabled
      ? {
          enabled: true,
          type: depType,
          value: depValue,
          depositDue: depDue,
          remainingBalance: depRemain,
          estimateTotal,
        }
      : undefined,
  }

  setInvoices((prev) => [inv, ...prev])
  setStatus(`Invoice created: ${inv.invoiceNo}`)
}

const isUserEdited = pricingEdited === true

const displayedConfidence = (() => {
  const base = priceGuard?.confidence ?? null
  if (base == null) return null
  if (!pricingEdited) return base
  return Math.max(0, Math.min(99, base - 20))
})()

const pdfShowPriceGuard =
  !isUserEdited &&
  (priceGuard?.status === "verified" ||
   priceGuard?.status === "adjusted" ||
   priceGuard?.status === "deterministic")
const pdfEdited = isUserEdited

const pdfPriceGuardLabel =
  priceGuard?.status === "verified" ? "PriceGuard™ Verified" :
  priceGuard?.status === "adjusted" ? "PriceGuard™ Adjusted" :
  priceGuard?.status === "deterministic" ? "PriceGuard™ Deterministic" :
  "PriceGuard™"

function PriceGuardBadge() {
  if (!result) return null // only show after generation

  const pgStatus = priceGuard?.status ?? (priceGuardVerified ? "verified" : "ai")

  const label =
  pricingEdited ? "PriceGuard™ Override" :
  pgStatus === "verified" ? "PriceGuard™ Verified" :
  pgStatus === "adjusted" ? "PriceGuard™ Adjusted" :
  pgStatus === "deterministic" ? "PriceGuard™ Deterministic" :
  pgStatus === "review" ? "Review Recommended" :
  "AI Estimate"

const sub =
  pricingEdited ? "Pricing adjusted manually" :
  pgStatus === "verified" ? "Pricing validated by deterministic safeguards" :
  pgStatus === "adjusted" ? "AI pricing lifted to deterministic safety floors" :
  pgStatus === "deterministic" ? "Deterministic pricing engine applied" :
  pgStatus === "review" ? "Some details were inferred — review recommended" :
  "Pricing relied primarily on AI — add quantities for stronger protection"

  return (
    <span
      style={{ position: "relative", display: "inline-block" }}
      data-priceguard
    >
      <button
        type="button"
        onClick={() => setShowPriceGuardDetails((v) => !v)}
        style={{
          border: "1px solid #e5e7eb",
          background:
  pricingEdited ? "#f3f4f6" :
  pgStatus === "verified" ? "#ecfdf5" :
  pgStatus === "adjusted" ? "#fffbeb" :
  pgStatus === "deterministic" ? "#eef2ff" :
  pgStatus === "review" ? "#fff7ed" :
  "#f3f4f6",
          color: "#111",
          padding: "6px 10px",
          borderRadius: 999,
          fontSize: 12,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
        title={sub}
      >
        
        <span aria-hidden="true">
  {priceGuardVerified ? "✅" : isUserEdited ? "✏️" : pricingSource === "deterministic" ? "🧠" : "ℹ️"}
</span>

        <span style={{ fontWeight: 800 }}>{label}</span>

        {displayedConfidence != null && (
  <span style={{ fontWeight: 700, color: "#444" }}>
    {displayedConfidence}%
  </span>
)}
      </button>

      {showPriceGuardDetails && (
        <div
          style={{
            position: "absolute",
            top: "110%",
            right: 0,
            width: 320,
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 12,
            boxShadow: "0 10px 30px rgba(0,0,0,0.10)",
            zIndex: 999,
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 13 }}>
   PriceGuard™ Verification
</div>
          <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>
            {sub}
          </div>

          <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.5 }}>
  {priceGuardVerified ? (
    <>
      <div>• ✔ Scope quantities verified</div>
      <div>• ✔ Trade minimums applied</div>
      <div>• ✔ Common pricing risks screened</div>
    </>
  ) : (
    <>
      <div>• ℹ️ Pricing generated from the scope provided</div>
      <div>• ✔ Standard checks applied</div>
      <div>• ℹ️ Add more detail (or measurements) for stronger verification</div>
    </>
  )}

  {state ? (
    <div>• ✔ Regional labor rates adjusted ({state})</div>
  ) : (
    <div>• ℹ️ Regional labor rates: national baseline</div>
  )}

  {effectivePaintScope === "doors_only" && (
    <div>• ✔ Doors-only scope detected (includes casing/frames)</div>
  )}

  {isMixedPaintScope && (
    <div>• ✔ Mixed scope detected (rooms + doors)</div>
  )}
</div>

          <div style={{ marginTop: 10, fontSize: 12, color: "#333" }}>
            {effectivePaintScope === "doors_only" && (
              <div style={{ marginTop: 6 }}>
                ⚙️ Doors-only detected — pricing locked to door logic.
              </div>
            )}

            {isMixedPaintScope && (
              <div style={{ marginTop: 6 }}>
                ⚙️ Mixed scope detected — rooms and doors priced separately.
              </div>
            )}

            {isUserEdited ? (
  <div style={{ marginTop: 6 }}>
    ✏️ Pricing was manually edited after generation.
  </div>
) : !priceGuardVerified ? (
  <div style={{ marginTop: 6 }}>
    ℹ️ Tip: add quantities, measurements, and the job state for a more
    precise verified price.
  </div>
) : null}
          </div>

          <button
            type="button"
            onClick={() => setShowPriceGuardDetails(false)}
            style={{
              marginTop: 10,
              fontSize: 12,
              border: "1px solid #e5e7eb",
              padding: "6px 10px",
              borderRadius: 8,
              background: "#fff",
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      )}
    </span>
  )
}

  // -------------------------
  // UI
  // -------------------------
  return (
    <main
      style={{
        maxWidth: 640,
        margin: "60px auto",
        padding: 32,
        fontFamily: "system-ui",
        border: "1px solid #e5e7eb",
        borderRadius: 14,
        background: "#fff",
        boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
      }}
    >
     <h1 style={{ marginBottom: 4 }}>JobEstimate Pro</h1>
<p
  style={{
    marginTop: 0,
    marginBottom: 20,
    fontSize: 15,
    letterSpacing: "0.2px",
    color: "#555",
  }}
>
  Professional change orders & estimates — generated instantly.
</p>

{!paid && (
  <div style={{ marginBottom: 12 }}>
    {remaining > 0 ? (
      <p style={{ fontSize: 13, color: "#666", margin: 0 }}>
        Free uses remaining: <strong>{remaining}</strong> / {FREE_LIMIT}
      </p>
    ) : (
      <p style={{ fontSize: 13, color: "#c53030", margin: 0 }}>
        Free uses are up. Upgrade for unlimited access.
      </p>
    )}
  </div>
)}

      <input
  type="email"
  placeholder="Enter your email to generate documents"
  value={email}
  onChange={(e) => setEmail(e.target.value)}
  onBlur={checkEntitlementNow}
  style={{ width: "100%", padding: 8 }}
/>

<p
  style={{
    fontSize: 12,
    color: "#c53030",
    marginTop: 4,
    marginBottom: 12,
  }}
  title="Email is required to generate documents"
>
  * Required
</p>

      <h3>Company Profile</h3>
      {["name", "address", "phone", "email"].map((f) => (
        <input
          key={f}
          placeholder={f}
          value={(companyProfile as any)[f]}
          onChange={(e) =>
            setCompanyProfile({
              ...companyProfile,
              [f]: e.target.value,
            })
          }
          style={{ width: "100%", padding: 8, marginBottom: 8 }}
        />
      ))}

      <label style={{ fontSize: 13, fontWeight: 600 }}>
  Company Logo (optional)
</label>

<input
  type="file"
  accept="image/*"
  onChange={(e) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onloadend = () => {
      setCompanyProfile((prev) => ({
        ...prev,
        logo: reader.result as string,
      }))
    }
    reader.readAsDataURL(file)
  }}
  style={{ width: "100%", padding: 8, marginBottom: 8 }}
/>

{companyProfile.logo && (
  <img
    src={companyProfile.logo}
    alt="Company logo preview"
    style={{
      maxHeight: 60,
      marginBottom: 12,
      objectFit: "contain",
    }}
  />
)}

<input
  placeholder="Contractor License # (optional)"
  value={(companyProfile as any).license || ""}
  onChange={(e) =>
    setCompanyProfile({
      ...companyProfile,
      license: e.target.value,
    })
  }
  style={{ width: "100%", padding: 8, marginBottom: 8 }}
/>

<textarea
  placeholder="Default payment terms (optional) — shown on PDFs & invoices"
  value={(companyProfile as any).paymentTerms || ""}
  onChange={(e) =>
    setCompanyProfile({
      ...companyProfile,
      paymentTerms: e.target.value,
    })
  }
  style={{ width: "100%", padding: 8, marginBottom: 8, height: 70 }}
/>

      <h3 style={{ marginTop: 18 }}>Job Details</h3>

<input
  placeholder="Client name"
  value={jobDetails.clientName}
  onChange={(e) =>
    setJobDetails({ ...jobDetails, clientName: e.target.value })
  }
  style={{ width: "100%", padding: 8, marginBottom: 8 }}
/>

<input
  placeholder="Job / Project name"
  value={jobDetails.jobName}
  onChange={(e) =>
    setJobDetails({ ...jobDetails, jobName: e.target.value })
  }
  style={{ width: "100%", padding: 8, marginBottom: 8 }}
/>

<input
  placeholder="Job address (optional)"
  value={jobDetails.jobAddress}
  onChange={(e) =>
    setJobDetails({ ...jobDetails, jobAddress: e.target.value })
  }
  style={{ width: "100%", padding: 8, marginBottom: 8 }}
/>

<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
  <input
    placeholder="Change Order # (optional)"
    value={jobDetails.changeOrderNo}
    onChange={(e) =>
      setJobDetails({ ...jobDetails, changeOrderNo: e.target.value })
    }
    style={{ width: "100%", padding: 8 }}
  />
  <input
    type="date"
    value={jobDetails.date}
    onChange={(e) =>
      setJobDetails({ ...jobDetails, date: e.target.value })
    }
    style={{ width: "100%", padding: 8 }}
  />
</div>

<p style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
  Tip: leave the date blank to auto-fill today on the PDF.
</p>

      <p style={{ marginTop: 12, fontWeight: 600 }}>Trade Type</p>
<select
  value={trade}
  onChange={(e) => setTrade(normalizeTrade(e.target.value))}
  style={{ width: "100%", padding: 10, marginTop: 6 }}
>
  <option value="">Auto-detect</option>
  <option value="painting">Painting</option>
  <option value="drywall">Drywall</option>
  <option value="flooring">Flooring</option>
  <option value="electrical">Electrical</option>
  <option value="plumbing">Plumbing</option>
  <option value="bathroom_tile">Bathroom / Tile</option>
  <option value="carpentry">Carpentry</option>
  <option value="general_renovation">General Renovation</option>
</select>

{showPaintScope && (
  <div style={{ marginTop: 12 }}>
    <p style={{ marginTop: 0, fontWeight: 600 }}>
      {effectivePaintScope === "doors_only"
        ? "Paint Scope: Doors only (auto-detected)"
        : "Paint Scope"}
    </p>

    <select
      value={effectivePaintScope === "doors_only" ? "walls" : paintScope}
      disabled={effectivePaintScope === "doors_only"}
      onChange={(e) => setPaintScope(e.target.value as any)}
      style={{
        width: "100%",
        padding: 10,
        marginTop: 6,
        opacity: effectivePaintScope === "doors_only" ? 0.6 : 1,
        cursor: effectivePaintScope === "doors_only" ? "not-allowed" : "pointer",
      }}
    >
      {PAINT_SCOPE_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>

    {effectivePaintScope === "doors_only" ? (
      <p style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
        Scope was automatically detected as doors-only based on your description.
      </p>
    ) : (
      <p style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
        This controls whether ceilings / trim / doors are included.
      </p>
    )}
  </div>
)}


      <p style={{ marginTop: 12, fontWeight: 600 }}>Job State</p>
<select
  value={state}
  onChange={(e) => setState(e.target.value)}
  style={{
    width: "100%",
    padding: 10,
    marginTop: 6,
    borderRadius: 6,
    border: "1px solid #ccc",
  }}
>
  <option value="">Select state</option>
  <option value="AL">Alabama</option>
  <option value="AK">Alaska</option>
  <option value="AZ">Arizona</option>
  <option value="AR">Arkansas</option>
  <option value="CA">California</option>
  <option value="CO">Colorado</option>
  <option value="CT">Connecticut</option>
  <option value="DE">Delaware</option>
  <option value="FL">Florida</option>
  <option value="GA">Georgia</option>
  <option value="HI">Hawaii</option>
  <option value="ID">Idaho</option>
  <option value="IL">Illinois</option>
  <option value="IN">Indiana</option>
  <option value="IA">Iowa</option>
  <option value="KS">Kansas</option>
  <option value="KY">Kentucky</option>
  <option value="LA">Louisiana</option>
  <option value="ME">Maine</option>
  <option value="MD">Maryland</option>
  <option value="MA">Massachusetts</option>
  <option value="MI">Michigan</option>
  <option value="MN">Minnesota</option>
  <option value="MS">Mississippi</option>
  <option value="MO">Missouri</option>
  <option value="MT">Montana</option>
  <option value="NE">Nebraska</option>
  <option value="NV">Nevada</option>
  <option value="NH">New Hampshire</option>
  <option value="NJ">New Jersey</option>
  <option value="NM">New Mexico</option>
  <option value="NY">New York</option>
  <option value="NC">North Carolina</option>
  <option value="ND">North Dakota</option>
  <option value="OH">Ohio</option>
  <option value="OK">Oklahoma</option>
  <option value="OR">Oregon</option>
  <option value="PA">Pennsylvania</option>
  <option value="RI">Rhode Island</option>
  <option value="SC">South Carolina</option>
  <option value="SD">South Dakota</option>
  <option value="TN">Tennessee</option>
  <option value="TX">Texas</option>
  <option value="UT">Utah</option>
  <option value="VT">Vermont</option>
  <option value="VA">Virginia</option>
  <option value="WA">Washington</option>
  <option value="WV">West Virginia</option>
  <option value="WI">Wisconsin</option>
  <option value="WY">Wyoming</option>
  <option value="DC">District of Columbia</option>
</select>

{/* -------------------------
    Invoices
------------------------- */}
{invoices.length > 0 && (
  <div
    style={{
      marginTop: 18,
      padding: 12,
      border: "1px solid #e5e7eb",
      borderRadius: 10,
      background: "#fff",
    }}
  >
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <h3 style={{ margin: 0 }}>Invoices</h3>
      <button
        type="button"
        onClick={() => setInvoices([])}
        style={{ fontSize: 12 }}
      >
        Clear all
      </button>
    </div>

    <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
      {invoices.map((inv) => (
        <div
          key={inv.id}
          style={{
            padding: 10,
            border: "1px solid #eee",
            borderRadius: 10,
            background: "#fafafa",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <div>
              <div style={{ fontWeight: 700 }}>{inv.invoiceNo}</div>
              <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>
                {inv.billToName} • Due {new Date(inv.dueDate).toLocaleDateString()}
              </div>
              <div style={{ fontSize: 12, color: "#333", marginTop: 6 }}>
                Total Due: <strong>${Number(inv.total || 0).toLocaleString()}</strong>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <button type="button" onClick={() => downloadInvoicePDF(inv)}>
                Download Invoice PDF
              </button>

              <button
                type="button"
                onClick={() =>
                  setInvoices((prev) => prev.filter((x) => x.id !== inv.id))
                }
                style={{ fontSize: 12 }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ))}
     </div>
  </div>
)}

      <textarea
        placeholder="Describe the scope change…"
        value={scopeChange}
        onChange={(e) => setScopeChange(e.target.value)}
        style={{ width: "100%", height: 120, marginTop: 12 }}
      />

      <div
  style={{
    marginTop: 16,
    padding: 12,
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    overflow: "visible",   // ✅ THIS LINE FIXES IT
  }}
>
  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <input
      type="checkbox"
      checked={measureEnabled}
      onChange={(e) => setMeasureEnabled(e.target.checked)}
    />
    <span style={{ fontWeight: 600 }}>Optional Measurements</span>
    <span style={{ fontSize: 12, color: "#666" }}>(helps pricing + detail)</span>
  </label>

  {measureEnabled && (
  <div
  style={{
    marginTop: 12,
    overflowX: "auto",
    overflowY: "visible",
    padding: 4,
  }}
>
      {measureRows.map((r, idx) => (
        <div
  key={idx}
  style={{
    display: "grid",
    gridTemplateColumns:
      "minmax(120px,1.2fr) minmax(90px,1fr) minmax(90px,1fr) minmax(70px,0.8fr) minmax(80px,auto)",
    gap: 10,           // ⬅️ slightly larger gap
    alignItems: "center",
    marginBottom: 12,
  }}
>
          <input
            value={r.label}
            onChange={(e) => {
              const next = [...measureRows]
              next[idx] = { ...next[idx], label: e.target.value }
              setMeasureRows(next)
            }}
            placeholder="Label (e.g., Wall A)"
            style={{ padding: 8, outlineOffset: 2 }}
          />

          <input
            type="number"
            value={r.lengthFt === 0 ? "" : r.lengthFt}
            onChange={(e) => {
              const val = e.target.value === "" ? 0 : Number(e.target.value)
              const next = [...measureRows]
              next[idx] = { ...next[idx], lengthFt: val }
              setMeasureRows(next)
            }}
            placeholder="Length (ft)"
            style={{ padding: 8, outlineOffset: 2 }}
          />

          <input
            type="number"
            value={r.heightFt === 0 ? "" : r.heightFt}
            onChange={(e) => {
              const val = e.target.value === "" ? 0 : Number(e.target.value)
              const next = [...measureRows]
              next[idx] = { ...next[idx], heightFt: val }
              setMeasureRows(next)
            }}
            placeholder="Height (ft)"
            style={{ padding: 8, outlineOffset: 2 }}
          />

          <input
            type="number"
            value={r.qty}
            min={1}
            onChange={(e) => {
              const val = e.target.value === "" ? 1 : Number(e.target.value)
              const next = [...measureRows]
              next[idx] = { ...next[idx], qty: Math.max(1, val) }
              setMeasureRows(next)
            }}
            placeholder="Qty"
            style={{ padding: 8, outlineOffset: 2 }}
          />

          <div style={{ fontSize: 13, color: "#333", textAlign: "right" }}>
            <strong>{rowSqft(r)}</strong> sqft
          </div>

          <div
            style={{
              gridColumn: "1 / -1",
              display: "flex",
              justifyContent: "flex-end",
            }}
          >
            {measureRows.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  const next = measureRows.filter((_, i) => i !== idx)
                  setMeasureRows(next)
                }}
                style={{ fontSize: 12 }}
              >
                Remove
              </button>
            )}
          </div>
        </div>
      ))}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 8,
        }}
      >
        <button
          type="button"
          onClick={() =>
            setMeasureRows((rows) => [
              ...rows,
              {
                label: `Area ${rows.length + 1}`,
                lengthFt: 0,
                heightFt: 0,
                qty: 1,
              },
            ])
          }
        >
          + Add another area
        </button>

        <div style={{ fontSize: 13 }}>
          Total: <strong>{totalSqft}</strong> sqft
        </div>
      </div>
    </div>
  )}
</div>

      <button
  type="button"
  onClick={generate}
  disabled={loading}
  style={{
    width: "100%",
    padding: 12,
    marginTop: 12,
    fontSize: 16,
    background: loading ? "#555" : "#000",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    cursor: loading ? "not-allowed" : "pointer",
  }}
>
  {loading ? "Generating…" : "Generate"}
</button>
{status && (
  <p style={{ marginTop: 10, fontSize: 13, color: "#c53030" }}>
    {status}
  </p>
)}

{loading && (
  <p style={{ fontSize: 13, color: "#666", marginTop: 8 }}>
    Generating professional document…
  </p>
)}

{/* -------------------------
    Saved History
------------------------- */}
{history.length > 0 && (
  <div
    style={{
      marginTop: 18,
      padding: 12,
      border: "1px solid #e5e7eb",
      borderRadius: 10,
      background: "#fff",
    }}
  >
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <h3 style={{ margin: 0 }}>Saved Estimates</h3>
      <button type="button" onClick={clearHistory} style={{ fontSize: 12 }}>
        Clear all
      </button>
    </div>

    <p style={{ marginTop: 6, marginBottom: 10, fontSize: 12, color: "#666" }}>
      Click “Load” to restore an estimate and download the PDF again.
    </p>

    <div style={{ display: "grid", gap: 10 }}>
      {history.map((h) => (
        <div
          key={h.id}
          style={{
            padding: 10,
            border: "1px solid #eee",
            borderRadius: 10,
            background: "#fafafa",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <div>
              <div style={{ fontWeight: 700 }}>
                {h.jobDetails.jobName || "Untitled Job"}
              </div>
             <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>
  {h.jobDetails.clientName ? `Client: ${h.jobDetails.clientName} • ` : ""}
  {h.documentType} • {new Date(h.createdAt).toLocaleString()}
</div>
              <div style={{ fontSize: 12, color: "#333", marginTop: 6 }}>
                Total: <strong>${Number(h.pricing.total || 0).toLocaleString()}</strong>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <button type="button" onClick={() => loadHistoryItem(h)}>
                Load
              </button>

              <button
                type="button"
                onClick={() => createInvoiceFromEstimate(h)}
                style={{ fontSize: 12 }}
              >
                Create Invoice
              </button>
              
              <button
                type="button"
                onClick={() => deleteHistoryItem(h.id)}
                style={{ fontSize: 12 }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
)}

{result && (
  <div
    style={{
      marginTop: 24,
      padding: 16,
      background: "#f5f5f5",
      borderRadius: 8,
      whiteSpace: "pre-wrap",
      lineHeight: 1.6,
      fontSize: 15,
    }}
  >
    <h3 style={{ marginBottom: 8 }}>
      Generated {documentType}
    </h3>

    <p
  style={{
    fontSize: 13,
    color: "#666",
    marginBottom: 12,
  }}
>
  Generated from the scope provided.
</p>

    <p>{result}</p>
  </div>
)}

      {!paid && (showUpgrade || remaining <= 0) && (
  <button
    type="button"
    onClick={upgrade}
    style={{ width: "100%", marginTop: 12 }}
  >
    Upgrade for Unlimited Access
  </button>
)}

      {result && (
  <>
    <h3
  style={{
    marginTop: 24,
    display: "flex",
    alignItems: "center",
    gap: 8,
  }}
>
    Pricing (Adjustable)

  {pdfShowPriceGuard && !isUserEdited && (
  <div
    style={{
      padding: "4px 8px",
      fontSize: 12,
      borderRadius: 999,
      background: "#ecfdf5",
      border: "1px solid #a7f3d0",
      color: "#065f46",
      fontWeight: 700,
      lineHeight: 1,
    }}
  >
    {pdfPriceGuardLabel}
  </div>
)}
</h3>

<p style={{ marginTop: -6, marginBottom: 10, fontSize: 12, color: "#666" }}>
  Adjust as needed for site conditions, selections, or confirmed measurements.
</p>

    <label>
      Labor
      <input
  type="number"
  value={pricing.labor === 0 ? "" : pricing.labor}
  onChange={(e) => {
    const val = e.target.value
    setPricing({
      ...pricing,
      labor: val === "" ? 0 : Number(val),
    })
    setPricingEdited(true)
  }}
  style={{ width: "100%", padding: 8, marginBottom: 8 }}
/>
    </label>

    <label>
      Materials
      <input
  type="number"
  value={pricing.materials === 0 ? "" : pricing.materials}
  onChange={(e) => {
    const val = e.target.value
    setPricing({
      ...pricing,
      materials: val === "" ? 0 : Number(val),
    })
    setPricingEdited(true)
  }}
  style={{ width: "100%", padding: 8, marginBottom: 8 }}
/>
    </label>

    <label>
      Other / Mobilization
      <input
  type="number"
  value={pricing.subs === 0 ? "" : pricing.subs}
  onChange={(e) => {
    const val = e.target.value
    setPricing({
      ...pricing,
      subs: val === "" ? 0 : Number(val),
    })
    setPricingEdited(true)
  }}
  style={{ width: "100%", padding: 8, marginBottom: 8 }}
/>
    </label>

    <label>
      Markup (%)
      <input
  type="number"
  value={pricing.markup === 0 ? "" : pricing.markup}
  onChange={(e) => {
    const val = e.target.value
    setPricing({
      ...pricing,
      markup: val === "" ? 0 : Number(val),
    })
    setPricingEdited(true)
  }}
  style={{ width: "100%", padding: 8, marginBottom: 8 }}
/>
    </label>

    <div
  style={{
    marginTop: 12,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
  }}
>

{/* -------------------------
    Deposit (optional)
------------------------- */}
<div
  style={{
    marginTop: 12,
    padding: 12,
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    background: "#fff",
  }}
>
  <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
    <input
      type="checkbox"
      checked={depositEnabled}
      onChange={(e) => setDepositEnabled(e.target.checked)}
    />
    <span style={{ fontWeight: 800 }}>Require deposit</span>
    <span style={{ fontSize: 12, color: "#666" }}>
      (shows on PDF + invoices)
    </span>
  </label>

  {depositEnabled && (
    <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 10 }}>
        <select
          value={depositType}
          onChange={(e) => setDepositType(e.target.value as any)}
          style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
        >
          <option value="percent">Percent (%)</option>
          <option value="fixed">Fixed ($)</option>
        </select>

        <input
          type="number"
          value={depositValue === 0 ? "" : depositValue}
          onChange={(e) => setDepositValue(e.target.value === "" ? 0 : Number(e.target.value))}
          placeholder={depositType === "percent" ? "e.g., 25" : "e.g., 500"}
          style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
        />
      </div>

      <div style={{ fontSize: 13, color: "#333", display: "grid", gap: 4 }}>
        <div>
          Deposit Due Now: <strong>${Number(depositDue || 0).toLocaleString()}</strong>
        </div>
        <div>
          Remaining Balance: <strong>${Number(remainingBalance || 0).toLocaleString()}</strong>
        </div>
      </div>
    </div>
  )}
</div>

  <div style={{ fontSize: 16, fontWeight: 800 }}>
    Total: ${Number(pricing.total || 0).toLocaleString()}
  </div>

  <PriceGuardBadge />
</div>

    <button onClick={downloadPDF} style={{ marginTop: 8 }}>
      Download PDF
    </button>
  </>
)}

      <p style={{ marginTop: 40, fontSize: 12, color: "#888", textAlign: "center" }}>
        Secure payments powered by Stripe.
      </p>
    </main>
  )
}