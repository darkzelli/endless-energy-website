// The whole app UI: the wheel, its options mode, and the message box above it.
//
// Modes
//   keys         normal use: click / hold-release sends a key
//   options      the slots turn into options (colors, size, add/move/remove slot...)
//   place        a ghost slot follows the pointer until you click to drop it
//   pick-move    click the slot to move
//   pick-remove  click the slot to remove
//   capture      listening for a new key (slot) or a new hotkey (center)
//   presets      saved setups: switch to one, save this one, rename / update / delete
//   menus        Options → Menu: add a new sub-menu, or one of your reusable menus
//   actions      a right-click menu (or a question): the wheel stays as it is, but the
//                choices sit in a row on the clicked slot's ring and the rest goes grey; the
//                clicked slot is the way back. Its Colors choice shows the colour menu for
//                that slot. Typing a name stays in the message box
//
// Ctrl+Z (⌘Z) undoes changes to the setup, one at a time.
//
// Right-clicking a colour in Options picks it up (S.brush): then right-clicking anything,
// in any menu, gives that one thing the colour, as accent, fill and/or tint.
//
// Every menu (the main one, each sub-menu) can have its own look: colours, see-through,
// picture and size. One without its own looks like the menu above it. A sub-menu slot can
// show a reusable menu (config.menus) instead of its own slots: the same menu, with the
// same name, picture and look, wherever it's used.

import {
  geometry, render, hitTest, eventToWheel, angleOf, ringAt, makeRoom, resolveRing,
  itemLabel, itemName, modLabel, prettyHotkey,
} from './wheel.js';

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const svg = document.getElementById('wheel');
const msgArea = document.getElementById('msg-area');
const msgEl = document.getElementById('msg');
const msgText = msgEl.querySelector('.msg-text');
const msgActions = msgEl.querySelector('.msg-actions');

const platform = await invoke('platform');
// Shown under the hotkey in the center ("v1.0").
const versionText = await invoke('app_version').then((v) => (v ? `v${v}` : null), () => null);
const mac = platform === 'macos';
const keys = await invoke('list_keys');
const keyMap = new Map(keys.map((k) => [k.code, k]));
let config = await invoke('get_config');
let layout = { width: 440, height: 510, size: 440, banner: 70, rings: Math.max(1, config.rings.length) };

const S = {
  mode: 'keys',
  holding: false, // hotkey still held: release sends, pointing past the edge still counts
  visible: false,
  hover: null,
  capture: null, // { target: 'hotkey' } | { target: 'slot', ring, index, isNew, pick }
  place: null, // { item, isNew, from, spanBase, ghost }
  autostart: false,
  pendingError: null,
  turn: null, // ring being dragged round in rotate mode
  hoverRing: -1,
  app: null, // { id, name } of the app keys will go to
  colorTargets: new Set(['accent']), // what a swatch click colours: 'accent' and/or 'fill'
  path: [], // open sub-menu, see rings()
  dwellBlock: false,
  dwellFirst: undefined,
  presets: null, // { presets: [{ name, accent, fill, rings, slots, background, same }], active, saved }
  presetEntry: null, // { angle, span } of the Presets option: its Back slot goes there
  menuEntry: null, // the same for the Menu option (Options → Menu with reusable menus)
  naming: null, // typing a name: { kind, from / ring + angle, text, selected, busy, error }
  actions: null, // right-click menu on the wheel: { title, kind, name, list, source, from, parent, cancel }
  lastActions: null, // the one just chosen from (a choice like Picture… comes back to it)
  brush: null, // carrying a colour to paint single slots with: { color }
};
const appIcons = new Map(); // app id -> data URL (or null if it has none)

async function loadAppIcon(app) {
  if (!app || !config.showApp || appIcons.has(app.id)) return;
  appIcons.set(app.id, null);
  try {
    const url = await invoke('app_icon', { id: app.id });
    appIcons.set(app.id, url || null);
    if (url && S.visible && S.app?.id === app.id) draw();
  } catch {
    // no icon: the center just shows the name
  }
}
let geo = geometry(config, layout.rings);
let wheel = null;
let drawn = []; // the slot descriptors currently on screen, by ring

// PointerEvent.button -> key id for the buttons you can record.
const MOUSE_CODES = { 1: 'MouseMiddle', 3: 'MouseBack', 4: 'MouseForward' };
const MODIFIER_CODES = new Set(['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight']);
// 24 swatches: a hue wheel, two earth tones, and greys from white to black.
const COLORS = [
  '#ff3b30', '#ff6b3d', '#ff9500', '#ffcc00', '#c7e000', '#34c759', '#00c7a0', '#00c7be',
  '#32ade6', '#0a84ff', '#5b8cff', '#5856d6', '#7c5cff', '#af52de', '#ff2dc0', '#ff375f',
  '#a2845e', '#f2d7b6', '#ffffff', '#d1d5db', '#8e8e93', '#4b5563', '#1f2430', '#000000',
];

// --- colour helpers ---------------------------------------------------------
const rgbOf = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lum = ([r, g, b]) => {
  const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const mixRgb = (a, b, t) => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t));
const rgba = (c, a) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
const inkOn = (hex) => (lum(rgbOf(hex)) > 0.45 ? '#111111' : '#ffffff');
/** Black or white, whichever stands out more on colour `c`. */
const lineOn = (c) => (contrast(c, [0, 0, 0]) >= contrast(c, [255, 255, 255]) ? '#000000' : '#ffffff');
/** The center's colour for a fill: a little further from the middle than the slots. */
const hubColorOf = (fill) => mixRgb(fill, lum(fill) > 0.45 ? [255, 255, 255] : [0, 0, 0], 0.3);
// "transparent" works in place of any colour: no fill, no labels and icons, or no tint.
const CLEAR = 'transparent';
// What a see-through fill counts as when working out what stands out on it (the default fill).
const CLEAR_BASE = '#161a24';
const solidOf = (fill) => rgbOf(fill === CLEAR ? CLEAR_BASE : fill);
// What a see-through accent leaves the message box with (it has buttons to colour).
const MSG_ACCENT = '#5b8cff';
// Slot edges with no fill and no picture: grey shows on any desktop.
const CLEAR_EDGE = 'rgba(128, 128, 128, 0.6)';
// The dark edge that keeps words readable over a picture.
const LABEL_HALO = 'rgba(0, 0, 0, 0.55)';
// A fill whose channels are this close together reads as black, white or grey (or near it).
const NEUTRAL_SPREAD = 64;
/**
 * Would thin lines and small words in colour `a` be hard to see on colour `b`? Similar
 * brightness is fine as long as the colours themselves are clearly different.
 */
const hardToSee = (a, b) => {
  const c = contrast(a, b);
  return c < 1.2 || (c < 1.6 && Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 160);
};
/**
 * The center's Y and words: black or white (whichever stands out) on a black, white or grey
 * fill, otherwise the accent. The accent gives way if it would disappear into the center.
 */
const hubLine = (fill, accent, hubC) => {
  if (fill === CLEAR || accent === CLEAR) return lineOn(hubC);
  const c = rgbOf(fill);
  return Math.max(...c) - Math.min(...c) < NEUTRAL_SPREAD || hardToSee(rgbOf(accent), hubC) ? lineOn(hubC) : accent;
};
/** The thin outline that keeps accent text readable when it's close to the fill. */
const outlineFor = (acc) => (lum(acc) > 0.45 ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.85)');

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const dot = ' <span class="dim">·</span> ';
const hotkeyText = (accel = config.hotkey) => prettyHotkey(accel, platform, keyMap);

// ---------------------------------------------------------------------------
// Message box (above the wheel). Priority: toast > alert > prompt > brush > notice > hint.
// ---------------------------------------------------------------------------
const msg = { toast: null, alert: null, prompt: null, brush: null, notice: null, hint: null };
let toastTimer = null;

let shownMsg = null;
function showMsg() {
  const m = msg.toast || msg.alert || msg.prompt || msg.brush || msg.notice || msg.hint;
  // Only touch the DOM when the visible message changes, so buttons stay put under the pointer.
  if (m === shownMsg) return;
  shownMsg = m;
  if (!m) {
    msgEl.classList.remove('visible');
    msgEl.hidden = true;
    return;
  }
  msgEl.hidden = false;
  msgEl.className = `msg visible ${m.kind || ''}`;
  msgText.innerHTML = m.html;
  msgActions.innerHTML = '';
  for (const a of m.actions || []) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = a.label;
    if (a.cls) b.className = a.cls;
    b.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      a.run();
    });
    msgActions.append(b);
  }
}

function toast(html, kind = 'ok', { ttl = 2600, actions = [] } = {}) {
  msg.toast = { html, kind, actions };
  clearTimeout(toastTimer);
  if (ttl) toastTimer = setTimeout(clearToast, ttl);
  showMsg();
}

function clearToast() {
  clearTimeout(toastTimer);
  msg.toast = null;
  showMsg();
}

function setPrompt(html, actions = []) {
  msg.prompt = html ? { html, kind: 'prompt', actions } : null;
  showMsg();
}

/** A new version is out ({ message, link } from the update check): stays until opened or dismissed. */
function setNotice(n) {
  if (!n?.message) {
    msg.notice = null;
    return showMsg();
  }
  const done = () => {
    msg.notice = null;
    showMsg();
    return invoke('dismiss_notice').catch(() => {});
  };
  const actions = [];
  if (n.link) {
    actions.push({
      label: 'Open',
      cls: 'primary',
      run: async () => {
        await done();
        invoke('open_link', { url: n.link }).catch((e) => toast(esc(e), 'error', { ttl: 5000 }));
      },
    });
  }
  actions.push({ label: 'Dismiss', run: done });
  msg.notice = { html: esc(n.message), kind: 'update', actions };
  showMsg();
}

function setHint(html) {
  const cur = msg.hint?.html ?? null;
  if (cur === html) return;
  msg.hint = html ? { html, kind: 'hint' } : null;
  showMsg();
}

// ---------------------------------------------------------------------------
// Layout + drawing
// ---------------------------------------------------------------------------
function applyLayout() {
  const { width, size, banner } = layout;
  geo = geometry(look(), layout.rings);
  Object.assign(svg.style, {
    width: `${size}px`,
    height: `${size}px`,
    left: `${(width - size) / 2}px`,
    top: `${banner}px`,
  });
  placeBanner(layout.rings);
  msgArea.style.width = `${width}px`;
}

/**
 * The message box sits just above the outermost of `rings` rings. draw() calls this with
 * the rings actually shown, which can be fewer than the window has room for (options
 * mode shows 2 even when your wheel has more).
 */
function placeBanner(rings) {
  const pad = layout.size / 2 - geometry(look(), rings).outer;
  msgArea.style.height = `${layout.banner + pad - 6}px`;
}

// ---------------------------------------------------------------------------
// Sub-menus. S.path leads from the root menu to the open one: each step is the
// { ring, angle } of the slot that was clicked (angles survive saving and sorting).
// ---------------------------------------------------------------------------
const sameAngle = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180) < 0.01;

function stepItem(ringsArr, step) {
  return ringsArr?.[step.ring]?.items.find((it) => sameAngle(it.angle, step.angle));
}

/** A reusable menu by id (null if there's none). */
const sharedMenu = (id) => (id && config.menus?.find((m) => m.id === id)) || null;

/** What a sub-menu slot's `menu` shows: a reusable menu ({ rings, look }), or itself. */
const menuBody = (menu) => sharedMenu(menu?.link) ?? menu;

/**
 * Where a sub-menu / program slot's name and picture live ({ label, image, cover }): on
 * the slot, or on the reusable menu it shows (then they're the same everywhere).
 */
const face = (it) => sharedMenu(it?.menu?.link) ?? it;

/** The rings of the menu at `path` (null if it no longer exists). */
function menuAt(path) {
  let r = config.rings;
  for (const step of path) {
    const it = stepItem(r, step);
    if (!it?.menu) return null;
    r = menuBody(it.menu).rings ?? [];
  }
  return r;
}

/**
 * The menu whose look shows at `path`: the open menu itself or the nearest one above it
 * with its own look, as { body, name } (body holds the look). null = the main menu's.
 */
function lookOwner(path = S.path) {
  let r = config.rings;
  let owner = null;
  for (const step of path) {
    const it = stepItem(r, step);
    if (!it?.menu) break;
    const body = menuBody(it.menu);
    if (body.look) owner = { body, name: face(it).label?.trim() || 'Sub-menu' };
    r = body.rings ?? [];
  }
  return owner;
}

/**
 * The look of the menu at `path`: { accent, fill, theme, background, innerRadius,
 * ringWidth, ringGap }. Live: changing it changes that look (the main menu's is config).
 */
const look = (path = S.path) => lookOwner(path)?.body.look ?? config;

/** Every sub-menu slot (main menu, sub-menus, reusable menus; not following links). */
function eachMenuSlot(fn) {
  const walk = (rs) => rs?.forEach((r) => r.items.forEach((it) => {
    if (!it.menu) return;
    fn(it);
    if (!it.menu.link) walk(it.menu.rings);
  }));
  walk(config.rings);
  for (const m of config.menus ?? []) walk(m.rings);
}

/** How many slots show reusable menu `id`. */
function usesOf(id) {
  let n = 0;
  eachMenuSlot((it) => { if (it.menu.link === id) n++; });
  return n;
}

