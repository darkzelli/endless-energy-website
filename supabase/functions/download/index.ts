// The thanks page asks here for signed links to the builds, with either
//   ?session_id=cs_…  from Stripe, right after paying: good for MAX_DOWNLOADS, so a shared page stops working
//   ?token=…          from an emailed link (resend-link): good once, for a day
// Each function is one file, so it can be pasted into the Supabase dashboard as is.
import Stripe from 'npm:stripe@23.0.1'
import { createClient } from 'npm:@supabase/supabase-js@2.49.4'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { httpClient: Stripe.createFetchHttpClient() })
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
})
const BUCKET = 'radial-keys'
const LINK_SECONDS = 60 * 10
const MAX_DOWNLOADS = 1

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

// Whether this ask may have links: 'ok', or why not. Uses up the download or the emailed link.
async function claim(params: URLSearchParams): Promise<'ok' | 'missing' | 'unpaid' | 'used'> {
  const token = params.get('token')
  if (token) {
    const { data, error } = await db.rpc('claim_token', { p_token: token })
    if (error) throw error
    return data ? 'ok' : 'used'
  }
  const sessionId = params.get('session_id') ?? ''
  if (!sessionId.startsWith('cs_')) return 'missing'
  if (!(await isPaid(sessionId))) return 'unpaid'
  const { data, error } = await db.rpc('claim_download', { p_session_id: sessionId, p_max: MAX_DOWNLOADS })
  if (error) throw error
  return data ? 'ok' : 'used'
}

const STATUS = { missing: 400, unpaid: 402, used: 410 }

Deno.serve(async (req) => {
  try {
    const claimed = await claim(new URL(req.url).searchParams)
    if (claimed !== 'ok') return json({ error: claimed }, STATUS[claimed])

    const builds = await latestBuilds()
    const links: Record<string, { name: string; url: string }> = {}
    for (const [os, name] of Object.entries(builds)) {
      if (!name) continue
      const { data, error } = await db.storage.from(BUCKET).createSignedUrl(name, LINK_SECONDS, { download: name })
      if (error) throw error
      links[os] = { name, url: data.signedUrl }
    }
    return json({ links, seconds: LINK_SECONDS })
  } catch (e) {
    console.error(e)
    return json({ error: 'server' }, 500)
  }
})
