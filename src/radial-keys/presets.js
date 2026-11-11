// The preset gallery. Each preset's button is dragged onto the wheel (tap the hotkey mid-drag to
// open it). Dropped anywhere else, it's the .rkpreset file. Clicking a card opens a preview you can
// click through (preview.js).
// The presets are in public/radial-keys/presets, listed in presets.json.
import { geometry, render } from './app/wheel.js'
import { openPreview } from './preview.js'

const DIR = '/radial-keys/presets/'

const GRIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>'

// Key labels as the app shows them (src-tauri/src/keys.rs).
const NUMPAD = { Decimal: '.', Add: '+', Subtract: '−', Multiply: '×', Divide: '÷', Enter: '⏎', Equal: '=' }
/** A slot's words: its own label, or its key ("KeyJ" → "J", "Numpad7" → "7"). */
const slotLabel = (it) => it.label || it.key.replace(/^(Key|Digit)/, '').replace(/^Numpad(.+)$/, (_, k) => NUMPAD[k] ?? k)

/** The preset's wheel, drawn by the app's renderer in its own colours, picture and gap colour. */
function thumbnail({ config, pictures }) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('class', 'wheel')
  svg.setAttribute('aria-hidden', 'true')
  const rings = config.rings.map((r) => r.items.map((it) => ({
    angle: it.angle,
    span: it.span,
    ...(it.menu ? { icon: 'folder', caption: it.label } : it.program ? { icon: 'app', caption: it.label } : { label: slotLabel(it) }),
    // A slot's own colours (fill behind, accent on its label).
    ...(it.colors?.fill ? { fill: it.colors.fill } : {}),
    ...(it.colors?.accent ? { color: it.colors.accent } : {}),
  })))
  const geo = geometry(config, rings.length)
  const size = 2 * (geo.outer + 8)
  const background = pictures[config.background] ?? ''
  render(svg, geo, size, rings, {}, { background })
  for (const [k, v] of Object.entries(colors(config, !!background))) svg.style.setProperty(k, v)
  // The gap colour: a band behind the slots that shows through the gaps.
  if (config.gapColor && config.gaps !== false) {
    const band = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    band.setAttribute('r', ((geo.r0 - 2 + geo.outer + 2) / 2).toFixed(1))
    band.setAttribute('fill', 'none')
    band.setAttribute('stroke', config.gapColor)
    band.setAttribute('stroke-width', (geo.outer - geo.r0 + 4).toFixed(1))
    svg.querySelector('.wheel-root').prepend(band)
  }
  return svg
}

// The wheel's colours from its accent and fill, as the app works them out (radial.js).
const rgbOf = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '')
  return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t))
const rgb = (c) => `rgb(${c.join(', ')})`
function colors({ accent, fill, theme }, picture) {
  const acc = rgbOf(accent)
  const bg = rgbOf(fill)
  if (!acc || !bg) return {}
  const light = (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255 > 0.45
  // A picture is the slots themselves; glass slots are see-through.
  const a = picture ? 0 : theme === 'glass' ? 0.62 : 1
  const rgba = (c) => `rgba(${c.join(', ')}, ${a})`
  return {
    '--accent': rgb(acc),
    '--text': rgb(acc),
    '--muted': rgb(mix(acc, bg, 0.4)),
    '--slice': rgba(bg),
    '--slice-alt': rgba(mix(bg, light ? [0, 0, 0] : [255, 255, 255], 0.06)),
    '--edge': light ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.08)',
  }
}

/** A preset file's pictures as data URLs, by name. */
function dataUrls(images = {}) {
  const type = (ext) => ({ svg: 'svg+xml', jpg: 'jpeg', ico: 'x-icon' })[ext] ?? ext
  return Object.fromEntries(Object.entries(images).map(([name, b64]) => [name, `data:image/${type(name.split('.').pop().toLowerCase())};base64,${b64}`]))
}

const IDLE = 'Drag to your wheel'
const DRAGGING = 'Tap hotkey, drop on wheel'

/**
 * The drag button. Used on each card and in the preview. `dragImage`: what follows the pointer.
 * Dragging is the only way in: a radialkeys:// link from a click didn't reliably open the app.
 */
export function getButton(entry, dragImage) {
  const wrap = document.createElement('div')
  wrap.className = 'rk-get-wrap'
  wrap.innerHTML = `<a class="rk-get" draggable="true">${GRIP}<span>${IDLE}</span></a>`
  const get = wrap.querySelector('.rk-get')
  const label = get.querySelector('span')
  get.href = entry.url
  get.title = `Drag ${entry.name} onto your wheel`

  // A click would only open the file: it stays put.
  get.addEventListener('click', (e) => e.preventDefault())
  get.addEventListener('dragstart', (e) => {
    const dt = e.dataTransfer
    dt.effectAllowed = 'copy'
    dt.setData('text/uri-list', entry.url)
    dt.setData('text/plain', entry.url)
    // Chrome: dropped on the desktop or a folder, it saves the file.
    dt.setData('DownloadURL', `application/octet-stream:${entry.file}:${entry.url}`)
    if (dragImage?.isConnected) dt.setDragImage(dragImage, 60, 60)
    // While it's dragged, the button says what to do next. (Right after dragstart: changing the
    // dragged element during it can cancel the drag. Not a frame later: Chrome holds frames
    // back while dragging, so the change showed up late.)
    setTimeout(() => {
      get.classList.add('dragging')
      label.textContent = DRAGGING
    })
  })
  get.addEventListener('dragend', () => {
    get.classList.remove('dragging')
    label.textContent = IDLE
  })
  return wrap
}

