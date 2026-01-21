"use client"

import { useEffect, useState } from "react"

export default function Home() {
  const FREE_LIMIT = 3

  // -------------------------
  // Email (required for entitlement)
  // -------------------------
  const [email, setEmail] = useState("")
  const [paid, setPaid] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem("scopeguard_email")
    if (saved) setEmail(saved)
  }, [])

  useEffect(() => {
    if (email) {
      localStorage.setItem("scopeguard_email", email)
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
    const saved = localStorage.getItem("scopeguard_company")
    if (saved) setCompanyProfile(JSON.parse(saved))
  }, [])

  useEffect(() => {
    localStorage.setItem(
      "scopeguard_company",
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

  const [count, setCount] = useState(0)
  const [status, setStatus] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setCount(Number(localStorage.getItem("changeOrderCount") || "0"))
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

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scopeChange,
        trade,
        state,
      }),
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
        "changeOrderCount",
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
    setStatus("Redirecting to secure checkout…")
    const res = await fetch("/api/checkout", { method: "POST" })
    const data = await res.json()
    if (data.url) window.location.href = data.url
    else setStatus("Checkout error.")
  }

  // -------------------------
  // PDF generation
  // -------------------------
  function downloadPDF() {
    const win = window.open("", "", "width=800,height=1000")
    if (!win) return

    win.document.write(`
      <html>
        <head>
          <title>Change Order / Estimate</title>
          <style>
            body { font-family: system-ui; padding: 40px; }
            h1 { margin-bottom: 4px; }
            .muted { color: #666; font-size: 14px; }
            hr { margin: 24px 0; }
            .pricing p { margin: 6px 0; }
            .sign { margin-top: 60px; display: flex; justify-content: space-between; }
            .line { border-top: 1px solid #000; width: 240px; margin-top: 40px; }
          </style>
        </head>
        <body>
          <h1>${companyProfile.name}</h1>
          <div class="muted">
            ${companyProfile.address}<br/>
            ${companyProfile.phone} · ${companyProfile.email}
          </div>

          <hr/>

          <h2>Change Order / Estimate</h2>
          <p>${result}</p>

          <hr/>

          <div class="pricing">
            <p>Labor: $${pricing.labor}</p>
            <p>Materials: $${pricing.materials}</p>
            <p>Subcontractors: $${pricing.subs}</p>
            <p>Markup: ${pricing.markup}%</p>
            <strong>Total: $${pricing.total}</strong>
          </div>

          <div class="sign">
            <div>
              <div class="line"></div>
              Contractor Signature
            </div>
            <div>
              <div class="line"></div>
              Client Signature
            </div>
          </div>
        </body>
      </html>
    `)

    win.document.close()
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
     <h1 style={{ marginBottom: 4 }}>ScopeGuard</h1>
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
    color: "#666",
    marginTop: 4,
    marginBottom: 12,
  }}
>
  Required to generate a change order or estimate.
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
    <h3 style={{ marginTop: 24 }}>Pricing (Editable)</h3>

    <label>
      Labor
      <input
        type="number"
        value={pricing.labor}
        onChange={(e) =>
          setPricing({ ...pricing, labor: Number(e.target.value) })
        }
        style={{ width: "100%", padding: 8, marginBottom: 8 }}
      />
    </label>

    <label>
      Materials
      <input
        type="number"
        value={pricing.materials}
        onChange={(e) =>
          setPricing({ ...pricing, materials: Number(e.target.value) })
        }
        style={{ width: "100%", padding: 8, marginBottom: 8 }}
      />
    </label>

    <label>
      Subcontractors
      <input
        type="number"
        value={pricing.subs}
        onChange={(e) =>
          setPricing({ ...pricing, subs: Number(e.target.value) })
        }
        style={{ width: "100%", padding: 8, marginBottom: 8 }}
      />
    </label>

    <label>
      Markup (%)
      <input
        type="number"
        value={pricing.markup}
        onChange={(e) =>
          setPricing({ ...pricing, markup: Number(e.target.value) })
        }
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