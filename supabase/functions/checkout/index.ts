// The Buy buttons link here: starts a $5 Stripe Checkout and sends the browser to it.
import Stripe from 'npm:stripe@17.7.0'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { httpClient: Stripe.createFetchHttpClient() })
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://bywhatevermedium.com'

Deno.serve(async () => {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: 500,
          product_data: { name: 'Radial Keys', description: 'For Windows and macOS. Pay once, keep it.' },
        },
      }],
      success_url: `${SITE_URL}/radial-keys/thanks.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/radial-keys/`,
    })
    return Response.redirect(session.url!, 303)
  } catch (e) {
    console.error(e)
    return Response.redirect(`${SITE_URL}/radial-keys/thanks.html?error=checkout`, 303)
  }
})
