// A stand-in for the app's Rust backend (src-tauri), so its real UI runs in a web page.
// It answers the same commands from memory: the setup lives until you reload. Sending a key
// or opening a program only closes the wheel, and closing it opens it again right away.
import { APPS_GLYPH, EDIT_GLYPH, MENU_PROGRAMS, PROGRAMS, RING_PROGRAMS } from './programs.js'

const WINDOW = 1600 // the iframe's size inside (page.css), with the wheel's center in the middle of it
const NO_FILES = 'Preset files work in the app, not in this demo'
const mac = /Mac|iPhone|iPad/.test(navigator.platform)
const platform = mac ? 'macos' : 'windows'
const clone = (v) => JSON.parse(JSON.stringify(v))

// --- keys (src-tauri/src/keys.rs) ------------------------------------------------
export const KEYS = []
const key = (code, label, name, group, on = 'both') => {
  if (on === 'both' || on === platform) KEYS.push({ code, label, name, group })
}
for (let i = 0; i < 10; i++) key(`Numpad${i}`, `${i}`, `Numpad ${i}`, 'Numpad')
key('NumpadDecimal', '.', 'Numpad .', 'Numpad')
key('NumpadAdd', '+', 'Numpad +', 'Numpad')
key('NumpadSubtract', '−', 'Numpad −', 'Numpad')
key('NumpadMultiply', '×', 'Numpad ×', 'Numpad')
key('NumpadDivide', '÷', 'Numpad ÷', 'Numpad')
key('NumpadEnter', '⏎', 'Numpad Enter', 'Numpad')
key('NumpadEqual', '=', 'Numpad =', 'Numpad', 'macos')
key('NumLock', 'Num', 'Num Lock', 'Numpad', 'windows')
key('NumpadClear', 'Clr', 'Numpad Clear', 'Numpad', 'macos')
for (let i = 1; i <= 24; i++) key(`F${i}`, `F${i}`, `F${i}`, 'Function', i <= 20 ? 'both' : 'windows')
key('MouseMiddle', 'MMB', 'Middle mouse', 'Mouse')
key('MouseBack', 'M4', 'Mouse 4', 'Mouse')
key('MouseForward', 'M5', 'Mouse 5', 'Mouse')
key('MouseLeft', 'LMB', 'Left click', 'Mouse')
key('MouseRight', 'RMB', 'Right click', 'Mouse')
key('Insert', 'Ins', 'Insert', 'Navigation')
key('Delete', 'Del', 'Delete', 'Navigation')
key('Home', 'Home', 'Home', 'Navigation')
key('End', 'End', 'End', 'Navigation')
key('PageUp', 'PgUp', 'Page Up', 'Navigation')
key('PageDown', 'PgDn', 'Page Down', 'Navigation')
key('ArrowUp', '↑', 'Arrow Up', 'Navigation')
key('ArrowDown', '↓', 'Arrow Down', 'Navigation')
key('ArrowLeft', '←', 'Arrow Left', 'Navigation')
key('ArrowRight', '→', 'Arrow Right', 'Navigation')
key('PrintScreen', 'PrtSc', 'Print Screen', 'System', 'windows')
key('ScrollLock', 'ScrLk', 'Scroll Lock', 'System', 'windows')
key('Pause', 'Pause', 'Pause / Break', 'System', 'windows')
key('ContextMenu', 'Menu', 'Context Menu', 'System')
key('Escape', 'Esc', 'Escape', 'System')
key('Tab', 'Tab', 'Tab', 'System')
key('CapsLock', 'Caps', 'Caps Lock', 'System')
key('Space', 'Space', 'Space', 'System')
key('Enter', 'Enter', 'Enter', 'System')
key('Backspace', '⌫', 'Backspace', 'System')
key('MediaPlayPause', '⏯', 'Play / Pause', 'Media', 'windows')
key('MediaStop', '⏹', 'Stop', 'Media', 'windows')
key('MediaTrackNext', '⏭', 'Next Track', 'Media', 'windows')
key('MediaTrackPrevious', '⏮', 'Previous Track', 'Media', 'windows')
key('AudioVolumeUp', '🔊', 'Volume Up', 'Media', 'windows')
key('AudioVolumeDown', '🔉', 'Volume Down', 'Media', 'windows')
key('AudioVolumeMute', '🔇', 'Mute', 'Media', 'windows')
for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') key(`Key${c}`, c, c, 'Letters')
for (let i = 0; i < 10; i++) key(`Digit${i}`, `${i}`, `${i} (top row)`, 'Digits')
key('Minus', '-', 'Minus', 'Symbols')
key('Equal', '=', 'Equals', 'Symbols')
key('BracketLeft', '[', 'Left Bracket', 'Symbols')
key('BracketRight', ']', 'Right Bracket', 'Symbols')
key('Backslash', '\\', 'Backslash', 'Symbols')
key('Semicolon', ';', 'Semicolon', 'Symbols')
key('Quote', "'", 'Quote', 'Symbols')
key('Backquote', '`', 'Backquote', 'Symbols')
key('Comma', ',', 'Comma', 'Symbols')
key('Period', '.', 'Period', 'Symbols')
key('Slash', '/', 'Slash', 'Symbols')
key('IntlBackslash', '§', 'ISO extra key', 'Symbols')

