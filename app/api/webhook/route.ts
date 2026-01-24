import { NextResponse } from "next/server"
import Stripe from "stripe"
import { createClient } from "@supabase/supabase-js"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY missing")
if (!STRIPE_WEBHOOK_SECRET) throw new Error("STRIPE_WEBHOOK_SECRET missing")
if (!SUPABASE_URL) throw new Error("NEXT_PUBLIC_SUPABASE_URL missing")
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing")

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
)

export async function POST(req: Request) {
  console.log("🔥 WEBHOOK HIT")

  const sig = req.headers.get("stripe-signature")
  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 })
  }

  const body = await req.text()
  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      STRIPE_WEBHOOK_SECRET!
    )
    console.log("✅ Event verified:", event.type)
  } catch (err: any) {
    console.error("❌ Signature verification failed:", err.message)
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

    if (event.type === "checkout.session.completed") {
  console.log("🎉 Checkout session completed")

  const session = event.data.object as Stripe.Checkout.Session
  const rawEmail = session.customer_details?.email
  const email = rawEmail ? rawEmail.trim().toLowerCase() : null
  const normalizedEmail = email
  const customerId = session.customer as string | null

  console.log("📧 Email:", email)
  console.log("👤 Customer ID:", customerId)

  if (!email) {
    console.error("❌ No email in checkout session")
    return NextResponse.json({ received: true })
  }

  if (session.payment_status && session.payment_status !== "paid") {
  console.warn("⚠️ Session not paid:", session.payment_status)
  return NextResponse.json({ received: true })
}

  const { error } = await supabase
    .from("entitlements")
    .upsert(
      { email, stripe_customer_id: customerId ?? null, active: true },
      { onConflict: "email" }
    )

  if (error) {
    console.error("❌ Supabase upsert failed:", error)
    // 500 tells Stripe to retry (correct behavior)
    return NextResponse.json({ error: "DB write failed" }, { status: 500 })
  }
}

  return NextResponse.json({ received: true })
}