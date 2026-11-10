// Stripe calls this when a checkout finishes: records the purchase.
// Subscribe the endpoint to checkout.session.completed and checkout.session.async_payment_succeeded.
// Each function is one file, so it can be pasted into the Supabase dashboard as is.
import Stripe from 'npm:stripe@23.0.1'
import { createClient } from 'npm:@supabase/supabase-js@2.49.4'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { httpClient: Stripe.createFetchHttpClient() })
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
})
const crypto = Stripe.createSubtleCryptoProvider()

// Saves a session once Stripe says it's paid. Same as in download/index.ts: the two can race, so it upserts.
async function recordPurchase(session: Stripe.Checkout.Session) {
  if (session.payment_status !== 'paid') return
  const { error } = await db.from('purchases').upsert({
    session_id: session.id,
    email: session.customer_details?.email ?? null,
    amount_total: session.amount_total ?? 0,
    currency: session.currency ?? 'usd',
  })
  if (error) throw error
}

Deno.serve(async (req) => {
  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(
      await req.text(),
      req.headers.get('stripe-signature') ?? '',
      Deno.env.get('STRIPE_WEBHOOK_SECRET')!,
      undefined,
      crypto,
    )
  } catch (e) {
    return new Response(`Bad signature: ${e instanceof Error ? e.message : e}`, { status: 400 })
  }

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    try {
      await recordPurchase(event.data.object)
    } catch (e) {
      console.error(e)
      return new Response('Could not record the purchase', { status: 500 }) // Stripe retries
    }
  }
  return new Response('ok')
})
