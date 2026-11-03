import '@fontsource/inter/400.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/inter/800.css'
import './style.css'

// The Unity WebGL build is copied into public/endless-energy/play/Build by `npm run sync-game`.
// Nothing is downloaded until the player presses Play.
const base = '/endless-energy/play/Build/WebGL'
const $ = (id) => document.getElementById(id)

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.onload = resolve
    s.onerror = () => reject(new Error(`Couldn't load ${src}`))
    document.body.appendChild(s)
  })
}

async function start() {
  $('gate').hidden = true
  $('loading').hidden = false
  const canvas = $('unity-canvas')
  try {
    await loadScript(`${base}.loader.js`)
    await window.createUnityInstance(canvas, {
      dataUrl: `${base}.data.unityweb`,
      frameworkUrl: `${base}.framework.js.unityweb`,
      codeUrl: `${base}.wasm.unityweb`,
      companyName: 'bywhatevermedium',
      productName: 'Endless Energy',
      productVersion: '1.0',
      devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    }, (p) => {
      $('bar').style.width = `${Math.round(p * 100)}%`
      $('status').textContent = p < 0.9 ? `Loading… ${Math.round(p * 100)}%` : 'Starting…'
    })
    canvas.hidden = false
    $('loading').hidden = true
    document.querySelector('.poster').hidden = true
    canvas.focus()
  } catch (e) {
    $('status').textContent = "Sorry, the game couldn't start in this browser."
    console.error(e)
  }
}

$('play').addEventListener('click', start, { once: true })
