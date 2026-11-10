// "Email me a link" on the thanks page posts here with an email. If it bought Radial Keys, Resend sends
// it a single-use download link (thanks.html?token=…, see download/index.ts). The answer is the same
// either way, so the form can't be used to find out who bought it.
// Each function is one file, so it can be pasted into the Supabase dashboard as is.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4'

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
})
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://bywhatevermedium.com'
const FROM = Deno.env.get('RESEND_FROM') ?? 'Radial Keys <downloads@bywhatevermedium.com>'
// Emails per purchase per day, so the form can't flood a buyer's inbox.
const MAX_PER_DAY = 3

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  })

// The newest purchase by this email, any capitals (ilike, with its wildcards escaped).
async function purchaseFor(email: string) {
  const { data, error } = await db.from('purchases')
    .select('session_id')
    .ilike('email', email.replace(/[\\%_]/g, '\\$&'))
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data?.session_id as string | undefined
}

async function sentToday(sessionId: string) {
  const { count, error } = await db.from('download_tokens')
    .select('token', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .gt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
  if (error) throw error
  return count ?? 0
}

const newToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function send(email: string, link: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: email,
      subject: 'Your Radial Keys download',
      text: `Here's your link to download Radial Keys:\n\n${link}\n\nIt works once, within a day. If you need it again, ask for a new one on the same page.\n\nQuestions? Reply to this email or write to management@bywhatevermedium.com.`,
      html: `<p>Here's your link to download Radial Keys:</p>
<p><a href="${link}" style="display:inline-block;padding:12px 22px;border-radius:12px;background:#3568e0;color:#fff;font-weight:700;text-decoration:none">Download Radial Keys</a></p>
<p style="color:#5f6878">It works once, within a day. If you need it again, ask for a new one on the same page.<br>Questions? Write to <a href="mailto:management@bywhatevermedium.com">management@bywhatevermedium.com</a>.</p>`,
      reply_to: 'management@bywhatevermedium.com',
    }),
  })
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`)
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'post' }, 405)
  // A form post (not JSON), so the browser sends it without a CORS preflight.
  const email = String((await req.formData()).get('email') ?? '').trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json({ error: 'email' }, 400)

  try {
    const sessionId = await purchaseFor(email)
    if (sessionId && (await sentToday(sessionId)) < MAX_PER_DAY) {
      const token = newToken()
      const { error } = await db.from('download_tokens').insert({ token, session_id: sessionId })
      if (error) throw error
      await send(email, `${SITE_URL}/radial-keys/thanks.html?token=${token}`)
    }
    return json({ ok: true })
  } catch (e) {
    console.error(e)
    return json({ error: 'server' }, 500)
  }
})
