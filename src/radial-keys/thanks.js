import '@fontsource/inter/400.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/inter/800.css'
import '../style.css'
import './page.css'
import { FUNCTIONS_URL } from './store.js'

// Stripe sends buyers here with ?session_id=cs_…; the download function swaps it for signed links.
const page = document.getElementById('thanks')
const params = new URLSearchParams(location.search)
const sessionId = params.get('session_id')

async function load() {
  if (params.has('error') || !FUNCTIONS_URL) return 'error'
  if (!sessionId) return 'unpaid'
  const res = await fetch(`${FUNCTIONS_URL}/download?session_id=${encodeURIComponent(sessionId)}`)
  if (res.status === 402 || res.status === 400) return 'unpaid'
  if (!res.ok) return 'error'
  const links = await res.json()
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
