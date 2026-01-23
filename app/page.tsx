"use client"

import { useEffect, useState } from "react"

export default function Home() {
  const FREE_LIMIT = 3

  // -------------------------
// Email (required for entitlement)
// -------------------------
const [email, setEmail] = useState("")
const [paid, setPaid] = useState(false)

const EMAIL_KEY = "jobestimatepro_email"
const COMPANY_KEY = "jobestimatepro_company"
const USAGE_KEY = "jobestimatepro_usage_count"

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

  useEffect(() => {
  if (!email) return

  async function checkEntitlement() {
    try {
      const res = await fetch("/api/entitlement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })

      if (!res.ok) {
        console.warn("Entitlement API returned", res.status)
        return
      }

      const data = await res.json()
      setPaid(data?.entitled === true)
    } catch (err) {
      console.warn("Entitlement check failed (local dev)", err)
    }
  }

  checkEntitlement()
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
  localStorage.setItem(
    COMPANY_KEY,
    JSON.stringify(companyProfile)
  )
}, [companyProfile])

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

  const [count, setCount] = useState(0)
  const [status, setStatus] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
  const old = localStorage.getItem("changeOrderCount")
  if (old) {
    localStorage.setItem(USAGE_KEY, old)
    localStorage.removeItem("changeOrderCount")
    setCount(Number(old))
    return
  }

  setCount(Number(localStorage.getItem(USAGE_KEY) || "0"))
}, [])

  const locked = !paid && count >= FREE_LIMIT
  const remaining = Math.max(0, FREE_LIMIT - count)

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
  console.log("🔥 Generate button clicked")

  if (!email) {
    setStatus("Please enter the email used at checkout.")
    return
  }

  if (locked) {
    setStatus("Free limit reached. Please upgrade.")
    return
  }

  setLoading(true)
  setStatus("Generating professional document…")
  setResult("")
  setPricingAdjusted(false)

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
  email,
  scopeChange,
  trade,
  state,
})
    })

    if (!res.ok) {
      throw new Error("API error")
    }

    const data = await res.json()

    setResult(data.text || data.description || "")
    if (data.pricing) setPricing(data.pricing)
    if (!trade && data.trade) setTrade(data.trade)

    if (!paid) {
      const newCount = count + 1
      localStorage.setItem(
  USAGE_KEY,
  newCount.toString()
)
      setCount(newCount)
    }

    setStatus("")
  } catch (err) {
    console.error(err)
    setStatus("Error generating document.")
  } finally {
    setLoading(false)
  }
}

  // -------------------------
  // Stripe upgrade
  // -------------------------
  async function upgrade() {
  try {
    setStatus("Redirecting to secure checkout…")

    const res = await fetch("/api/checkout", {
      method: "POST",
    })

    if (!res.ok) {
      throw new Error("Checkout request failed")
    }

    const data = await res.json()

    if (!data?.url) {
      throw new Error("No checkout URL returned")
    }

    // 🔑 Force full-page navigation (bypasses React state re-renders)
    window.location.assign(data.url)
  } catch (err) {
    console.error(err)
    setStatus("Checkout error.")
  }
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
    const companyName = companyProfile.name?.trim() || brandName
    const companyAddress = companyProfile.address?.trim() || ""
    const companyPhone = companyProfile.phone?.trim() || ""
    const companyEmail = companyProfile.email?.trim() || ""

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
          <title>${esc(brandName)} — Change Order / Estimate</title>
          <meta charset="utf-8" />
          <style>
            @page { margin: 28mm 20mm; }
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
              font-size: 18px;
              font-weight: 800;
              letter-spacing: 0.2px;
            }
            .brandTag {
              margin-top: 4px;
              font-size: 12px;
              color: #444;
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
            .footer {
              margin-top: 26px;
              padding-top: 10px;
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
              <div style="font-weight:700; font-size:13px;">${esc(companyName)}</div>
              ${companyAddress ? `<div>${esc(companyAddress)}</div>` : ""}
              ${companyPhone ? `<div>${esc(companyPhone)}</div>` : ""}
              ${companyEmail ? `<div>${esc(companyEmail)}</div>` : ""}
            </div>
          </div>

          <h1>Change Order / Estimate
            ${pricingAdjusted ? `<span class="badge">Pricing adjusted</span>` : ""}
          </h1>
          <div class="muted">Generated by ${esc(brandName)}</div>

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
              <tr><td>Subcontractors</td><td style="text-align:right;">$${Number(pricing.subs || 0).toLocaleString()}</td></tr>
              <tr><td>Markup</td><td style="text-align:right;">${Number(pricing.markup || 0)}%</td></tr>
              <tr class="totalRow"><td>Total</td><td style="text-align:right;">$${Number(pricing.total || 0).toLocaleString()}</td></tr>
            </table>
          </div>

          <div class="sign">
            <div class="sigBlock">
              <div class="line"></div>
              <div class="sigLabel">Contractor Signature</div>
            </div>
            <div class="sigBlock">
              <div class="line"></div>
              <div class="sigLabel">Client Signature</div>
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
        <p>
          Free uses remaining: <strong>{remaining}</strong>
        </p>
      )}

      <input
  type="email"
  placeholder="Email used at checkout"
  value={email}
  onChange={(e) => setEmail(e.target.value)}
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

      <textarea
        placeholder="Describe the scope change…"
        value={scopeChange}
        onChange={(e) => setScopeChange(e.target.value)}
        style={{ width: "100%", height: 120, marginTop: 12 }}
      />

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
      This description is generated based on the scope provided and may be
      used as an estimate or a change order depending on contract status.
    </p>

    <p>{result}</p>
  </div>
)}

      {locked && (
        <button
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
      Subcontractors
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