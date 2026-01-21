"use client"

import { useEffect, useState } from "react"

export default function Home() {
  const FREE_LIMIT = 3

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
  const [pricing, setPricing] = useState({
    labor: 0,
    materials: 0,
    subs: 0,
    markup: 20,
    total: 0,
  })

  const [count, setCount] = useState(0)
  const [paid, setPaid] = useState(false)
  const [status, setStatus] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setCount(Number(localStorage.getItem("changeOrderCount") || "0"))

    if (localStorage.getItem("scopeguard_paid") === "true") {
      setPaid(true)
    }

    if (window.location.search.includes("paid=true")) {
      localStorage.setItem("scopeguard_paid", "true")
      setPaid(true)
      window.history.replaceState({}, "", "/")
    }
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
  // Generate AI change order
  // -------------------------
  async function generate() {
    if (locked) {
      setStatus("Free limit reached. Please upgrade.")
      return
    }

    setLoading(true)
    setStatus("Generating professional change order…")
    setResult("")

    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scopeChange }),
    })

    if (!res.ok) {
      setStatus("Error generating change order.")
      setLoading(false)
      return
    }

    const data = await res.json()
    setResult(data.text)
if (data.pricing) setPricing(data.pricing)
if (data.trade) setTrade(data.trade)

    setLoading(false)
    setStatus("")

    if (!paid) {
      const newCount = count + 1
      localStorage.setItem(
        "changeOrderCount",
        newCount.toString()
      )
      setCount(newCount)
    }
  }

  // -------------------------
  // Stripe upgrade
  // -------------------------
  async function upgrade() {
    setStatus("Redirecting to secure checkout…")
    const res = await fetch("/api/checkout", {
      method: "POST",
    })
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
          <title>Change Order</title>
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

          <h2>Change Order</h2>
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
        fontFamily:
          "system-ui, -apple-system, BlinkMacSystemFont",
        border: "1px solid #e5e7eb",
        borderRadius: 14,
        background: "#ffffff",
        boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
      }}
    >
      <h1>ScopeGuard</h1>

      {!paid && (
        <p>
          Free uses remaining: <strong>{remaining}</strong>
        </p>
      )}

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
          style={{
            width: "100%",
            padding: 8,
            marginBottom: 8,
          }}
        />
      ))}

      <textarea
        placeholder="Describe the scope change…"
        value={scopeChange}
        onChange={(e) => setScopeChange(e.target.value)}
        style={{
          width: "100%",
          height: 120,
          marginTop: 8,
        }}
      />

      <button
        onClick={generate}
        disabled={locked || loading || !scopeChange.trim()}
        style={{
          width: "100%",
          padding: "12px 16px",
          marginTop: 12,
          fontSize: 16,
          background: locked ? "#ccc" : "#000",
          color: "#fff",
          border: "none",
          borderRadius: 8,
          cursor: locked ? "not-allowed" : "pointer",
        }}
      >
        {loading
          ? "Generating…"
          : "Generate Professional Change Order"}
      </button>
      {trade && (
  <p
    style={{
      color: "#555",
      marginTop: 12,
      fontSize: 14,
    }}
  >
    Detected Trade: <strong>{trade}</strong>
  </p>
)}

      {status && (
        <p style={{ marginTop: 12, color: "#555" }}>
          {status}
        </p>
      )}

      {locked && (
        <button
          onClick={upgrade}
          style={{
            width: "100%",
            marginTop: 12,
            padding: 12,
          }}
        >
          Upgrade for Unlimited Access
        </button>
      )}

      {result && (
        <>
          <h3 style={{ marginTop: 24 }}>
            Pricing (Editable)
          </h3>

          {["labor", "materials", "subs", "markup"].map(
            (k) => (
              <label
                key={k}
                style={{ display: "block", marginBottom: 8 }}
              >
                {k.charAt(0).toUpperCase() + k.slice(1)}
                <input
                  type="number"
                  value={(pricing as any)[k]}
                  onChange={(e) =>
                    setPricing({
                      ...pricing,
                      [k]: Number(e.target.value),
                    })
                  }
                  style={{
                    width: "100%",
                    padding: 8,
                  }}
                />
              </label>
            )
          )}

          <p>
            <strong>Total: ${pricing.total}</strong>
          </p>

          <button onClick={downloadPDF}>
            Download PDF
          </button>
        </>
      )}

      <p
        style={{
          marginTop: 40,
          fontSize: 12,
          color: "#888",
          textAlign: "center",
        }}
      >
        Secure payments powered by Stripe.
      </p>
    </main>
  )
}