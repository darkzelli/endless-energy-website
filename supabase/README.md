# Selling Radial Keys

$5 once, through Stripe Checkout, with the builds in a private Supabase Storage bucket.

1. **Buy** (`radial-keys/` page) links to the `checkout` function, which opens a $5 Stripe Checkout.
2. Stripe calls `stripe-webhook` when it's paid, which adds a row to `purchases`.
3. Stripe sends the buyer to `radial-keys/thanks.html?session_id=…`. That page asks `download`, which checks
   the session was paid (in `purchases`, or with Stripe if the webhook hasn't arrived) and returns 10-minute
   signed links to the newest `*-Mac.dmg` and `*-Windows.exe` in the bucket. The thanks URL keeps working,
   so it's the buyer's download link for later versions too.

## Setting it up

```sh
npx supabase login
npx supabase link --project-ref <ref>        # the project at supabase.com/dashboard
npx supabase db push                         # purchases table + private radial-keys bucket
npx supabase secrets set STRIPE_SECRET_KEY=sk_live_… SITE_URL=https://bywhatevermedium.com
npx supabase functions deploy
```

Then:

- **Stripe → Developers → Webhooks → Add endpoint:** `https://<ref>.supabase.co/functions/v1/stripe-webhook`,
  events `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Copy its signing secret:
  `npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_…`
- **Upload the builds** to the `radial-keys` bucket (Dashboard → Storage), keeping the release names:
  `Radial-Keys-1.1-Mac.dmg`, `Radial-Keys-1.1-Windows.exe`. For a new version, upload the new pair; the newest wins.
- **Turn on the Buy buttons:** set `FUNCTIONS_URL` in `src/radial-keys/store.js` to
  `https://<ref>.supabase.co/functions/v1` and push.

Try it all first with test keys (`sk_test_…`, a test-mode webhook) and card `4242 4242 4242 4242`.