/**
 * A gallery card: the wheel beside its name and a one-line summary. Clicking it (anywhere but its
 * button) opens the preview, which has the full description.
 */
function card(entry) {
  const el = document.createElement('article')
  el.className = 'rk-preset'
  el.innerHTML = `
    <span class="rk-preset-wheel"></span>
    <div class="rk-preset-text">
      <h3></h3>
      <p class="rk-preset-blurb"></p>
      <button type="button" class="rk-preset-open">See full details</button>
    </div>`
  const open = el.querySelector('.rk-preset-open')
  const svg = thumbnail(entry)
  el.querySelector('.rk-preset-wheel').append(svg)
  el.querySelector('h3').textContent = entry.name
  open.setAttribute('aria-label', `See full details of ${entry.name}`)
  el.querySelector('.rk-preset-blurb').textContent = entry.summary ?? entry.blurb
  el.append(getButton(entry, svg))
  el.addEventListener('click', (e) => {
    if (!e.target.closest('.rk-get-wrap')) openPreview(entry, svg)
  })
  return el
}

export async function loadPresets() {
  const list = await (await fetch(DIR + 'presets.json')).json()
  const entries = await Promise.all(list.map(async ({ file, summary, blurb, group = 'colors' }) => {
    try {
      const preset = await (await fetch(DIR + file)).json()
      return {
        file, summary, blurb, group,
        name: preset.name,
        config: preset.config,
        pictures: dataUrls(preset.images),
        url: new URL(DIR + file, location.href).href,
      }
    } catch {
      return null // a broken file: leave it out
    }
  }))
  shelves(entries.filter(Boolean))
}

// --- the shelves: one row per group, or one group's every preset, a page at a time -------
const ROWS = 3 // rows on a page of See all (4 when it's one card across)

function shelves(entries) {
  const root = document.getElementById('shelves')
  const all = [...root.querySelectorAll('.rk-shelf')].map((el) => ({
    el,
    group: el.dataset.group,
    grid: el.querySelector('.rk-preset-grid'),
    pages: el.querySelector('.rk-pages'),
    seeAll: el.querySelector('.rk-see-all'),
    close: el.querySelector('.rk-shelf-close'),
    page: 0,
  }))
  let open = null // the shelf shown on its own

  for (const s of all) {
    s.grid.replaceChildren(...entries.filter((e) => e.group === s.group).map(card))
    s.el.hidden = !s.grid.children.length
    s.seeAll.addEventListener('click', () => show(s))
    s.close.addEventListener('click', () => show(null))
  }

  function show(shelf) {
    const was = open
    open = shelf
    if (shelf) shelf.page = 0
    layout()
    if (shelf) shelf.close.focus({ preventScroll: true })
    else was?.seeAll.focus({ preventScroll: true })
    // Back to the top of the presets if the change left you below them.
    const top = root.getBoundingClientRect().top
    if (top < 0) root.scrollIntoView({ block: 'start' })
  }

  /** How many cards fit across: the grid's own column count at this width. */
  const columns = (grid) => getComputedStyle(grid).gridTemplateColumns.split(' ').length || 1

  function layout() {
    // Shown or hidden first: a hidden grid has no columns to count.
    for (const s of all) {
      s.el.classList.toggle('open', s === open)
      s.el.classList.toggle('shut', !!open && s !== open)
    }
    for (const s of all) {
      if (s.el.classList.contains('shut')) continue
      const cards = [...s.grid.children]
      const cols = columns(s.grid)
      const expanded = s === open
      s.seeAll.hidden = expanded || cards.length <= cols
      s.seeAll.textContent = `See all ${cards.length}`
      if (!expanded) {
        cards.forEach((c, i) => { c.hidden = i >= cols })
        s.pages.replaceChildren()
        continue
      }
      const per = cols * (cols === 1 ? ROWS + 1 : ROWS)
      const count = Math.ceil(cards.length / per)
      s.page = Math.min(s.page, count - 1)
      cards.forEach((c, i) => { c.hidden = Math.floor(i / per) !== s.page })
      pager(s, count)
    }
  }

  /** Previous, the page numbers, Next. Nothing when it's all on one page. */
  function pager(s, count) {
    if (count < 2) return s.pages.replaceChildren()
    const button = (text, page, label) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = text
      if (label) b.setAttribute('aria-label', label)
      if (page === s.page && text === String(page + 1)) b.setAttribute('aria-current', 'page')
      b.disabled = page < 0 || page >= count
      b.addEventListener('click', () => {
        s.page = page
        layout()
        s.pages.querySelector(`[data-p="${text}"]`)?.focus()
      })
      b.dataset.p = text
      return b
    }
    s.pages.replaceChildren(
      button('‹', s.page - 1, 'Previous page'),
      ...Array.from({ length: count }, (_, i) => button(String(i + 1), i, `Page ${i + 1}`)),
      button('›', s.page + 1, 'Next page'),
    )
  }

  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open && !document.querySelector('dialog[open]')) show(null)
  })
  // Columns change with the width, so the rows and pages are worked out again.
  let last = 0
  new ResizeObserver(([e]) => {
    const w = Math.round(e.contentRect.width)
    if (w !== last) { last = w; requestAnimationFrame(layout) } // a frame on: layout changes the height
  }).observe(root)
  layout()
}