// Pictures picked for slots (sub-menu icons), loaded once and scaled down.
const imageCache = new Map();
function slotImage(name) {
  if (!imageCache.has(name)) {
    imageCache.set(name, null);
    (async () => {
      try {
        const url = await invoke('image_data', { name });
        if (!url) return;
        const img = new Image();
        img.src = url;
        await img.decode();
        const max = 256; // sharp enough to fill a whole slot (Fill slot)
        const k = Math.min(1, max / Math.max(img.naturalWidth || max, img.naturalHeight || max));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round((img.naturalWidth || max) * k));
        c.height = Math.max(1, Math.round((img.naturalHeight || max) * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        imageCache.set(name, c.toDataURL('image/png'));
        if (S.visible) draw();
      } catch (e) {
        console.warn('slot image', name, e);
      }
    })();
  }
  return imageCache.get(name);
}

/** The open sub-menu object ({ rings, hotkey }), or null in the main menu. */
function currentMenu() {
  if (!S.path.length) return null;
  const parent = menuAt(S.path.slice(0, -1));
  return stepItem(parent, S.path[S.path.length - 1])?.menu ?? null;
}

/** The rings of the menu that's open now (live: changes go straight into config). */
function rings() {
  const r = menuAt(S.path);
  if (r) return r;
  S.path = [];
  return config.rings;
}

/** In a sub-menu: where its Back slot goes (the spot of the slot that opened it). */
function backSlot() {
  if (!S.path.length) return null;
  if (S.place?.item.isBack) return null; // being moved: the ghost is where it goes
  const step = S.path[S.path.length - 1];
  const it = stepItem(menuAt(S.path.slice(0, -1)), step);
  if (!it) return null;
  // You moved it (Move, or right-click Back → Move).
  const moved = menuBody(it.menu)?.back;
  if (moved) return { ring: moved.ring, angle: moved.angle, span: moved.span, moved: true };
  let ring = step.ring;
  // A reusable menu is laid out once, but opened from slots in different places: where
  // you came in can be taken by one of its slots. Then Back sits further out, at the same
  // angle, on the first ring that's free there.
  if (it.menu?.link) {
    const r = rings();
    const clash = (x) => Math.abs((((x.angle - it.angle) % 360) + 540) % 360 - 180) < (x.span + it.span) / 2 - 0.5;
    while (r[ring]?.items.some(clash)) ring++;
  }
  return { ring, angle: it.angle, span: it.span };
}

function trimRings() {
  const r = rings();
  while (r.length && !r[r.length - 1].items.length) r.pop();
}

function ringsForMode() {
  const back = backSlot();
  const n = Math.max(rings().length, back ? back.ring + 1 : 0);
  if (S.mode === 'presets') return presetSlots().length;
  if (S.mode === 'menus') return menuPickSlots().length;
  // The window keeps its size (no jump): the choices sit on the inner rings.
  if (S.mode === 'actions') return Math.max(layout.rings || 1, actionSlots().length);
  if (S.mode === 'options') return Math.max(2, n);
  if (S.mode === 'place') return n + 1;
  return Math.max(1, n);
}

// What the window is sized for: ring count + the open menu's size (sub-menus can have their own).
let layoutKey = '';
const layoutKeyFor = (count) => {
  const L = look();
  return `${count}|${L.innerRadius}|${L.ringWidth}|${L.ringGap}|${L.gaps !== false}`;
};

/** Resize the window when the ring count or the open menu's size changed (or `force`). */
async function ensureLayout(force = false) {
  const count = ringsForMode();
  const key = layoutKeyFor(count);
  if (!force && layoutKey === key) return;
  try {
    // Rust sizes it from the saved look of this menu: callers save size changes first.
    layout = await invoke('layout_wheel', { rings: count, path: S.path });
    layoutKey = key;
  } catch (e) {
    console.error(e);
  }
  applyLayout();
}

/** The picture a sub-menu / program slot shows (yours, else the program's icon), or null. */
function slotPicture(it) {
  const f = face(it);
  return (f.image && slotImage(f.image)) || (it.program && programIcon(it.program)) || null;
}

/** The name being typed for this slot, or null. */
function typedName(it, ring) {
  const n = S.naming;
  return (n?.kind === 'slot' || n?.kind === 'share') && n.ring === ring && sameAngle(n.angle, it.angle) ? n.text || '…' : null;
}

/**
 * What a stored slot shows, wherever it's drawn: a picture or icon with a caption, or a
 * key's label. A hidden label comes back while you type a name. `blank`: a key with no key yet.
 */
function slotFace(it, ring, blank = '?') {
  const f = face(it);
  const typed = typedName(it, ring);
  const hidden = f.hideLabel && typed == null;
  const pic = slotPicture(it);
  const art = pic && { picture: pic, cover: !!f.cover };
  if (it.menu || it.program) {
    return {
      cls: it.menu ? 'folder' : 'program',
      caption: hidden ? undefined : typed ?? (f.label?.trim() || (it.menu ? 'Menu' : 'Program')),
      captionMin: NAME_MIN,
      // Your own .ico / picture, else the program's icon, else a generic icon.
      // "Fill" makes the picture cover the whole slot.
      ...(art || { icon: it.menu ? 'folder' : 'launch' }),
      linked: !!sharedMenu(it.menu?.link),
    };
  }
  const label = typed ?? (it.key ? itemLabel(it, keyMap) : blank);
  const sub = modLabel(it.mods, platform, true);
  if (art) return { ...art, caption: hidden ? undefined : [sub, label].filter(Boolean).join(mac ? '' : '+'), captionMin: NAME_MIN };
  if (hidden) return {};
  return { label, sub, curved: typed != null || !!it.label?.trim() };
}

/** CSS variables for something with its own colours { accent, fill, tint }, over the open menu's look. */
function paintVars(c) {
  const L = look();
  const fill = solidOf(c.fill || L.fill);
  const ownInk = c.accent && c.accent !== CLEAR;
  const accent = ownInk ? c.accent : L.accent;
  const acc = rgbOf(accent === CLEAR ? lineOn(fill) : accent);
  // A see-through accent hides the label and icon, except where you're editing the keys.
  const noInk = c.accent ? c.accent === CLEAR && (BRUSH_MODES.has(S.mode) || !!S.actions?.colors) : L.accent === CLEAR && S.mode === 'keys';
  const vars = {};
  if (ownInk) Object.assign(vars, { '--accent': c.accent, '--on-accent': inkOn(c.accent), '--text': c.accent, '--label-halo': LABEL_HALO });
  if (c.fill) {
    const bg = c.fill === CLEAR ? CLEAR : rgba(fill, L.theme === 'glass' ? 0.62 : 1);
    Object.assign(vars, { '--slice': bg, '--slice-alt': bg });
    if (c.fill === CLEAR && !L.background) vars['--edge'] = CLEAR_EDGE;
  }
  if (c.accent || c.fill) {
    const low = !noInk && (c.fill === CLEAR || contrast(acc, fill) < 2);
    const outline = outlineFor(acc);
    vars['--muted'] = noInk ? CLEAR : rgba(mixRgb(acc, fill, 0.4), 1);
    vars['--text-outline'] = low ? outline : CLEAR;
    vars['--icon-outline'] = low ? `drop-shadow(0 0 0.8px ${outline}) drop-shadow(0 0 0.8px ${outline})` : 'none';
  }
  if (noInk) Object.assign(vars, { '--text': CLEAR, '--label-halo': CLEAR });
  if (c.tint) vars['--tint'] = c.tint === CLEAR ? CLEAR : rgba(rgbOf(c.tint), TINT_ALPHA);
  return vars;
}

/** A slot to draw, with colours of its own if `colors` has any. */
function painted(slot, colors) {
  if (!colors) return slot;
  return { ...slot, vars: paintVars(colors), cls: `${slot.cls || ''}${colors.fill ? ' painted-fill' : ''}`.trim() };
}

/** The center with colours of its own (its Y follows them: see hubLine). */
function hubPaintVars(hasBg) {
  const L = look();
  // The Y (Options, colour menus) can have colours of its own, over the center's.
  const y = pieShown() ? config.paint?.['opt-hub'] : undefined;
  const own = y ? { ...config.paint?.hub, ...y } : config.paint?.hub;
  // (A see-through accent hides the keys' labels, not the center's words.)
  if (!own && L.accent !== CLEAR) return undefined;
  const c = own ?? {};
  const fill = c.fill || L.fill;
  const tint = c.tint && c.tint !== CLEAR ? rgbOf(c.tint) : null;
  const ownFill = c.fill && c.fill !== CLEAR;
  let hubC = ownFill ? rgbOf(c.fill) : hubColorOf(solidOf(L.fill));
  if (tint) hubC = mixRgb(hubC, tint, TINT_ALPHA);
  // Its words only go away on the keys: everywhere else they say what the center does.
  const noInk = c.accent === CLEAR && S.mode === 'keys';
  const ink = c.accent && c.accent !== CLEAR ? c.accent : L.accent === CLEAR ? lineOn(hubC) : L.accent;
  // Your own colour for the Y is used as it is; a see-through one hides its lines.
  const line = y?.accent && y.accent !== CLEAR ? y.accent : hubLine(fill, c.accent || L.accent, hubC);
  const solid = rgba(hubC, L.theme === 'glass' ? 0.78 : 1);
  const clear = tint ? rgba(tint, TINT_ALPHA) : CLEAR; // nothing but its tint, if it has one
  const vars = {
    ...paintVars({ ...c, accent: noInk ? CLEAR : ink }),
    '--hub': fill === CLEAR ? clear : solid,
    '--slice': ownFill ? solid : clear, // over a picture: its own fill, or the picture itself
    '--hub-line': line,
    '--hub-halo': (c.fill ? c.fill === CLEAR : hasBg || L.fill === CLEAR) ? outlineFor(rgbOf(line)) : CLEAR,
  };
  if (y?.accent === CLEAR) Object.assign(vars, { '--hub-y': CLEAR, '--hub-y-halo': CLEAR });
  // Over the app's icon too.
  if (c.accent) vars['--hub-ink'] = noInk ? CLEAR : ink;
  if (c.fill || c.tint) vars['--hub-scrim'] = c.fill === CLEAR ? clear : rgba(hubC, 0.55);
  return vars;
}

function keySlots(ringsArr = rings()) {
  const out = ringsArr.map((ring, ri) =>
    ring.items.map((it) => painted({ angle: it.angle, span: it.span, ...slotFace(it, ri) }, face(it).colors)),
  );
  // Inside a sub-menu, the slot you came in through is the way back.
  const back = backSlot();
  if (back) {
    while (out.length <= back.ring) out.push([]);
    out[back.ring].push(painted({ angle: back.angle, span: back.span, icon: 'back', caption: 'Back', cls: 'back-slot', back: true }, config.paint?.back));
  }
  return out;
}

/**
 * In a sub-menu: whose look the colour, picture, see-through and size options change
 * (" · changes this menu"), so it's never a surprise. "" in the main menu.
 */
function lookScope() {
  if (!S.path.length) return '';
  const owner = lookOwner();
  const body = menuBody(currentMenu());
  if (owner && owner.body === body) {
    return `${dot}changes <b>this menu</b>${sharedMenu(currentMenu()?.link) ? ', everywhere it’s used' : ''}`;
  }
  return owner
    ? `${dot}changes <b>${esc(owner.name)}</b> (this menu looks like it)`
    : `${dot}changes the <b>main menu</b> (this menu looks like it)`;
}

/** The "Look" option (sub-menus only): give this menu its own look, or drop it. */
function ownLookDef() {
  const body = menuBody(currentMenu());
  const mine = !!body?.look;
  const owner = lookOwner(S.path.slice(0, -1));
  const parent = owner ? `<b>${esc(owner.name)}</b>` : 'the <b>main menu</b>';
  const everywhere = sharedMenu(currentMenu()?.link) ? ' (everywhere this reusable menu is used)' : '';
  return {
    id: 'ownLook', icon: 'look', caption: 'Look', badge: mine ? 'on' : 'off',
    desc: mine
      ? `<b>Own look</b> is on${everywhere}${dot}colours, picture, see-through and size here are this menu’s own${dot}click to look like ${parent} again`
      : `<b>Own look</b> is off${dot}this menu looks like ${parent}${dot}click to give it its own colours, picture, see-through and size${everywhere}`,
  };
}

// Options: a few on the ring, the rest in groups (Add, Adjust, Toggles) that open on the
// wheel like a right-click menu.
const OPTION_GROUPS = {
  add: ['slot', 'menu', 'program'],
  adjust: ['bigger', 'smaller', 'slotSize', 'rotate'],
  toggles: ['labels', 'context', 'glass', 'gaps', 'background', 'startup', 'hold'],
};

function optionDefs() {
  const all = new Map(allOptionDefs().map((o) => [o.id, o]));
  const pick = (...ids) => ids.map((id) => all.get(id)).filter(Boolean);
  return [
    ...pick('done'),
    { id: 'add', icon: 'plus', caption: 'Add', desc: `<b>Add</b>${dot}a key slot, a sub-menu or a program` },
    ...pick('remove', 'move'),
    { id: 'adjust', icon: 'adjust', caption: 'Adjust', desc: `<b>Adjust</b>${dot}bigger, smaller, slot width, turn a ring` },
    { id: 'toggles', icon: 'toggles', caption: 'Toggles', desc: `<b>Toggles</b>${dot}labels, app icon, see-through, gaps, background image, launch at login, hold to select` },
    ...pick('ownLook', 'presets', 'reset', 'quit'),
  ];
}

/** Every option, grouped or not. */
function allOptionDefs() {
  const on = (b) => (b ? 'on' : 'off');
  const L = look();
  const glass = L.theme === 'glass';
  const scope = lookScope();
  return [
    { id: 'done', icon: 'check', caption: 'Done', desc: '<b>Done</b>: back to your keys' },
    { id: 'slot', icon: 'plus', caption: 'Slot', desc: `<b>Add a key slot</b>${dot}drop it anywhere, other slots make room` },
    {
      id: 'menu', icon: 'folder', caption: 'Menu',
      desc: config.menus?.length
        ? `<b>Add a sub-menu</b>${dot}a new one, or one of your reusable menus`
        : `<b>Add a sub-menu</b>${dot}a slot that opens its own set of slots`,
    },
    { id: 'program', icon: 'launch', caption: 'Program', desc: `<b>Add a program</b>${dot}pick one, place its slot anywhere, click it to open the program` },
    { id: 'move', icon: 'move', caption: 'Move', desc: `<b>Move a slot</b>${dot}other slots make room` },
    { id: 'remove', icon: 'trash', caption: 'Remove', desc: `<b>Remove a slot</b>` },
    { id: 'rotate', icon: 'rotate', caption: 'Turn', desc: `<b>Turn a ring</b>${dot}drag a ring, or scroll over it` },
    { id: 'slotSize', icon: 'slotWide', caption: 'Width', desc: `<b>Slot size</b>${dot}make slots narrower to fit more keys in a ring` },
    { id: 'smaller', icon: 'smaller', caption: 'Smaller', desc: `Make the ${S.path.length ? 'menu' : 'whole wheel'} <b>smaller</b>${scope}` },
    { id: 'bigger', icon: 'bigger', caption: 'Bigger', desc: `Make the ${S.path.length ? 'menu' : 'whole wheel'} <b>bigger</b>${scope}` },
    {
      id: 'background', icon: 'image', caption: 'Image', badge: L.background ? 'on' : 'off',
      desc: L.background
        ? `<b>Background image</b>${dot}click to change or remove it${scope}`
        : `<b>Background image</b>${dot}pick a picture to show through the slots${scope}`,
    },
    {
      id: 'glass', icon: 'glass', caption: 'Glass', badge: glass ? 'on' : 'off',
      desc: `<b>See-through</b> is ${on(glass)}${dot}${glass ? 'what is behind the wheel shows through' : 'slots are solid'}${scope}`,
    },
    {
      id: 'gaps', icon: 'gaps', caption: 'Gaps', badge: on(L.gaps !== false),
      desc: L.gaps !== false
        ? `<b>Gaps</b> are on${dot}space between slots and rings${dot}click to make them touch${dot}right-click for their colour${scope}`
        : `<b>Gaps</b> are off${dot}slots and rings touch, with a thin line between${dot}right-click for its colour${scope}`,
    },
    ...(S.path.length ? [ownLookDef()] : []),
    {
      id: 'context', icon: 'app', caption: 'Icon', badge: config.showApp ? 'on' : 'off',
      desc: `<b>App icon</b> is ${on(config.showApp)}${dot}the icon of the app your keys go to fills the center`,
    },
    {
      id: 'labels', icon: 'labels', caption: 'Labels', badge: config.optionLabels === false ? 'off' : 'on',
      desc: config.optionLabels === false
        ? `<b>Labels</b> are off${dot}options show just their icons (pointing at one still says what it does)`
        : `<b>Labels</b> are on${dot}the words under the option icons; turn off for icons only`,
    },
    {
      id: 'hold', icon: 'timer', caption: 'Hold', badge: config.holdToSelect ? 'on' : 'off',
      desc: `<b>Hold to select</b> is ${on(config.holdToSelect)}${dot}hold the hotkey, point, let go to send`,
    },
    {
      id: 'startup', icon: 'power', caption: 'Login', badge: S.autostart ? 'on' : 'off',
      desc: `<b>Launch at login</b> is ${on(S.autostart)}`,
    },
    {
      id: 'presets', icon: 'presets', caption: 'Presets',
      desc: `<b>Presets</b>${dot}save this whole setup (colors, rings, sub-menus…) or switch to a saved one`,
    },
    { id: 'reset', icon: 'reset', caption: 'Reset', desc: 'Reset slots, size and colors to the defaults' },
    { id: 'quit', icon: 'quit', caption: 'Quit', desc: 'Quit Radial Keys' },
  ];
}

/**
 * A wheel made small (Options → Smaller, twice or more) has no room for the words under
 * option icons: show just the icons (hovering one still says what it does).
 */
const COMPACT_RING_WIDTH = 56;
// The smallest a slot's name gets: past this it's cut short with "…" instead.
const NAME_MIN = 7.5;

// The options center: Tint on top between the Y's arms, Fill right, Accent left.
const HUB_PARTS = [
  { id: 'tint', label: 'Tint', from: -60, to: 60 },
  { id: 'fill', label: 'Fill', from: 60, to: 180 },
  { id: 'accent', label: 'Accent', from: 180, to: 300 },
];
/** Which part of the options center a point (wheel coordinates) is in. */
function hubPart(p) {
  const a = angleOf(p.x, p.y);
  return a >= 300 || a < 60 ? 'tint' : a < 180 ? 'fill' : 'accent';
} // default 64; Smaller steps: 58, 53, 48, 44, 40
const optionCaption = (text) => (config.optionLabels === false || look().ringWidth < COMPACT_RING_WIDTH ? undefined : text);

const CLEAR_MEANS = { accent: 'no labels or icons', fill: 'no fill, so the picture shows', tint: 'no tint' };

/** Option `id` ({ id, icon, caption, desc }), on the ring or in a group. */
const optionDef = (id) => [...optionDefs(), ...allOptionDefs()].find((o) => o.id === id) ?? null;

/** The group (Add, Adjust, Toggles) option `id` is in, or null if it's on the ring itself. */
const groupOf = (id) => Object.keys(OPTION_GROUPS).find((g) => OPTION_GROUPS[g].includes(id)) ?? null;

/** An option's own colours. One in a group looks like its group's option, unless it has its own. */
function optionColors(id) {
  const group = groupOf(id);
  const c = { ...(group && config.paint?.[`opt:${group}`]), ...config.paint?.[`opt:${id}`] };
  return Object.keys(c).length ? c : undefined;
}

/** Option slot `slot` as you made it look: your picture for its icon, its word or not, its colours. */
function optionSlot(id, slot) {
  const f = config.faces?.[`opt:${id}`];
  const pic = f?.image && slotImage(f.image);
  const out = { ...slot, optId: id };
  if (pic) {
    delete out.icon;
    Object.assign(out, { picture: pic, cover: !!f.cover });
  }
  if (f?.hideLabel) delete out.caption;
  return painted(out, optionColors(id));
}

function optionSlots() {
  const inner = optionDefs().map((o) => ({ ...o, caption: optionCaption(o.caption) }));
  const step = 360 / inner.length;
  const accent = look().accent.toLowerCase();
  const fill = look().fill.toLowerCase();
  const tint = (look().tint || '').toLowerCase();
  const targets = ([...S.colorTargets].join(' + ') || 'nothing (pick Accent, Fill or Tint in the center)') + lookScope();
  // The last swatch is transparent: no labels and icons, no fill or no tint.
  const colors = [...COLORS, CLEAR];
  const clearTo = [...S.colorTargets].map((t) => CLEAR_MEANS[t]).join(', ') || 'nothing (pick Accent, Fill or Tint in the center)';
  const cstep = 360 / colors.length;
  return [
    inner.map((o, i) => optionSlot(o.id, { ...o, cls: 'opt', angle: i * step, span: step })),
    colors.map((c, i) => (c === CLEAR
      ? {
          id: 'color', color: c, angle: i * cstep, span: cstep, fill: 'url(#clear-hatch)', cls: `swatch none${S.brush?.color === c ? ' carried' : ''}`,
          marks: [accent === CLEAR && 'A', fill === CLEAR && 'F', !tint && 'T'].filter(Boolean).join(' ') || null,
          markColor: '#ffffff',
          desc: `<b>Transparent</b>${dot}${clearTo}${lookScope()}${dot}right-click to give it to single slots instead`,
        }
      : {
          id: 'color', color: c, angle: i * cstep, span: cstep, fill: c, cls: `swatch${S.brush?.color === c ? ' carried' : ''}`,
          // A = current accent, F = current fill, T = current tint.
          marks: [c === accent && 'A', c === fill && 'F', c === tint && 'T'].filter(Boolean).join(' ') || null,
          markColor: inkOn(c),
          desc: `<b>${c}</b>${dot}sets ${targets}${dot}right-click to give it to single slots instead`,
        })),
  ];
}

function hub(mode = S.mode) {
  switch (mode) {
    case 'options':
      // Pick what the swatches colour: accent, fill, tint (any mix). Three slices in a Y.
      return {
        pie: HUB_PARTS.map((p) => ({
          ...p,
          swatch: p.id === 'tint' ? look().tint || CLEAR : look()[p.id],
          selected: S.colorTargets.has(p.id),
        })),
      };
    case 'presets': {
      if (S.naming) return { top: 'Name', main: S.naming.text || '…' };
      const P = S.presets;
      const active = P?.active && P.presets.find((p) => p.name === P.active);
      return {
        top: 'Using',
        main: active ? active.name : 'Unsaved setup',
        bottom: active && !active.same ? 'edited · back' : 'back',
      };
    }
    case 'menus':
      if (S.naming) return { top: 'Name', main: S.naming.text || '…' };
      return { top: 'Add a', main: 'Sub-menu', bottom: 'back' };
    case 'actions':
      if (S.actions?.colors) {
        // The colour menu: the same Y as in Options, showing this slot's colours.
        const own = colorTarget(S.actions)?.colors ?? {};
        return {
          pie: HUB_PARTS.map((p) => ({
            ...p,
            swatch: own[p.id] || (p.id === 'tint' ? look().tint || CLEAR : look()[p.id]),
            selected: S.colorTargets.has(p.id),
          })),
        };
      }
      if (S.actions?.gapColors) return { top: 'Gap', main: 'Colour', bottom: 'back' };
      {
        const { clicked } = actionSource(S.actions);
        if (clicked) return actionHub(clicked);
      }
      return hub(S.actions?.from ?? 'keys'); // no slot (it's gone): the center stays what it was
    case 'place': return { icon: 'x', bottom: 'Cancel' };
    case 'pick-move':
    case 'pick-remove': return { icon: 'check', bottom: 'Done' };
    case 'size': return { halves: { left: { icon: 'minus' }, right: { icon: 'plus' } } };
    case 'rotate': return { icon: 'check', bottom: 'Done' };
    case 'capture':
      if (S.capture?.target === 'hotkey') return { top: 'Listening', main: 'Press keys…' };
      return { top: 'Open with', main: hotkeyText() };
    default: {
      // Center = which app the keys go to (its icon fills the circle) + the hotkey.
      const icon = S.app && appIcons.get(S.app.id);
      // In a sub-menu the center shows (and sets) that sub-menu's own hotkey.
      const sub = currentMenu();
      const main = sub ? (sub.hotkey ? hotkeyText(sub.hotkey) : 'No hotkey') : hotkeyText();
      if (S.app) return { top: S.app.name, main, version: versionText, image: config.showApp ? icon || null : null };
      return { top: sub ? sharedMenu(sub.link)?.label || 'Sub-menu' : 'Open with', main, version: versionText, bottom: 'click for options' };
    }
  }
}

/** How strongly the tint colours each slot (0 = not at all, 1 = covers it). */
const TINT_ALPHA = 0.38;

/** Turn the open menu's accent / fill / tint / see-through into the wheel's colour variables. */
function applyColors(hasBg) {
  const L = look();
  const clearFill = L.fill === CLEAR;
  const fill = solidOf(L.fill);
  // A see-through accent still needs something to highlight with: black or white.
  const accent = L.accent === CLEAR ? lineOn(fill) : L.accent;
  const acc = rgbOf(accent);
  // It hides labels and icons on the keys only: you need to see the rest to get around.
  const noInk = L.accent === CLEAR && S.mode === 'keys';
  const lightFill = lum(fill) > 0.45;
  const glass = L.theme === 'glass';
  // With a background picture there's no tint over it at all: the picture *is* the slots.
  // See-through then makes the picture itself translucent.
  const a = hasBg || clearFill ? 0 : glass ? 0.62 : 1;
  const alt = mixRgb(fill, lightFill ? [0, 0, 0] : [255, 255, 255], 0.06);
  const hubC = hubColorOf(fill);
  // Key labels and option icons always use the accent. If it's too close to the fill to
  // read, they get a thin outline instead (the colour itself never changes).
  const ink = acc;
  const low = !noInk && (clearFill || contrast(acc, fill) < 2);
  const outline = outlineFor(acc);
  const line = hubLine(L.fill, L.accent, hubC);
  // Greyed-out slots (right-click menus): a plain grey about as bright as the fill.
  const fillV = Math.round((fill[0] + fill[1] + fill[2]) / 3);
  const offV = lightFill ? Math.round(fillV * 0.82) : fillV + 16;
  const offInk = lightFill ? offV - 62 : offV + 52;
  const vars = {
    '--accent': accent,
    '--on-accent': inkOn(accent),
    '--slice': rgba(fill, a),
    '--slice-alt': rgba(alt, a),
    '--hub': clearFill ? CLEAR : rgba(hubC, glass ? 0.78 : 1),
    '--hub-line': line,
    // With a picture or nothing behind them, the Y and its words get an edge to stay visible.
    '--hub-halo': hasBg || clearFill ? outlineFor(rgbOf(line)) : CLEAR,
    '--text': noInk ? CLEAR : rgba(ink, 1),
    '--muted': noInk ? CLEAR : rgba(mixRgb(ink, fill, 0.4), 1),
    '--label-halo': noInk ? CLEAR : LABEL_HALO,
    // Gaps off: the lines between slots are the gap colour, if you gave them one.
    '--edge': L.gaps === false && L.gapColor ? L.gapColor : clearFill && !hasBg ? CLEAR_EDGE : lightFill ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.08)',
    '--gap': L.gapColor || CLEAR,
    '--guide': rgba(fill, 0.4),
    '--bg-opacity': glass ? '0.5' : '1',
    '--tint': L.tint ? rgba(rgbOf(L.tint), TINT_ALPHA) : CLEAR,
    '--off-slice': rgba([offV, offV, offV], 1),
    '--off-ink': rgba([offInk, offInk, offInk], 1),
    '--off-edge': lightFill ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.05)',
    '--text-outline': low ? outline : CLEAR,
    '--icon-outline': low ? `drop-shadow(0 0 0.8px ${outline}) drop-shadow(0 0 0.8px ${outline})` : 'none',
  };
  for (const [k, v] of Object.entries(vars)) svg.style.setProperty(k, v);
  msgEl.style.setProperty('--accent', L.accent === CLEAR ? MSG_ACCENT : L.accent);
}

