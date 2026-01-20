"use client"

import { useState } from "react"
import { jsPDF } from "jspdf"

const FREE_LIMIT = 3

function getUsageCount() {
  return Number(localStorage.getItem("changeOrderCount") || "0")
}

function incrementUsage() {
  const count = getUsageCount() + 1
  localStorage.setItem("changeOrderCount", count.toString())
  return count
}

export default function Home() {
  const [companyName, setCompanyName] = useState("")
  const [clientName, setClientName] = useState("")
  const [jobAddress, setJobAddress] = useState("")
  const [scopeChange, setScopeChange] = useState("")
  const [markup, setMarkup] = useState(20)
  const [output, setOutput] = useState("")
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null)

  async function generateChangeOrder() {
    const currentUsage = getUsageCount()
    if (currentUsage >= FREE_LIMIT) {
      setOutput("Free limit reached. Please upgrade to generate more change orders.")
      return
    }

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

    incrementUsage()
  }

  function downloadPDF() {
    if (!output) return

    const doc = new jsPDF()
    const pageWidth = doc.internal.pageSize.getWidth()
    let y = 20

    // Logo or company name
    if (logoDataUrl) {
      const logoWidth = 40
      const logoHeight = 20

      doc.addImage(
        logoDataUrl,
        "PNG",
        (pageWidth - logoWidth) / 2,
        y,
        logoWidth,
        logoHeight
      )
      y += logoHeight + 10
    } else {
      doc.setFontSize(14)
      doc.text(companyName || "Company Name", pageWidth / 2, y, { align: "center" })
      y += 10
    }

    // Title
    doc.setFontSize(18)
    doc.text("CHANGE ORDER", pageWidth / 2, y, { align: "center" })
    y += 12

    // Client info
    doc.setFontSize(10)
    doc.text(`Client: ${clientName || "__________"}`, 20, y)
    y += 6
    doc.text(`Job Address: ${jobAddress || "__________"}`, 20, y)
    y += 6
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 20, y)
    y += 10

    // Divider
    doc.line(20, y, pageWidth - 20, y)
    y += 10

    // Scope section
    doc.setFontSize(12)
    doc.text("Scope of Change", 20, y)
    y += 6

    doc.setFontSize(11)
    const lines = doc.splitTextToSize(output, pageWidth - 40)
    doc.text(lines, 20, y)
    y += lines.length * 6 + 10

    // Divider
    doc.line(20, y, pageWidth - 20, y)
    y += 15

    // Signatures
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
        Company Logo
        <br />
        <input
          type="file"
          accept="image/png, image/jpeg"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (!file) return

            const reader = new FileReader()
            reader.onload = () => {
              setLogoDataUrl(reader.result as string)
            }
            reader.readAsDataURL(file)
          }}
          style={{ marginTop: 6 }}
        />
      </label>

      <br /><br />

      <label>
        Company Name
        <br />
        <input
          type="text"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          style={{ width: "100%", marginTop: 6 }}
          placeholder="Smith Renovations LLC"
        />
      </label>

      <br /><br />

      <label>
        Client Name
        <br />
        <input
          type="text"
          value={clientName}
          onChange={(e) => setClientName(e.target.value)}
          style={{ width: "100%", marginTop: 6 }}
          placeholder="John Doe"
        />
      </label>

      <br /><br />

      <label>
        Job Address
        <br />
        <input
          type="text"
          value={jobAddress}
          onChange={(e) => setJobAddress(e.target.value)}
          style={{ width: "100%", marginTop: 6 }}
          placeholder="123 Main St, Austin, TX"
        />
      </label>

      <br /><br />

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