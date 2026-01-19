"use client"

import { useState } from "react"

export default function Home() {
  const [scopeChange, setScopeChange] = useState("")
  const [markup, setMarkup] = useState(20)
  const [output, setOutput] = useState("")

  async function generateChangeOrder() {
    setOutput("Generating change order...")

    const res = await fetch("/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scopeChange,
        markup,
      }),
    })

  if (!res.ok) {
  const errorText = await res.text()
  setOutput("API Error:\n" + errorText)
  return
}

const data = await res.json()
setOutput(data.text)
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

      <hr style={{ margin: "24px 0" }} />

      <pre style={{ background: "#f5f5f5", padding: 12, whiteSpace: "pre-wrap" }}>
        {output || "Generated change order will appear here."}
      </pre>
    </div>
  )
}