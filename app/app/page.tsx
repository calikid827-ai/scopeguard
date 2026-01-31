"use client"

import { useEffect, useRef, useState } from "react"

export default function Home() {
  const FREE_LIMIT = 3
  const generatingRef = useRef(false)
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
  pricingAdjusted?: boolean
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

type EstimateHistoryItem = {
  id: string
  createdAt: number
  // job context snapshot
  jobDetails: {
    clientName: string
    jobName: string
    changeOrderNo: string
    jobAddress: string
    date: string
  }
  trade: string
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
  pricingAdjusted: boolean
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
  if (email) {
    localStorage.setItem(EMAIL_KEY, email)
  } else {
    localStorage.removeItem(EMAIL_KEY)
  }
}, [email])

  async function checkEntitlementNow() {
  const e = email.trim().toLowerCase()
  if (!e) return

  const res = await fetch("/api/entitlement", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: e }),
  })

  if (!res.ok) {
    setPaid(false)
    setRemaining(FREE_LIMIT)   // optional fallback
    setShowUpgrade(false)      // optional fallback
    return
  }

  const data = await res.json()

  const entitled = data?.entitled === true
  setPaid(entitled)

  const used = typeof data?.usage_count === "number" ? data.usage_count : 0
  const limit = typeof data?.free_limit === "number" ? data.free_limit : FREE_LIMIT

  if (!entitled) {
  const remainingNow = Math.max(0, limit - used)
  setRemaining(remainingNow)
  setShowUpgrade(remainingNow <= 0)
} else {
  setRemaining(FREE_LIMIT) // optional
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
  })

  useEffect(() => {
  const old = localStorage.getItem("scopeguard_company")
  if (old) {
    localStorage.setItem(COMPANY_KEY, old)
    localStorage.removeItem("scopeguard_company")
    setCompanyProfile(JSON.parse(old))
    return
  }

  const saved = localStorage.getItem(COMPANY_KEY)
  if (saved) setCompanyProfile(JSON.parse(saved))
}, [])

  useEffect(() => {
  localStorage.setItem(COMPANY_KEY,JSON.stringify(companyProfile))
}, [companyProfile])
  useEffect(() => {
  const saved = localStorage.getItem(JOB_KEY)
  if (saved) setJobDetails(JSON.parse(saved))
}, [])

useEffect(() => {
  localStorage.setItem(JOB_KEY, JSON.stringify(jobDetails))
}, [jobDetails])

