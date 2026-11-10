import '@fontsource/inter/400.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/inter/800.css'
import '../style.css'
import './page.css'
import { FUNCTIONS_URL } from './store.js'

// Stripe sends buyers here with ?session_id=cs_…, good for one download; emailed links bring ?token=…,
// also good once (supabase/functions/download). The links last a few minutes. After that, or with no
// download left, the page asks for the buyer's email and resend-link sends a new link there.
const page = document.getElementById('thanks')
const params = new URLSearchParams(location.search)
const sessionId = params.get('session_id')
const token = params.get('token')

// Ask for a new link by email, and why.
function again(why) {
  page.dataset.why = why
  return 'again'
}

async function load() {
  if (params.has('error') || !FUNCTIONS_URL) return 'error'
  if (!sessionId && !token) return again('none')
  const query = token ? `token=${encodeURIComponent(token)}` : `session_id=${encodeURIComponent(sessionId)}`
  const res = await fetch(`${FUNCTIONS_URL}/download?${query}`)
  if (res.status === 402 || res.status === 400) return 'unpaid'
  if (res.status === 410) return again(token ? 'token' : 'used')
  if (!res.ok) return 'error'
  const { links, seconds } = await res.json()
  setTimeout(() => { page.dataset.state = again('expired') }, seconds * 1000)
  // The buyer's own system first.
  const mine = /Mac/.test(navigator.platform || navigator.userAgent) ? 'mac' : 'windows'
  for (const a of page.querySelectorAll('[data-os]')) {
    const link = links[a.dataset.os]
    if (!link) continue
    a.href = link.url
    a.hidden = false
    if (a.dataset.os !== mine) a.classList.add('rk-dl-other')
    else a.parentElement.prepend(a)
  }
  return 'ready'
}

load().catch(() => 'error').then((state) => { page.dataset.state = state })

document.getElementById('email-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const form = e.currentTarget
  const button = form.querySelector('button')
  button.disabled = true
  try {
    // A form post, not JSON: no CORS preflight.
    const res = await fetch(`${FUNCTIONS_URL}/resend-link`, { method: 'POST', body: new URLSearchParams(new FormData(form)) })
    if (!res.ok) throw new Error(res.status)
    page.querySelector('[data-sent-to]').textContent = form.email.value.trim()
    page.dataset.state = 'sent'
  } catch {
    page.dataset.state = 'error'
  } finally {
    button.disabled = false
  }
})