// Background pictures (the main menu's, sub-menus' own): loaded once, scaled down for
// speed, cached by file name.
const bgCache = new Map();
function currentBackground() {
  const name = look().background;
  if (!name) return null;
  if (!bgCache.has(name)) loadBackground(name); // draws again once it's ready
  return bgCache.get(name) || null;
}
async function loadBackground(name = look().background) {
  if (!name || bgCache.has(name)) return;
  bgCache.set(name, null);
  try {
    const url = await invoke('image_data', { name });
    if (!url) return;
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    bgCache.set(name, c.toDataURL('image/webp', 0.9));
    if (S.visible && look().background === name) draw();
  } catch (e) {
    console.warn('background image', e);
  }
}

/** The slots a mode shows, by ring. */
function slotsFor(mode, shown) {
  switch (mode) {
    case 'options': return optionSlots();
    case 'presets': return presetSlots();
    case 'menus': return menuPickSlots();
    case 'actions': return actionSlots();
    default: return keySlots(shown);
  }
}

function draw() {
  geo = geometry(look(), layout.rings);
  const under = S.mode === 'actions' ? S.actions?.from ?? 'keys' : S.mode; // a right-click menu keeps the wheel it's on
  const bg = under === 'options' || under === 'presets' || under === 'menus' ? null : currentBackground();
  applyColors(!!bg);
  svg.classList.toggle('placing', S.mode === 'place');
  svg.classList.toggle('picking-move', S.mode === 'pick-move');
  svg.classList.toggle('picking-remove', S.mode === 'pick-remove');

  // While placing, the target ring shows its neighbours already pushed aside.
  const pv = S.mode === 'place' && S.place?.preview;
  const current = rings();
  const shown = pv ? current.map((r, i) => (i === pv.ring ? { items: pv.items } : r)) : current;
  if (pv) while (shown.length <= pv.ring) shown.push({ items: [] });
  drawn = slotsFor(S.mode, shown);
  const c = S.capture;
  if (c?.target === 'slot' && c.pick != null && drawn[c.ring]?.[c.index]) {
    drawn[c.ring][c.index] = { ...drawn[c.ring][c.index], label: keys[c.pick].label, sub: '' };
  }
  // Message box right above the outermost ring with slots. While placing a slot it stays
  // above the whole area, so it never covers the spot for a new ring.
  let ringsShown = drawn.length;
  while (ringsShown > 1 && !drawn[ringsShown - 1]?.length) ringsShown--;
  placeBanner(S.mode === 'place' ? layout.rings : Math.max(1, ringsShown));
  const h = hub();
  wheel = render(svg, geo, layout.size, drawn, h, {
    background: bg,
    bgHub: !h.image && !h.halves,
    hubVars: h.vars ?? hubPaintVars(!!bg),
    gapFill: !!look().gapColor && look().gapColor !== CLEAR,
    guides: S.mode === 'place' ? rings().length + 1 : 0,
    highlightRing: S.mode === 'rotate' ? (S.turn?.ring ?? S.hoverRing) : null,
  });
  if (c) wheel.mark(c.target === 'hotkey' ? { center: true } : { ring: c.ring, index: c.index }, 'capturing');
  if (S.naming) wheel.mark(namingHit(), 'capturing');
  if (S.place?.ghost) wheel.ghost(ghostSlot());
  wheel.setActive(S.hover);
}

async function setMode(mode) {
  if (S.brush && !BRUSH_MODES.has(mode)) dropBrush();
  S.mode = mode;
  S.hover = null;
  S.turn = null;
  S.hoverRing = -1;
  msg.prompt = null;
  msg.hint = null;
  showMsg();
  trimRings();
  await ensureLayout();
  draw();
  updateHint();
}

// ---------------------------------------------------------------------------
// Hover + hints
// ---------------------------------------------------------------------------
function sameHit(a, b) {
  return a === b || (a && b && a.center === b.center && a.half === b.half && a.ring === b.ring && a.index === b.index);
}

function setHover(hit) {
  if (sameHit(S.hover, hit)) return;
  S.hover = hit;
  wheel?.setActive(hit);
  updateHint();
  // Right after entering/leaving a sub-menu the pointer sits on its Back (or folder) slot:
  // only allow hold-to-open again once it has moved somewhere else.
  if (S.dwellBlock) {
    if (S.dwellFirst === undefined) S.dwellFirst = hit;
    else if (!sameHit(hit, S.dwellFirst)) {
      S.dwellBlock = false;
      S.dwellFirst = undefined;
    }
  }
  armDwell(hit);
}

function itemAt(hit) {
  return hit && !hit.center ? rings()[hit.ring]?.items[hit.index] : null;
}

/** Name for messages: the key combo, or "sub-menu". */
function slotName(it) {
  if (it?.menu) return face(it).label?.trim() || 'sub-menu';
  if (it?.program) return it.label || 'program';
  return itemName(it, keyMap, platform);
}

/** What's drawn at `hit` (includes the Back slot, which isn't a stored item). */
function drawnAt(hit) {
  return hit && !hit.center ? drawn[hit.ring]?.[hit.index] : null;
}

async function openMenu(hit) {
  const it = itemAt(hit);
  if (!it?.menu) return;
  S.path.push({ ring: hit.ring, angle: it.angle });
  S.dwellBlock = true; // you're now on its Back slot: don't bounce straight back out
  S.dwellFirst = undefined;
  await setMode('keys');
  if (!(menuBody(it.menu).rings ?? []).some((r) => r.items.length)) {
    toast('This sub-menu is empty · add slots from <b>options</b> · <b>Back</b> returns', 'prompt', { ttl: 5000 });
  }
}

async function goBack() {
  if (!S.path.length) return;
  S.path.pop();
  S.dwellBlock = true;
  S.dwellFirst = undefined;
  await setMode('keys');
}

// Holding the hotkey: resting on a sub-menu (or Back) slot opens it, so you can keep holding.
let dwellTimer = null;
function armDwell(hit) {
  clearTimeout(dwellTimer);
  const d = drawnAt(hit);
  if (!S.holding || S.mode !== 'keys' || !d) return;
  if (!(d.back || itemAt(hit)?.menu)) return;
  if (S.dwellBlock) return;
  dwellTimer = setTimeout(() => {
    if (S.mode !== 'keys' || !sameHit(S.hover, hit)) return;
    if (drawnAt(hit)?.back) goBack();
    else openMenu(hit);
  }, 380);
}

/** What a part of the Y in the center does (Options, the colour menu). */
function hubPartHint(t) {
  const what = {
    accent: `<b>Accent</b>: ${S.actions?.colors ? 'its label or icon, and highlight' : 'key labels, icons and highlights'}`,
    fill: `<b>Fill</b>: ${S.actions?.colors ? 'its background' : 'the slot background'}`,
    tint: `<b>Tint</b>: ${S.actions?.colors ? 'a see-through colour over it, pictures too' : 'a see-through colour over every slot, pictures too'}`,
  }[t];
  return `${what}${dot}click to ${S.colorTargets.has(t) ? 'unselect' : 'select'}, then pick a colour`;
}

