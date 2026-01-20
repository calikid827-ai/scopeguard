"use client"

import { useState } from "react"
import { jsPDF } from "jspdf"

export default function Home() {
  const [scopeChange, setScopeChange] = useState("")
  const [markup, setMarkup] = useState(20)
  const [output, setOutput] = useState("")

  async function generateChangeOrder() {
    setOutput("Generating change order...")

    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scopeChange, markup }),
    })

    if (!res.ok) {
      const errorText = await res.text()
      setOutput("API Error:\n" + errorText)
      return
    }

    const data = await res.json()
    setOutput(data.text)
  }

  function downloadPDF() {
  if (!output) return

  const doc = new jsPDF()
  const pageWidth = doc.internal.pageSize.getWidth()
  let y = 20

  // Company Name
  doc.setFontSize(14)
  doc.text("Your Company Name", pageWidth / 2, y, { align: "center" })
  y += 10

  // Title
  doc.setFontSize(18)
  doc.text("CHANGE ORDER", pageWidth / 2, y, { align: "center" })
  y += 12

  // Date
  doc.setFontSize(10)
  const date = new Date().toLocaleDateString()
  doc.text(`Date: ${date}`, 20, y)
  y += 10

  // Divider
  doc.line(20, y, pageWidth - 20, y)
  y += 10

  // Section Header
  doc.setFontSize(12)
  doc.text("Scope of Change", 20, y)
  y += 6

  // Body Text
  doc.setFontSize(11)
  const lines = doc.splitTextToSize(output, pageWidth - 40)
  doc.text(lines, 20, y)
  y += lines.length * 6 + 10

  // Divider
  doc.line(20, y, pageWidth - 20, y)
  y += 15

  // Signatures
  doc.setFontSize(11)
  doc.text("Approved By:", 20, y)
  doc.line(20, y + 6, 100, y + 6)
  doc.text("Date:", 110, y)
  doc.line(120, y + 6, pageWidth - 20, y + 6)

  y += 20

  doc.text("Contractor Signature:", 20, y)
  doc.line(20, y + 6, 100, y + 6)
  doc.text("Date:", 110, y)
  doc.line(120, y + 6, pageWidth - 20, y + 6)

  doc.save("change-order.pdf")
}

  return (
    <div style={{ maxWidth: 600, margin: "40px auto", fontFamily: "Arial, sans-serif" }}>
      <h1>Create Change Order</h1>

      <label>
        Describe the scope change
        <br />
        <textarea
          value={scopeChange}
          onChange={(e) => setScopeChange(e.target.value)}
          style={{ width: "100%", height: 120, marginTop: 8 }}
          placeholder="Client requested upgraded cabinets..."
        />
      </label>

      <br /><br />

      <label>
        Markup %
        <br />
        <input
          type="number"
          value={markup}
          onChange={(e) => setMarkup(Number(e.target.value))}
        />
      </label>

      <br /><br />

      <button onClick={generateChangeOrder} style={{ padding: "10px 16px" }}>
        Generate Change Order
      </button>

      <br /><br />

      <button onClick={downloadPDF} style={{ padding: "10px 16px" }}>
        Download PDF
      </button>

      <hr style={{ margin: "24px 0" }} />

      <pre style={{ background: "#f5f5f5", padding: 12, whiteSpace: "pre-wrap" }}>
        {output || "Generated change order will appear here."}
      </pre>
    </div>
  )
}