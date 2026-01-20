"use client"

import { useEffect, useState } from "react"
import { jsPDF } from "jspdf"

const FREE_LIMIT = 3

export default function Home() {
  const [companyName, setCompanyName] = useState("")
  const [clientName, setClientName] = useState("")
  const [jobAddress, setJobAddress] = useState("")
  const [scopeChange, setScopeChange] = useState("")
  const [markup, setMarkup] = useState(20)
  const [output, setOutput] = useState("")
  const [usageCount, setUsageCount] = useState(0)
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null)

  useEffect(() => {
    setUsageCount(Number(localStorage.getItem("changeOrderCount") || "0"))
  }, [])

  async function generateChangeOrder() {
    if (usageCount >= FREE_LIMIT) {
      setOutput("Free limit reached. Please upgrade to continue.")
      return
    }

    setOutput("Generating change order...")

    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scopeChange, markup }),
    })

    if (!res.ok) {
      setOutput("Error generating change order.")
      return
    }

    const data = await res.json()
    setOutput(data.text)

    const newCount = usageCount + 1
    localStorage.setItem("changeOrderCount", newCount.toString())
    setUsageCount(newCount)
  }

  function downloadPDF() {
    const doc = new jsPDF()
    const pageWidth = doc.internal.pageSize.getWidth()
    let y = 20

    if (logoDataUrl) {
      doc.addImage(logoDataUrl, "PNG", 20, y, 40, 20)
    }

    doc.setFontSize(14)
    doc.text(companyName || "Company Name", logoDataUrl ? 70 : 20, y + 12)
    y += 30

    doc.setFontSize(18)
    doc.text("CHANGE ORDER", pageWidth / 2, y, { align: "center" })
    y += 12

    doc.setFontSize(10)
    doc.text(`Client: ${clientName}`, 20, y)
    y += 6
    doc.text(`Job Address: ${jobAddress}`, 20, y)
    y += 6
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 20, y)
    y += 10

    doc.line(20, y, pageWidth - 20, y)
    y += 10

    doc.setFontSize(11)
    const lines = doc.splitTextToSize(output, pageWidth - 40)
    doc.text(lines, 20, y)

    doc.save("change-order.pdf")
  }

  return (
    <main style={{ maxWidth: 700, margin: "40px auto", fontFamily: "system-ui" }}>
      <h1>ScopeGuard</h1>

      <input placeholder="Company Name" value={companyName} onChange={(e) => setCompanyName(e.target.value)} style={{ width: "100%", marginBottom: 6 }} />
      <input placeholder="Client Name" value={clientName} onChange={(e) => setClientName(e.target.value)} style={{ width: "100%", marginBottom: 6 }} />
      <input placeholder="Job Address" value={jobAddress} onChange={(e) => setJobAddress(e.target.value)} style={{ width: "100%", marginBottom: 12 }} />

      <label>
        Company Logo
        <input type="file" accept="image/*" onChange={(e) => {
          const file = e.target.files?.[0]
          if (!file) return
          const reader = new FileReader()
          reader.onload = () => setLogoDataUrl(reader.result as string)
          reader.readAsDataURL(file)
        }} />
      </label>

      <textarea
        placeholder="Describe the scope change..."
        value={scopeChange}
        onChange={(e) => setScopeChange(e.target.value)}
        style={{ width: "100%", height: 120, marginTop: 12 }}
      />

      <label>
        Markup %
        <input type="number" value={markup} onChange={(e) => setMarkup(Number(e.target.value))} style={{ width: 80, marginLeft: 8 }} />
      </label>

      <br /><br />

      <button onClick={generateChangeOrder} style={{ padding: "10px 16px" }}>
        Generate Change Order
      </button>

      {output && (
        <>
          <h3 style={{ marginTop: 20 }}>Editable Change Order</h3>
          <textarea
            value={output}
            onChange={(e) => setOutput(e.target.value)}
            style={{
              width: "100%",
              minHeight: 260,
              padding: 12,
              background: "#f5f5f5",
              whiteSpace: "pre-wrap",
            }}
          />

          <br /><br />

          <button onClick={downloadPDF} style={{ padding: "10px 16px" }}>
            Download PDF
          </button>
        </>
      )}
    </main>
  )
}