function updateHint() {
  const h = S.hover;
  switch (S.mode) {
    case 'keys': {
      if (h?.center) {
        return setHint(S.path.length
          ? `Click for <b>options</b>${dot}right-click to give this sub-menu its own hotkey`
          : `Click for <b>options</b>${dot}right-click to change the hotkey`);
      }
      if (drawnAt(h)?.back) return setHint(`<b>Back</b> to the previous menu${dot}right-click to move it`);
      const it = itemAt(h);
      if (it?.menu) {
        const reusable = sharedMenu(it.menu.link) ? `${dot}reusable menu` : '';
        return setHint(`<b>${esc(face(it).label?.trim() || 'Sub-menu')}</b>${reusable}${dot}click to open${dot}right-click for more`);
      }
      if (it?.program) return setHint(`<b>${esc(it.label || 'Program')}</b>${dot}click to open${dot}right-click for more`);
      if (!it) return setHint(null);
      const combo = itemName(it, keyMap, platform);
      const named = it.label?.trim();
      return setHint(`<b>${esc(named || combo)}</b>${named ? ` <span class="dim">${esc(combo)}</span>` : ''}${dot}right-click for more`);
    }
    case 'options': {
      if (h?.center) return setHint(`${hubPartHint(h.half)}${dot}right-click: colours of the Y`);
      const o = h && drawn[h.ring]?.[h.index];
      if (o?.optId) return setHint(`${o.desc}${dot}right-click to restyle`);
      return setHint(o ? o.desc : `<b>Options</b>${dot}pick Accent, Fill and/or Tint in the center, then a colour${dot}✓ when done`);
    }
    case 'presets': {
      const P = S.presets;
      if (h?.center) return setHint(`Back to <b>options</b>${P?.active ? `${dot}using <b>${esc(P.active)}</b>` : ''}`);
      const d = drawnAt(h);
      if (d?.back) return setHint('<b>Back</b> to options');
      if (d?.id === 'save') {
        const cur = presetByName(P.active);
        return setHint(cur?.same
          ? `<b>${esc(P.active)}</b> already has everything you see`
          : `<b>Save</b> your changes into <b>${esc(P.active)}</b>`);
      }
      if (d?.id === 'save-new') return setHint(`<b>Save new</b>${dot}keep this setup as another preset${dot}colors, rings, sub-menus, programs: all of it`);
      if (d?.id === 'import') return setHint(`<b>Import</b>${dot}load a preset from a file (.rkpreset)`);
      const p = d?.preset && P?.presets.find((x) => x.name === d.preset);
      if (p) {
        const current = P.active === p.name;
        const what = p.same
          ? current ? 'in use now' : 'same as your setup now'
          : current ? 'in use, with changes not saved in it' : 'click to switch to it';
        return setHint(`<b>${esc(p.name)}</b>${dot}${what}${dot}right-click for more`);
      }
      return setHint(P?.presets.length
        ? `<b>Presets</b>${dot}click one to switch to it${dot}<b>Save new</b> keeps this setup as another one`
        : `No presets yet${dot}<b>Save new</b> keeps this whole setup as one`);
    }
    case 'menus': {
      if (h?.center) return setHint('Back to <b>options</b>');
      const d = drawnAt(h);
      if (d?.back) return setHint('<b>Back</b> to options');
      if (d?.id === 'new-menu') return setHint(`<b>New</b> sub-menu${dot}an empty one, just for here`);
      const m = d?.shared && sharedMenu(d.shared);
      if (m) {
        if (d.blocked) return setHint(`<b>${esc(m.label)}</b> can’t go here: this menu is inside it`);
        const n = slotsIn(m.rings);
        const uses = usesOf(m.id);
        return setHint(`<b>${esc(m.label)}</b>${dot}${n} slot${n === 1 ? '' : 's'}, used ${uses === 1 ? 'once' : `${uses} times`}${dot}click to add it here${dot}right-click for more`);
      }
      return setHint(`<b>Add a sub-menu</b>${dot}a new one, or a reusable menu: the same menu everywhere you put it`);
    }
    case 'actions': {
      const A = S.actions;
      if (!A) return setHint(null);
      const d = drawnAt(h);
      if (h?.center) return actionsMsg(A.colors ? hubPartHint(h.half) : wayBackText(A));
      if (d?.optId && d.act != null) return actionsMsg(`${d.desc}${dot}right-click to restyle`);
      return actionsMsg(d && !d.off ? d.desc : A.title);
    }
    case 'size':
      if (h?.center) return setHint(h.half === 'left' ? '<b>Narrower</b> slots: fit more in a ring' : '<b>Wider</b> slots: bigger targets and text');
      return setHint(null);
    case 'pick-move':
    case 'pick-remove': {
      const it = itemAt(h);
      const verb = S.mode === 'pick-move' ? 'move' : 'remove';
      const done = `${dot}✓ <b>Done</b> in the center when you’re finished`;
      if (h?.center) return setPrompt(`<b>Done</b>: back to options`);
      if (drawnAt(h)?.back) {
        return setPrompt(S.mode === 'pick-move' ? `Click to move <b>Back</b>${done}` : `<b>Back</b> can’t be removed${done}`);
      }
      return setPrompt(
        it ? `Click to ${verb} <b>${esc(slotName(it))}</b>${done}` : `Click each slot you want to ${verb}${done}`,
      );
    }
    default:
      return setHint(null);
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
function send(item) {
  if (!item?.key) return;
  invoke('activate', { key: item.key, mods: item.mods || [] }).catch((e) => toast(esc(e), 'error', { ttl: 5000 }));
}

function close() {
  invoke('close_wheel');
}

let edits = 0; // bumped by rapid edits (slot resizing) so a slow save can't undo newer ones
async function save() {
  const sortAll = (rs) => rs?.forEach((r) => {
    r.items.sort((a, b) => a.angle - b.angle);
    for (const it of r.items) if (it.menu) sortAll(it.menu.rings);
  });
  sortAll(config.rings);
  for (const m of config.menus ?? []) sortAll(m.rings);
  const v = edits;
  const before = lastSaved;
  try {
    const saved = await invoke('save_config', { config });
    if (v === edits) config = saved;
    remember(before, saved);
  } catch (e) {
    toast(esc(e), 'error', { ttl: 5000 });
  }
}

// --- Undo (Ctrl+Z / ⌘Z) -------------------------------------------------------------
// Each save keeps the setup it replaced, so changes can be taken back one at a time,
// newest first. An Undo button on screen for something newer (a preset switched, saved
// or deleted) goes first.

const UNDO_MAX = 60;
const undoKey = mac ? '⌘Z' : 'Ctrl+Z';
const history = []; // { json, seq }: the setup before each change, newest last
let lastSaved = JSON.stringify(config); // the setup as it's saved now
let undoSeq = 0; // orders changes and Undo buttons: the newest is undone first
let restoring = false;

/** After a save: keep the setup it replaced (unless nothing changed, or this *is* an undo). */
function remember(before, saved) {
  const now = JSON.stringify(saved);
  if (!restoring && before !== now && history.at(-1)?.json !== before) {
    history.push({ json: before, seq: ++undoSeq });
    if (history.length > UNDO_MAX) history.shift();
  }
  lastSaved = now;
}

/** The setup was replaced wholesale (a preset): older changes don't apply to it. */
function forgetHistory() {
  history.length = 0;
  lastSaved = JSON.stringify(config);
}

/** An Undo button for something that isn't a plain setup change (presets): newer than every change so far. */
const undoButton = (run) => ({ label: 'Undo', undo: true, seq: ++undoSeq, run });

let undoBusy = false;
let lastUndoAt = 0;
async function undo() {
  // The keyboard shortcut can arrive twice (global hotkey + page): once is enough.
  const t = performance.now();
  if (undoBusy || t - lastUndoAt < 120) return;
  lastUndoAt = t;
  if (S.naming || S.mode === 'capture') return;
  if (S.mode === 'place') return cancelPlace(); // the slot you're placing goes back
  const top = history.at(-1);
  const chip = msg.toast?.actions?.find((a) => a.undo);
  if (chip && (!top || chip.seq > top.seq)) return chip.run();
  if (!top) return toast('Nothing to undo', 'prompt');
  undoBusy = true;
  try {
    await restore(top);
  } finally {
    undoBusy = false;
  }
}

/** Undo button of change `seq` (Remove, Fill gap): like Ctrl+Z while it's the newest change. */
async function undoChange(seq, fallback) {
  clearToast();
  const top = history.at(-1);
  if (top && top.seq === seq) return restore(top);
  return fallback?.();
}

async function restore(entry) {
  history.splice(history.indexOf(entry));
  clearTimeout(turnTimer);
  clearTimeout(sizeTimer);
  edits++;
  config = JSON.parse(entry.json);
  restoring = true;
  try {
    await save();
  } finally {
    restoring = false;
  }
  // Out of a right-click menu (what it was about may be gone now); the rest stays.
  const mode = S.mode === 'actions' ? S.actions?.from ?? 'keys' : S.mode;
  S.actions = null;
  if (mode === 'presets') S.presets = await invoke('list_presets').catch(() => S.presets);
  if (!menuAt(S.path)) S.path = [];
  loadBackground();
  await setMode(mode);
  await ensureLayout(true);
  draw();
  toast(history.length ? `Undone${dot}<kbd>${undoKey}</kbd> again to undo more` : 'Undone');
}

// Pictures you replaced or removed stay on disk while an undo could bring them back;
// they're deleted when the wheel closes (unless something still uses them).
const droppedImages = new Set();
const dropImage = (name) => name && droppedImages.add(name);
function tidyImages() {
  for (const name of droppedImages) {
    if (history.some((e) => e.json.includes(JSON.stringify(name)))) continue;
    droppedImages.delete(name);
    invoke('delete_image', { name }).catch(() => {});
  }
}

/** Ring index under the point, or -1 (center / outside). */
function ringUnder(p) {
  const r = ringAt(geo, Math.hypot(p.x, p.y));
  return r >= 0 && r < rings().length ? r : -1;
}

/** Turn every slot in a ring by `deg` (clockwise). */
function turnRing(ring, deg) {
  edits++;
  for (const it of rings()[ring]?.items ?? []) it.angle = (((it.angle + deg) % 360) + 360) % 360;
  draw();
}

let turnTimer = null;
function scheduleSave() {
  clearTimeout(turnTimer);
  turnTimer = setTimeout(save, 300);
}

function rotateMove(p, hit) {
  if (S.turn) {
    // Dragging: follow the pointer around the center.
    const a = angleOf(p.x, p.y);
    let d = a - S.turn.last;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    S.turn.last = a;
    S.turn.moved += Math.abs(d);
    return turnRing(S.turn.ring, d);
  }
  const ring = hit?.center ? -1 : ringUnder(p);
  if (ring !== S.hoverRing) {
    S.hoverRing = ring;
    draw();
  }
}

const SLOT_STEP = 1.12;
let sizeTimer = null;
/** Make every slot narrower (f < 1) or wider (f > 1), keeping centers; wider slots push apart. */
function resizeSlots(f) {
  edits++;
  for (const ring of rings()) {
    ring.items.forEach((it) => (it.span = clamp(it.span * f, 6, 120)));
    if (f > 1) ring.items = resolveRing(ring.items);
  }
  draw();
  clearTimeout(sizeTimer);
  sizeTimer = setTimeout(save, 300);
}

async function enterOptions() {
  try {
    S.autostart = await invoke('get_autostart');
  } catch {
    S.autostart = false;
  }
  await setMode('options');
}

/** Where option `id` is on the options ring ({ ring, index }). */
function optionHit(id) {
  const index = optionDefs().findIndex((o) => o.id === id);
  return index >= 0 ? { ring: 0, index } : null;
}

/** An option group (Add, Adjust, Toggles) as a menu on the wheel, next to its option. */
function optionGroupSpec(id) {
  const all = new Map(allOptionDefs().map((o) => [o.id, o]));
  const group = optionDefs().find((o) => o.id === id);
  const at = drawn[0]?.find((x) => x.id === id); // where it is (Menu's picker opens there)
  const source = optionHit(id);
  return {
    title: group.desc,
    name: group.caption,
    source,
    list: OPTION_GROUPS[id].map((sub) => all.get(sub)).filter(Boolean).map((o) => ({
      label: o.caption, icon: o.icon, badge: o.badge, desc: o.desc, optId: o.id,
      run: async () => {
        // Things that open choices of their own (Image, once set) have Back to this group.
        await runOption({ ...o, angle: at?.angle ?? 0, span: at?.span ?? 24, source, parent: optionGroupSpec(id) });
        // Toggles and Bigger / Smaller stay open, so you can do another.
        if (id !== 'add' && S.mode === 'options') await showActions(optionGroupSpec(id));
      },
    })),
  };
}

async function runOption(o) {
  switch (o.id) {
    case 'add':
    case 'adjust':
    case 'toggles':
      return showActions(optionGroupSpec(o.id));
    case 'slot':
      return startPlace({ isNew: true, item: { label: '', key: '', mods: [] } });
    case 'menu':
      // With reusable menus to choose from, first pick: a new one or one of those.
      if (config.menus?.length) return enterMenuPicker(o);
      return placeNewMenu();
    case 'ownLook':
      return toggleOwnLook();
    case 'program': {
      // Pick the program first, then drag its slot to where you want it.
      const picked = await pickProgram();
      if (!picked) return;
      return startPlace({ isNew: true, item: { label: picked.name, key: '', mods: [], program: picked.path } });
    }
    case 'presets':
      return enterPresets(o);
    case 'move':
      return setMode('pick-move');
    case 'remove':
      return setMode('pick-remove');
    case 'rotate':
      await setMode('rotate');
      return setPrompt(`<b>Drag</b> a ring or <b>scroll</b> over it to turn it${dot}click the center when done`);
    case 'slotSize':
      await setMode('size');
      return setPrompt(`<b>Scroll</b> or click <b>−</b> / <b>+</b> to resize slots${dot}click outside when done`);
    case 'bigger':
    case 'smaller': {
      const f = o.id === 'bigger' ? 1.1 : 1 / 1.1;
      const L = look();
      L.innerRadius = clamp(Math.round(L.innerRadius * f), 36, 160);
      L.ringWidth = clamp(Math.round(L.ringWidth * f), 40, 140);
      await save();
      await ensureLayout(true);
      draw();
      return;
    }
    case 'done':
      return setMode('keys');
    case 'context':
      config.showApp = !config.showApp;
      toast(config.showApp ? 'The app’s icon shows in the center' : 'The center shows the app’s name without its icon');
      if (config.showApp) loadAppIcon(S.app);
      break;
    case 'glass': {
      const L = look();
      L.theme = L.theme === 'glass' ? 'solid' : 'glass';
      break;
    }
    case 'gaps': {
      const L = look();
      L.gaps = L.gaps === false;
      await save();
      await ensureLayout(true); // touching rings make the wheel a little smaller
      draw();
      updateHint();
      return;
    }
    case 'background':
      if (!look().background) return pickBackground();
      return showActions({
        title: `<b>Background image</b>${lookScope()}`,
        name: 'Background',
        source: o.source ?? hitOfDrawn(o),
        parent: o.parent,
        list: [
          { label: 'Change', icon: 'image', primary: true, desc: '<b>Change</b>: pick another picture', run: pickBackground },
          { label: 'Remove', icon: 'trash', danger: true, desc: '<b>Remove</b> the background image', run: removeBackground },
        ],
      });
    case 'hold':
      config.holdToSelect = !config.holdToSelect;
      break;
    case 'labels':
      config.optionLabels = config.optionLabels === false;
      break;
    case 'startup':
      try {
        await invoke('set_autostart', { enabled: !S.autostart });
        S.autostart = !S.autostart;
        toast(S.autostart ? 'Radial Keys will start when you log in' : 'Radial Keys won’t start at login');
      } catch (e) {
        toast(esc(e), 'error');
      }
      draw();
      updateHint();
      return;
    case 'color':
      if (!S.colorTargets.size) return toast('Pick <b>Accent</b>, <b>Fill</b> or <b>Tint</b> in the center first', 'error');
      if (S.colorTargets.has('accent')) look().accent = o.color;
      if (S.colorTargets.has('fill')) look().fill = o.color;
      if (S.colorTargets.has('tint')) look().tint = o.color === CLEAR ? '' : o.color;
      break;
    case 'reset':
      return showActions({
        title: 'Reset all slots, size and colors? Your hotkey stays.',
        kind: 'warn',
        name: 'Reset',
        source: hitOfDrawn(o),
        list: [{ label: 'Reset', caption: 'Yes', icon: 'reset', danger: true, desc: `<b>Reset</b> slots, size and colors to the defaults (${undoKey} brings them back)`, run: doReset }],
      });
    case 'quit':
      return invoke('quit_app');
    default:
      return;
  }
  await save();
  draw();
  updateHint();
}

/**
 * Right-click on an option (on the ring, or in Add / Adjust / Toggles): a picture instead of
 * its icon, its word, its colours. This menu has no look of its own: it looks like the option.
 */
function optionActions(id) {
  const o = optionDef(id);
  if (!o) return;
  const key = `opt:${id}`;
  const f = config.faces?.[key] ?? {};
  const pic = f.image && slotImage(f.image);
  const group = groupOf(id);
  const source = optionHit(group ?? id);
  const sourceOpt = group ? id : null;
  const again = () => optionActions(id); // stays open: change something else
  const change = (patch) => async () => {
    await setOptionFace(id, patch);
    await again();
  };
  return showActions({
    title: `<b>${esc(o.caption)}</b> <span class="dim">option</span>${dot}its picture, word and colors`,
    name: o.caption,
    source,
    sourceOpt,
    parent: group ? optionGroupSpec(group) : undefined,
    inheritOpt: id, // (looked up when drawn: you may have just given it colours)
    list: [
      ...(id === 'gaps' ? [{
        label: 'Gap colour', caption: 'Gap', icon: 'gaps', primary: true,
        desc: `<b>Gap colour</b>: the space between slots (with gaps off, the lines between them)${lookScope()}`,
        run: () => gapColorMenu(source, sourceOpt),
      }] : []),
      {
        label: 'Icon…', caption: 'Icon', icon: 'image', primary: id !== 'gaps', desc: '<b>Icon</b>: pick a picture (.ico, .png, .svg…) to show instead of its icon',
        run: async () => {
          await pickOptionIcon(id, false);
          await again();
        },
      },
      f.cover && pic
        ? { label: 'Small icon', icon: 'shrink', desc: '<b>Small icon</b>: the picture shrinks back to an icon in the slot', run: change({ cover: false }) }
        : {
            label: 'Fill slot', icon: 'expand',
            desc: pic ? '<b>Fill slot</b>: the picture covers the whole slot' : '<b>Fill slot</b>: pick a picture that covers the whole slot',
            run: pic ? change({ cover: true }) : async () => {
              await pickOptionIcon(id, true);
              await again();
            },
          },
      ...(f.image ? [{ label: 'Own icon', caption: 'Own', icon: o.icon, desc: `<b>Own icon</b>: back to the ${esc(o.caption)} icon`, run: change({ image: '', cover: false }) }] : []),
      {
        label: f.hideLabel ? 'Show label' : 'Hide label', caption: 'Label', icon: 'labels', badge: f.hideLabel ? 'off' : 'on',
        desc: f.hideLabel ? `<b>Label</b> is off${dot}click to show it` : `<b>Label</b> is on${dot}click to hide it (pointing at it still says what it does)`,
        run: change({ hideLabel: !f.hideLabel }),
      },
      {
        label: 'Colors', icon: 'look',
        desc: group
          ? `<b>Colors</b>: its own accent, fill or tint (without, it looks like <b>${esc(optionDef(group).caption)}</b>)`
          : `<b>Colors</b>: its own accent, fill or tint${OPTION_GROUPS[id] ? ` (what’s in it looks the same, unless it has its own)` : ''}`,
        run: () => colorMenu(source, { paintKey: key, sourceOpt }),
      },
    ],
  });
}

/** Pick a picture for option `id` (`cover`: it fills the slot). */
async function pickOptionIcon(id, cover) {
  try {
    const name = await invoke('pick_icon');
    if (!name) return; // cancelled
    await setOptionFace(id, { image: name, cover: cover || !!config.faces?.[`opt:${id}`]?.cover });
    toast(cover ? 'The picture fills the slot' : 'Icon set');
  } catch (e) {
    toast(esc(e), 'error', { ttl: 5000 });
  }
}

/** Change how option `id` shows ({ image, cover, hideLabel }; empty = as it comes). */
async function setOptionFace(id, patch) {
  const key = `opt:${id}`;
  const old = config.faces?.[key]?.image;
  const f = { ...config.faces?.[key], ...patch };
  for (const k of Object.keys(f)) if (!f[k]) delete f[k];
  if (!f.image) delete f.cover;
  config.faces ??= {};
  if (Object.keys(f).length) config.faces[key] = f;
  else delete config.faces[key];
  await save();
  if (old && old !== f.image) dropImage(old);
  draw();
}

/** Background picture for the open menu's look (the main menu's, or a sub-menu's own). */
async function pickBackground() {
  try {
    const name = await invoke('pick_background');
    if (!name) return; // cancelled
    const L = look(); // after the dialog: the setup may have been saved meanwhile
    const old = L.background;
    L.background = name;
    await save();
    if (old && old !== name) dropImage(old);
    await loadBackground(name);
    draw();
    updateHint();
    toast('Background image set');
  } catch (e) {
    toast(esc(e), 'error', { ttl: 5000 });
  }
}

async function removeBackground() {
  clearToast();
  const L = look();
  const old = L.background;
  L.background = '';
  await save();
  // Deleted later, and only if nothing else (another look, a preset, an undo) still shows it.
  dropImage(old);
  draw();
  updateHint();
  toast('Background image removed');
}

/** Options → Look (in a sub-menu): give it its own look (a copy of what it looks like now), or drop it. */
async function toggleOwnLook() {
  const body = menuBody(currentMenu());
  if (!body) return;
  if (body.look) {
    const old = body.look.background;
    delete body.look;
    await save();
    dropImage(old);
    toast('This menu looks like the menu above it again');
  } else {
    const L = look();
    body.look = {
      accent: L.accent, fill: L.fill, tint: L.tint || '', theme: L.theme, background: L.background || '',
      innerRadius: L.innerRadius, ringWidth: L.ringWidth, ringGap: L.ringGap, gaps: L.gaps !== false, gapColor: L.gapColor || '',
    };
    await save();
    toast(`This menu has its own look now${dot}colours, picture, see-through and size you change here stay in this menu`, 'ok', { ttl: 5000 });
  }
  await ensureLayout(true);
  draw();
  updateHint();
}

async function doReset() {
  clearToast();
  const oldBackground = config.background;
  config = await invoke('default_config');
  S.path = [];
  await save();
  // Other pictures that nothing uses now are tidied away at the next start.
  dropImage(oldBackground);
  await ensureLayout(true);
  draw();
  toast(`Reset to the defaults${dot}<kbd>${undoKey}</kbd> brings your setup back`, 'ok', { ttl: 5000 });
}

async function removeSlot(hit) {
  const ring = hit.ring;
  const [item] = rings()[ring].items.splice(hit.index, 1);
  await save();
  const seq = history.at(-1)?.seq;
  await setMode('pick-remove');
  const left = rings()[ring]?.items.length ?? 0;
  toast(`Removed <b>${esc(slotName(item))}</b>`, 'ok', {
    ttl: 8000,
    actions: [
      {
        // Same as Ctrl+Z (or, if something changed since, just puts this slot back).
        label: 'Undo', undo: true, seq,
        run: () => undoChange(seq, async () => {
          while (rings().length <= ring) rings().push({ items: [] });
          rings()[ring].items.push(item);
          await save();
          await ensureLayout();
          draw();
        }),
      },
      // The rest of the ring spreads out over the hole (and any other gaps in it).
      ...(left ? [{ label: 'Fill gap', cls: 'primary', run: () => fillGaps(ring) }] : []),
    ],
  });
}

/**
 * Close every gap in a ring (`items`): its slots keep their order and relative sizes, and
 * grow until they fill the ring. The Back slot stays put (the rest fill around
 * it); otherwise the ring turns as little as possible.
 */
function closeGaps(items, fixed) {
  if (!items.length) return;
  const from = fixed ? fixed.angle + fixed.span / 2 : 0;
  const order = [...items].sort((a, b) => norm(a.angle - from) - norm(b.angle - from));
  const room = 360 - (fixed ? Math.min(fixed.span, 359) : 0);
  const total = order.reduce((n, it) => n + it.span, 0);
  let start = fixed ? from : order[0].angle - order[0].span / 2;
  const placed = order.map((it) => {
    const span = (it.span * room) / total;
    const angle = start + span / 2;
    start += span;
    return { it, angle, span };
  });
  // Without a fixed point, turn the result so slots move as little as possible.
  let turn = 0;
  if (!fixed) {
    let x = 0;
    let y = 0;
    for (const p of placed) {
      const d = ((p.it.angle - p.angle) * Math.PI) / 180;
      x += Math.cos(d);
      y += Math.sin(d);
    }
    turn = (Math.atan2(y, x) * 180) / Math.PI;
  }
  for (const p of placed) {
    p.it.angle = norm(p.angle + turn);
    p.it.span = Math.min(360, p.span);
  }
}

async function fillGaps(ri) {
  clearToast();
  const ring = rings()[ri];
  if (!ring?.items.length) return;
  const before = ring.items.map((it) => ({ ...it }));
  const back = backSlot();
  closeGaps(ring.items, back?.ring === ri ? back : null);
  edits++;
  await save();
  const seq = history.at(-1)?.seq;
  draw();
  toast('No gaps left in that ring', 'ok', {
    ttl: 6000,
    actions: [
      {
        label: 'Undo', undo: true, seq,
        run: () => undoChange(seq, async () => {
          if (!rings()[ri]) return;
          rings()[ri].items = before;
          await save();
          draw();
        }),
      },
    ],
  });
}

// --- Placing a slot (new, or moving an existing one). No snapping: it goes exactly where you click.

const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** Span for a new slot: like its ring-mates, or (empty ring) the same width in px as other slots. */
function defaultSpan(ring) {
  const items = rings()[ring]?.items ?? [];
  if (items.length) return median(items.map((i) => i.span));
  // Empty ring: as wide (in px) as the roomiest ring's slots, and never tiny,
  // so icons and pictures in it have space. (Units: degrees × px.)
  const perRing = rings()
    .map((r, ri) => (r.items.length ? median(r.items.map((i) => i.span)) * geo.rMid(ri) : 0))
    .filter(Boolean);
  const arc = Math.max(...perRing, geo.w * 1.1 * (180 / Math.PI));
  return clamp(arc / geo.rMid(ring), 6, 90);
}

function ghostSlot() {
  const g = S.place.ghost;
  const it = S.place.item;
  if (it.isBack) return { ...g, icon: 'back', caption: 'Back', cls: 'back-slot' };
  const colors = face(it).colors;
  return { ...g, ...slotFace(it, -1, '+'), vars: colors ? paintVars(colors) : undefined };
}

/** `returnTo`: the mode after dropping or cancelling (Move comes back to pick the next slot). */
async function startPlace({ isNew, item, from = null, spanBase = null, returnTo = null }) {
  spanBase ??= from ? { span: item.span, ring: from.ring } : null;
  S.place = { isNew, item, from, spanBase, returnTo, ghost: null, preview: null };
  clearToast(); // so "point where..." is what you see
  await setMode('place');
  setPrompt(
    isNew
      ? `Point where you want the new slot, then <b>click</b>${dot}other slots make room${dot}Esc to cancel`
      : `Point where <b>${esc(item.isBack ? 'Back' : slotName(item))}</b> should go, then <b>click</b>${dot}Esc to cancel`,
  );
}

function updateGhost(p) {
  const pl = S.place;
  if (!pl) return;
  const d = Math.hypot(p.x, p.y);
  let ring = ringAt(geo, d);
  if (ring < 0) {
    // Over the center: nothing to place (click cancels).
    if (pl.ghost) {
      pl.ghost = null;
      pl.preview = null;
      draw();
    }
    return;
  }
  ring = Math.min(ring, rings().length); // one past the last ring = a new ring
  const angle = angleOf(p.x, p.y);
  let span;
  const b = pl.spanBase;
  if (b && ring === b.ring) {
    span = b.span; // same ring: keep its size
  } else if (b && !(rings()[ring]?.items.length)) {
    span = clamp((b.span * geo.rMid(b.ring)) / geo.rMid(ring), 6, 90); // empty ring: same width in px
  } else {
    // A ring with keys: match their size.
    span = defaultSpan(ring);
  }
  // Taken spot? Neighbours slide aside (and shrink if the ring is full). Shown live.
  const items = rings()[ring]?.items ?? [];
  const back = backSlot();
  const withBack = back && back.ring === ring;
  // The Back slot is in the way like any other slot, but it can't move: if making
  // room shifted it, turn the result back so it's where it belongs.
  const list = withBack ? [...items, { angle: back.angle, span: back.span }] : items;
  const room = makeRoom(list, angle, span);
  if (withBack) {
    const moved = room.slots.pop();
    const delta = ((((back.angle - moved.angle) % 360) + 540) % 360) - 180;
    if (Math.abs(delta) > 0.01) {
      const turn = (a) => (((a + delta) % 360) + 360) % 360;
      room.slots = room.slots.map((s) => ({ ...s, angle: turn(s.angle) }));
      room.angle = turn(room.angle);
    }
  }
  pl.ghost = { ring, angle: room.angle, span: room.span };
  pl.preview = { ring, items: room.slots };
  draw();
}

async function dropPlace() {
  const pl = S.place;
  const g = pl?.ghost;
  if (!g) return;
  clearToast();
  if (pl.item.isBack) {
    S.place = null;
    return dropBack(g, pl.preview, pl.returnTo);
  }
  while (rings().length <= g.ring) rings().push({ items: [] });
  const before = rings()[g.ring].items.map((i) => ({ ...i }));
  if (pl.preview) rings()[g.ring].items = pl.preview.items;
  const item = { ...pl.item, angle: g.angle, span: g.span };
  rings()[g.ring].items.push(item);
  const index = rings()[g.ring].items.length - 1;
  S.place = null;
  if (pl.isNew && item.program) {
    await save();
    await setMode('keys');
    toast(`<b>${esc(item.label || 'Program')}</b> added${dot}click its slot to open it`);
    return;
  }
  if (pl.isNew && item.menu?.link) {
    // A reusable menu: it already has its slots.
    await save();
    await setMode('keys');
    toast(`<b>${esc(slotName(item))}</b> added${dot}it’s the same menu everywhere you put it`, 'ok', { ttl: 5000 });
    return;
  }
  if (pl.isNew && item.menu) {
    // New sub-menu: save it and go straight in, so slots can be added to it.
    await save();
    S.path.push({ ring: g.ring, angle: item.angle });
    await setMode('keys');
    toast('New sub-menu · add slots to it from <b>options</b> · <b>Back</b> returns', 'ok', { ttl: 6000 });
    return;
  }
  if (pl.isNew) {
    // Not saved until it has a key; cancelling puts the neighbours back.
    return startCapture({ target: 'slot', ring: g.ring, index, isNew: true, before });
  }
  await save();
  await setMode(pl.returnTo ?? 'keys');
  toast(pl.returnTo === 'pick-move'
    ? `Moved <b>${esc(slotName(item))}</b>${dot}click the next one, or ✓ <b>Done</b> in the center`
    : `Moved <b>${esc(slotName(item))}</b>`);
}

// --- The Back slot of a sub-menu: where you came in, unless you move it.

/** Move the open sub-menu's Back slot: placed like any slot (others make room). */
function startBackMove(returnTo = 'keys') {
  const b = backSlot();
  if (!b) return;
  return startPlace({ isNew: false, item: { isBack: true, span: b.span }, spanBase: { span: b.span, ring: b.ring }, returnTo });
}

async function dropBack(g, preview, returnTo = 'keys') {
  const body = menuBody(currentMenu());
  if (!body) return setMode('keys');
  if (preview && rings()[g.ring]) rings()[g.ring].items = preview.items;
  // On a reusable menu it's moved everywhere the menu is used.
  body.back = { ring: g.ring, angle: g.angle, span: g.span };
  await save();
  await setMode(returnTo);
  toast(`Moved <b>Back</b>${dot}right-click it to put it where you came in again`, 'ok', { ttl: 5000 });
}

async function resetBack() {
  const body = menuBody(currentMenu());
  if (!body?.back) return;
  delete body.back;
  await save();
  await ensureLayout();
  draw();
  toast('<b>Back</b> is where you came in again');
}

/** Right-click on Back. */
function backActions(hit) {
  const b = backSlot();
  return showActions({
    title: `<b>Back</b> <span class="dim">to the menu above${b?.moved ? `${dot}moved` : ''}</span>`,
    name: 'Back',
    source: hit,
    list: [
      { label: 'Go back', icon: 'back', primary: true, desc: '<b>Go back</b> to the menu above', run: goBack },
      { label: 'Move', icon: 'move', desc: '<b>Move</b> Back to another spot in this menu', run: () => startBackMove() },
      ...(b?.moved ? [{ label: 'Reset spot', caption: 'Reset', icon: 'reset', desc: '<b>Reset spot</b>: Back goes where you came in again', run: resetBack }] : []),
      colorChoice(hit),
    ],
  });
}

async function cancelPlace() {
  const pl = S.place;
  S.place = null;
  clearToast();
  if (pl?.from) rings()[pl.from.ring].items.splice(pl.from.index, 0, pl.item);
  await setMode(pl?.returnTo ?? 'options');
}

async function pickMove(hit) {
  const [item] = rings()[hit.ring].items.splice(hit.index, 1);
  await startPlace({ isNew: false, item, from: { ring: hit.ring, index: hit.index }, returnTo: 'pick-move' });
}

// --- Right-click menus on the wheel ----------------------------------------------------
// Right-clicking a slot, Back, a preset or a reusable menu (and questions like "Delete it?")
// leaves the wheel as it is: same layout, same center. The choices sit in a row on the ring
// of the slot you clicked, starting right after it going clockwise, always in the same order,
// wherever the slot is. Every other slot goes grey and does nothing, and the one you clicked
// stays, as the way back. The center, empty space, a right-click and Esc go back too. Typing
// a name stays in the message box.

const ACTION_ARC = 72; // px of ring a choice gets when there's room
const ACTION_MIN_ARC = 22; // with less than this (px) per choice, they go on the next ring out

/**
 * Show choices on the wheel. spec: { title (message box), kind ('prompt' / 'warn'), name
 * (what it's about, for "Back to…"), list: [{ label, caption, icon, desc, primary, danger,
 * run, optId (an option: drawn as you made it look) }], source ({ ring, index } of the slot
 * it's about), sourceOpt (an option in a group, shown in its group's place), parent (spec Back
 * returns to), cancel (what the way back is called), inheritOpt (the choices take this
 * option's colours), colors / paintKey (the colour menu, see colorMenu) }.
 */
async function showActions(spec) {
  clearToast();
  const from = S.mode === 'actions' ? S.actions?.from ?? 'keys' : S.mode;
  S.actions = { from, ...spec };
  await setMode('actions');
}

const wayBackText = (A) => (A.parent ? `<b>Back</b> to ${esc(A.parent.name || 'the menu before')}` : `<b>${esc(A.cancel || 'Back')}</b>`);

/** A slot that isn't part of the menu: greyed out, doesn't respond. */
function greySlot(d) {
  return {
    angle: d.angle, span: d.span, cls: 'off', off: true,
    label: d.label, sub: d.sub, curved: d.curved, caption: d.caption, captionMin: d.captionMin, icon: d.icon, picture: d.picture, cover: d.cover,
  };
}

/**
 * Where `need` choices go: a row on the clicked slot's ring, clockwise from it (or round the
 * inner ring from the top, with no slot). Returns { ring, start, span }: the row's first
 * edge and each choice's width, in degrees. A slot too wide to leave room: the next ring out.
 */
function actionRow(src, clicked, need) {
  const deg = (ring, px) => ((px * 180) / Math.PI) / geo.rMid(ring);
  if (!src) {
    const span = Math.min(deg(0, ACTION_ARC), 360 / need);
    return { ring: 0, start: -span / 2, span };
  }
  const room = 360 - Math.min(clicked.span, 360);
  if (room / need >= deg(src.ring, ACTION_MIN_ARC)) {
    return { ring: src.ring, start: clicked.angle + clicked.span / 2, span: Math.min(deg(src.ring, ACTION_ARC), room / need) };
  }
  const ring = src.ring + 1;
  const span = Math.min(deg(ring, ACTION_ARC), 360 / need);
  return { ring, start: clicked.angle - span / 2, span };
}

/** A ring's slots greyed out, without what's under the arc of `length` degrees from `start`. */
function greyAround(row, start, length) {
  return row.flatMap((d) => {
    const from = norm(d.angle - d.span / 2 - start);
    const to = from + d.span;
    const a = from < length ? length : from;
    const b = Math.min(to, 360);
    if (b - a < 1) return [];
    if (b - a >= d.span - 0.01) return [greySlot(d)];
    return [{ angle: norm(start + (a + b) / 2), span: b - a, cls: 'off', off: true }]; // partly covered: no words
  });
}

/** The wheel under a right-click menu, and the slot it's about (as drawn there), if it's still there. */
function actionSource(A) {
  const base = slotsFor(A.from);
  const src = A.source && base[A.source.ring]?.[A.source.index] ? A.source : null;
  let clicked = src && base[src.ring][src.index];
  // An option inside a group (Add, Adjust, Toggles): it shows in its group's place.
  const sub = clicked && A.sourceOpt && optionDef(A.sourceOpt);
  if (sub) clicked = optionSlot(sub.id, { icon: sub.icon, caption: optionCaption(sub.caption), badge: sub.badge, cls: 'opt', angle: clicked.angle, span: clicked.span });
  return { base, src, clicked };
}

/** The center of a right-click menu: the slot it's about, its look and all. */
function actionHub(d) {
  const hub = d.picture
    ? { image: d.picture, imageZoom: d.cover ? 1 : undefined, main: d.caption ?? d.label }
    : d.icon
      ? { icon: d.icon, bottom: d.caption }
      : { top: d.sub || undefined, main: d.label || d.caption };
  // Its fill (a swatch's own, else the slot colour it has) and tint, instead of the center's.
  const vars = { ...d.vars, '--hub': d.fill || 'var(--slice)', '--hub-tint': d.fill ? CLEAR : 'var(--tint)' };
  return { ...hub, vars };
}

/** The wheel underneath, with the menu on it. */
function actionSlots() {
  const A = S.actions;
  if (!A) return [];
  const { base, src, clicked } = actionSource(A);
  const without = (row, ring) => row.filter((_, i) => !(src && ring === src.ring && i === src.index));
  // The slot you clicked becomes Back, in its own colours (the center shows what it was).
  const way = src && {
    angle: clicked.angle, span: clicked.span, vars: clicked.vars, fill: clicked.fill,
    icon: 'back', caption: 'Back', cls: `back-slot act-source${clicked.vars?.['--slice'] ? ' painted-fill' : ''}`, source: true,
    desc: wayBackText(A),
  };
  let rows;
  if (A.colors || A.gapColors) {
    rows = colorMenuRows(A, base, src, clicked, without, A.gapColors ? gapColorEntries() : null);
  } else {
    const list = A.list.map((a, act) => ({ ...a, act }));
    // No slot to go back through (it's gone): the way back is a choice too.
    if (!src) list.push({ label: A.cancel || 'Cancel', icon: 'x', cancel: true });
    // A small wheel has no room for words: icons, and the message box says what they do.
    const words = look().ringWidth >= COMPACT_RING_WIDTH;
    const { ring, start, span } = actionRow(src, clicked, list.length);
    rows = base.map((row, r) => (r === ring ? greyAround(without(row, r), start, span * list.length) : without(row, r).map(greySlot)));
    while (rows.length <= ring) rows.push([]);
    list.forEach((a, k) => {
      const slot = {
        angle: norm(start + (k + 0.5) * span), span,
        icon: a.icon || 'check', caption: words ? a.caption ?? a.label : undefined, captionOptional: true, badge: a.badge,
        cls: `act opt${a.primary ? ' primary' : ''}${a.danger ? ' danger' : ''}`,
        desc: a.desc || `<b>${esc(a.label)}</b>`,
        act: a.act,
      };
      // An option in a group looks the way you made it; a menu about one thing looks like it.
      rows[ring].push(a.optId ? optionSlot(a.optId, slot) : painted(slot, A.inheritOpt && optionColors(A.inheritOpt)));
    });
  }
  if (way) rows[src.ring].push(way);
  return rows;
}

/** The message box in a right-click menu: what it's about, or what the slot you point at does. */
function actionsMsg(html) {
  const kind = S.actions?.kind || 'prompt';
  if (msg.prompt?.html === html && msg.prompt.kind === kind) return;
  msg.prompt = { html, kind };
  showMsg();
}

async function chooseAction(d) {
  const A = S.actions;
  if (d?.swatch) return colorSlot(d.swatch);
  if (d?.clearColors) return clearSlotColors();
  if (d?.gapSwatch) return setGapColor(d.gapSwatch);
  if (d?.gapReset) return setGapColor('');
  const a = d && d.act != null ? A?.list[d.act] : null;
  if (!a) return cancelActions();
  S.actions = null;
  S.lastActions = A; // Picture… opens its own choices, with Back to these
  await setMode(A.from);
  await a.run();
}

/** Back: to the menu this one came from, or out to where you were. */
async function cancelActions() {
  const A = S.actions;
  if (A?.parent) return showActions(A.parent);
  S.actions = null;
  await setMode(A?.from ?? 'keys');
}

/** Where the drawn slot `d` is ({ ring, index }), or null. */
function hitOfDrawn(d) {
  for (let ring = 0; ring < drawn.length; ring++) {
    const index = drawn[ring].indexOf(d);
    if (index >= 0) return { ring, index };
  }
  return null;
}

// --- Giving one thing its own colour ---------------------------------------------------
// Right-click a colour in Options to pick it up, go wherever you like (left-clicks still get
// you around: sub-menus, Back, the center, Presets...), then right-click anything: it gets
// the colour as whatever's selected in the Y (accent, fill, tint). Right-click it again with
// the same colour to take that off. Done in the message box, Esc or empty space puts it down.

const BRUSH_MODES = new Set(['keys', 'options', 'presets', 'menus']);

/** What the colour you're carrying goes on. */
const brushParts = () => [...S.colorTargets];

function brushCursor(color) {
  const fill = color === CLEAR ? 'none' : color;
  const hatch = color === CLEAR ? `<path d='M6 11 L11 6 M9 14 L14 9' stroke='white' stroke-width='1.5'/>` : '';
  const dot = `<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20'><circle cx='10' cy='10' r='6.5' fill='${fill}' stroke='white' stroke-width='2'/><circle cx='10' cy='10' r='8' fill='none' stroke='black'/>${hatch}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(dot)}") 10 10, crosshair`;
}

function showBrush() {
  const { color } = S.brush;
  const chip = color === CLEAR
    ? '<span class="brush-chip none"></span>'
    : `<span class="brush-chip" style="background:${color}"></span>`;
  const what = brushParts().map((p) => (color === CLEAR ? `no ${p}` : p)).join(' + ') || 'nothing yet (pick in the center)';
  msg.brush = {
    html: `${chip}<b>${esc(what)}</b>${dot}<b>right-click</b> anything to colour it, again to take it off`,
    kind: 'prompt',
    actions: [{ label: 'Done', cls: 'primary', run: endBrush }],
  };
  showMsg();
  document.body.style.cursor = brushCursor(color);
}

/** Right-clicked a colour: pick it up (or swap it for the one you're carrying). */
function pickBrush(color) {
  if (!S.colorTargets.size) {
    return toast('Pick <b>Accent</b>, <b>Fill</b> or <b>Tint</b> in the center first', 'error');
  }
  S.brush = { color };
  showBrush();
  draw();
}

function dropBrush() {
  S.brush = null;
  msg.brush = null;
  document.body.style.cursor = '';
  showMsg();
}

function endBrush() {
  dropBrush();
  draw();
  updateHint();
}

const savedPaint = async (write) => {
  write();
  edits++;
  await save();
};

/** The own colours of something that isn't a stored slot (config.paint[key]), and how to set them. */
function paintUnder(key) {
  return {
    colors: config.paint?.[key],
    set: (c) => savedPaint(() => {
      config.paint ??= {};
      if (c) config.paint[key] = c;
      else delete config.paint[key];
    }),
  };
}

/** The center shows the Y (Options and its menus, a colour menu): its colours are the Y's own. */
const pieShown = () => S.mode === 'options' || (S.mode === 'actions' && (!!S.actions?.colors || S.actions?.from === 'options'));

/** What a right-click at `hit` paints: its colours, and how to set them. Null if nothing. */
function paintTarget(hit, d) {
  const saved = savedPaint;
  const on = (obj) => ({
    colors: obj.colors,
    set: (c) => saved(() => {
      if (c) obj.colors = c;
      else delete obj.colors;
    }),
  });
  const under = paintUnder;
  if (hit?.center) return under(pieShown() ? 'opt-hub' : 'hub');
  if (!d) return null;
  if (d.back) return under('back');
  if (d.preset) {
    const p = presetByName(d.preset);
    return p && {
      colors: p.colors,
      set: async (c) => {
        try {
          await refreshPresets(await invoke('set_preset_colors', { name: p.name, colors: c }));
          toast(`Coloured <b>${esc(p.name)}</b>`, 'ok', { ttl: 4000, actions: [undoButton(undoPresets)] });
        } catch (e) {
          toast(esc(e), 'error', { ttl: 5000 });
        }
      },
    };
  }
  if (d.shared) return on(sharedMenu(d.shared)); // on every slot showing it, like its name and picture
  if (d.optId || d.id) return under(`opt:${d.optId ?? d.id}`);
  const it = (S.mode === 'actions' ? S.actions?.from : S.mode) === 'keys' ? itemAt(hit) : null;
  return it ? on(face(it)) : null;
}

/** Give `target` a colour as whatever's selected in the Y; the same colour again takes it off. */
async function paintWith(target, color) {
  const parts = brushParts();
  if (!parts.length) return toast('Pick <b>Accent</b>, <b>Fill</b> or <b>Tint</b> in the center first', 'error');
  const next = { ...(target.colors ?? {}) };
  const off = parts.every((p) => next[p] === color);
  for (const p of parts) {
    if (off) delete next[p];
    else next[p] = color;
  }
  await target.set(Object.keys(next).length ? next : null);
  draw();
  updateHint();
}

/** Right-click while carrying a colour. */
async function paintHit(hit) {
  const d = drawnAt(hit);
  if (d?.id === 'color') return pickBrush(d.color); // another colour
  const target = paintTarget(hit, d);
  if (target) await paintWith(target, S.brush.color);
}

// --- The colour menu of one slot (right-click it → Colors) -----------------------------
// Looks like the colours in Options: the Y in the center, the swatches on the second ring.
// The slot you clicked stays as the way back, every other slot goes grey.

/** What the colour menu `A` colours (see paintTarget). */
function colorTarget(A) {
  if (A.paintKey) return paintUnder(A.paintKey);
  return paintTarget(A.colors, slotsFor(A.from)[A.colors.ring]?.[A.colors.index]);
}

/** The "Colors" choice of a right-click menu. */
function colorChoice(hit) {
  return { label: 'Colors', icon: 'look', desc: '<b>Colors</b>: give this slot its own accent, fill or tint', run: () => colorMenu(hit) };
}

/** `extra`: { paintKey, sourceOpt } for an option (see optionActions). */
function colorMenu(hit, extra = {}) {
  const parent = S.lastActions;
  return showActions({
    title: `Colors of <b>${esc(parent?.name ?? 'this slot')}</b>${dot}pick Accent, Fill and/or Tint in the center, then a colour`,
    name: 'Colors',
    source: hit,
    colors: hit,
    parent,
    list: [],
    ...extra,
  });
}

/** Options → right-click Gaps → Gap colour: the swatches set the open menu's gap colour. */
function gapColorMenu(source, sourceOpt) {
  return showActions({
    title: `<b>Gap colour</b>${dot}the space between slots, or with gaps off the lines between them${lookScope()}`,
    name: 'Gap colour',
    source,
    sourceOpt,
    gapColors: true,
    parent: S.lastActions,
    list: [],
  });
}

/** Swatch rows of the gap colour menu: the same colours, G marks the one in use. */
function gapColorEntries() {
  const now = (look().gapColor || '').toLowerCase();
  const where = look().gaps === false ? 'the lines between slots' : 'the gaps between slots';
  return [
    ...COLORS.map((c) => ({
      gapSwatch: c, fill: c, cls: 'swatch', marks: c === now ? 'G' : null, markColor: inkOn(c),
      desc: `<b>${c}</b>${dot}colours ${where}${dot}click again to take it off`,
    })),
    {
      gapSwatch: CLEAR, fill: 'url(#clear-hatch)', cls: 'swatch none', marks: now === CLEAR ? 'G' : null, markColor: '#ffffff',
      desc: `<b>Transparent</b>${dot}see-through gaps, and no lines with gaps off`,
    },
    { gapReset: true, icon: 'reset', cls: 'act opt', desc: '<b>No gap colour</b>: see-through gaps and the usual faint lines' },
  ];
}

async function setGapColor(c) {
  const L = look();
  if (c && L.gapColor !== c) L.gapColor = c;
  else delete L.gapColor;
  edits++;
  await save();
  draw();
  updateHint();
}

/** Options: right-click the center → the Y's own colours (its lines and words, behind it, over it). */
function hubColorMenu() {
  S.lastActions = null;
  return showActions({
    title: `Colors of the <b>Y</b> in the center${dot}Accent: its lines and words${dot}Fill: behind it${dot}Tint: over it${dot}right-click to go back`,
    name: 'Center',
    colors: { center: true },
    paintKey: 'opt-hub',
    list: [],
  });
}

/** The colour menu's rings: the rest of the wheel greyed out, the second ring all swatches. */
function colorMenuRows(A, base, src, clicked, without, gapEntries = null) {
  const own = gapEntries ? {} : colorTarget(A)?.colors ?? {};
  const targets = [...S.colorTargets].join(' + ') || 'nothing (pick Accent, Fill or Tint in the center)';
  const clearTo = [...S.colorTargets].map((t) => CLEAR_MEANS[t]).join(', ') || 'nothing (pick Accent, Fill or Tint in the center)';
  const markOf = (c) => [own.accent === c && 'A', own.fill === c && 'F', own.tint === c && 'T'].filter(Boolean).join(' ') || null;
  const entries = gapEntries ?? [
    ...COLORS.map((c) => ({
      swatch: c, fill: c, cls: 'swatch', marks: markOf(c), markColor: inkOn(c),
      desc: `<b>${c}</b>${dot}sets ${targets}${dot}click again to take it off`,
    })),
    {
      swatch: CLEAR, fill: 'url(#clear-hatch)', cls: 'swatch none', marks: markOf(CLEAR), markColor: '#ffffff',
      desc: `<b>Transparent</b>${dot}${clearTo}${dot}click again to take it off`,
    },
    { clearColors: true, icon: 'reset', cls: 'act opt', desc: '<b>No own colors</b>: this slot looks like the rest of the menu again' },
  ];
  // Round the second ring; if the slot you clicked is on it, in the room that leaves. A slot
  // too wide to leave enough: the swatches go on the ring outside it.
  let ring = 1;
  if (src?.ring === 1 && clicked.span > 240) ring = 2;
  const around = src?.ring === ring;
  const room = around ? 360 - clicked.span : 360;
  const step = room / entries.length;
  const start = around ? clicked.angle + clicked.span / 2 + step / 2 : 0;
  const rows = base.map((row, r) => (r === ring ? [] : without(row, r).map(greySlot)));
  while (rows.length <= ring) rows.push([]);
  rows[ring] = entries.map((e, i) => ({ ...e, angle: norm(start + i * step), span: step }));
  return rows;
}

const colorSlot = (color) => paintWith(colorTarget(S.actions), color);

async function clearSlotColors() {
  await colorTarget(S.actions).set(null);
  draw();
  updateHint();
}

/** Turn Accent / Fill / Tint on or off as what the swatches change, under the pointer. */
function toggleColorTarget(t) {
  if (S.colorTargets.has(t)) S.colorTargets.delete(t);
  else S.colorTargets.add(t);
  S.hover = null;
  if (S.brush) showBrush();
  draw();
  setHover({ center: true, half: t });
}

// --- Recording a key (right-click a slot) or the hotkey (right-click the center).

let scrollAcc = 0;

async function startCapture(c) {
  S.capture = { ...c, pick: null };
  clearToast(); // so the "press a key" prompt is visible
  scrollAcc = 0;
  await setMode('capture');
  if (c.target === 'hotkey' && c.menuPath) {
    setPrompt(`Press a hotkey that opens <b>this sub-menu</b> directly (or a mouse button)${dot}Backspace removes it${dot}Esc cancels`);
  } else if (c.target === 'hotkey') {
    setPrompt(`Press the new hotkey, or a mouse button (middle, 4, 5)${dot}Esc to cancel`);
  } else {
    setPrompt(`Press a key, combo or mouse button${dot}or <b>scroll</b> to pick any key${dot}Esc cancels`);
  }
  try {
    await invoke('capture_start');
  } catch (e) {
    console.error(e);
  }
  window.focus();
}

async function endCapture() {
  S.capture = null;
  try {
    await invoke('capture_end');
  } catch (e) {
    console.error(e);
  }
  await setMode('keys');
}

async function cancelCapture() {
  const c = S.capture;
  if (c?.isNew && rings()[c.ring]) rings()[c.ring].items = c.before ?? [];
  // Cancelled turning a sub-menu into a key: put the sub-menu back.
  if (c?.restore) Object.assign(rings()[c.ring]?.items[c.index] ?? {}, c.restore);
  await endCapture();
}

/** Choose a picture (.ico, .png, .svg…) for a slot, e.g. a sub-menu. */
async function pickSlotIcon(hit, cover = false) {
  const it = itemAt(hit);
  if (!it) return;
  const angle = it.angle;
  try {
    const name = await invoke('pick_icon');
    if (!name) return; // cancelled
    await setSlotIcon({ ring: hit.ring, angle }, name, cover);
  } catch (e) {
    toast(esc(e), 'error', { ttl: 5000 });
  }
}

/**
 * Put picture `name` on a slot ("" = back to the default icon), save, tidy up the old file.
 * On a slot showing a reusable menu, the picture is that menu's (so it's on every one).
 */
async function setSlotIcon(where, name, cover = false) {
  const ring = rings()[where.ring];
  const it = where.angle != null
    ? ring?.items.find((x) => sameAngle(x.angle, where.angle))
    : ring?.items[where.index];
  if (!it) return;
  const f = face(it);
  const old = f.image;
  f.image = name || undefined;
  if (cover) f.cover = true;
  await save();
  if (old && old !== name) dropImage(old);
  draw();
  toast(name ? (cover ? 'The picture fills the slot' : 'Icon set') : 'Icon removed');
}

// --- Reusable menus ---------------------------------------------------------------
// A sub-menu made reusable moves into config.menus; its slot then shows it by id
// (menu.link). Options → Menu offers them, so the same menu can sit in many places:
// change it in one and it's changed in all. "Make a separate copy" unlinks one slot.

function placeNewMenu() {
  return startPlace({ isNew: true, item: { label: '', key: '', mods: [], menu: { rings: [] } } });
}

async function enterMenuPicker(o) {
  S.menuEntry = { angle: o.angle, span: o.span };
  await setMode('menus');
}

/** Options → Menu: inner ring = Back + New; outer rings = your reusable menus. */
function menuPickSlots() {
  const entry = S.menuEntry ?? { angle: 0, span: 24 };
  const inner = [
    { icon: 'back', caption: 'Back', cls: 'back-slot', back: true },
    { icon: 'plus', caption: 'New', cls: 'opt', id: 'new-menu' },
  ];
  const blocked = blockedMenus();
  return [
    entryRing(inner, entry),
    ...spreadRings(config.menus ?? [], (m, angle, span) => sharedSlot(m, angle, span, blocked.has(m.id))),
  ];
}

function sharedSlot(m, angle, span, blocked) {
  const naming = S.naming?.kind === 'shared' && S.naming.from === m.id;
  const pic = m.image ? slotImage(m.image) : null;
  return {
    angle, span, shared: m.id, blocked,
    cls: `folder${blocked ? ' blocked' : ''}`,
    caption: naming ? S.naming.text || '…' : m.hideLabel ? undefined : m.label,
    captionMin: NAME_MIN,
    ...(pic ? { picture: pic, cover: !!m.cover } : { icon: 'folder' }),
    // Its own look's fill, if it has one, so you can tell them apart.
    fill: m.colors?.fill ? undefined : m.look?.fill,
    linked: true,
    ...(m.colors ? { vars: paintVars(m.colors) } : {}),
  };
}

/** Reusable menus linked from inside reusable menu `id` (and from those, and so on). */
function linksInside(id) {
  const seen = new Set();
  const walk = (rs) => rs?.forEach((r) => r.items.forEach((it) => {
    if (!it.menu) return;
    if (!it.menu.link) return walk(it.menu.rings);
    if (seen.has(it.menu.link)) return;
    seen.add(it.menu.link);
    walk(sharedMenu(it.menu.link)?.rings);
  }));
  walk(sharedMenu(id)?.rings);
  return seen;
}

/**
 * Reusable menus that can't go into the open menu: the ones it's inside of, and any that
 * lead to one of those (a menu inside itself would never end).
 */
function blockedMenus() {
  const above = new Set();
  let r = config.rings;
  for (const step of S.path) {
    const it = stepItem(r, step);
    if (!it?.menu) break;
    if (it.menu.link) above.add(it.menu.link);
    r = menuBody(it.menu).rings ?? [];
  }
  const blocked = new Set();
  if (!above.size) return blocked;
  for (const m of config.menus ?? []) {
    if (above.has(m.id) || [...linksInside(m.id)].some((id) => above.has(id))) blocked.add(m.id);
  }
  return blocked;
}

function placeShared(id) {
  const m = sharedMenu(id);
  if (!m) return;
  if (blockedMenus().has(id)) {
    return toast(`<b>${esc(m.label)}</b> can’t go inside itself${dot}this menu is part of it`, 'error', { ttl: 4000 });
  }
  return startPlace({ isNew: true, item: { label: '', key: '', mods: [], menu: { link: id, rings: [] } } });
}

/** Right-click on a reusable menu in Options → Menu. */
function sharedActions(id) {
  const m = sharedMenu(id);
  if (!m) return;
  const n = slotsIn(m.rings);
  const uses = usesOf(id);
  const blocked = blockedMenus().has(id);
  return showActions({
    title: `<b>${esc(m.label)}</b> <span class="dim">reusable menu with ${n} slot${n === 1 ? '' : 's'}${dot}used ${uses === 1 ? 'once' : `${uses} times`}</span>`,
    name: m.label,
    source: sharedHit(id),
    list: [
      ...(blocked ? [] : [{ label: 'Add it here', caption: 'Add here', icon: 'plus', primary: true, desc: `<b>Add it here</b>: place a slot that shows <b>${esc(m.label)}</b>`, run: () => placeShared(id) }]),
      { label: 'Rename', icon: 'rename', desc: '<b>Rename</b>: renames it everywhere it’s used', run: () => startSharedNaming(id) },
      labelChoice(() => sharedMenu(id), true),
      colorChoice(sharedHit(id)),
      { label: 'Delete', icon: 'trash', danger: true, desc: `<b>Delete</b> this reusable menu${uses ? '; slots that use it keep their own copy' : ''}`, run: () => confirmDeleteShared(id) },
    ],
  });
}

/** Where reusable menu `id` is drawn in Options → Menu ({ ring, index }), or null. */
function sharedHit(id) {
  for (let ring = 0; ring < drawn.length; ring++) {
    const index = drawn[ring].findIndex((d) => d.shared === id);
    if (index >= 0) return { ring, index };
  }
  return null;
}

const menuNameTaken = (name, exceptId = null) =>
  (config.menus ?? []).some((m) => m.id !== exceptId && m.label.toLowerCase() === name.toLowerCase());

/** "Menu 1", "Menu 2"... the first name no reusable menu has. */
function nextMenuName() {
  for (let n = 1; ; n++) if (!menuNameTaken(`Menu ${n}`)) return `Menu ${n}`;
}

function newMenuId() {
  for (;;) {
    const id = `m-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    if (!sharedMenu(id)) return id;
  }
}

async function renameShared(id, to) {
  if (!to) throw 'Give the menu a name';
  if (menuNameTaken(to, id)) throw `There’s already a menu called ${to}`;
  const m = sharedMenu(id);
  if (!m) throw 'That menu is gone';
  m.label = to;
  await save();
}

function startSharedNaming(id) {
  const m = sharedMenu(id);
  if (!m) return;
  return beginNaming({ kind: 'shared', from: id, text: m.label, max: 24, apply: (to) => renameShared(id, to) });
}

/** Right-click a sub-menu → Make reusable: name it, and it moves into your reusable menus. */
function shareSlot(hit) {
  const it = itemAt(hit);
  if (!it?.menu || it.menu.link) return;
  const where = { ring: hit.ring, angle: it.angle };
  const suggested = it.label?.trim() && !menuNameTaken(it.label.trim()) ? it.label.trim() : nextMenuName();
  return beginNaming({
    kind: 'share', ...where, text: suggested, max: 24, always: true, intro: 'Make reusable',
    apply: async (to) => {
      if (!to) throw 'Give the menu a name';
      if (menuNameTaken(to)) throw `There’s already a menu called ${to}`;
      const target = rings()[where.ring]?.items.find((x) => sameAngle(x.angle, where.angle));
      if (!target?.menu || target.menu.link) throw 'That sub-menu is gone';
      const { rings: content = [], look: ownLook, hotkey, back } = target.menu;
      const { colors, hideLabel } = target;
      const id = newMenuId();
      // Its slots, look, name and picture go to the reusable menu; the hotkey stays on this slot.
      (config.menus ??= []).push({ id, label: to, rings: content, look: ownLook, back, image: target.image, cover: target.cover, colors, hideLabel });
      target.menu = { link: id, hotkey, rings: [] };
      target.label = '';
      target.image = undefined;
      target.cover = undefined;
      target.colors = undefined;
      target.hideLabel = undefined;
      await save();
    },
    done: (to) => toast(
      `<b>${esc(to)}</b> is reusable${dot}add it to any menu with Options → Add → <b>Menu</b>${dot}change it anywhere and it changes everywhere`,
      'ok', { ttl: 7000 },
    ),
  });
}

/** Give a slot its own copy of the reusable menu it shows (slots, look, name, picture). */
function copyInto(it, m) {
  const copy = structuredClone({ rings: m.rings ?? [], look: m.look, back: m.back, colors: m.colors });
  it.menu = { rings: copy.rings, look: copy.look, back: copy.back, hotkey: it.menu?.hotkey };
  it.label = m.label;
  it.image = m.image || undefined;
  it.cover = m.cover || undefined;
  it.colors = copy.colors;
  it.hideLabel = m.hideLabel || undefined;
}

async function unlinkSlot(hit) {
  const it = itemAt(hit);
  const m = sharedMenu(it?.menu?.link);
  if (!m) return;
  copyInto(it, m);
  await save();
  draw();
  updateHint();
  toast(`This slot has its own copy of <b>${esc(m.label)}</b> now${dot}changes to it stay here`, 'ok', { ttl: 5000 });
}

function confirmDeleteShared(id) {
  const m = sharedMenu(id);
  if (!m) return;
  const uses = usesOf(id);
  const keep = !uses ? ''
    : uses === 1 ? `${dot}the slot that uses it keeps its own copy`
    : `${dot}the ${uses} slots that use it each keep their own copy`;
  return showActions({
    title: `Delete the reusable menu <b>${esc(m.label)}</b>?${keep}`,
    kind: 'warn',
    name: m.label,
    source: sharedHit(id),
    list: [{ label: 'Delete', caption: 'Yes', icon: 'trash', danger: true, desc: `<b>Delete</b> ${esc(m.label)}${keep}`, run: () => deleteShared(id) }],
  });
}

async function deleteShared(id) {
  const m = sharedMenu(id);
  if (!m) return;
  // Nothing is lost: every slot showing it gets its own copy first.
  eachMenuSlot((it) => { if (it.menu.link === id) copyInto(it, m); });
  config.menus = config.menus.filter((x) => x.id !== id);
  await save();
  if (!config.menus?.length && S.mode === 'menus') {
    await setMode('options');
  } else {
    await ensureLayout();
    draw();
    updateHint();
  }
  toast(`Deleted <b>${esc(m.label)}</b>`);
}

// --- Presets --------------------------------------------------------------------
// Options → Presets swaps the wheel to: inner ring = Back (where the Presets option was)
// + Save; outer ring(s) = one slot per saved preset, drawn in that preset's own colours.

const norm = (a) => ((a % 360) + 360) % 360;
const PRESET_ARC = 84; // px of ring per preset slot, so names stay readable

function presetSlots() {
  const P = S.presets ?? { presets: [], active: '', saved: false };
  const entry = S.presetEntry ?? { angle: 0, span: 24 };
  // Save = into the preset you're on; Save new = another preset. Not on one yet: only Save new.
  const inner = [{ icon: 'back', caption: 'Back', cls: 'back-slot', back: true }];
  if (P.active) inner.push({ icon: 'save', caption: 'Save', cls: 'opt', id: 'save' });
  inner.push({ icon: 'saveNew', caption: 'Save new', cls: 'opt', id: 'save-new' });
  inner.push({ icon: 'import', caption: 'Import', cls: 'opt', id: 'import' });
  return [
    entryRing(inner, entry),
    ...spreadRings(P.presets, (p, angle, span) => presetSlot(p, P, angle, span)),
  ];
}

/** The inner ring of a sub-view (presets, Options → Menu): its slots in a row from where you came in. */
function entryRing(slots, entry) {
  const span0 = Math.max(entry.span, 36);
  return slots.map((s, i) => painted(
    { ...s, caption: optionCaption(s.caption), angle: norm(entry.angle + i * span0), span: span0 },
    s.back ? config.paint?.back : config.paint?.[`opt:${s.id}`],
  ));
}

/** One slot per thing in `list` on rings 1, 2…: a few sit together at the top, a full ring goes all the way round. */
function spreadRings(list, make) {
  const out = [];
  let rest = list;
  for (let ring = 1; rest.length; ring++) {
    const cap = Math.max(4, Math.floor((2 * Math.PI * geo.rMid(ring)) / PRESET_ARC));
    const chunk = rest.slice(0, cap);
    rest = rest.slice(cap);
    const span = Math.min(60, 360 / chunk.length);
    const start = -((chunk.length - 1) * span) / 2;
    out.push(chunk.map((x, k) => make(x, norm(start + k * span), span)));
  }
  return out;
}

function presetSlot(p, P, angle, span) {
  const current = P.active === p.name;
  const naming = S.naming?.kind === 'preset' && S.naming.from === p.name;
  const own = p.colors ?? {};
  const fill = own.fill || p.fill;
  const solid = solidOf(fill);
  // A preset saved with a see-through accent still shows its name; one you made see-through doesn't.
  const accent = own.accent || (p.accent === CLEAR ? lineOn(solid) : p.accent);
  const acc = rgbOf(accent === CLEAR ? lineOn(solid) : accent);
  const low = accent !== CLEAR && (fill === CLEAR || contrast(acc, solid) < 2);
  return {
    angle, span, preset: p.name,
    cls: `preset${current ? ' current' : ''}`,
    label: naming ? S.naming.text || '…' : p.name,
    curved: true,
    sub: current ? (p.same ? '✓ in use' : '✓ edited') : '',
    // The preset's own look: its fill behind its accent-coloured name (or colours you gave its slot).
    fill,
    color: accent,
    outline: low ? outlineFor(acc) : null,
    vars: { '--tint': own.tint && own.tint !== CLEAR ? rgba(rgbOf(own.tint), TINT_ALPHA) : CLEAR },
  };
}

/** Where preset `name` is drawn ({ ring, index }), or null. */
function presetHit(name) {
  for (let ring = 0; ring < drawn.length; ring++) {
    const index = drawn[ring].findIndex((d) => d.preset === name);
    if (index >= 0) return { ring, index };
  }
  return null;
}

async function enterPresets(o) {
  S.presetEntry = { angle: o.angle, span: o.span };
  try {
    S.presets = await invoke('list_presets');
  } catch (e) {
    return toast(esc(e), 'error', { ttl: 6000 });
  }
  await setMode('presets');
}

async function refreshPresets(list) {
  S.presets = list;
  await ensureLayout();
  draw();
  updateHint();
}

const presetByName = (name) => S.presets?.presets.find((p) => p.name === name);

/** Click on a preset: switch to it, first offering to keep a setup that isn't saved anywhere. */
async function choosePreset(name) {
  const P = S.presets;
  const p = presetByName(name);
  if (!p) return;
  if (p.same) return toast(`<b>${esc(name)}</b> is already what you have`);
  const active = P.active ? presetByName(P.active) : null;
  if (active && name === active.name) {
    return showActions({
      title: `Go back to the saved <b>${esc(name)}</b>? Your changes since then will be gone.`,
      kind: 'warn',
      name,
      source: presetHit(name),
      list: [
        { label: 'Go back', icon: 'reset', danger: true, desc: `<b>Go back</b> to the saved ${esc(name)}; your changes since then are gone`, run: () => loadPreset(name) },
        { label: 'Update it instead', caption: 'Update', icon: 'save', desc: `<b>Update</b>: save your changes into ${esc(name)} instead`, run: () => updatePreset(name) },
      ],
    });
  }
  if (!P.saved) {
    const keep = active
      ? {
          label: `Update “${active.name}” first`, caption: 'Update first', icon: 'save', primary: true,
          desc: `<b>Update ${esc(active.name)}</b> with your changes, then switch`,
          run: async () => { if (await updatePreset(active.name, true)) await loadPreset(name); },
        }
      : {
          label: 'Save it first', caption: 'Save first', icon: 'saveNew', primary: true,
          desc: '<b>Save</b> your setup as a new preset, then switch',
          run: async () => { if (await saveNewPreset(true)) await loadPreset(name); },
        };
    return showActions({
      title: `Switch to <b>${esc(name)}</b>?${dot}${active ? `your changes to <b>${esc(active.name)}</b> aren’t saved in it` : 'your setup now isn’t saved as a preset'}`,
      kind: 'warn',
      name,
      source: presetHit(name),
      list: [
        keep,
        { label: 'Switch anyway', caption: 'Switch', icon: 'swap', danger: true, desc: `<b>Switch anyway</b>${dot}<b>Undo</b> right after switching brings this setup back`, run: () => loadPreset(name) },
      ],
    });
  }
  return loadPreset(name);
}

/** The setup changed under us (preset loaded / undone): show it. */
async function applySwitched(r) {
  // Drop any delayed save of the old setup.
  clearTimeout(turnTimer);
  clearTimeout(sizeTimer);
  edits++;
  config = r.config;
  forgetHistory(); // a different setup now: its own Undo button switches back
  S.path = [];
  S.presets = r.list;
  loadBackground();
  loadAppIcon(S.app);
  await ensureLayout(true);
  draw();
  updateHint();
}

async function loadPreset(name) {
  try {
    const r = await invoke('load_preset', { name });
    await applySwitched(r);
    const warn = r.warnings.length ? `${dot}<span class="dim">${esc(r.warnings.join(' · '))}</span>` : '';
    toast(`Now using <b>${esc(name)}</b>${warn}`, r.warnings.length ? 'warn' : 'ok', {
      ttl: r.warnings.length ? 9000 : 6000,
      actions: [undoButton(undoLoad)],
    });
  } catch (e) {
    toast(esc(e), 'error', { ttl: 5000 });
  }
}

async function undoLoad() {
  clearToast();
  try {
    await applySwitched(await invoke('undo_load_preset'));
    toast('Switched back');
  } catch (e) {
    toast(esc(e), 'error', { ttl: 5000 });
  }
}

/** Save the setup as a new preset ("Preset N"), then let you type its name. */
async function saveNewPreset(quiet = false) {
  try {
    const list = await invoke('save_preset', { name: null, replace: false });
    await refreshPresets(list);
    if (quiet) toast(`Saved as <b>${esc(list.active)}</b>`);
    else startNaming(list.active, 'Saved');
    return true;
  } catch (e) {
    toast(esc(e), 'error', { ttl: 5000 });
    return false;
  }
}

/** Save: your changes go into the preset you're on. */
async function saveCurrentPreset() {
  const name = S.presets?.active;
  if (!name) return saveNewPreset();
  if (presetByName(name)?.same) return toast(`<b>${esc(name)}</b> is already saved`);
  return updatePreset(name);
}

/** Save the setup into an existing preset (with Undo). */
async function updatePreset(name, quiet = false) {
  try {
    await refreshPresets(await invoke('save_preset', { name, replace: true }));
    if (!quiet) toast(`Saved your setup into <b>${esc(name)}</b>`, 'ok', { ttl: 6000, actions: [undoButton(undoPresets)] });
    return true;
  } catch (e) {
    toast(esc(e), 'error', { ttl: 5000 });
    return false;
  }
}

async function deletePreset(name) {
  try {
    await refreshPresets(await invoke('delete_preset', { name }));
    toast(`Deleted <b>${esc(name)}</b>`, 'ok', { ttl: 6000, actions: [undoButton(undoPresets)] });
  } catch (e) {
    toast(esc(e), 'error', { ttl: 5000 });
  }
}

async function undoPresets() {
  clearToast();
  try {
    await refreshPresets(await invoke('undo_presets'));
    toast('Undone');
  } catch (e) {
    toast(esc(e), 'error', { ttl: 5000 });
  }
}

/** Import: pick a .rkpreset file, add it to your presets, then switch to it. */
async function importPreset() {
  let r;
  try {
    r = await invoke('import_preset');
  } catch (e) {
    return toast(esc(e), 'error', { ttl: 6000 });
  }
  if (!r) return; // cancelled
  return afterImport(r);
}

/** A preset was added (from a file, a Get button or a drop): switch to it, after showing
 *  which programs its slots open, if any. */
async function afterImport(r) {
  await refreshPresets(r.list);
  if (r.programs.length) {
    // A preset from someone else can open programs: show which before using it.
    const list = r.programs.map((p) => esc(p.split(/[\\/]/).pop())).join(', ');
    return showActions({
      title: `Imported <b>${esc(r.name)}</b>${dot}its slots open: ${list}`,
      kind: 'warn',
      name: r.name,
      source: presetHit(r.name),
      cancel: 'Not now',
      list: [{ label: 'Switch to it', caption: 'Switch', icon: 'swap', primary: true, desc: `<b>Switch to it</b>${dot}its slots open: ${list}`, run: () => choosePreset(r.name) }],
    });
  }
  return choosePreset(r.name);
}

async function exportPreset(name) {
  try {
    const path = await invoke('export_preset', { name });
    if (path) toast(`Saved <b>${esc(name)}</b> to <span class="dim">${esc(path)}</span>`, 'ok', { ttl: 6000 });
  } catch (e) {
    toast(esc(e), 'error', { ttl: 6000 });
  }
}

/** Right-click on a preset. */
function presetActions(name) {
  const P = S.presets;
  const p = presetByName(name);
  if (!p) return;
  const current = P.active === name;
  const info = `${p.rings} ring${p.rings === 1 ? '' : 's'} · ${p.slots} slot${p.slots === 1 ? '' : 's'}${p.background ? ' · picture' : ''}`;
  return showActions({
    title: `<b>${esc(name)}</b> <span class="dim">${info}</span>`,
    name,
    source: presetHit(name),
    list: [
      ...(p.same ? [] : [current
        ? { label: 'Go back to it', caption: 'Go back', icon: 'reset', primary: true, desc: `<b>Go back</b> to the saved ${esc(name)}`, run: () => choosePreset(name) }
        : { label: 'Switch to it', caption: 'Switch', icon: 'swap', primary: true, desc: `<b>Switch</b> to ${esc(name)}`, run: () => choosePreset(name) }]),
      ...(p.same ? [] : [{ label: 'Update', icon: 'save', desc: `<b>Update</b>: save your setup now into ${esc(name)}`, run: () => updatePreset(name) }]),
      { label: 'Rename', icon: 'rename', desc: `<b>Rename</b> ${esc(name)}`, run: () => startNaming(name) },
      colorChoice(presetHit(name)),
      { label: 'Export…', caption: 'Export', icon: 'export', desc: '<b>Export</b> to a file (.rkpreset), to keep or share', run: () => exportPreset(name) },
      { label: 'Delete', icon: 'trash', danger: true, desc: `<b>Delete</b> ${esc(name)} (Undo brings it back)`, run: () => deletePreset(name) },
    ],
  });
}

// Typing a name (a preset, or a sub-menu / program slot). The wheel doesn't take focus on
// Windows, so keys come from the same keyboard hook that records keys (they don't reach
// the app below meanwhile).

/** Name a preset: renames it when you're done. */
function startNaming(name, intro = '') {
  return beginNaming({
    kind: 'preset', from: name, text: name, intro, max: 32,
    apply: async (to) => {
      if (!to) throw 'Give the preset a name';
      S.presets = await invoke('rename_preset', { from: name, to });
    },
  });
}

/** Name a slot ("" = back to "Menu" / the default / the key's own label). */
function startSlotNaming(hit) {
  const it = itemAt(hit);
  if (!it) return;
  const where = { ring: hit.ring, angle: it.angle };
  const shared = sharedMenu(it.menu?.link);
  if (shared) {
    // A reusable menu's name is on every slot that shows it.
    return beginNaming({
      kind: 'slot', ...where, text: shared.label, max: 24, intro: 'Renames it everywhere',
      apply: (to) => renameShared(shared.id, to),
    });
  }
  return beginNaming({
    kind: 'slot', ...where, text: it.label?.trim() ?? '', max: 24,
    apply: async (to) => {
      const target = rings()[where.ring]?.items.find((x) => sameAngle(x.angle, where.angle));
      if (!target) throw 'That slot is gone';
      target.label = to;
      await save();
    },
  });
}

/** Where the slot being named is drawn. */
function namingHit() {
  const n = S.naming;
  if (n?.kind === 'preset') return presetHit(n.from);
  if (n?.kind === 'shared') return sharedHit(n.from); // renaming a reusable menu in Options → Menu
  if (n?.kind === 'slot' || n?.kind === 'share') {
    const index = rings()[n.ring]?.items.findIndex((x) => sameAngle(x.angle, n.angle)) ?? -1;
    return index >= 0 ? { ring: n.ring, index } : null;
  }
  return null;
}

async function beginNaming(n) {
  S.naming = { ...n, original: n.text, selected: true, busy: false, error: '' };
  clearToast();
  showNaming();
  try {
    await invoke('capture_start');
  } catch (e) {
    console.error(e);
  }
  window.focus();
}

function showNaming() {
  const n = S.naming;
  if (!n) return;
  const text = n.text ? `<span class="name-edit${n.selected ? ' selected' : ''}">${esc(n.text)}</span>` : '';
  const err = n.error ? `${dot}<span class="err">${esc(n.error)}</span>` : '';
  setPrompt(`${n.intro ? `${esc(n.intro)}${dot}` : ''}Name: ${text}<span class="caret"></span>${err}`, [
    { label: 'Done', cls: 'primary', run: () => endNaming(true) },
    { label: 'Cancel', run: () => endNaming(false) },
  ]);
  draw();
}

/** A key while naming. `text` is what it types (null for Enter, arrows...). */
function onNameKey(code, mods, text) {
  const n = S.naming;
  if (!n || n.busy) return;
  invoke('capture_extend').catch(() => {});
  const ctrl = (mods.includes('ctrl') && !mods.includes('alt')) || mods.includes('meta');
  n.error = '';
  if (code === 'Escape') return endNaming(false);
  if (code === 'Enter' || code === 'NumpadEnter') return endNaming(true);
  if (code === 'Backspace' || (code === 'Delete' && n.selected)) {
    n.text = n.selected || ctrl ? '' : [...n.text].slice(0, -1).join('');
  } else if (ctrl && code === 'KeyA') {
    n.selected = true;
    return showNaming();
  } else if (!ctrl && text) {
    n.text = [...((n.selected ? '' : n.text) + text)].slice(0, n.max ?? 32).join('');
  } else if (!/^(Arrow|Home$|End$)/.test(code ?? '')) {
    return; // shortcuts, function keys...
  }
  n.selected = false;
  showNaming();
}

async function endNaming(commit) {
  const n = S.naming;
  if (!n || n.busy) return;
  const to = n.text.trim().replace(/\s+/g, ' ');
  // `always`: the name is needed even if you keep the suggested one (Make reusable).
  const renaming = commit && (n.always || to !== n.original.trim());
  if (renaming) {
    n.busy = true;
    try {
      await n.apply(to);
    } catch (e) {
      n.busy = false;
      n.error = String(e); // e.g. that name is taken: keep typing
      return showNaming();
    }
  }
  S.naming = null;
  setPrompt(null);
  invoke('capture_end').catch(() => {});
  await ensureLayout();
  draw();
  updateHint();
  if (renaming) {
    if (n.done) n.done(to);
    else toast(to ? `Named <b>${esc(to)}</b>` : 'Name removed');
  }
}

// --- Program slots ------------------------------------------------------------
const programIcons = new Map(); // program path -> icon data URL (null while loading / none)
function programIcon(path) {
  if (!programIcons.has(path)) {
    programIcons.set(path, null);
    invoke('program_icon', { path })
      .then((url) => {
        if (!url) return;
        programIcons.set(path, url);
        if (S.visible) draw();
      })
      .catch(() => {});
  }
  return programIcons.get(path);
}

/** File picker for a program. Returns { path, name } or null. */
async function pickProgram() {
  try {
    return await invoke('pick_program');
  } catch (e) {
    toast(esc(e), 'error', { ttl: 5000 });
    return null;
  }
}

function launchItem(item) {
  invoke('launch', { path: item.program }).catch((e) => {
    // The wheel already closed: show the problem next time it opens.
    S.pendingError = String(e);
  });
}

/**
 * Picture choices for a slot: pick an icon, make it fill the whole
 * slot (or go back to a small icon), drop your own picture.
 */
function pictureActions(hit, it) {
  const pic = it && slotPicture(it);
  const f = it && face(it);
  return [
    { label: 'Icon…', caption: 'Icon', icon: 'image', primary: true, desc: '<b>Icon</b>: pick a picture (.ico, .png, .svg…) to show in the slot', run: () => pickSlotIcon(hit) },
    f?.cover && pic
      ? { label: 'Small icon', icon: 'shrink', desc: '<b>Small icon</b>: the picture shrinks back to an icon in the slot', run: () => setSlotCover(hit, false) }
      // No picture yet (a sub-menu with the folder icon): pick one, then fill.
      : {
          label: 'Fill slot', icon: 'expand', run: () => (pic ? setSlotCover(hit, true) : pickSlotIcon(hit, true)),
          desc: pic ? '<b>Fill slot</b>: the picture covers the whole slot' : '<b>Fill slot</b>: pick a picture that covers the whole slot',
        },
    ...(f?.image
      ? [it.program
          ? { label: 'Own icon', icon: 'launch', desc: '<b>Own icon</b>: back to the program’s own icon', run: () => setSlotIcon(hit, '') }
          : { label: 'Remove icon', caption: 'Remove', icon: 'trash', danger: true, desc: `<b>Remove</b> the picture (back to ${it.menu ? 'the folder icon' : 'the key’s label'})`, run: () => setSlotIcon(hit, '') }]
      : []),
  ];
}

/** "Picture…" on a slot: the picture choices as their own menu, Back returns. */
function pictureChoice(hit) {
  return { label: 'Picture…', caption: 'Picture', icon: 'image', desc: '<b>Picture</b>: an icon for this slot, or a picture that fills it', run: () => pictureMenu(hit) };
}

function pictureMenu(hit) {
  const it = itemAt(hit);
  if (!it) return;
  const name = face(it).label?.trim() || (it.menu ? 'Sub-menu' : it.program ? 'Program' : slotName(it));
  const everywhere = sharedMenu(it.menu?.link) ? ` <span class="dim">everywhere it’s used</span>` : '';
  return showActions({
    title: `Picture for <b>${esc(name)}</b>${everywhere}`,
    name: 'Picture',
    source: hit,
    parent: S.lastActions,
    list: pictureActions(hit, it),
  });
}

async function setSlotCover(hit, on) {
  const it = itemAt(hit);
  if (!it) return;
  face(it).cover = on || undefined;
  await save();
  draw();
  toast(on ? 'The picture fills the slot' : 'Small icon again');
}

/**
 * The "Label" choice: show the name or key label of `get()` (a slot's face, or a reusable
 * menu), or not. Pointing at the slot still says it.
 */
function labelChoice(get, everywhere) {
  const hidden = !!get()?.hideLabel;
  const where = everywhere ? ' everywhere it’s used' : '';
  return {
    label: hidden ? 'Show label' : 'Hide label', caption: 'Label', icon: 'labels', badge: hidden ? 'off' : 'on',
    desc: hidden ? `<b>Label</b> is off${where}${dot}click to show it` : `<b>Label</b> is on${where}${dot}click to hide it (pointing at the slot still says what it is)`,
    run: async () => {
      const f = get();
      if (!f) return;
      f.hideLabel = !f.hideLabel || undefined;
      await save();
      draw();
      updateHint();
      toast(f.hideLabel ? 'Label hidden' : 'Label shown');
    },
  };
}

/** Right-click on a key slot. */
function keyActions(hit) {
  const it = itemAt(hit);
  if (!it) return;
  const combo = itemName(it, keyMap, platform);
  const name = it.label?.trim() || combo;
  return showActions({
    title: `<b>${esc(name)}</b> <span class="dim">${it.label?.trim() ? esc(combo) : 'key'}</span>`,
    name,
    source: hit,
    list: [
      {
        label: 'Change key', caption: 'Key', icon: 'key', primary: true,
        desc: '<b>Change key</b>: press a new key, combo or mouse button, or scroll to pick one',
        run: () => startCapture({ target: 'slot', ring: hit.ring, index: hit.index }),
      },
      { label: 'Rename', icon: 'rename', desc: '<b>Rename</b>: a name to show instead of the key (empty = the key again)', run: () => startSlotNaming(hit) },
      pictureChoice(hit),
      labelChoice(() => face(itemAt(hit))),
      colorChoice(hit),
    ],
  });
}

/** Right-click on a program slot. */
function programActions(hit) {
  const it = itemAt(hit);
  if (!it) return;
  const where = { ring: hit.ring, angle: it.angle };
  const name = it.label || 'Program';
  return showActions({
    title: `<b>${esc(name)}</b> <span class="dim">${esc(it.program)}</span>`,
    name,
    source: hit,
    list: [
      { label: 'Open', icon: 'launch', primary: true, desc: `<b>Open</b> ${esc(name)}`, run: () => launchItem(it) },
      { label: 'Rename', icon: 'rename', desc: '<b>Rename</b> this slot', run: () => startSlotNaming(hit) },
      pictureChoice(hit),
      labelChoice(() => face(itemAt(hit))),
      colorChoice(hit),
      {
        label: 'Change…', caption: 'Change', icon: 'swap', desc: '<b>Change</b>: pick another program for this slot',
        run: async () => {
          const picked = await pickProgram();
          if (!picked) return;
          const target = rings()[where.ring]?.items.find((x) => sameAngle(x.angle, where.angle));
          if (!target) return;
          target.program = picked.path;
          target.label = picked.name;
          await save();
          draw();
          toast(`Now opens <b>${esc(picked.name)}</b>`);
        },
      },
      {
        label: 'Make it a key', caption: 'Key', icon: 'key', desc: '<b>Make it a key</b>: press a key and this slot sends it instead (Esc keeps the program)',
        run: () => {
          // Pressing a key turns it into a key slot; Esc keeps the program.
          const restore = { program: it.program, label: it.label, image: it.image, cover: it.cover, key: it.key, mods: it.mods };
          it.program = undefined;
          it.label = '';
          it.image = undefined; // (a key can have a picture: this one was the program's)
          it.cover = undefined;
          startCapture({ target: 'slot', ring: hit.ring, index: hit.index, restore });
        },
      },
    ],
  });
}

/** Slots in a set of rings (not counting what's inside its sub-menus). */
const slotsIn = (rs) => (rs ?? []).reduce((n, r) => n + r.items.length, 0);

/** Right-click on a sub-menu slot. */
function folderActions(hit) {
  const it = itemAt(hit);
  if (!it?.menu) return;
  const shared = sharedMenu(it.menu.link);
  const count = slotsIn(menuBody(it.menu).rings);
  const slots = `${count} slot${count === 1 ? '' : 's'}`;
  const uses = shared ? usesOf(shared.id) : 0;
  const info = shared
    ? `reusable menu with ${slots}${dot}used ${uses === 1 ? 'once' : `${uses} times`}`
    : `sub-menu with ${slots}`;
  const name = face(it).label?.trim() || 'Sub-menu';
  return showActions({
    title: `<b>${esc(name)}</b> <span class="dim">${info}</span>`,
    name,
    source: hit,
    list: [
      { label: 'Open', icon: 'folder', primary: true, desc: `<b>Open</b> ${esc(name)}`, run: () => openMenu(hit) },
      {
        label: 'Rename', icon: 'rename', run: () => startSlotNaming(hit),
        desc: shared ? `<b>Rename</b>${dot}renames it everywhere it’s used` : '<b>Rename</b> this sub-menu',
      },
      pictureChoice(hit),
      labelChoice(() => face(itemAt(hit)), !!shared),
      colorChoice(hit),
      shared
        ? {
            label: 'Make a separate copy', caption: 'Copy', icon: 'copy', run: () => unlinkSlot(hit),
            desc: `<b>Make a separate copy</b>${dot}this slot gets its own copy of <b>${esc(name)}</b>; changes to it stay here`,
          }
        : {
            label: 'Make reusable', caption: 'Reusable', icon: 'link', run: () => shareSlot(hit),
            desc: '<b>Make reusable</b>: name it, then add the same menu anywhere with Options → Add → <b>Menu</b>',
          },
      {
        label: 'Make it a key', caption: 'Key', icon: 'key',
        desc: '<b>Make it a key</b>: press a key and this slot sends it instead; what’s in the sub-menu goes (Esc keeps it)',
        run: () => {
          // Pressing a key replaces the sub-menu (and what's in it); Esc keeps it.
          const restore = { menu: it.menu, key: it.key, mods: it.mods, label: it.label, image: it.image, cover: it.cover };
          it.menu = undefined;
          it.image = undefined;
          it.cover = undefined;
          startCapture({ target: 'slot', ring: hit.ring, index: hit.index, restore });
        },
      },
    ],
  });
}

async function applySlotKey(code, mods) {
  const c = S.capture;
  const item = rings()[c.ring]?.items[c.index];
  if (!item) return endCapture();
  item.key = code;
  item.mods = mods;
  item.label = '';
  const name = itemName(item, keyMap, platform);
  await save();
  await endCapture();
  toast(`Slot set to <b>${esc(name)}</b>`);
}

async function applyHotkey(code, mods) {
  const menuPath = S.capture?.menuPath;
  if (menuPath && code === 'Backspace' && !mods.length) {
    try {
      const before = lastSaved;
      config = await invoke('set_menu_hotkey', { path: menuPath, hotkey: '' });
      remember(before, config);
      await endCapture();
      toast('This sub-menu has no hotkey now');
    } catch (e) {
      toast(esc(e), 'error', { ttl: 4000 });
    }
    return;
  }
  const plain = /^(Key[A-Z]|Digit\d|Space|Enter|Backspace|Tab)$/.test(code);
  if (!mods.length && plain) {
    const name = keyMap.get(code)?.name ?? code;
    return toast(`<b>${esc(name)}</b> on its own would block typing — add Ctrl, Alt or Shift`, 'error', { ttl: 4000 });
  }
  const accel = [
    mods.includes('ctrl') && 'Control',
    mods.includes('alt') && 'Alt',
    mods.includes('shift') && 'Shift',
    mods.includes('meta') && 'Super',
    code,
  ].filter(Boolean).join('+');
  try {
    if (menuPath) {
      const before = lastSaved;
      config = await invoke('set_menu_hotkey', { path: menuPath, hotkey: accel });
      remember(before, config); // Ctrl+Z can take a sub-menu's hotkey back
      await endCapture();
      toast(`<kbd>${esc(hotkeyText(accel))}</kbd> now opens this sub-menu directly`);
    } else {
      config = await invoke('set_hotkey', { hotkey: accel });
      lastSaved = JSON.stringify(config); // the main hotkey isn't part of undo: older setups keep the new one
      await endCapture();
      toast(`Open the wheel with <kbd>${esc(hotkeyText())}</kbd>`);
    }
  } catch (e) {
    toast(esc(e), 'error', { ttl: 4000 }); // keep listening
  }
}

/** A key pressed while listening (from the page on macOS, from Rust's keyboard hook on Windows). */
let captureBusy = false;
async function onCaptureCode(code, mods) {
  const c = S.capture;
  if (!c || captureBusy) return;
  if (code === 'Escape' && !mods.length) return cancelCapture();
  // Backspace on its own removes a sub-menu's hotkey.
  const removing = c.target === 'hotkey' && c.menuPath && code === 'Backspace' && !mods.length;
  if (!removing && (!code || !keyMap.has(code))) {
    return toast(`That key can’t be sent on this system${dot}scroll to pick a key`, 'error', { ttl: 4000 });
  }
  captureBusy = true;
  try {
    if (c.target === 'hotkey') await applyHotkey(code, mods);
    else await applySlotKey(code, mods);
  } finally {
    captureBusy = false;
  }
}

function onCaptureKey(ev) {
  if (!S.capture || ev.repeat || MODIFIER_CODES.has(ev.code)) return;
  const mods = [ev.ctrlKey && 'ctrl', ev.altKey && 'alt', ev.shiftKey && 'shift', ev.metaKey && 'meta'].filter(Boolean);
  onCaptureCode(ev.code, mods);
}

function handleEscape() {
  if (S.naming) return endNaming(false);
  if (S.brush) return endBrush();
  switch (S.mode) {
    case 'capture': return cancelCapture();
    case 'place': return cancelPlace();
    case 'pick-move':
    case 'pick-remove':
    case 'size':
    case 'rotate': return setMode('options');
    case 'presets':
    case 'menus':
      if (msg.toast?.actions?.length) return clearToast();
      return setMode('options');
    case 'actions': return cancelActions();
    case 'options': return setMode('keys');
    default:
      if (msg.toast?.actions?.length) return clearToast();
      if (S.path.length) return goBack(); // in a sub-menu: Esc goes up one level
      return close();
  }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
function hitAt(ev, extend = false) {
  const p = eventToWheel(svg, ev, layout.size);
  return { p, hit: hitTest(geo, drawn, p.x, p.y, extend) };
}

function onPointerMove(ev) {
  if (!wheel) return;
  const { p, hit } = hitAt(ev, S.mode === 'keys' && S.holding);
  if (S.mode === 'place') return updateGhost(p);
  if (S.mode === 'size') return setHover(hit?.center ? { center: true, half: p.x < 0 ? 'left' : 'right' } : null);
  if ((S.mode === 'options' || S.actions?.colors) && hit?.center) return setHover({ center: true, half: hubPart(p) });
  if (S.mode === 'rotate') return rotateMove(p, hit);
  if (S.mode === 'actions' && drawnAt(hit)?.off) return setHover(null); // greyed out: no response
  setHover(hit);
}
document.addEventListener('pointermove', onPointerMove);

document.addEventListener('pointerleave', () => {
  if (!S.holding && S.mode !== 'place') setHover(null);
});

document.addEventListener('pointerdown', (ev) => {
  if (ev.target.closest?.('#msg')) return; // buttons in the message box
  const left = ev.button === 0;
  const right = ev.button === 2;
  if (S.naming) {
    // Clicking anywhere while typing a name keeps what's typed.
    ev.preventDefault();
    return endNaming(true);
  }
  if (S.mode === 'capture' && MOUSE_CODES[ev.button]) {
    // Middle / Mouse 4 / Mouse 5 can be recorded too (as a slot's key or the hotkey).
    ev.preventDefault();
    const mods = [ev.ctrlKey && 'ctrl', ev.altKey && 'alt', ev.shiftKey && 'shift', ev.metaKey && 'meta'].filter(Boolean);
    return onCaptureCode(MOUSE_CODES[ev.button], mods);
  }
  if (!left && !right) return;
  ev.preventDefault();
  const { p, hit } = hitAt(ev, false);
  const item = itemAt(hit);

  if (S.brush && BRUSH_MODES.has(S.mode)) {
    if (right) return paintHit(hit);
    if (S.mode === 'keys' && !hit?.center) {
      // You can still get around, but keys and programs don't fire while you carry a colour.
      if (drawnAt(hit)?.back) return goBack();
      if (item?.menu) return openMenu(hit);
      if (item) return toast(`<b>Right-click</b> it to colour it${dot}<b>Done</b> or Esc when you’re finished`, 'prompt');
      return endBrush(); // empty space
    }
  }

  switch (S.mode) {
    case 'keys':
      if (hit?.center) {
        if (left) return enterOptions();
        // Right-click: the hotkey for whichever menu is open (main, or this sub-menu).
        return startCapture({ target: 'hotkey', menuPath: S.path.length ? S.path.map((p) => ({ ...p })) : null });
      }
      if (drawnAt(hit)?.back) return left ? goBack() : backActions(hit);
      if (item?.menu) return left ? openMenu(hit) : folderActions(hit);
      if (item?.program) return left ? launchItem(item) : programActions(hit);
      if (item) return left ? send(item) : keyActions(hit);
      if (left) close();
      return;
    case 'options': {
      if (hit?.center) {
        // Right-click: the Y's own colours. Click: Accent / Fill / Tint as what the colour swatches change.
        if (right) return hubColorMenu();
        return toggleColorTarget(hubPart(p));
      }
      const o = hit && drawn[hit.ring]?.[hit.index];
      if (o && right) return o.id === 'color' ? pickBrush(o.color) : optionActions(o.id);
      if (o) return runOption(o);
      return setMode('keys'); // empty space: back to the keys
    }
    case 'presets': {
      const d = drawnAt(hit);
      if (!d || d.back) return setMode('options'); // center, Back, empty space
      if (d.id === 'save-new') return saveNewPreset();
      if (d.id === 'save') return saveCurrentPreset();
      if (d.id === 'import') return importPreset();
      if (d.preset) return left ? choosePreset(d.preset) : presetActions(d.preset);
      return;
    }
    case 'menus': {
      const d = drawnAt(hit);
      if (!d || d.back) return setMode('options'); // center, Back, empty space
      if (d.id === 'new-menu') return placeNewMenu();
      if (d.shared) return left ? placeShared(d.shared) : sharedActions(d.shared);
      return;
    }
    case 'actions': {
      // A choice, or the slot it's about (back). Greyed-out slots do nothing; the center,
      // empty space and right-click go back. (In the colour menu the center is the Y.)
      if (left && hit?.center && S.actions?.colors) return toggleColorTarget(hubPart(p));
      const d = drawnAt(hit);
      // An option in Add / Adjust / Toggles: right-click it like one on the ring.
      if (right && d?.optId && d.act != null) return optionActions(d.optId);
      if (right || hit?.center) return cancelActions();
      if (d?.off) return;
      return chooseAction(d);
    }
    case 'place':
      if (right || hit?.center) return cancelPlace();
      updateGhost(p);
      return dropPlace();
    case 'pick-move':
    case 'pick-remove':
      // One slot after another; only Done in the center (or Esc) finishes.
      if (hit?.center) {
        clearToast();
        return setMode('options');
      }
      if (left && drawnAt(hit)?.back) {
        if (S.mode === 'pick-move') return startBackMove('pick-move');
        return toast(`<b>Back</b> can’t be removed${dot}<b>Move</b> can put it somewhere else`, 'error');
      }
      if (left && item) return S.mode === 'pick-move' ? pickMove(hit) : removeSlot(hit);
      return;
    case 'capture':
      if (left && S.capture?.target === 'slot' && S.capture.pick != null) return applySlotKey(keys[S.capture.pick].code, []);
      return cancelCapture();
    case 'size':
      if (hit?.center) return resizeSlots(p.x < 0 ? 1 / SLOT_STEP : SLOT_STEP);
      return setMode('options');
    case 'rotate': {
      if (hit?.center) return setMode('options');
      const ring = ringUnder(p);
      if (ring < 0) return setMode('options');
      S.turn = { ring, last: angleOf(p.x, p.y), moved: 0 };
      return draw();
    }
  }
});

// While recording a slot's key: scroll through every key, so you can assign
// keys your keyboard doesn't have.
document.addEventListener(
  'wheel',
  (ev) => {
    if (S.mode === 'rotate') {
      ev.preventDefault();
      const ring = ringUnder(eventToWheel(svg, ev, layout.size));
      if (ring < 0) return;
      turnRing(ring, (ev.deltaY > 0 ? 1 : -1) * (ev.shiftKey ? 1 : 5));
      scheduleSave();
      return;
    }
    if (S.mode === 'size') {
      // Scroll up = wider, down = narrower.
      ev.preventDefault();
      scrollAcc += ev.deltaY;
      if (Math.abs(scrollAcc) < 50) return;
      const steps = Math.max(1, Math.round(Math.abs(scrollAcc) / 100));
      resizeSlots(Math.pow(scrollAcc < 0 ? SLOT_STEP : 1 / SLOT_STEP, steps));
      scrollAcc = 0;
      return;
    }
    const c = S.capture;
    if (S.mode !== 'capture' || c?.target !== 'slot') return;
    ev.preventDefault();
    scrollAcc += ev.deltaY;
    if (Math.abs(scrollAcc) < 50) return;
    // One mouse-wheel notch = one key; a big trackpad swipe moves several.
    const steps = Math.sign(scrollAcc) * Math.max(1, Math.round(Math.abs(scrollAcc) / 100));
    scrollAcc = 0;
    const item = rings()[c.ring]?.items[c.index];
    const start = c.pick ?? Math.max(0, keys.findIndex((k) => k.code === item?.key));
    c.pick = (((start + steps) % keys.length) + keys.length) % keys.length;
    const k = keys[c.pick];
    setPrompt(`<b>${esc(k.name)}</b> <span class="dim">(${esc(k.group)})</span>${dot}<b>click</b> to use it${dot}scroll for more${dot}Esc to cancel`);
    draw();
  },
  { passive: false },
);

document.addEventListener(
  'keydown',
  (ev) => {
    if (S.naming) {
      // macOS: the wheel has focus while naming, so keys arrive here.
      ev.preventDefault();
      ev.stopPropagation();
      if (MODIFIER_CODES.has(ev.code)) return;
      const mods = [ev.ctrlKey && 'ctrl', ev.altKey && 'alt', ev.shiftKey && 'shift', ev.metaKey && 'meta'].filter(Boolean);
      return onNameKey(ev.code, mods, [...ev.key].length === 1 ? ev.key : null);
    }
    if (S.mode === 'capture') {
      ev.preventDefault();
      ev.stopPropagation();
      return onCaptureKey(ev);
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      handleEscape();
    }
    // Ctrl+Z / ⌘Z (Windows sends it from a global hotkey instead: the wheel has no focus).
    if (ev.code === 'KeyZ' && (mac ? ev.metaKey : ev.ctrlKey) && !ev.shiftKey && !ev.altKey) {
      ev.preventDefault();
      undo();
    }
  },
  true,
);

// Windows only reports Print Screen on key-up.
document.addEventListener(
  'keyup',
  (ev) => {
    if (S.mode === 'capture' && ev.code === 'PrintScreen') {
      ev.preventDefault();
      onCaptureKey(ev);
    }
  },
  true,
);

document.addEventListener('pointerup', () => {
  if (S.mode === 'rotate' && S.turn) {
    S.turn = null;
    save();
    draw();
  }
});

document.addEventListener('contextmenu', (ev) => ev.preventDefault());
for (const type of ['mouseup', 'auxclick']) {
  document.addEventListener(type, (ev) => {
    if (ev.button === 3 || ev.button === 4) ev.preventDefault();
  });
}

// ---------------------------------------------------------------------------
// Events from Rust
// ---------------------------------------------------------------------------
listen('radial-open', async (e) => {
  const { layout: l, hold, welcome, app, path, notice } = e.payload;
  layout = l;
  Object.assign(S, { mode: 'keys', holding: hold, visible: true, hover: null, capture: null, place: null, turn: null, hoverRing: -1, app: app || null, path: [], dwellBlock: false, dwellFirst: undefined, actions: null });
  // A sub-menu's own hotkey opens the wheel right inside that sub-menu (Rust already
  // sized the window for it).
  if (path?.length && menuAt(path)) S.path = path;
  layoutKey = layoutKeyFor(layout.rings);
  if (S.path.length) {
    trimRings();
    await ensureLayout();
  }
  loadAppIcon(S.app);
  loadBackground();
  Object.assign(msg, { toast: null, prompt: null, hint: null });
  setNotice(notice);
  applyLayout();
  draw();
  showMsg();
  svg.classList.remove('show');
  requestAnimationFrame(() => svg.classList.add('show'));

  if (welcome) {
    toast(
      `<b>Welcome to Radial Keys!</b> Open it anytime with <kbd>${esc(hotkeyText())}</kbd>: hold, point, release. Right-click anything to change it.`,
      'prompt',
      { ttl: 0, actions: [{ label: 'Got it', cls: 'primary', run: clearToast }] },
    );
  } else if (S.pendingError) {
    toast(esc(S.pendingError), 'error', { ttl: 6000 });
  }
  S.pendingError = null;

  msg.alert = null;
  if (mac && !(await invoke('accessibility_ok'))) {
    msg.alert = {
      html: 'Radial Keys needs <b>Accessibility</b> permission to press keys for you',
      kind: 'warn',
      actions: [{ label: 'Open Settings', cls: 'primary', run: () => invoke('open_accessibility_settings') }],
    };
  }
  showMsg();
});

// macOS: the page gets no mouse-moved events while the wheel isn't the key window (see
// watch_outside_clicks in lib.rs), so CSS :hover doesn't work on the message box's buttons either.
listen('radial-pointer', ({ payload: { x, y } }) => {
  if (!S.visible) return;
  onPointerMove({ clientX: x, clientY: y });
  const over = document.elementFromPoint(x, y)?.closest?.('button');
  for (const b of msgActions.children) b.classList.toggle('hover', b === over);
});

listen('radial-tap', () => {
  S.holding = false;
});

// Hotkey released after holding: send whatever the pointer is aiming at.
listen('radial-release', (e) => {
  S.holding = false;
  if (S.mode !== 'keys' || S.brush) return;
  const hit = hitTest(geo, drawn, e.payload.dx, e.payload.dy, true);
  if (drawnAt(hit)?.back) return goBack(); // wheel stays open: click from here
  const item = itemAt(hit);
  if (item?.menu) return openMenu(hit);
  if (item?.program) return launchItem(item);
  if (item) send(item);
  else close();
});

listen('radial-escape', handleEscape);
listen('radial-undo', () => undo());

// Windows: keys arrive from a keyboard hook, so the wheel never needs focus.
listen('radial-key', (e) => {
  if (S.naming) return onNameKey(e.payload.code, e.payload.mods, e.payload.text ?? null);
  if (S.mode === 'capture') onCaptureCode(e.payload.code, e.payload.mods);
});

listen('radial-capture-timeout', async () => {
  if (S.naming) {
    // Stopped listening: keep the name as it was.
    S.naming = null;
    setPrompt(null);
    draw();
    updateHint();
    return toast('Stopped listening for the name', 'warn');
  }
  if (S.mode !== 'capture') return;
  await cancelCapture();
  toast('Stopped listening for a key', 'warn');
});

// A preset from outside: the website's Get button, or a .rkpreset file opened from Finder /
// Explorer. Rust has opened the wheel for it.
listen('radial-import', (e) => getPreset(e.payload));

/** Import { url } (from the website) or { path } (a file), or { text, name } (a dropped file). */
async function getPreset(from) {
  if (from.url) toast('Getting the preset…', 'hint', { ttl: 0 });
  let r;
  try {
    if (from.url) r = await invoke('import_preset_url', { url: from.url });
    else if (from.path) r = await invoke('import_preset_file', { path: from.path });
    else r = await invoke('import_preset_text', { text: from.text, name: from.name });
  } catch (e) {
    return toast(esc(e), 'error', { ttl: 6000 });
  }
  clearToast();
  return afterImport(r);
}

// Drag a preset onto the wheel: the website's Get button (a link) or a .rkpreset file. While
// dragging, tap the hotkey to open the wheel, then drop.
const dragged = (e) => {
  const t = e.dataTransfer?.types ?? [];
  return t.includes('Files') || t.includes('text/uri-list') || t.includes('text/plain');
};
let dragDepth = 0;
const endDrag = () => {
  dragDepth = 0;
  svg.classList.remove('drop');
  setHint(null);
};
document.addEventListener('dragenter', (e) => {
  if (!dragged(e) || !S.visible) return;
  e.preventDefault();
  if (dragDepth++ === 0) {
    svg.classList.add('drop');
    setHint(`<b>Drop</b> to add this preset`);
  }
});
document.addEventListener('dragover', (e) => {
  if (!dragged(e) || !S.visible) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
document.addEventListener('dragleave', () => {
  if (dragDepth && --dragDepth === 0) endDrag();
});
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  endDrag();
  if (!S.visible || S.mode === 'capture' || S.naming) return;
  const file = e.dataTransfer.files?.[0];
  if (file) return getPreset({ text: await file.text(), name: file.name });
  const link = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain'))
    .split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
  if (link && /^https?:\/\//i.test(link)) return getPreset({ url: link });
  toast('That isn’t a Radial Keys preset', 'error', { ttl: 4000 });
});

// The update check found something new while the wheel is open (or it's gone).
listen('radial-notice', (e) => setNotice(e.payload));

listen('radial-error', (e) => {
  if (S.visible) toast(esc(e.payload), 'error', { ttl: 6000 });
  else S.pendingError = e.payload;
});

listen('radial-close', async () => {
  Object.assign(S, { visible: false, mode: 'keys', holding: false, capture: null, place: null, hover: null, path: [], naming: null, actions: null });
  dropBrush();
  clearTimeout(dwellTimer);
  svg.classList.remove('show');
  clearTimeout(toastTimer);
  Object.assign(msg, { toast: null, prompt: null, hint: null });
  showMsg();
  // Drop any half-finished edit (a slot being placed, a new slot with no key yet).
  config = await invoke('get_config');
  // Changed from outside (the file edited by hand): undo would bring back the old one.
  if (JSON.stringify(config) !== lastSaved) forgetHistory();
  tidyImages();
});

applyLayout();
draw();
loadBackground();
invoke('ready');
