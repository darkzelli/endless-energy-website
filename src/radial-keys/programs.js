// The made-up programs that program slots open in the demo (a web page can't open real ones).
const icon = (bg, art) =>
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect x="3" y="3" width="42" height="42" rx="11" fill="${bg}"/><g fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${art}</g></svg>`,
  )
const program = (id, name, bg, art) => ({ path: `demo:${id}`, name, icon: icon(bg, art) })

// The hero wheel's outer ring shows plain glyphs in one blue instead of app tiles.
export const GLYPH_INK = '#1f44e0'
export const glyph = (art) =>
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -6 60 60"><g fill="none" stroke="${GLYPH_INK}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${art}</g></svg>`,
  )
const ringProgram = (id, name, art) => ({ path: `demo:${id}`, name, icon: glyph(art) })
// Sub-menu pictures on that ring: Edit's pencil, the Apps grid.
export const EDIT_GLYPH = glyph('<path d="M14 34l3-9 13-13 6 6-13 13zM27 15l6 6"/>')
export const APPS_GLYPH = glyph('<path d="M13 13h5v5h-5zM21.5 13h5v5h-5zM30 13h5v5h-5zM13 21.5h5v5h-5zM21.5 21.5h5v5h-5zM30 21.5h5v5h-5zM13 30h5v5h-5zM21.5 30h5v5h-5zM30 30h5v5h-5z"/>')

// On the demo's outer ring.
export const RING_PROGRAMS = [
  ringProgram('browser', 'Browser', '<circle cx="24" cy="24" r="12"/><path d="M12 24h24M24 12c-7 8-7 16 0 24M24 12c7 8 7 16 0 24"/>'),
  ringProgram('chat', 'Chat', '<path d="M12 14h24v16H22l-7 6v-6h-3z"/>'),
  ringProgram('games', 'Games', '<path d="M16 17h16a7 7 0 0 1 6 11l-1 3a3 3 0 0 1-5 1l-3-4H19l-3 4a3 3 0 0 1-5-1l-1-3a7 7 0 0 1 6-11zM18 21v5M15.500 23.500h5"/><circle cx="31" cy="23" r="1"/>'),
  ringProgram('model', '3D', '<path d="M24 11l12 7v12l-12 7-12-7V18zM12 18l12 7 12-7M24 25v12"/>'),
  ringProgram('video', 'Video', '<path d="M12 15h24v18H12zM21 19l8 5-8 5z"/>'),
  ringProgram('music', 'Music', '<path d="M20 32V15l14-3v17"/><circle cx="16" cy="32" r="4"/><circle cx="30" cy="29" r="4"/>'),
  ringProgram('team', 'Team chat', '<path d="M19 12v24M29 12v24M12 19h24M12 29h24"/>'),
  ringProgram('design', 'Design', '<path d="M24 12l9 9-9 15-9-15zM24 12v13"/><circle cx="24" cy="26" r="2"/>'),
  ringProgram('record', 'Recorder', '<circle cx="24" cy="24" r="12"/><circle cx="24" cy="24" r="4"/>'),
  ringProgram('terminal', 'Terminal', '<path d="M11 14h26v20H11zM16 21l4 3-4 3M23 28h8"/>'),
]

// Inside the demo's Apps menu.
export const MENU_PROGRAMS = [
  program('files', 'Files', '#3f8fd2', '<path d="M12 16h9l3 3h12v15H12z"/>'),
  program('calendar', 'Calendar', '#d8453f', '<path d="M12 15h24v20H12zM12 21h24M18 11v6M30 11v6"/>'),
  program('video', 'Video', '#a23fbf', '<path d="M12 15h24v18H12zM21 19l8 5-8 5z"/>'),
  program('calculator', 'Calculator', '#5d6778', '<path d="M15 11h18v26H15zM19 16h10M20 23h.5M28 23h.5M20 29h.5M28 29h.5"/>'),
  program('paint', 'Paint', '#d24f93', '<path d="M31 12l5 5-14 14-7 2 2-7z"/>'),
  program('settings', 'Settings', '#6b7280', '<circle cx="24" cy="24" r="5"/><path d="M24 12v5M24 31v5M12 24h5M31 24h5M15.500 15.500l3.500 3.500M29 29l3.500 3.500M15.500 32.500L19 29M29 19l3.500-3.500"/>'),
]

export const PROGRAMS = [...RING_PROGRAMS, ...MENU_PROGRAMS]
