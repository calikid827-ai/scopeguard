import { NextResponse } from "next/server"
import Stripe from "stripe"
import { createClient } from "@supabase/supabase-js"

export const dynamic = "force-dynamic"

// -----------------------------
// ENV VALIDATION (HARD FAIL)
// -----------------------------
if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY missing")
}

if (!process.env.STRIPE_WEBHOOK_SECRET) {
  throw new Error("STRIPE_WEBHOOK_SECRET missing")
}

if (!process.env.SUPABASE_URL) {
  throw new Error("SUPABASE_URL missing")
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY missing")
}

// -----------------------------
// CLIENTS (AFTER VALIDATION)
// -----------------------------
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// -----------------------------
// WEBHOOK HANDLER
// -----------------------------
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
      process.env.STRIPE_WEBHOOK_SECRET
    )
  } catch (err: any) {
    console.error("❌ Webhook signature verification failed:", err.message)
    return NextResponse.json(
      { error: "Invalid signature" },
      { status: 400 }
    )
  }

  // -----------------------------
  // HANDLE CHECKOUT COMPLETION
  // -----------------------------
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session

    const email = session.customer_details?.email
    const customerId = session.customer as string | null

    if (!email || !customerId) {
      console.error("❌ Missing email or customer ID")
      return NextResponse.json({ received: true })
    }

    const { error } = await supabase
      .from("entitlements")
      .upsert({
        email,
        stripe_customer_id: customerId,
        active: true,
      })

    if (error) {
      console.error("❌ Supabase entitlement upsert failed:", error)
    } else {
      console.log("✅ Entitlement granted for:", email)
    }
  }

  return NextResponse.json({ received: true })
}