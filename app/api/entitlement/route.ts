import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL) throw new Error("NEXT_PUBLIC_SUPABASE_URL missing")
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing")

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const FREE_LIMIT = 3

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const emailRaw = body?.email

    if (!emailRaw || typeof emailRaw !== "string") {
      return NextResponse.json({ entitled: false, usage_count: 0, free_limit: FREE_LIMIT })
    }

    const email = normalizeEmail(emailRaw)

    const { data, error } = await supabase
      .from("entitlements")
      .select("active, usage_count")
      .eq("email", email)
      .maybeSingle()

    if (error) {
      console.error("Entitlement lookup error:", error)
      return NextResponse.json({ entitled: false, usage_count: 0, free_limit: FREE_LIMIT })
    }

    return NextResponse.json({
      entitled: data?.active === true,
      usage_count: typeof data?.usage_count === "number" ? data.usage_count : 0,
      free_limit: FREE_LIMIT,
    })
  } catch (err) {
    console.error("Entitlement route failed:", err)
    return NextResponse.json({ entitled: false, usage_count: 0, free_limit: FREE_LIMIT })
  }
}