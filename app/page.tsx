"use client"

import Link from "next/link"

export default function HomePage() {
  return (
    <main
      style={{
        maxWidth: 1040,
        margin: "60px auto",
        padding: "0 18px 70px",
        fontFamily:
          'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji"',
        color: "#0b0b0b",
      }}
    >
      {/* TOP BAR */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 14,
          padding: "10px 0 18px",
          borderBottom: "1px solid #eee",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <div style={{ fontWeight: 950, letterSpacing: "-0.3px" }}>
            JobEstimate Pro
          </div>
          <div style={{ fontSize: 12, color: "#666" }}>
            Change orders & estimates
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ fontSize: 12, color: "#666" }}>
            Built for contractors
          </div>
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
                fontWeight: 800,
              }}
            >
              Open App
            </button>
          </Link>
        </div>
      </header>

      {/* HERO + PREVIEW */}
      <section
        style={{
          marginTop: 26,
          display: "grid",
          gridTemplateColumns: "1.05fr 0.95fr",
          gap: 22,
          alignItems: "start",
        }}
      >
        {/* Left: copy */}
        <div>
          <h1
            style={{
              fontSize: 44,
              margin: "0 0 10px",
              lineHeight: 1.06,
              letterSpacing: "-0.7px",
              fontWeight: 950,
            }}
          >
            Write a change order.
            <br />
            Print it. Get it signed.
          </h1>

          <p
            style={{
              fontSize: 18,
              color: "#444",
              margin: "0 0 16px",
              lineHeight: 1.55,
              maxWidth: 560,
            }}
          >
            No templates, no formatting. Type the scope and get a clean PDF your
            client can approve on the spot.
          </p>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
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
                  fontWeight: 900,
                }}
              >
                Generate a Change Order
              </button>
            </Link>

            <Link href="/app">
              <button
                style={{
                  padding: "14px 18px",
                  fontSize: 16,
                  background: "#fff",
                  color: "#111",
                  border: "1px solid #ddd",
                  borderRadius: 12,
                  cursor: "pointer",
                  fontWeight: 800,
                }}
              >
                Create an Invoice
              </button>
            </Link>
          </div>

          <div style={{ fontSize: 13, color: "#666", marginTop: 10 }}>
            Free to try — no credit card required
          </div>

          {/* Spec strip */}
          <div
            style={{
              marginTop: 18,
              padding: 14,
              borderRadius: 14,
              border: "1px solid #e6e6e6",
              background: "#fafafa",
              display: "grid",
              gap: 10,
            }}
          >
            <div style={{ fontWeight: 900, fontSize: 13 }}>What you get</div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 10,
                fontSize: 13,
                color: "#111",
              }}
            >
              <div>✅ Print-ready PDF</div>
              <div>✅ Signature lines included</div>
              <div>✅ Clear pricing summary</div>
              <div>✅ Works on mobile or desktop</div>
            </div>
          </div>
        </div>

        {/* Right: screenshot */}
        <div>
          <div
            style={{
              fontSize: 12,
              color: "#666",
              marginBottom: 8,
              fontWeight: 700,
            }}
          >
            Example output (what your client sees)
          </div>

          <div
            style={{
              borderRadius: 16,
              overflow: "hidden",
              border: "1px solid #e6e6e6",
              background: "#fff",
              boxShadow: "0 20px 40px rgba(0,0,0,0.10)",
            }}
          >
            <img
              src="/screenshot.png"
              alt="Example of a print-ready change order generated in seconds"
              style={{ width: "100%", display: "block" }}
            />
          </div>

          <div style={{ fontSize: 12, color: "#666", marginTop: 8 }}>
            Clean scope, clean totals, signatures ready.
          </div>
        </div>
      </section>

      {/* WHY */}
      <section style={{ marginTop: 44 }}>
        <h2 style={{ marginBottom: 10 }}>Why contractors use JobEstimate Pro</h2>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 12,
          }}
        >
          {[
            {
              title: "Looks professional",
              text: "Clients take it seriously because it looks like a real document.",
            },
            {
              title: "Saves time",
              text: "No formatting or templates — just type the work and generate.",
            },
            {
              title: "Gets approved faster",
              text: "Clear scope + clear pricing + signature-ready PDF.",
            },
            {
              title: "Made for real jobs",
              text: "Use it on-site or at home. Simple, fast, and clean.",
            },
          ].map((c) => (
            <div
              key={c.title}
              style={{
                padding: 14,
                borderRadius: 14,
                border: "1px solid #eee",
                background: "#fff",
              }}
            >
              <div style={{ fontWeight: 950 }}>{c.title}</div>
              <div style={{ marginTop: 6, color: "#555", lineHeight: 1.55 }}>
                {c.text}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* HOW */}
      <section style={{ marginTop: 44 }}>
        <h2 style={{ marginBottom: 10 }}>How it works</h2>

        <div style={{ display: "grid", gap: 10 }}>
          {[
            {
              n: "1",
              title: "Enter the scope",
              text: "Describe the change or additional work in plain language.",
            },
            {
              n: "2",
              title: "Review pricing",
              text: "Adjust labor, materials, markup — whatever matches the job.",
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
                  fontWeight: 950,
                }}
              >
                {s.n}
              </div>

              <div>
                <div style={{ fontWeight: 950 }}>{s.title}</div>
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
          marginTop: 50,
          paddingTop: 18,
          borderTop: "1px solid #eee",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 950 }}>
          Stop wasting time on templates.
        </div>
        <div style={{ marginTop: 6, color: "#555" }}>
          Make it clean. Make it clear. Get it approved.
        </div>

        <div style={{ marginTop: 14 }}>
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
                fontWeight: 950,
              }}
            >
              Open JobEstimate Pro
            </button>
          </Link>
        </div>
      </section>

      {/* FOOTER */}
      <footer
        style={{
          marginTop: 46,
          paddingTop: 18,
          borderTop: "1px solid #eee",
          fontSize: 12,
          color: "#777",
        }}
      >
        Professional documents. Real-world jobs. Built to get approved.
      </footer>
    </main>
  )
}