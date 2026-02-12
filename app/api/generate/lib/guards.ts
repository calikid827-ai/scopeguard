import { z } from "zod"

export const GenerateSchema = z.object({
  email: z.string().email().max(254),
  scopeChange: z.string().min(10).max(4000),
  trade: z
    .enum([
      "",
      "painting",
      "drywall",
      "flooring",
      "electrical",
      "plumbing",
      "carpentry",
      "general renovation",
    ])
    .optional()
    .default(""),
  state: z
    .string()
    .trim()
    .regex(/^(|AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)$/)
    .optional()
    .default(""),
  paintScope: z.enum(["walls", "walls_ceilings", "full"]).nullable().optional().default(null),
  measurements: z
    .object({
      units: z.literal("ft"),
      totalSqft: z.number().min(0).max(25000),
      rows: z
        .array(
          z.object({
            label: z.string().max(60),
            lengthFt: z.number().min(0).max(1000),
            heightFt: z.number().min(0).max(30),
            qty: z.number().int().min(1).max(500),
          })
        )
        .max(50),
    })
    .nullable()
    .optional()
    .default(null),
})

export function cleanScopeText(s: string) {
  return s
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function jsonError(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ ok: false, code, message }), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

// VERY basic origin check (good first line of defense)
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin") || ""
  const host = req.headers.get("host") || ""
  if (!origin || !host) return true // allow in dev / edge oddities

  try {
    const o = new URL(origin)
    // allow same host (covers http/https differences in some deployments)
    return o.host === host
  } catch {
    return false
  }
}

// Body size guard (rough, but effective)
export function assertBodySize(req: Request, maxBytes = 40_000) {
  const len = req.headers.get("content-length")
  if (!len) return true
  const n = Number(len)
  return Number.isFinite(n) && n <= maxBytes
}