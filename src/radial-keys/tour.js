// The tour: until someone clicks the wheel, a made-up pointer clicks through it by itself. Its
// clicks and keys are real events for the app's real UI (no shortcuts), so it shows exactly
// what the app does. The first real click, scroll or key stops it, puts the wheel back to how
// the demo starts and hands it over. To change what it shows, edit play().
import { KEYS, emit, open, reset, sent } from './bridge.js'
import { PROGRAMS } from './programs.js'
import { ICONS } from './app/wheel.js'

const mac = /Mac|iPhone|iPad/.test(navigator.platform)
const HOTKEY = mac ? ['⌘', '⇧', 'Space'] : ['Ctrl', 'Shift', 'Space']
const CMD = mac ? '⌘' : 'Ctrl'
const SPEED = Number(new URLSearchParams(parent.location.search).get('tour-speed')) || 1

const tell = (data) => parent.postMessage(data, location.origin)

// --- running, pausing, stopping ----------------------------------------------------
let running = false
let visible = true // the page says when the demo is scrolled out of sight
const ended = new Error('tour ended')

// Every wait goes through this clock, so the tour holds still while it's out of sight.
const waiters = new Set()
let last = performance.now()
function tick(now) {
  const dt = Math.min(now - last, 50) * SPEED
  last = now
  if (visible) {
    for (const w of [...waiters]) {
      w.elapsed = Math.min(w.elapsed + dt, w.ms)
      w.step?.(w.ms ? w.elapsed / w.ms : 1)
      if (w.elapsed >= w.ms) {
        waiters.delete(w)
        w.done()
      }
    }
  }
  if (running) requestAnimationFrame(tick)
}
function tween(ms, step) {
  if (!running) return Promise.reject(ended)
  return new Promise((done, fail) => waiters.add({ ms, step, elapsed: 0, done: () => (running ? done() : fail(ended)) }))
}
const wait = (ms) => tween(ms)
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

// A real click, scroll or key takes over. Real pointer moves are kept from the wheel while
// the tour runs, so passing over it on the way somewhere doesn't get in the way.
const TAKE_OVER = ['pointerdown', 'wheel', 'keydown', 'contextmenu']
for (const type of [...TAKE_OVER, 'pointermove', 'pointerup', 'pointerleave', 'mousedown', 'mouseup', 'click']) {
  window.addEventListener(type, (e) => {
    if (!running || !e.isTrusted) return
    e.stopImmediatePropagation()
    if (!TAKE_OVER.includes(type)) return
    e.preventDefault()
    tell({ type: 'touched' }) // this click never reaches the app, so say it here
    stop()
  }, { capture: true })
}

const appFocus = window.focus
function stop() {
  running = false
  for (const w of waiters) w.done()
  waiters.clear()
  window.focus = appFocus
  sent.listener = null
  cursor.remove()
  emit('radial-escape') // out of whatever it was in the middle of (typing a name, placing a slot)
  reset()
  tell({ type: 'tour', on: false })
}

window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || e.source !== parent || e.data.type !== 'visible') return
  visible = e.data.on
})

// --- the pointer ---------------------------------------------------------------------
const cursor = document.createElement('div')
cursor.className = 'tour-cursor'
cursor.innerHTML = '<span class="tour-ripple"></span><svg viewBox="0 0 26 30" width="26" height="30"><path d="M3 2v22l6-5.5 4 9 4.2-1.9-4-8.8H21z"/></svg><span class="tour-label">Right-click</span>'
let at = { x: 0, y: 0 }

function place(p) {
  at = p
  cursor.style.left = `${p.x}px`
  cursor.style.top = `${p.y}px`
}

function fire(type, extra = {}) {
  const target = type === 'pointerdown' ? document.elementFromPoint(at.x, at.y) ?? document : document
  target.dispatchEvent(new PointerEvent(type, { clientX: at.x, clientY: at.y, bubbles: true, cancelable: true, ...extra }))
}

async function moveTo(p, ms = 600) {
  const from = at
  await tween(ms, (t) => {
    const e = ease(t)
    place({ x: from.x + (p.x - from.x) * e, y: from.y + (p.y - from.y) * e })
    fire('pointermove')
  })
}

