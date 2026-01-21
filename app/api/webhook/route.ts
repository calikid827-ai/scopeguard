import { NextResponse } from "next/server"
import Stripe from "stripe"
import { createClient } from "@supabase/supabase-js"

export const dynamic = "force-dynamic"

// -----------------------------
// ENV VALIDATION (HARD FAIL)
// -----------------------------
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY missing")
}
if (!STRIPE_WEBHOOK_SECRET) {
  throw new Error("STRIPE_WEBHOOK_SECRET missing")
}
if (!SUPABASE_URL) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL missing")
}
if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY missing")
}

// Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// Supabase (SERVICE ROLE — backend only)
const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
)

export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature")

  if (!sig) {
    return NextResponse.json(
      { error: "Missing Stripe signature" },
      { status: 400 }
    )
  }

  const body = await req.text()

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      STRIPE_WEBHOOK_SECRET!
    )
  } catch (err: any) {
    console.error("❌ Webhook signature verification failed:", err.message)
    return NextResponse.json(
      { error: "Invalid signature" },
      { status: 400 }
    )
  }

  // ✅ Successful checkout → grant entitlement
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session

    const email = session.customer_details?.email
    const customerId = session.customer as string | null

    if (email && customerId) {
      const { error } = await supabase
        .from("entitlements")
        .upsert({
          email,
          stripe_customer_id: customerId,
          active: true,
        })

      if (error) {
        console.error("❌ Supabase upsert failed:", error)
      } else {
        console.log("✅ Entitlement granted:", email)
      }
    }
  }

  return NextResponse.json({ received: true })
}