import '@fontsource/inter/400.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/inter/800.css'
import '../style.css'
import './app/wheel.css'
import './page.css'
import { geometry, render } from './app/wheel.js'
import { PROGRAMS } from './programs.js'
import { mountDemo } from './demo-frame.js'
import { loadPresets } from './presets.js'
import { BUY_URL } from './store.js'

// Both Buy buttons start a Stripe Checkout (store.js). nofollow: a crawler shouldn't open checkouts.
for (const a of document.querySelectorAll('[data-buy]')) {
  a.href = BUY_URL
  a.rel = 'nofollow'
}
loadPresets(BUY_URL)

// --- the demo: the iframe scaled so the rings on show fill the stage ------------
const stage = document.getElementById('stage')
const clickMe = document.getElementById('clickme')
mountDemo(stage, document.getElementById('demo'), {
  onMessage(data) {
    if (data.type === 'touched') clickMe.classList.add('gone')
    else if (data.type === 'tour') showTour(data)
  },
})

// --- the tour: the frame clicks through the wheel by itself until someone clicks it ------
const tour = document.getElementById('tour')
const tourCaption = document.getElementById('tour-caption')
const tourKeys = document.getElementById('tour-keys')
const IDLE = tourCaption.textContent // what it says when the wheel is yours
function showTour({ on, caption, keys = [] }) {
  tour.classList.toggle('idle', !on)
  clickMe.classList.toggle('touring', on)
  tourCaption.textContent = on ? caption : IDLE
  tourKeys.replaceChildren(...keys.map((k) => {
    const el = document.createElement('kbd')
    el.textContent = k
    return el
  }))
}

// --- what a slot can be: real slots, drawn by the app's own renderer -----------
const SLOTS = [
  {
    id: 'key',
    name: 'Key',
    slot: { label: 'F5' },
    text: "Presses a key or a combo in the app you're in: numpad keys, F1–F24, Ctrl+C, or a left, right, middle, Mouse 4 or Mouse 5 click.",
    how: 'Right-click one and choose Key, then press the new key, or scroll to pick any key, even ones your keyboard doesn’t have.',
  },
  {
    id: 'menu',
    name: 'Sub-menu',
    slot: { icon: 'folder', caption: 'Edit' },
    text: 'Swaps the whole wheel for its own slots, which can include more sub-menus.',
    how: 'Give one its own hotkey to open straight into it, and its own colours, picture and size.',
  },
  {
    id: 'program',
    name: 'Program',
    slot: { picture: PROGRAMS[0].icon, caption: 'Browser' },
    text: 'Opens a program, shortcut or script and brings it to the front, showing its own icon and name.',
    how: 'Add one from Options → Program, then drop it anywhere on the wheel.',
  },
  {
    id: 'back',
    name: 'Back',
    slot: { icon: 'back', caption: 'Back', cls: 'back-slot' },
    text: 'Sits in every sub-menu, in the same spot as the slot you came in through, so the way out is where you went in.',
    how: 'Click it or press Esc. Right-click it to move it somewhere else.',
  },
  {
    id: 'reusable',
    name: 'Reusable menu',
    slot: { icon: 'folder', caption: 'Apps', linked: true },
    text: 'One menu in as many places as you like. Change it anywhere and every slot showing it changes too. The chain link marks it.',
    how: 'Right-click a sub-menu and choose Make reusable. Make a separate copy whenever one needs to differ.',
  },
  {
    id: 'preset',
    name: 'Preset',
    slot: { label: 'Gaming', sub: '✓ in use', curved: true, cls: 'preset current' },
    text: 'Your whole setup under one name: rings, slots, colours and pictures. Click one in Options → Presets to switch.',
    how: 'Export one as a file to use it on another computer.',
  },
]

const tiles = document.getElementById('tiles')
const explain = document.getElementById('explain')
const geo = geometry({ innerRadius: 48, ringWidth: 64, ringGap: 6 }, 1)
const entries = SLOTS.map((s) => {
  const tile = document.createElement('button')
  tile.type = 'button'
  tile.className = 'rk-tile'
  tile.innerHTML = '<svg class="wheel" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"></svg><span></span>'
  tile.querySelector('span').textContent = s.name
  tiles.append(tile)
  const svg = tile.querySelector('svg')
  const drawn = render(svg, geo, 240, [[{ angle: 0, span: 64, ...s.slot }]], {})
  svg.setAttribute('viewBox', '-64 -116 128 80')

  const panel = document.createElement('div')
  panel.className = 'rk-explain-one'
  const title = document.createElement('h3')
  title.textContent = s.name
  const text = document.createElement('p')
  text.textContent = s.text
  const how = document.createElement('p')
  how.className = 'rk-how'
  how.textContent = s.how
  panel.append(title, text, how)
  explain.append(panel)

  const entry = { tile, panel, drawn }
  tile.addEventListener('pointerenter', () => select(entry))
  tile.addEventListener('focus', () => select(entry))
  tile.addEventListener('click', () => select(entry))
  return entry
})

function select(chosen) {
  for (const e of entries) {
    const on = e === chosen
    e.tile.setAttribute('aria-pressed', on)
    e.panel.classList.toggle('on', on)
    e.drawn.setActive(on ? { ring: 0, index: 0 } : null)
  }
}
select(entries[0])