// --- the setup the demo starts with: the app's default rings, and an outer ring with the other kinds of slot ---
const evenRing = (items) => ({
  items: items.map((it, i) => ({ label: '', key: 'F13', mods: [], ...it, angle: (i * 360) / items.length, span: 360 / items.length })),
})
const keysRing = (codes, fill) => evenRing(codes.map((key) => ({ key, ...(fill ? { colors: { fill } } : {}) })))
const cmd = mac ? 'meta' : 'ctrl'
const program = (p) => ({ label: p.name, program: p.path })
const defaults = () => ({
  hotkey: 'CommandOrControl+Shift+Space',
  holdToSelect: true,
  tapMs: 220,
  innerRadius: 58,
  ringWidth: 64,
  ringGap: 6,
  // A light wheel: grey rings, darker toward the center, white outside, blue labels.
  accent: '#3d7ef2',
  fill: '#ffffff',
  theme: 'solid',
  background: '',
  gaps: false,
  optionLabels: false,
  showApp: true,
  rings: [
    keysRing([...Array(10).keys()].map((i) => `Numpad${i}`).concat(['NumpadDecimal', 'NumpadDivide', 'NumpadMultiply', 'NumpadSubtract', 'NumpadAdd', 'NumpadEnter']), '#cfcdd2'),
    keysRing([...Array(12).keys()].map((i) => `F${i + 1}`), '#ebebef'),
    // Icons only out here: pointing at one still names it.
    evenRing([
      {
        label: 'Edit',
        image: 'demo-edit',
        hideLabel: true,
        menu: {
          hotkey: '',
          rings: [
            evenRing([
              { label: 'Copy', key: 'KeyC', mods: [cmd] },
              { label: 'Paste', key: 'KeyV', mods: [cmd] },
              { label: 'Cut', key: 'KeyX', mods: [cmd] },
              { label: 'Undo', key: 'KeyZ', mods: [cmd] },
              { label: 'Redo', key: 'KeyZ', mods: [cmd, 'shift'] },
              { label: 'All', key: 'KeyA', mods: [cmd] },
            ]),
          ],
        },
      },
      { label: 'Apps', menu: { hotkey: '', rings: [], link: 'apps' } },
      ...RING_PROGRAMS.map((p) => ({ ...program(p), hideLabel: true })),
    ]),
  ],
  menus: [{ id: 'apps', label: 'Apps', image: 'demo-apps', hideLabel: true, rings: [evenRing(MENU_PROGRAMS.map(program))] }],
})

// --- state ------------------------------------------------------------------------
// What the wheel starts with (and Reset goes back to): the demo setup, or a preset the page sent
// to preview (see the 'preset' message below).
let start = defaults
let config = start()
let presets = []
const undoStore = { presets: null, config: null }
let autostart = false
const images = new Map([['demo-edit', EDIT_GLYPH], ['demo-apps', APPS_GLYPH]]) // picture name -> data URL
let nextImage = 1
let nextProgram = 0