useEffect(() => {
  const saved = localStorage.getItem(HISTORY_KEY)
  if (saved) {
    try {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed)) setHistory(parsed)
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
  const [trade, setTrade] = useState("")
  const [state, setState] = useState("")
  const [pricing, setPricing] = useState({
    labor: 0,
    materials: 0,
    subs: 0,
    markup: 20,
    total: 0,
  })
  
  const [pricingAdjusted, setPricingAdjusted] = useState(false)
  const [status, setStatus] = useState("")
  const [loading, setLoading] = useState(false)

  const [invoices, setInvoices] = useState<Invoice[]>([])

  useEffect(() => {
  const saved = localStorage.getItem(INVOICE_KEY)
  if (!saved) return

  try {
    const parsed = JSON.parse(saved)
    if (Array.isArray(parsed)) setInvoices(parsed)
  } catch (err) {
    // ignore bad data
  }
}, [])

useEffect(() => {
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
  setPricingAdjusted(false)

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: e,
        scopeChange,
        trade,
        state,
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

const nextResult = data.text || data.description || ""
const nextPricing = data.pricing ? data.pricing : pricing
const nextTrade = (!trade && data.trade) ? data.trade : trade

setResult(nextResult)
setPricing(nextPricing)
if (!trade && data.trade) setTrade(data.trade)

saveToHistory({
  id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
  createdAt: Date.now(),
  jobDetails: { ...jobDetails },
  trade: nextTrade || "",
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
  pricingAdjusted,
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

function persistHistory(next: EstimateHistoryItem[]) {
  setHistory(next)
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
}

function saveToHistory(item: EstimateHistoryItem) {
  // newest first, keep last 25 (you can change this)
  const next = [item, ...history].slice(0, 25)
  persistHistory(next)
}

function deleteHistoryItem(id: string) {
  const next = history.filter((h) => h.id !== id)
  persistHistory(next)
}

function clearHistory() {
  persistHistory([])
}

function loadHistoryItem(item: EstimateHistoryItem) {
  // restore form + outputs
  setJobDetails(item.jobDetails)
  setTrade(item.trade || "")
  setState(item.state || "")
  setScopeChange(item.scopeChange || "")

  setResult(item.result || "")
  setPricing(item.pricing)
  setPricingAdjusted(item.pricingAdjusted)

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
    const clientName = jobDetails.clientName?.trim() || ""
    const jobName = jobDetails.jobName?.trim() || ""
    const jobAddress = jobDetails.jobAddress?.trim() || ""
    const changeOrderNo = jobDetails.changeOrderNo?.trim() || ""

    const win = window.open("", "", "width=900,height=1100")
    if (!win) {
      setStatus("Pop-up blocked. Please allow pop-ups to download the PDF.")
      return
    }

    // Basic HTML escaping to prevent broken PDFs if user types special chars
    const esc = (s: string) =>
      s
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;")

    const safeResult = esc(result)

    win.document.write(`
      <html>
        <head>
          <title>${esc(brandName)} — ${esc(jobName || "Change Order / Estimate")}</title>
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
              <div style="font-weight:700; font-size:16px; color:#111;">${esc(companyName)}</div>
              ${companyAddress ? `<div>${esc(companyAddress)}</div>` : ""}
              ${companyPhone ? `<div>${esc(companyPhone)}</div>` : ""}
              ${companyEmail ? `<div>${esc(companyEmail)}</div>` : ""}
            </div>
          </div>

          <h1>Change Order / Estimate
  ${pricingAdjusted ? `<span class="badge">Pricing adjusted</span>` : ""}
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
            </table>
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
      Payment terms: <strong>Due upon approval.</strong>
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

  const esc = (s: string) =>
    (s || "")
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
  due.setDate(due.getDate() + 7) // default: 7 days

  const client = est?.jobDetails?.clientName || jobDetails.clientName || "Client"
  const jobNm = est?.jobDetails?.jobName || jobDetails.jobName || "Job"
  const jobAddr = est?.jobDetails?.jobAddress || jobDetails.jobAddress || ""

  const labor = Number(est?.pricing?.labor || 0)
  const materials = Number(est?.pricing?.materials || 0)
  const subs = Number(est?.pricing?.subs || 0)
  const total = Number(est?.pricing?.total || 0)

  const lineItems: { label: string; amount: number }[] = []
  if (labor) lineItems.push({ label: "Labor", amount: labor })
  if (materials) lineItems.push({ label: "Materials", amount: materials })
  if (subs) lineItems.push({ label: "Other / Mobilization", amount: subs })

  const subtotal = labor + materials + subs

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
    subtotal,
    total: total || subtotal, // if your estimate total exists, use it
    notes: "Payment terms: Due upon approval.",
  }

  setInvoices((prev) => [inv, ...prev])
  setStatus(`Invoice created: ${inv.invoiceNo}`)
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
  placeholder="Email used at checkout"
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
  onChange={(e) => setTrade(e.target.value)}
  style={{ width: "100%", padding: 10, marginTop: 6 }}
>
  <option value="">Auto-detect</option>
  <option value="painting">Painting</option>
  <option value="flooring">Flooring</option>
  <option value="electrical">Electrical</option>
  <option value="plumbing">Plumbing</option>
  <option value="tile">Tile / Bathroom</option>
  <option value="carpentry">Carpentry</option>
  <option value="general renovation">General Renovation</option>
</select>

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
  disabled={loading || !scopeChange.trim()}
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
  {loading ? "Generating…" : "Generate Change Order / Estimate"}
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
                {new Date(h.createdAt).toLocaleString()}
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

    <h3 style={{ marginBottom: 8 }}>
      Generated Change Order / Estimate
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
  Pricing (Editable)

  {pricingAdjusted && (
    <div
      style={{
        padding: "4px 8px",
        fontSize: 12,
        borderRadius: 6,
        background: "#edf2f7",
        color: "#4a5568",
      }}
    >
      Adjusted
    </div>
  )}
</h3>

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
    setPricingAdjusted(true)
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
    setPricingAdjusted(true)
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
    setPricingAdjusted(true)
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
    setPricingAdjusted(true)
  }}
  style={{ width: "100%", padding: 8, marginBottom: 8 }}
/>
    </label>

    <p style={{ marginTop: 12 }}>
      <strong>Total: ${pricing.total}</strong>
    </p>

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