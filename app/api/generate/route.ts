export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import OpenAI from "openai"

export async function POST(req: Request) {
  try {
    const { scopeChange, markup } = await req.json()

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY!,
    })

    const prompt = `
You are a senior residential renovation estimator in the United States.

Your job is to generate a PROFESSIONAL change order with realistic pricing.

Rules:
- Use mid-range residential renovation pricing
- Break costs into Labor, Materials, Subcontractors (only if needed)
- Use realistic labor hours and rates
- Assume no extreme conditions unless stated
- Clearly state assumptions
- Provide subtotal, markup, and total
- Numbers must be reasonable and defensible
- Output MUST be editable by a contractor

Typical pricing guidance:
- General labor: $65–$95/hr
- Skilled labor: $85–$125/hr
- Tile: $5–$10 / sq ft
- Paint: $2–$4 / sq ft
- Electrical/plumbing: $90–$150/hr

Scope of Change:
${scopeChange}

Markup Percentage: ${markup}%

Return the change order in THIS EXACT FORMAT:

---
Scope of Work:
(text)

Estimated Costs:

Labor:
(list)

Materials:
(list)

Subcontractors:
(list or "None")

Subtotal: $X,XXX
Markup (${markup}%): $X,XXX
Total Estimated Change Order: $X,XXX

Assumptions:
(list)
---

Do NOT include legal disclaimers.
Do NOT include emojis.
`

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
    })

    return NextResponse.json({
      text: response.choices[0].message.content,
    })
  } catch (error) {
    console.error("AI generation error:", error)
    return NextResponse.json(
      { error: "AI generation failed" },
      { status: 500 }
    )
  }
}