function tell(data) {
  parent.postMessage(data, location.origin)
}

// --- events to the UI -------------------------------------------------------------
const listeners = new Map()
export const emit = (event, payload) => listeners.get(event)?.forEach((f) => f({ event, payload }))

function wheelSize(rings, look) {
  const n = Math.max(rings, 1)
  return (look.innerRadius + n * look.ringWidth + (n - 1) * look.ringGap + 28) * 2
}

function layoutFor(rings, look = config) {
  const n = Math.max(rings, 1)
  const size = wheelSize(n, look)
  currentLook = look
  currentRings = n
  return { width: WINDOW, height: WINDOW, size, banner: (WINDOW - size) / 2, rings: n }
}

// The page zooms to the rings on show, which can be fewer than the layout has room for (Options
// shows two of three). While placing a slot, the ring it could start counts too.
let currentLook = config
let currentRings = 1
let toldSize = 0
const wheelSvg = document.getElementById('wheel')
new MutationObserver(() => {
  const rings = [...wheelSvg.querySelectorAll('.ring')]
  const shown = wheelSvg.querySelector('.ring-guide') ? currentRings : rings.findLastIndex((r) => r.querySelector('.slice')) + 1
  const size = wheelSize(shown, currentLook)
  if (size !== toldSize) tell({ type: 'layout', size: (toldSize = size) })
}).observe(wheelSvg, { childList: true })

// The first press anywhere on the wheel takes the page's "click me" away. (Only a real one:
// the tour's clicks are made up, see tour.js.)
const touched = (e) => {
  if (!e.isTrusted) return
  tell({ type: 'touched' })
  document.removeEventListener('pointerdown', touched, { capture: true })
}
document.addEventListener('pointerdown', touched, { capture: true })

// The app gets Esc and Ctrl+Z from Rust. Here they need the keyboard, and the UI's own
// pointerdown handling keeps a click from giving it to this frame.
document.addEventListener('pointerdown', (e) => e.isTrusted && window.focus(), { capture: true })

export function open(hold = false) {
  emit('radial-open', { layout: layoutFor(config.rings.length), hold, welcome: false, app: { id: 'demo', name: 'Your app' }, path: [], notice: null })
}

// Closing puts the wheel straight back, with the slot under the pointer still lit.
let reopenTimer
let pointer = null
document.addEventListener('pointermove', (e) => {
  pointer = { x: e.clientX, y: e.clientY }
})
function closeAndReopen() {
  clearTimeout(reopenTimer)
  emit('radial-close')
  reopenTimer = setTimeout(() => {
    open()
    if (pointer) emit('radial-pointer', pointer)
  }, 60)
}

// Back to the setup the demo starts with, and the wheel opened fresh on it.
export function reset() {
  config = start()
  presets = []
  undoStore.presets = undoStore.config = null
  autostart = false
  nextProgram = 0
  closeAndReopen()
}

// What was just sent or opened, for the tour to show. (Here they don't go anywhere.)
export const sent = { listener: null }

// --- menus ------------------------------------------------------------------------
const body = (menu) => (menu.link && config.menus?.find((m) => m.id === menu.link)) || menu
function findMenu(rings, step) {
  return rings[step.ring]?.items.find((it) => it.menu && Math.abs(it.angle - step.angle) < 0.01)?.menu
}
function lookAt(path = []) {
  let look = config
  let rings = config.rings
  for (const step of path) {
    const menu = findMenu(rings, step)
    if (!menu) break
    const b = body(menu)
    look = b.look ?? look
    rings = b.rings
  }
  return look
}

