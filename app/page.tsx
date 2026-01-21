"use client";

import { useEffect, useState } from "react";
import jsPDF from "jspdf";

export default function Home() {
  const [scopeChange, setScopeChange] = useState("");
  const [markup, setMarkup] = useState(20);
  const [output, setOutput] = useState("");
  const [paid, setPaid] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);

  // Editable totals
  const [labor, setLabor] = useState(0);
  const [materials, setMaterials] = useState(0);
  const [subs, setSubs] = useState(0);

  const subtotal = labor + materials + subs;
  const total = Math.round(subtotal * (1 + markup / 100));

  // Load usage / payment status
  useEffect(() => {
    fetch("/api/usage")
      .then((r) => r.json())
      .then((d) => {
        setPaid(d.paid);
        setRemaining(d.remaining);
      });
  }, []);

  // Stripe checkout
  async function startCheckout() {
    const res = await fetch("/api/checkout", { method: "POST" });
    const data = await res.json();
    if (data.url) window.location.href = data.url;
  }

  // AI generation
  async function generateChangeOrder() {
    if (!paid && remaining !== null && remaining <= 0) {
      setOutput("LOCKED");
      return;
    }

    setOutput("Generating…");

    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scopeChange }),
    });

    const data = await res.json();

    setLabor(data.labor || 0);
    setMaterials(data.materials || 0);
    setSubs(data.subs || 0);
    setOutput(data.text || "");
  }

  // PDF
  function downloadPDF() {
    const pdf = new jsPDF();

    pdf.setFontSize(16);
    pdf.text("Change Order", 20, 20);

    pdf.setFontSize(11);
    pdf.text(`Scope: ${scopeChange}`, 20, 40);
    pdf.text(`Labor: $${labor}`, 20, 60);
    pdf.text(`Materials: $${materials}`, 20, 70);
    pdf.text(`Subcontractors: $${subs}`, 20, 80);
    pdf.text(`Markup: ${markup}%`, 20, 95);
    pdf.text(`Total: $${total}`, 20, 110);

    pdf.save("change-order.pdf");
  }

  return (
    <div
      style={{
        maxWidth: 760,
        margin: "40px auto",
        padding: 24,
        borderRadius: 14,
        background: "#fff",
        fontFamily: "system-ui",
      }}
    >
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>ScopeGuard</h1>
      <p style={{ fontSize: 18, color: "#555", marginBottom: 24 }}>
        Instantly generate professional construction change orders.
      </p>

      {!paid && remaining !== null && (
        <p style={{ marginBottom: 16 }}>
          Free uses remaining: <strong>{remaining}</strong>
        </p>
      )}

      <textarea
        placeholder="Describe the scope change…"
        value={scopeChange}
        onChange={(e) => setScopeChange(e.target.value)}
        style={{
          width: "100%",
          height: 120,
          padding: 12,
          fontSize: 15,
          borderRadius: 8,
          border: "1px solid #ddd",
          marginBottom: 16,
        }}
      />

      <label>
        Markup %
        <input
          type="number"
          value={markup}
          onChange={(e) => setMarkup(+e.target.value)}
          style={{ marginLeft: 10, width: 80 }}
        />
      </label>

      <div style={{ marginTop: 20 }}>
        <button
          onClick={generateChangeOrder}
          style={{
            padding: "12px 18px",
            background: "#000",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            fontSize: 15,
            cursor: "pointer",
          }}
        >
          Generate Change Order
        </button>
      </div>

      {/* LOCKED STATE */}
      {!paid && output === "LOCKED" && (
        <div style={{ marginTop: 20 }}>
          <p style={{ color: "red" }}>
            Free limit reached. Please upgrade to continue.
          </p>
          <button
            onClick={startCheckout}
            style={{
              marginTop: 10,
              padding: "10px 16px",
              background: "#000",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Upgrade for Unlimited Access
          </button>
        </div>
      )}

      {/* RESULTS */}
      {output && output !== "LOCKED" && (
        <div style={{ marginTop: 30 }}>
          <h3>Editable Totals</h3>

          <label>Labor $
            <input type="number" value={labor} onChange={e => setLabor(+e.target.value)} />
          </label><br />

          <label>Materials $
            <input type="number" value={materials} onChange={e => setMaterials(+e.target.value)} />
          </label><br />

          <label>Subcontractors $
            <input type="number" value={subs} onChange={e => setSubs(+e.target.value)} />
          </label>

          <p style={{ marginTop: 12 }}>Subtotal: ${subtotal}</p>
          <p><strong>Total: ${total}</strong></p>

          <button
            onClick={downloadPDF}
            style={{
              marginTop: 12,
              padding: "10px 14px",
              borderRadius: 6,
              border: "1px solid #000",
              background: "#fff",
              cursor: "pointer",
            }}
          >
            Download PDF
          </button>
        </div>
      )}
    </div>
  );
}