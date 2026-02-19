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

workDaysPerWeek: z
  .union([z.literal(5), z.literal(6), z.literal(7)])
  .optional()
  .default(5),
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

// Host-based Origin allowlist
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin")

  // In production, require Origin (blocks curl/other clients unless you want to allow them)
  if (!origin) return process.env.NODE_ENV !== "production"

  let o: URL
  try {
    o = new URL(origin)
  } catch {
    return false
  }

  // Primary allowed host comes from env (NEXT_PUBLIC_SITE_URL)
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || ""
  let expectedHost = ""
  try {
    expectedHost = siteUrl ? new URL(siteUrl).host : ""
  } catch {
    expectedHost = ""
  }

  // Optional additional allowed hosts (comma-separated)
  const extraHosts = (process.env.ALLOWED_ORIGIN_HOSTS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

  const allowed = new Set<string>()
  if (expectedHost) allowed.add(expectedHost)
  for (const h of extraHosts) allowed.add(h)

  // ✅ Dev convenience: allow common localhost variants automatically
  // (does NOT apply to production)
  if (process.env.NODE_ENV !== "production") {
    allowed.add("localhost:3000")
    allowed.add("127.0.0.1:3000")
  }

  // Fail closed in production if you didn’t configure anything
  if (allowed.size === 0) return process.env.NODE_ENV !== "production"

  return allowed.has(o.host)
}

// ✅ STREAM-SAFE BODY PARSER
export async function readJsonWithLimit<T>(req: Request, maxBytes: number): Promise<T> {
  const len = req.headers.get("content-length")
  if (len) {
    const n = Number(len)
    if (Number.isFinite(n) && n > maxBytes) {
      throw Object.assign(new Error("BODY_TOO_LARGE"), { status: 413 })
    }
  }

  if (!req.body) {
    return (await req.json()) as T
  }

  const reader = req.body.getReader()
  let size = 0
  const chunks: Uint8Array[] = []

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (!value) continue

    size += value.byteLength
    if (size > maxBytes) {
      throw Object.assign(new Error("BODY_TOO_LARGE"), { status: 413 })
    }
    chunks.push(value)
  }

  const text = new TextDecoder().decode(concatUint8(chunks))

  try {
    return JSON.parse(text) as T
  } catch {
    throw Object.assign(new Error("BAD_JSON"), { status: 400 })
  }
}

function concatUint8(chunks: Uint8Array[]) {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
}