// --- presets (src-tauri/src/presets.rs) --------------------------------------------
const stripped = (c) => JSON.stringify({ ...c, hotkey: 0, preset: 0, dismissedNotice: 0 })
const countSlots = (rings) => rings.reduce((n, r) => n + r.items.length, 0)
function presetList() {
  const current = stripped(config)
  const infos = presets.map((p) => ({
    name: p.name,
    accent: p.config.accent,
    fill: p.config.fill,
    rings: p.config.rings.length,
    slots: countSlots(p.config.rings),
    background: !!p.config.background,
    same: stripped(p.config) === current,
    colors: p.colors ?? undefined,
  }))
  return {
    presets: infos,
    active: presets.some((p) => p.name === config.preset) ? config.preset : '',
    saved: infos.some((i) => i.same),
  }
}
const taken = (name, except) => presets.some((p) => p.name !== except && p.name.toLowerCase() === name.toLowerCase())
function cleanName(name) {
  const clean = [...name.replace(/\p{Cc}/gu, '').trim().replace(/\s+/g, ' ')].slice(0, 32).join('')
  if (!clean) throw 'Give it a name'
  return clean
}
function nextName() {
  for (let n = 1; ; n++) if (!taken(`Preset ${n}`)) return `Preset ${n}`
}
const find = (name) => presets.find((p) => p.name === name) ?? (() => { throw `There's no preset called ${name} any more` })()
function switchTo(next) {
  const prev = config
  config = { ...next, hotkey: prev.hotkey }
  return prev
}
const switched = () => ({ config: clone(config), list: presetList(), warnings: [] })

// --- pictures: a file input instead of the app's file dialog --------------------------
function pickImage(prefix) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.addEventListener('cancel', () => {
      window.focus()
      resolve(null)
    })
    input.addEventListener('change', () => {
      window.focus() // the dialog took the keyboard: Esc and Ctrl+Z should work again
      const file = input.files?.[0]
      if (!file) return resolve(null)
      const reader = new FileReader()
      reader.onerror = () => reject("Couldn't read that picture")
      reader.onload = () => {
        const name = `${prefix}-${nextImage++}`
        images.set(name, reader.result)
        resolve(name)
      }
      reader.readAsDataURL(file)
    })
    input.click()
  })
}

// --- importing (src-tauri/src/presets.rs) ------------------------------------------------
function addPreset(text, fileName = '') {
  let file
  try {
    file = JSON.parse(text)
  } catch {
    throw "That file isn't a Radial Keys preset"
  }
  if (!file?.radialKeysPreset || !Array.isArray(file.config?.rings)) throw "That file isn't a Radial Keys preset"
  const type = (n) => ({ svg: 'svg+xml', jpg: 'jpeg', ico: 'x-icon' })[n.split('.').pop().toLowerCase()] ?? n.split('.').pop().toLowerCase()
  for (const [name, b64] of Object.entries(file.images ?? {})) images.set(name, `data:image/${type(name)};base64,${b64}`)
  const base = cleanName(file.name || fileName.replace(/\.[^.]*$/, '') || 'Imported')
  let name = base
  for (let n = 2; taken(name); n++) name = `${base} (${n})`
  presets.push({ name, config: { ...clone(file.config), hotkey: '', preset: '' } })
  const programs = []
  const walk = (rings) => rings.forEach((r) => r.items.forEach((it) => {
    if (it.program) programs.push(it.program)
    if (it.menu?.rings) walk(it.menu.rings)
  }))
  walk(file.config.rings)
  return { list: presetList(), name, programs }
}

