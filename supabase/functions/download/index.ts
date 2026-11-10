// The thanks page asks here with its session_id: if that session was paid, it gets signed links to the builds.
// Each function is one file, so it can be pasted into the Supabase dashboard as is.
import Stripe from 'npm:stripe@23.0.1'
import { createClient } from 'npm:@supabase/supabase-js@2.49.4'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { httpClient: Stripe.createFetchHttpClient() })
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
})
const BUCKET = 'radial-keys'
const LINK_SECONDS = 60 * 10

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  })

// Paid if the webhook recorded it, or (if the buyer got here first) if Stripe says so now, which records it.
async function isPaid(sessionId: string): Promise<boolean> {
  const { data } = await db.from('purchases').select('session_id').eq('session_id', sessionId).maybeSingle()
  if (data) return true
  let session: Stripe.Checkout.Session
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId)
  } catch {
    return false // no such session
  }
  if (session.payment_status !== 'paid') return false
  const { error } = await db.from('purchases').upsert({
    session_id: session.id,
    email: session.customer_details?.email ?? null,
    amount_total: session.amount_total ?? 0,
    currency: session.currency ?? 'usd',
  })
  if (error) throw error
  return true
}

// The newest Mac and Windows builds in the bucket, by upload time.
async function latestBuilds() {
  const { data, error } = await db.storage.from(BUCKET).list('', { sortBy: { column: 'created_at', order: 'desc' } })
  if (error) throw error
  return {
    mac: data.find((f) => f.name.endsWith('-Mac.dmg'))?.name,
    windows: data.find((f) => f.name.endsWith('-Windows.exe'))?.name,
  }
}

Deno.serve(async (req) => {
  const sessionId = new URL(req.url).searchParams.get('session_id') ?? ''
  if (!sessionId.startsWith('cs_')) return json({ error: 'missing' }, 400)

  try {
    if (!(await isPaid(sessionId))) return json({ error: 'unpaid' }, 402)
    const builds = await latestBuilds()
    const links: Record<string, { name: string; url: string }> = {}
    for (const [os, name] of Object.entries(builds)) {
      if (!name) continue
      const { data, error } = await db.storage.from(BUCKET).createSignedUrl(name, LINK_SECONDS, { download: name })
      if (error) throw error
      links[os] = { name, url: data.signedUrl }
    }
    return json(links)
  } catch (e) {
    console.error(e)
    return json({ error: 'server' }, 500)
  }
})
