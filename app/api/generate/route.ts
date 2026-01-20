import { NextResponse } from "next/server"
import OpenAI from "openai"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const { scopeChange, subtotal, markup, total, paymentTerms, dueDate } =
      await req.json()

    if (!process.env.OPENAI_API_KEY) {
      throw new Error("Missing OPENAI_API_KEY")
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })

    const prompt = `
Create a professional construction change order.

Scope of Change:
${scopeChange}

Subtotal: $${subtotal}
Markup: ${markup}%
Total: $${total}

Payment Terms: ${paymentTerms}
${dueDate ? `Due Date: ${dueDate}` : ""}

Return only the formatted change order text.
`

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    })

    return NextResponse.json({
      text: response.choices[0].message.content,
    })
  } catch (error) {
    console.error("AI generate error:", error)
    return NextResponse.json(
      { error: "AI generation failed" },
      { status: 500 }
    )
  }
}