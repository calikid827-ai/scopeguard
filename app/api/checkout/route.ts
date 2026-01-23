import Stripe from "stripe"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function POST() {
  try {
    const secretKey = process.env.STRIPE_SECRET_KEY
    const priceId = process.env.STRIPE_PRICE_ID
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL

    if (!secretKey) throw new Error("STRIPE_SECRET_KEY missing")
    if (!priceId) throw new Error("STRIPE_PRICE_ID missing")
    if (!siteUrl) throw new Error("NEXT_PUBLIC_SITE_URL missing")

    const stripe = new Stripe(secretKey)

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_creation: "always",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${siteUrl}/success`,
      cancel_url: `${siteUrl}/cancel`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err: any) {
    console.error("Stripe checkout error:", err)

    return NextResponse.json(
      {
        error: err?.message || "Stripe checkout failed",
      },
      { status: 500 }
    )
  }
}