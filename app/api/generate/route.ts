import { NextResponse } from "next/server"
import OpenAI from "openai"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
})

export async function POST(req: Request) {
  try {
    const { scopeChange } = await req.json()

    if (!scopeChange) {
      return NextResponse.json(
        { error: "Missing scope change" },
        { status: 400 }
      )
    }

    const prompt = `
You are a senior residential construction estimator.

STEP 1:
Determine the PRIMARY TRADE involved in this change order.
Choose ONE:
Painting, Flooring, Electrical, Plumbing, Tile, Drywall, Carpentry, General Renovation

STEP 2:
Write a professional, client-facing CHANGE ORDER description.

STEP 3:
Estimate realistic COST TOTALS (not line items) based on the trade:
- Labor
- Materials
- Subcontractors (0 if not applicable)

Use realistic US residential pricing assumptions:
• Painting → labor-heavy
• Flooring → materials + labor
• Electrical → skilled labor + permit risk
• Plumbing → higher subs + contingency
• Tile → high labor precision
• General renovation → blended estimate

STEP 4:
Apply a standard 20% contractor markup.

STEP 5:
Return ONLY valid JSON in this exact format:

{
  "trade": "string",
  "description": "string",
  "pricing": {
    "labor": number,
    "materials": number,
    "subs": number,
    "markup": 20
  }
}

Scope change:
${scopeChange}
`

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.35,
    })

    const raw = completion.choices[0].message.content || ""

    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      console.error("Invalid JSON from AI:", raw)
      return NextResponse.json(
        { error: "AI returned invalid JSON", raw },
        { status: 500 }
      )
    }

    return NextResponse.json({
      trade: parsed.trade,
      text: parsed.description,
      pricing: parsed.pricing,
    })
  } catch (err) {
    console.error("AI generate error:", err)
    return NextResponse.json(
      { error: "AI generation failed" },
      { status: 500 }
    )
  }
}