async function press(button) {
  const ripple = cursor.querySelector('.tour-ripple')
  ripple.classList.remove('go')
  void ripple.offsetWidth
  ripple.classList.add('go')
  cursor.classList.toggle('right', button === 2)
  cursor.classList.add('down')
  await wait(90)
  fire('pointerdown', { button })
  fire('pointerup', { button })
  cursor.classList.remove('down')
  await wait(button === 2 ? 650 : 330)
  cursor.classList.remove('right')
}

const click = async (p, ms) => {
  await moveTo(p, ms)
  await wait(170)
  await press(0)
}
const rightClick = async (p) => {
  await moveTo(p)
  await wait(220)
  await press(2)
}

// --- finding things on the wheel -------------------------------------------------------
const wheel = document.getElementById('wheel')
function middle(node) {
  const r = (node.querySelector(':scope > path') ?? node).getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}
function center() {
  return middle(wheel)
}
const slices = () => [...wheel.querySelectorAll('.slice:not(.off)')]

/** The slot showing these words: a key's label, a slot's name, a menu choice. */
function slot(text) {
  const node = slices().find((s) => [...s.querySelectorAll('text')].some((t) => t.textContent.trim() === text))
  if (!node) throw new Error(`Tour: no slot says "${text}"`)
  return middle(node)
}
/** A slot by where it is: ring `ring`, `index`th from the top (for slots that show only a picture). */
function ringSlot(ring, index) {
  const node = wheel.querySelectorAll(`.ring-${ring} > .slice`)[index]
  if (!node) throw new Error(`Tour: no slot ${index} on ring ${ring}`)
  return middle(node)
}
/** An option, by its icon (captions can be cut short or turned off). In a menu that opened from
 *  an option, the one it opened from (outlined) is skipped: Add's Slot has Add's + icon too. */
function option(icon) {
  const d = ICONS[icon][0]
  const node = slices().find((s) => (s.classList.contains('opt') || s.classList.contains('act')) && !s.classList.contains('act-source') && [...s.querySelectorAll('.icon path')].some((p) => p.getAttribute('d') === d))
  if (!node) throw new Error(`Tour: no option with the ${icon} icon`)
  return middle(node)
}
/** A colour swatch, by its place in the colour ring. */
function swatch(index) {
  const node = wheel.querySelectorAll('.slice.swatch')[index]
  if (!node) throw new Error(`Tour: no swatch ${index}`)
  return middle(node)
}
/** A point in a ring at an angle (clockwise from the top), from the wheel's own sizes. */
function inRing(ring, angle) {
  const g = ringSizes()
  const rad = g.r0 + ring * g.pitch + g.w / 2
  const c = center()
  const a = (angle * Math.PI) / 180
  return { x: c.x + rad * Math.sin(a), y: c.y - rad * Math.cos(a) }
}
// Ring sizes, read off the slots drawn: inner radius, ring width and the step between rings.
function ringSizes() {
  const c = center()
  const radii = [...wheel.querySelectorAll('.ring')].map((ring) => {
    const s = ring.querySelector('.slice > path')
    if (!s) return null
    const len = s.getTotalLength()
    const pts = Array.from({ length: 24 }, (_, i) => s.getPointAtLength((i / 24) * len))
    const ctm = s.getScreenCTM()
    const d = pts.map((p) => {
      const q = p.matrixTransform(ctm)
      return Math.hypot(q.x - c.x, q.y - c.y)
    })
    return { inner: Math.min(...d), outer: Math.max(...d) }
  }).filter(Boolean)
  const w = radii[0].outer - radii[0].inner
  return { r0: radii[0].inner, w, pitch: radii[1] ? radii[1].inner - radii[0].inner : w + 6 }
}

// --- the keyboard ------------------------------------------------------------------------
const say = (caption, keys = []) => tell({ type: 'tour', on: true, caption, keys })
let caption = ''
const chapter = (text) => say((caption = text))
const showKeys = (keys) => say(caption, keys)

