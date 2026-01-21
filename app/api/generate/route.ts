import { NextResponse } from "next/server"
import OpenAI from "openai"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
})

export async function POST(req: Request) {
  const { scopeChange } = await req.json()

  if (!scopeChange) {
    return NextResponse.json(
      { error: "Missing scope" },
      { status: 400 }
    )
  }

  const prompt = `
You are a professional residential renovation estimator.

Given the scope change below, do ALL of the following:

1. Write a clear, professional CHANGE ORDER description suitable for a contractor-client agreement.
2. Estimate realistic COST TOTALS (not line items) for:
   - labor
   - materials
   - subcontractors
3. Apply a standard 20% contractor markup.
4. Return ONLY valid JSON in this exact format:

{
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
    temperature: 0.4,
  })

  const raw = completion.choices[0].message.content || ""

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return NextResponse.json(
      { error: "AI returned invalid JSON", raw },
      { status: 500 }
    )
  }

  return NextResponse.json({
    text: parsed.description,
    pricing: parsed.pricing,
  })
}