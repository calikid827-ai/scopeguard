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
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature")
  if (!sig) return NextResponse.json({ error: "Missing signature" }, { status: 400 })

  const body = await req.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, STRIPE_WEBHOOK_SECRET!)
  } catch (err: any) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

  // -----------------------------
// Idempotency / dedupe (Stripe may retry same event)
// -----------------------------
const { error: dedupeErr } = await supabase
  .from("stripe_webhook_events")
  .insert({ event_id: event.id, type: event.type })

// If event_id already exists, we've processed it — exit successfully
if (dedupeErr) {
  const msg = (dedupeErr as any)?.message || ""
  const code = (dedupeErr as any)?.code || ""

  // Postgres unique violation (duplicate primary key)
  // Supabase often uses code "23505" for unique violation
  if (code === "23505" || /duplicate key|unique/i.test(msg)) {
    return NextResponse.json({ received: true })
  }

  // Otherwise, fail so Stripe retries (safe)
  return NextResponse.json({ error: "Webhook dedupe write failed" }, { status: 500 })
}

  // Only handle what you need (keeps webhook fast + safe)
  if (event.type !== "checkout.session.completed") {
    return NextResponse.json({ received: true })
  }

  const session = event.data.object as Stripe.Checkout.Session

  // ✅ email can exist in either field
  const rawEmail = session.customer_details?.email ?? session.customer_email
  const email = rawEmail ? rawEmail.trim().toLowerCase() : ""

  if (!email) return NextResponse.json({ received: true })

  // optional paid check (fine to keep)
  if (session.payment_status && session.payment_status !== "paid") {
    return NextResponse.json({ received: true })
  }

  // customer can be string | object | null
  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id ?? null

  // ✅ DO NOT overwrite usage_count here
  const { error } = await supabase
    .from("entitlements")
    .upsert(
      { email, stripe_customer_id: customerId, active: true },
      { onConflict: "email" }
    )

  if (error) {
    // returning 500 makes Stripe retry (good)
    return NextResponse.json({ error: "DB write failed" }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}