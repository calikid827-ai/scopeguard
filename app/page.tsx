"use client"

import Link from "next/link"

export default function HomePage() {
  return (
    <main
      style={{
        maxWidth: 980,
        margin: "70px auto",
        padding: "0 22px 80px",
        fontFamily:
          'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji"',
        color: "#0b0b0b",
      }}
    >
      {/* TOP BAR */}
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 0 26px",
        }}
      >
        <div style={{ fontWeight: 900, letterSpacing: "-0.3px" }}>
          JobEstimate <span style={{ color: "#111" }}>Pro</span>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#666" }}>
            Built for real contractors
          </span>
          <Link href="/app">
            <button
              style={{
                padding: "10px 14px",
                fontSize: 14,
                background: "#111",
                color: "#fff",
                border: "none",
                borderRadius: 10,
                cursor: "pointer",
                fontWeight: 700,
              }}
            >
              Open App
            </button>
          </Link>
        </div>
      </header>

      {/* HERO */}
      <section
        style={{
          padding: "34px 26px",
          borderRadius: 20,
          border: "1px solid #e7e7e7",
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.02), rgba(0,0,0,0.00))",
          boxShadow: "0 18px 40px rgba(0,0,0,0.06)",
          textAlign: "center",
        }}
      >
        <h1
          style={{
            fontSize: 48,
            margin: "0 0 12px",
            lineHeight: 1.05,
            letterSpacing: "-0.9px",
            fontWeight: 900,
          }}
        >
          Change orders & Estimates in seconds.
          <br />
          <span style={{ fontWeight: 900 }}>Print-ready. Signature-ready.</span>
        </h1>

        <p
          style={{
            fontSize: 18,
            color: "#444",
            maxWidth: 760,
            margin: "0 auto",
            lineHeight: 1.55,
          }}
        >
          Type the scope. Review the numbers. Download a clean PDF your client
          can approve on the spot.
        </p>

        <div style={{ marginTop: 20 }}>
          <Link href="/app">
            <button
              style={{
                padding: "14px 18px",
                fontSize: 16,
                background: "#000",
                color: "#fff",
                border: "none",
                borderRadius: 12,
                cursor: "pointer",
                fontWeight: 800,
                boxShadow: "0 14px 30px rgba(0,0,0,0.18)",
              }}
            >
              Generate a Change Order
            </button>
          </Link>

          <div style={{ marginTop: 10, fontSize: 13, color: "#666" }}>
            Free to try — no credit card required
          </div>
        </div>

        {/* Trust chips */}
        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "center",
            flexWrap: "wrap",
            marginTop: 22,
          }}
        >
          {[
            "✅ Print-ready PDF",
            "🖊️ Signature lines included",
            "💰 Pricing you can adjust",
            "📱 Works on phone or desktop",
          ].map((t) => (
            <div
              key={t}
              style={{
                fontSize: 13,
                padding: "8px 12px",
                borderRadius: 999,
                border: "1px solid #e9e9e9",
                background: "#fff",
                color: "#111",
                fontWeight: 650,
              }}
            >
              {t}
            </div>
          ))}
        </div>
      </section>

      {/* PREVIEW */}
      <section style={{ marginTop: 44 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 20, letterSpacing: "-0.2px" }}>
            Example output
          </h2>
          <div style={{ fontSize: 12, color: "#666" }}>
            Clean formatting. Clear scope. Pricing summary. Signatures.
          </div>
        </div>

        <div
          style={{
            marginTop: 14,
            borderRadius: 18,
            overflow: "hidden",
            border: "1px solid #e7e7e7",
            background: "#fff",
            boxShadow: "0 26px 60px rgba(0,0,0,0.12)",
          }}
        >
          <img
            src="/screenshot.png"
            alt="Example of a print-ready change order generated in seconds"
            style={{
              width: "100%",
              display: "block",
            }}
          />
        </div>

        <p style={{ fontSize: 13, color: "#666", marginTop: 10 }}>
          Generate, download, and get it signed — without fighting templates.
        </p>
      </section>

      {/* WHY */}
      <section
        style={{
          marginTop: 56,
          paddingTop: 26,
          borderTop: "1px solid #eee",
        }}
      >
        <h2 style={{ marginBottom: 14 }}>Why contractors use JobEstimate Pro</h2>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 14,
            marginTop: 12,
          }}
        >
          {[
            {
              title: "Looks professional",
              text: "Clean, print-ready documents that clients take seriously.",
            },
            {
              title: "Saves time",
              text: "No formatting. No templates. Just type the scope and go.",
            },
            {
              title: "Gets approved faster",
              text: "Clear scope + clear pricing + signature-ready PDF.",
            },
            {
              title: "Built for the field",
              text: "Works on your phone or laptop — on site or at home.",
            },
          ].map((c) => (
            <div
              key={c.title}
              style={{
                padding: 16,
                border: "1px solid #eee",
                borderRadius: 14,
                background: "#fff",
              }}
            >
              <div style={{ fontWeight: 900 }}>{c.title}</div>
              <div style={{ marginTop: 6, color: "#555", lineHeight: 1.55 }}>
                {c.text}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* HOW */}
      <section
        style={{
          marginTop: 56,
          paddingTop: 26,
          borderTop: "1px solid #eee",
        }}
      >
        <h2 style={{ marginBottom: 14 }}>How it works</h2>

        <div style={{ display: "grid", gap: 12 }}>
          {[
            {
              n: "1",
              title: "Enter the scope",
              text: "Describe the change or additional work in plain language.",
            },
            {
              n: "2",
              title: "Review pricing",
              text: "Adjust labor, materials, and markup if needed.",
            },
            {
              n: "3",
              title: "Download & print",
              text: "Get a PDF ready for signatures and approval.",
            },
          ].map((s) => (
            <div
              key={s.n}
              style={{
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
                padding: 14,
                borderRadius: 14,
                border: "1px solid #eee",
                background: "#fafafa",
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  background: "#111",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 900,
                }}
              >
                {s.n}
              </div>
              <div>
                <div style={{ fontWeight: 900 }}>{s.title}</div>
                <div style={{ color: "#555", marginTop: 4, lineHeight: 1.55 }}>
                  {s.text}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* BOTTOM CTA */}
      <section
        style={{
          marginTop: 56,
          paddingTop: 26,
          borderTop: "1px solid #eee",
          textAlign: "center",
        }}
      >
        <h2 style={{ marginBottom: 8 }}>Stop wasting time on templates.</h2>
        <p style={{ marginTop: 0, color: "#555" }}>
          Make it clean. Make it clear. Get it approved.
        </p>

        <Link href="/app">
          <button
            style={{
              marginTop: 10,
              padding: "14px 18px",
              fontSize: 16,
              background: "#000",
              color: "#fff",
              border: "none",
              borderRadius: 12,
              cursor: "pointer",
              fontWeight: 900,
            }}
          >
            Open JobEstimate Pro
          </button>
        </Link>
      </section>

      {/* FOOTER */}
      <footer style={{ marginTop: 60, paddingTop: 18, borderTop: "1px solid #eee" }}>
        <div style={{ fontSize: 12, color: "#777", textAlign: "center" }}>
          Professional documents. Real-world jobs. Built to get approved.
        </div>
      </footer>
    </main>
  )
}