async function holdAndSend(text) {
  showKeys(HOTKEY)
  emit('radial-close')
  await wait(120)
  open(true)
  await wait(380)
  const p = slot(text)
  await moveTo(p, 520)
  await wait(260)
  showKeys([])
  const c = center()
  emit('radial-release', { dx: p.x - c.x, dy: p.y - c.y })
  await wait(900)
}

async function type(text) {
  for (const ch of text) {
    showKeys([ch.toUpperCase()])
    emit('radial-key', { code: `Key${ch.toUpperCase()}`, mods: [], text: ch })
    await wait(190)
  }
  showKeys(['Enter'])
  await wait(240)
  emit('radial-key', { code: 'Enter', mods: [], text: null })
  await wait(420)
  showKeys([])
}

async function pressKeys(labels, code, mods = []) {
  showKeys(labels)
  await wait(320)
  emit('radial-key', { code, mods })
  await wait(600)
  showKeys([])
}

async function escape() {
  showKeys(['Esc'])
  await wait(250)
  emit('radial-escape')
  await wait(450)
  showKeys([])
}

// Say what was sent, since here it doesn't go anywhere.
const MOD = { ctrl: mac ? '⌃' : 'Ctrl', alt: mac ? '⌥' : 'Alt', shift: mac ? '⇧' : 'Shift', meta: mac ? '⌘' : 'Win' }
function sentWhat({ key, mods = [], program }) {
  if (program) return `Opened ${PROGRAMS.find((p) => p.path === program)?.name ?? 'the program'}`
  const name = KEYS.find((k) => k.code === key)?.name ?? key
  return `Sent ${[...mods.map((m) => MOD[m]), name].join(mac ? '' : '+')}`
}

// --- the script ----------------------------------------------------------------------------
async function play() {
  chapter('Hold the hotkey, point at a key, let go.')
  await moveTo(center(), 700)
  await holdAndSend('7')
  await holdAndSend('F5')

  chapter('Sub-menus open in place.')
  await click(ringSlot(2, 0)) // Edit: the pencil at the top of the outer ring
  await wait(700)
  await click(slot('Copy'))
  await wait(700)

  chapter('Right-click any slot to change it.')
  await rightClick(slot('F5'))
  await wait(450)
  await click(slot('Rename'))
  await wait(250)
  await type('Save')
  await wait(400)
  chapter('Give one slot its own colour.')
  await rightClick(slot('Save'))
  await click(slot('Colors'))
  await wait(450)
  await click(swatch(5))
  await wait(700)
  await escape()
  await escape()
  await wait(300)

  chapter('Click the center for Options. Pick a colour and the whole wheel follows.')
  await click(center())
  await wait(800)
  await click(swatch(2))
  await wait(700)
  await click(swatch(13))
  await wait(700)
  await click(option('check'))
  await wait(900)

  chapter('Add a slot anywhere. The others make room.')
  await click(center())
  await wait(600)
  await click(option('plus')) // Add
  await wait(500)
  await click(option('plus')) // → Slot
  await moveTo(inRing(0, 11), 900)
  await wait(500)
  await press(0)
  await wait(450)
  chapter('Then press any key or combo for it.')
  await pressKeys([CMD, 'D'], 'KeyD', [mac ? 'meta' : 'ctrl'])
  await wait(900)

  chapter('Your turn: click the wheel to try it yourself.')
  await holdAndSend('Save')
  await wait(2200)
}

async function run() {
  // Give the page a moment to show, and the app to draw.
  while (!wheel.querySelector('.slice')) await new Promise((r) => setTimeout(r, 50))
  running = true
  requestAnimationFrame(tick)
  window.focus = () => {} // the app asks for the keyboard when it waits for a key; the tour types its own
  sent.listener = (what) => showKeys([sentWhat(what)])
  document.body.append(cursor)
  place(center())
  say('Watch, or click the wheel to try it yourself.')
  try {
    await wait(1200)
    for (;;) {
      await play()
      reset()
      await wait(1200)
    }
  } catch (e) {
    if (e !== ended) {
      console.error(e) // the app changed under the script: leave the demo to the visitor
      stop()
    }
  }
}

if (!matchMedia('(prefers-reduced-motion: reduce)').matches) run()
