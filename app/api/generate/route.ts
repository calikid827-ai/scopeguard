import { NextResponse } from "next/server"
import OpenAI from "openai"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function POST(req: Request) {
  const body = await req.json()
  const { scopeChange, markup } = body

  const prompt = `
You are a professional renovation contractor.

Write a clear, client-friendly change order.

Scope change:
${scopeChange}

Markup: ${markup}%

Return only the change order text.
`

  const response = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: prompt,
  })

  const text =
    response.output_text ??
    "Unable to generate change order."

  return NextResponse.json({ text })
}