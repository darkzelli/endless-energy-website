// The demo inside the page's iframe: the app's real UI (app/, see scripts/sync-radial-keys.mjs) on a stand-in for its Rust backend.
import './app/wheel.css'
import './app/radial.css'
import './demo.css'
import './bridge.js'
import './app/radial.js'
// The preview (demo.html?preview) is yours from the start: no tour.
if (!new URLSearchParams(location.search).has('preview')) import('./tour.js')
