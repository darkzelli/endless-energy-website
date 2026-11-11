// The Buy buttons link here: starts a $5 Stripe Checkout and sends the browser to it.
import Stripe from 'npm:stripe@23.0.1'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { httpClient: Stripe.createFetchHttpClient() })
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://bywhatevermedium.com'

Deno.serve(async () => {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      // Without this the sale is an ordinary Stripe payment, with us as the seller and no tax handled.
      managed_payments: { enabled: true },
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: 500,
          // Stripe is the seller of record (Managed Payments) and handles sales tax and VAT. $5 is what
          // buyers pay, tax included, and the tax code says what it is: downloadable software, personal use.
          tax_behavior: 'inclusive',
          product_data: {
            name: 'Radial Keys',
            description: 'For Windows and macOS. Pay once, keep it.',
            tax_code: 'txcd_10202000',
          },
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
