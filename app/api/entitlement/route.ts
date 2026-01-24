import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const dynamic = "force-dynamic"

// Env validation
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL) throw new Error("NEXT_PUBLIC_SUPABASE_URL missing")
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing")

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

// ✅ GET /api/entitlement?email=someone@example.com
export async function GET(req: Request) {
  const url = new URL(req.url)
  const emailParam = url.searchParams.get("email")

  if (!emailParam) {
    return NextResponse.json({ entitled: false }, { status: 400 })
  }

  const email = normalizeEmail(emailParam)

  const { data, error } = await supabase
    .from("entitlements")
    .select("active")
    .eq("email", email)
    .maybeSingle()

  if (error || !data) return NextResponse.json({ entitled: false })

  return NextResponse.json({ entitled: data.active === true })
}

// ✅ POST { email: "someone@example.com" }
export async function POST(req: Request) {
  const body = await req.json()
  const emailRaw = body?.email

  if (!emailRaw || typeof emailRaw !== "string") {
    return NextResponse.json({ entitled: false }, { status: 400 })
  }

  const email = normalizeEmail(emailRaw)

  const { data, error } = await supabase
    .from("entitlements")
    .select("active")
    .eq("email", email)
    .maybeSingle()

  if (error || !data) return NextResponse.json({ entitled: false })

  return NextResponse.json({ entitled: data.active === true })
}