// --- commands ---------------------------------------------------------------------
const commands = {
  platform: () => platform,
  app_version: () => '',
  list_keys: () => KEYS,
  get_config: () => clone(config),
  default_config: () => ({ ...start(), hotkey: config.hotkey }),
  ready() {
    open()
    tell({ type: 'ready' })
  },
  save_config({ config: c }) {
    config = { ...clone(c), hotkey: config.hotkey, preset: config.preset }
    return clone(config)
  },
  layout_wheel: ({ rings, path }) => layoutFor(rings, lookAt(path)),
  close_wheel: closeAndReopen,
  quit_app: closeAndReopen,
  activate({ key, mods }) {
    sent.listener?.({ key, mods })
    closeAndReopen()
  },
  launch({ path }) {
    sent.listener?.({ program: path })
    closeAndReopen()
  },
  pick_program() {
    const p = PROGRAMS[nextProgram++ % PROGRAMS.length]
    return { path: p.path, name: p.name }
  },
  program_icon: ({ path }) => PROGRAMS.find((p) => p.path === path)?.icon ?? null,
  app_icon: () => null,
  image_data: ({ name }) => images.get(name) ?? null,
  pick_background: () => pickImage('background'),
  pick_icon: () => pickImage('icon'),
  delete_image() {}, // kept: undo can bring any picture back, and it's all gone on reload anyway
  get_autostart: () => autostart,
  set_autostart({ enabled }) {
    autostart = enabled
  },
  accessibility_ok: () => true,
  capture_start() {},
  capture_extend() {},
  capture_end() {},
  dismiss_notice() {},
  open_link({ url }) {
    window.open(url, '_blank', 'noopener')
  },
  set_hotkey({ hotkey }) {
    config.hotkey = hotkey
    return clone(config)
  },
  set_menu_hotkey({ path, hotkey }) {
    let rings = config.rings
    let menu = null
    for (const step of path) {
      menu = findMenu(rings, step)
      if (!menu) throw 'That sub-menu is gone'
      rings = body(menu).rings
    }
    if (menu) menu.hotkey = hotkey
    return clone(config)
  },
  list_presets: presetList,
  save_preset({ name, replace }) {
    const before = clone(presets)
    const snapshot = { ...clone(config), preset: '' }
    if (name != null && replace) {
      find(name).config = snapshot
    } else {
      name = name != null ? cleanName(name) : nextName()
      if (taken(name)) throw `There's already a preset called ${name}`
      presets.push({ name, config: snapshot })
    }
    undoStore.presets = before
    config.preset = name
    return presetList()
  },
  load_preset({ name }) {
    undoStore.config = switchTo({ ...clone(find(name).config), preset: name })
    return switched()
  },
  undo_load_preset() {
    if (!undoStore.config) throw 'Nothing to undo'
    switchTo(undoStore.config)
    undoStore.config = null
    return switched()
  },
  rename_preset({ from, to }) {
    to = cleanName(to)
    if (taken(to, from)) throw `There's already a preset called ${to}`
    find(from).name = to
    if (config.preset === from) config.preset = to
    return presetList()
  },
  delete_preset({ name }) {
    undoStore.presets = clone(presets)
    presets = presets.filter((p) => p.name !== name)
    return presetList()
  },
  undo_presets() {
    if (!undoStore.presets) throw 'Nothing to undo'
    presets = undoStore.presets
    undoStore.presets = null
    return presetList()
  },
  set_preset_colors({ name, colors }) {
    undoStore.presets = clone(presets)
    find(name).colors = colors ?? undefined
    return presetList()
  },
  import_preset() {
    throw NO_FILES
  },
  // A Get button (or a .rkpreset file) dropped on the demo's wheel: add it like the app does.
  async import_preset_url({ url }) {
    if (new URL(url, location.href).origin !== location.origin) throw 'Presets can only come from this website'
    const res = await fetch(url)
    if (!res.ok) throw "Couldn't download the preset"
    return addPreset(await res.text(), url.split('/').pop())
  },
  import_preset_text: ({ text, name }) => addPreset(text, name),
  import_preset_file() {
    throw NO_FILES
  },
  open_accessibility_settings() {},
  export_preset() {
    throw NO_FILES
  },
}

window.__TAURI__ = {
  core: {
    async invoke(command, args = {}) {
      const run = commands[command]
      if (!run) throw `The demo can't do ${command}`
      return run(args)
    },
  },
  event: {
    async listen(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event).add(handler)
      return () => listeners.get(event).delete(handler)
    },
  },
}

window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || e.source !== parent) return
  if (e.data.type === 'fit') {
    // How much of this big iframe shows, and how much it's scaled down.
    document.documentElement.style.setProperty('--visible', `${e.data.visible}px`)
    document.documentElement.style.setProperty('--scale', `${e.data.scale}`)
  } else if (e.data.type === 'preset') {
    // Preview a preset: { config, images: { name: data URL } }. It's the setup from now on.
    const { config: preset, images: pictures = {} } = e.data
    for (const [name, url] of Object.entries(pictures)) images.set(name, url)
    const hotkey = config.hotkey
    start = () => ({ ...clone(preset), hotkey, preset: '' })
    reset()
  }
})
