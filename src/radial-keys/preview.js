// The preset preview: a dialog with the preset on a live wheel (the app's real UI, demo.html in
// preview mode) on the left, and what it is with its Get button on the right. The dialog and
// its iframe are made the first time a preview opens and reused after that: opening another
// preset only sends the frame that preset.
import { mountDemo } from './demo-frame.js'
import { getButton } from './presets.js'

const CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'

let ui = null
let shown = null // the entry on show
let ready = false // the frame has loaded and can take a preset

function build() {
  const dialog = document.createElement('dialog')
  dialog.className = 'rk-modal'
  dialog.setAttribute('aria-labelledby', 'rk-modal-title')
  dialog.innerHTML = `
    <button type="button" class="rk-modal-close" aria-label="Close">${CLOSE}</button>
    <div class="rk-modal-stage">
      <iframe src="demo.html?preview" width="1600" height="1600" title="Try this preset: a working Radial Keys wheel"></iframe>
    </div>
    <div class="rk-modal-info">
      <p class="rk-modal-kind"></p>
      <h2 id="rk-modal-title"></h2>
      <p class="rk-modal-blurb"></p>
      <ul class="rk-swatches" aria-label="Colours"></ul>
      <p class="rk-modal-try">Try it on the left: click a slot to press it, right-click one to change it, click the center for Options.</p>
      <div class="rk-modal-get"></div>
    </div>`
  document.body.append(dialog)
  const stage = dialog.querySelector('.rk-modal-stage')
  const demo = mountDemo(stage, stage.querySelector('iframe'), {
    maxScale: 1.3,
    onMessage(data) {
      if (data.type !== 'ready') return
      ready = true
      send()
    },
  })
  dialog.querySelector('.rk-modal-close').addEventListener('click', () => dialog.close())
  // A click on the backdrop (outside the box) closes it.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close()
  })
  return {
    dialog,
    demo,
    kind: dialog.querySelector('.rk-modal-kind'),
    title: dialog.querySelector('h2'),
    blurb: dialog.querySelector('.rk-modal-blurb'),
    swatches: dialog.querySelector('.rk-swatches'),
    get: dialog.querySelector('.rk-modal-get'),
  }
}

/** Put the preset on the wheel (once the frame can take it). */
function send() {
  if (!ready || !shown) return
  ui.demo.post({ type: 'preset', config: shown.config, images: shown.pictures })
}

function swatch(color, name) {
  const li = document.createElement('li')
  li.style.background = color
  li.title = name
  li.setAttribute('aria-label', color.startsWith('url(') ? name : `${name}: ${color}`)
  return li
}

/** The colours worth showing: the rings' own fills (or the main fill), labels, gaps. */
function swatches({ config, pictures }) {
  const out = []
  if (config.background && pictures[config.background]) {
    out.push(swatch(`url("${pictures[config.background]}") center / cover`, 'Picture'))
  }
  const fills = [...new Set(config.rings.map((r) => r.items[0]?.colors?.fill).filter(Boolean))]
  if (fills.length) fills.forEach((c, i) => out.push(swatch(c, `Ring ${i + 1}`)))
  else out.push(swatch(config.fill, 'Slots'))
  out.push(swatch(config.accent, 'Labels'))
  if (config.gapColor) out.push(swatch(config.gapColor, 'Gaps'))
  return out
}

/** Open the preview of `entry` (a gallery entry, see presets.js). `dragImage`: for Get's drag. */
export function openPreview(entry, dragImage) {
  ui ??= build()
  shown = entry
  ui.kind.textContent = entry.config.background ? 'Picture theme' : 'Colour theme'
  ui.title.textContent = entry.name
  ui.blurb.textContent = entry.blurb
  ui.swatches.replaceChildren(...swatches(entry))
  ui.get.replaceChildren(getButton(entry, dragImage))
  if (!ui.dialog.open) ui.dialog.showModal()
  ui.demo.fit()
  send()
}
