import { NextResponse } from "next/server"
import OpenAI from "openai"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function POST(req: Request) {
  const { scopeChange, markup } = await req.json()

  const prompt = `
You are a professional residential construction project manager.

Generate a clear, client-facing CHANGE ORDER using the rules below.

IMPORTANT RULES:
- Use professional, simple language
- Be neutral and factual
- Do NOT mention AI
- Do NOT include disclaimers
- Assume this document will be signed by a client
- Use USD currency
- Ensure all math is internally consistent
- If exact costs are unknown, use reasonable placeholder estimates

FORMAT THE RESPONSE EXACTLY AS FOLLOWS:

CHANGE ORDER SUMMARY
2–3 sentences explaining why this change is required.

SCOPE OF CHANGE
- Bullet list of specific work being added, removed, or modified.

COST BREAKDOWN
- Labor: $____
- Materials: $____
- Subcontractors (if applicable): $____
- Subtotal: $____
- Markup (${markup}%): $____
- Total Change Order Amount: $____

SCHEDULE IMPACT
State any impact to the project timeline. If none, state "No change to project schedule."

APPROVAL
By approving this change order, the client authorizes the contractor to proceed with the work described above and agrees to the revised cost and schedule.

PROJECT CHANGE DESCRIPTION:
${scopeChange}
`

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
  })

  return NextResponse.json({
    text: completion.choices[0].message.content,
  })
}