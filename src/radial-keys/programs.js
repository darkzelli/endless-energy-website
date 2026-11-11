// The programs that program slots open in the demo (a web page can't open real ones), with real
// apps' logos from Simple Icons (CC0).
import {
  siBlender, siDiscord, siFigma, siFirefoxbrowser, siGimp, siGooglecalendar, siGooglechrome, siNotion,
  siObsidian, siObsstudio, siSlack, siSpotify, siSteam, siVlcmediaplayer, siWhatsapp, siZoom,
} from 'simple-icons'

const svgUrl = (svg) => 'data:image/svg+xml,' + encodeURIComponent(svg)
/** The logo in its own colour, as the outer ring shows it. */
const logo = (si) =>
  svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -6 36 36"><path fill="#${si.hex}" d="${si.path}"/></svg>`)
/** The logo in white on a tile of its colour, like an app icon: the Apps menu's look. */
const tile = (si) =>
  svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect x="3" y="3" width="42" height="42" rx="11" fill="#${si.hex}"/><path transform="translate(12 12)" fill="#fff" d="${si.path}"/></svg>`)
const program = (si, art = logo) => ({ path: `demo:${si.slug}`, name: si.title, icon: art(si) })

// The hero wheel's sub-menus on its outer ring are plain glyphs in one blue.
export const GLYPH_INK = '#1f44e0'
export const glyph = (art) =>
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -6 60 60"><g fill="none" stroke="${GLYPH_INK}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${art}</g></svg>`,
  )
// Sub-menu pictures on that ring: Edit's pencil, the Apps grid.
export const EDIT_GLYPH = glyph('<path d="M14 34l3-9 13-13 6 6-13 13zM27 15l6 6"/>')
export const APPS_GLYPH = glyph('<path d="M13 13h5v5h-5zM21.5 13h5v5h-5zM30 13h5v5h-5zM13 21.5h5v5h-5zM21.5 21.5h5v5h-5zM30 21.5h5v5h-5zM13 30h5v5h-5zM21.5 30h5v5h-5zM30 30h5v5h-5z"/>')

// On the demo's outer ring.
export const RING_PROGRAMS = [
  siGooglechrome, siDiscord, siSteam, siBlender, siVlcmediaplayer,
  siSpotify, siSlack, siFigma, siObsstudio, siObsidian,
].map((si) => program(si))

// Inside the demo's Apps menu.
export const MENU_PROGRAMS = [siFirefoxbrowser, siGooglecalendar, siZoom, siGimp, siNotion, siWhatsapp].map((si) => program(si, tile))

export const PROGRAMS = [...RING_PROGRAMS, ...MENU_PROGRAMS]
