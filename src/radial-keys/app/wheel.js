// Wheel geometry + SVG rendering.
//
// Angles are degrees clockwise from 12 o'clock. Every slot has its own center
// angle and width ("span"), so rings don't have to be full or evenly spaced.

const SVG_NS = 'http://www.w3.org/2000/svg';
const DEG = Math.PI / 180;
let captionSeq = 0; // unique ids for caption arcs

export function geometry(cfg, rings) {
  const r0 = cfg.innerRadius;
  const w = cfg.ringWidth;
  // Gaps off: slots, rings and the center touch (a thin edge line still shows between them).
  const gaps = cfg.gaps !== false;
  const gap = gaps ? cfg.ringGap : 0;
  const pitch = w + gap;
  const n = Math.max(rings, 1);
  return {
    r0, w, gap, pitch, rings: n,
    slotGap: gaps ? 4 : 0, // between slots in a ring
    hubR: gaps ? r0 - 4 : r0, // the center circle
    rIn: (i) => r0 + i * pitch,
    rOut: (i) => r0 + i * pitch + w,
    rMid: (i) => r0 + i * pitch + w / 2,
    outer: r0 + n * w + (n - 1) * gap,
  };
}

/** 0..360, clockwise from the top. */
export function angleOf(dx, dy) {
  return ((Math.atan2(dx, -dy) / DEG) % 360 + 360) % 360;
}

/** Smallest distance between two angles. */
export function angDist(a, b) {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/** Ring index at distance d (may be >= number of rings), or -1 in the center. */
export function ringAt(g, d) {
  if (d < g.r0) return -1;
  return Math.floor((d - g.r0) / g.pitch);
}

const norm360 = (a) => ((a % 360) + 360) % 360;
/** Signed angle a - b in (-180, 180]. */
const offset = (a, b) => {
  const d = norm360(a - b);
  return d > 180 ? d - 360 : d;
};

/**
 * Make room for a slot of `span` at `angle` in a ring of `slots`.
 *
 * - Free space under the pointer: the slot goes exactly there (no snapping).
 * - Over taken slots: it goes into the gap between the two slots around the pointer,
 *   and the others make room by shifting (whichever way moves them least) or, if the
 *   ring would hold more than 360°, by all shrinking a little. The result depends
 *   only on *which* gap you're over, so the ring never drifts while you move.
 *
 * Returns adjusted copies of `slots`, the new slot's span and its center angle.
 */
export function makeRoom(slots, angle, span) {
  const n = slots.length;
  if (!n) return { slots: [], span: Math.min(span, 360), angle: norm360(angle) };
  const total = slots.reduce((a, s) => a + s.span, 0) + span;
  const k = total > 360 ? 360 / total : 1;
  const ins = span * k;
  const sorted = slots
    .map((s, i) => ({ i, angle: norm360(s.angle), span: s.span * k }))
    .sort((a, b) => a.angle - b.angle);

  // The neighbours the pointer is between (center to center), as unwrapped angles.
  let A = sorted[n - 1], B = sorted[0], aC = 0, bC = 0, p = 0;
  for (let j = 0; j < n; j++) {
    const a = sorted[j], b = sorted[(j + 1) % n];
    const d = n === 1 ? 360 : norm360(b.angle - a.angle) || 360;
    const q = a.angle + norm360(angle - a.angle);
    if (q < a.angle + d) {
      A = a; B = b; aC = a.angle; bC = a.angle + d; p = q;
      break;
    }
  }
  const gapStart = aC + A.span / 2;
  const gapEnd = bC - B.span / 2;

  // Room right here: exact placement.
  if (k === 1 && gapEnd - gapStart >= ins - 1e-6 && p >= gapStart && p <= gapEnd) {
    const c = Math.min(Math.max(p, gapStart + ins / 2), gapEnd - ins / 2);
    return { slots: slots.map((s) => ({ ...s })), span: ins, angle: norm360(c) };
  }

  // Taken: insert between A and B. Work in offsets from the middle of their gap.
  const mid = (gapStart + gapEnd) / 2;
  const items = sorted.map((it) => ({ ...it, off: offset(it.angle, mid), pos: 0 }));
  const aEnd = gapStart - mid; // A's right edge
  const bStart = gapEnd - mid; // B's left edge

  const layout = (g0, g1) => {
    const right = items.filter((it) => it.off >= 0).sort((x, y) => x.off - y.off);
    const left = items.filter((it) => it.off < 0).sort((x, y) => y.off - x.off);
    const pos = new Map();
    let cur = g1;
    for (const it of right) {
      const start = Math.max(it.off - it.span / 2, cur);
      pos.set(it, start + it.span / 2);
      cur = start + it.span;
    }
    const rightEnd = cur;
    cur = g0;
    for (const it of left) {
      const end = Math.min(it.off + it.span / 2, cur);
      pos.set(it, end - it.span / 2);
      cur = end - it.span;
    }
    if (rightEnd - cur > 360 + 1e-6) return null; // pushed chains collide behind
    let cost = 0;
    for (const it of items) cost += Math.abs(pos.get(it) - it.off);
    return { pos, cost, ghost: (g0 + g1) / 2 };
  };

  // Push only clockwise (A stays), only counter-clockwise (B stays), or both ways.
  const options = [layout(aEnd, aEnd + ins), layout(bStart - ins, bStart), layout(-ins / 2, ins / 2)].filter(Boolean);
  let best = options.sort((x, y) => x.cost - y.cost)[0];

  if (!best) {
    // Full ring: pack in order from the gap, then turn so slots move as little as possible.
    const right = items.filter((it) => it.off >= 0).sort((x, y) => x.off - y.off);
    const left = items.filter((it) => it.off < 0).sort((x, y) => y.off - x.off);
    const seq = [...right, ...left.slice().reverse()];
    const pos = new Map();
    let c = ins / 2;
    for (const it of seq) {
      pos.set(it, c + it.span / 2);
      c += it.span;
    }
    const shift = seq.reduce((a, it) => a + ((it.off < 0 ? it.off + 360 : it.off) - pos.get(it)), 0) / seq.length;
    for (const it of seq) pos.set(it, pos.get(it) + shift);
    best = { pos, ghost: shift };
  }

  const out = slots.map((s) => ({ ...s }));
  for (const it of items) {
    out[it.i].angle = norm360(mid + best.pos.get(it));
    out[it.i].span = it.span;
  }
  return { slots: out, span: ins, angle: norm360(mid + best.ghost) };
}

/** Remove overlaps in a ring (after slots got wider), moving slots as little as possible. */
export function resolveRing(slots) {
  if (slots.length < 2) return slots.map((s) => ({ ...s, span: Math.min(s.span, 360) }));
  const total = slots.reduce((a, s) => a + s.span, 0);
  const k = total > 360 ? 360 / total : 1;
  const items = slots.map((s) => ({ ...s, span: s.span * k })).sort((a, b) => norm360(a.angle) - norm360(b.angle));
  // Start right after the biggest gap so clusters don't get split.
  let startIdx = 0;
  let biggest = -Infinity;
  items.forEach((it, i) => {
    const next = items[(i + 1) % items.length];
    let dist = norm360(next.angle - it.angle);
    if (i === items.length - 1 && dist === 0) dist = 360;
    const gap = dist - (it.span + next.span) / 2; // negative = overlapping
    if (gap > biggest) {
      biggest = gap;
      startIdx = (i + 1) % items.length;
    }
  });
  const ordered = [...items.slice(startIdx), ...items.slice(0, startIdx)];
  const first = ordered[0].angle;
  const base = first - ordered[0].span / 2;
  let cur = base;
  for (const it of ordered) {
    // Clockwise distance from the first slot's center keeps the order intact.
    const center = first + norm360(it.angle - first);
    const start = Math.max(center - it.span / 2, cur);
    it.angle = norm360(start + it.span / 2);
    cur = start + it.span;
  }
  if (cur - base > 360 + 1e-6) {
    let c = base;
    for (const it of ordered) {
      it.angle = norm360(c + it.span / 2);
      c += it.span;
    }
  }
  return ordered;
}

// --- Icons (24×24, stroked) ------------------------------------------------------
// Each icon: list of path strings; "c:x,y,r" draws a circle.
export const ICONS = {
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  launch: ['M14 4h6v6', 'M20 4l-8.5 8.5', 'M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10'],
  folder: ['M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z'],
  app: ['M3 5h18v14H3z', 'M3 9h18', 'c:6,7,0.6', 'c:8.5,7,0.6'],
  image: ['M4 5h16v14H4z', 'M4 16l5-5 4 4 2.5-2.5L20 16', 'c:15.5,9,1.6'],
  rotate: ['M20 11a8 8 0 1 0-2.3 5.7', 'M20 4v7h-7'],
  move: ['M12 3v18', 'M3 12h18', 'M9 6l3-3 3 3', 'M9 18l3 3 3-3', 'M6 9l-3 3 3 3', 'M18 9l3 3-3 3'],
  trash: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'],
  slotNarrow: ['M12 4v16', 'M3 12h5', 'M16 12h5', 'M5 9l3 3-3 3', 'M19 9l-3 3 3 3'],
  slotWide: ['M3 12h18', 'M7 8l-4 4 4 4', 'M17 8l4 4-4 4', 'M12 8v8'],
  bigger: ['M15 3h6v6', 'M9 21H3v-6', 'M21 3l-7 7', 'M3 21l7-7'],
  smaller: ['M4 14h6v6', 'M20 10h-6V4', 'M14 10l7-7', 'M3 21l7-7'],
  moon: ['M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z'],
  sun: ['c:12,12,4', 'M12 2v2', 'M12 20v2', 'M4.9 4.9l1.4 1.4', 'M17.7 17.7l1.4 1.4', 'M2 12h2', 'M20 12h2', 'M4.9 19.1l1.4-1.4', 'M17.7 6.3l1.4-1.4'],
  glass: ['M12 3c-3.5 4.6-6 8-6 11a6 6 0 0 0 12 0c0-3-2.5-6.4-6-11z', 'M9 14.5a3 3 0 0 0 3 3'],
  timer: ['c:12,13,8', 'M12 9v4l2.5 2', 'M10 2h4'],
  power: ['M12 3v8', 'M6.3 6.8a8 8 0 1 0 11.4 0'],
  reset: ['M3 12a9 9 0 1 0 2.6-6.4', 'M3 4v5h5'],
  quit: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
  check: ['M5 12.5l4.5 4.5L19 7'],
  x: ['M6 6l12 12', 'M18 6L6 18'],
  back: ['M15 6l-6 6 6 6'],
  presets: ['M12 2.5L2.5 7.5l9.5 5 9.5-5z', 'M2.5 12l9.5 5 9.5-5', 'M2.5 16.5l9.5 5 9.5-5'],
  save: ['M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z', 'M17 21v-8H7v8', 'M7 3v5h8'],
  import: ['M12 3v12', 'M7 10l5 5 5-5', 'M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4'],
  saveNew: ['M13 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8', 'M17 21v-8H7v8', 'M7 3v5h6', 'M19 1.5v7', 'M15.5 5h7'],
  look: ['M12 3a9 9 0 0 0 0 18c1.1 0 1.9-.8 1.9-1.8 0-.5-.2-.9-.5-1.2-.3-.4-.5-.8-.5-1.3 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z', 'c:7.5,11.5,1.2', 'c:10,7.2,1.2', 'c:15,7.6,1.2'],
  link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
  labels: ['M3 6h11', 'M8.5 6v13', 'M14 11h7', 'M17.5 11v8'],
  adjust: ['M4 6h9', 'M17 6h3', 'c:15,6,2', 'M4 12h3', 'M11 12h9', 'c:9,12,2', 'M4 18h11', 'M19 18h1', 'c:17,18,2'],
  toggles: ['M8 7h8a5 5 0 0 1 0 10H8A5 5 0 0 1 8 7z', 'c:16,12,2.5'],
  // Right-click actions.
  rename: ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'],
  key: ['M3 7h18v10H3z', 'c:7,10.5,0.7', 'c:10.3,10.5,0.7', 'c:13.7,10.5,0.7', 'c:17,10.5,0.7', 'M7.5 14h9'],
  copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
  export: ['M12 15V3', 'M7 8l5-5 5 5', 'M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4'],
  swap: ['M7 4L3 8l4 4', 'M3 8h14', 'M17 12l4 4-4 4', 'M21 16H7'],
  expand: ['M4 9V4h5', 'M15 4h5v5', 'M20 15v5h-5', 'M9 20H4v-5'],
  shrink: ['M9 4v5H4', 'M15 4v5h5', 'M15 20v-5h5', 'M9 20v-5H4'],
  gaps: ['M3 4h7.5v7H3z', 'M13.5 4H21v7h-7.5z', 'M3 13h7.5v7H3z', 'M13.5 13H21v7h-7.5z'],
};

function drawIcon(parent, name, cx, cy, size, cls = 'icon') {
  const shapes = ICONS[name];
  if (!shapes) return;
  const s = size / 24;
  const g = el('g', { class: cls, transform: `translate(${f(cx - size / 2)} ${f(cy - size / 2)}) scale(${f(s * 1000) / 1000})` }, parent);
  for (const sh of shapes) {
    if (sh.startsWith('c:')) {
      const [x, y, r] = sh.slice(2).split(',').map(Number);
      el('circle', { cx: x, cy: y, r }, g);
    } else {
      el('path', { d: sh }, g);
    }
  }
}

/**
 * What's at (dx, dy) from the center?
 * Returns { center: true }, { ring, index }, or null (empty space).
 * extendOuter: past the last ring still counts as the last ring (hold-to-select flicks).
 */
export function hitTest(g, rings, dx, dy, extendOuter = false) {
  const d = Math.hypot(dx, dy);
  let ring = ringAt(g, d);
  if (ring < 0) return { center: true };
  if (!rings.length) return null;
  if (ring >= rings.length) {
    if (!extendOuter && d > g.outer + 10) return null;
    ring = rings.length - 1;
  }
  const theta = angleOf(dx, dy);
  const slots = rings[ring] || [];
  let best = null;
  slots.forEach((s, index) => {
    const dist = angDist(theta, s.angle);
    if (dist <= s.span / 2 && (!best || dist < best.dist)) best = { ring, index, dist };
  });
  return best && { ring: best.ring, index: best.index };
}

function polar(r, deg) {
  return [r * Math.sin(deg * DEG), -r * Math.cos(deg * DEG)];
}

const f = (n) => Math.round(n * 100) / 100;

/** Annular sector with a constant-width gap to its neighbours. */
export function slicePath(rIn, rOut, center, span, gap = 4) {
  if (span >= 359.9) {
    return [
      `M 0 ${-rOut} A ${rOut} ${rOut} 0 1 1 0 ${rOut} A ${rOut} ${rOut} 0 1 1 0 ${-rOut} Z`,
      `M 0 ${-rIn} A ${rIn} ${rIn} 0 1 0 0 ${rIn} A ${rIn} ${rIn} 0 1 0 0 ${-rIn} Z`,
    ].join(' ');
  }
  const a0 = center - span / 2;
  const a1 = center + span / 2;
  const padOut = (gap / 2 / rOut) / DEG;
  const padIn = (gap / 2 / rIn) / DEG;
  const o0 = a0 + padOut, o1 = a1 - padOut;
  const i0 = a0 + padIn, i1 = a1 - padIn;
  const large = o1 - o0 > 180 ? 1 : 0;
  const [x1, y1] = polar(rOut, o0);
  const [x2, y2] = polar(rOut, o1);
  const [x3, y3] = polar(rIn, i1);
  const [x4, y4] = polar(rIn, i0);
  return `M ${f(x1)} ${f(y1)} A ${rOut} ${rOut} 0 ${large} 1 ${f(x2)} ${f(y2)} ` +
    `L ${f(x3)} ${f(y3)} A ${rIn} ${rIn} 0 ${large} 0 ${f(x4)} ${f(y4)} Z`;
}

function el(tag, attrs = {}, parent) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

function fitFont(text, maxWidth, maxSize, minSize = 8) {
  const len = Math.max(1, [...text].length);
  return Math.max(minSize, Math.min(maxSize, maxWidth / (len * 0.6)));
}

const measurer = document.createElement('canvas').getContext('2d');
/** Width of `text` in the wheel's font. */
function textWidth(text, size, weight) {
  measurer.font = `${weight} ${size}px ${getComputedStyle(document.body).fontFamily}`;
  return measurer.measureText(text).width;
}

/** `text` as it is if it fits `width`, otherwise cut short with "…". */
function ellipsize(text, width, size, weight) {
  if (textWidth(text, size, weight) <= width) return text;
  const chars = [...text];
  let lo = 0, hi = chars.length - 1; // longest start that still fits with the "…"
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (textWidth(`${chars.slice(0, mid).join('').trimEnd()}…`, size, weight) <= width) lo = mid;
    else hi = mid - 1;
  }
  return `${chars.slice(0, lo).join('').trimEnd()}…`;
}

/** The largest size up to `max` that fits `text` in `width`, never under `min`. */
function fitSize(text, width, max, min, weight) {
  // (A hair under: text widths don't scale exactly with size, and this shouldn't then cut it short.)
  return Math.max(min, Math.min(max, (max * width * 0.97) / Math.max(1, textWidth(text, max, weight))));
}

/** Text along the circle of radius `r`, centered on `angle`, running `half` degrees to each side. */
function arcText(node, r, angle, half, text, attrs) {
  const h = Math.min(half, 179.5);
  // Bottom half: run the arc the other way so the text isn't upside down.
  const flip = isBottom(angle);
  const large = h > 90 ? 1 : 0;
  const [x0, y0] = polar(r, angle - h);
  const [x1, y1] = polar(r, angle + h);
  const d = flip
    ? `M ${f(x1)} ${f(y1)} A ${f(r)} ${f(r)} 0 ${large} 0 ${f(x0)} ${f(y0)}`
    : `M ${f(x0)} ${f(y0)} A ${f(r)} ${f(r)} 0 ${large} 1 ${f(x1)} ${f(y1)}`;
  const id = `cap-${++captionSeq}`;
  el('path', { id, d, class: 'caption-path' }, node);
  const t = el('text', attrs, node);
  const tp = el('textPath', { href: `#${id}`, startOffset: '50%' }, t);
  tp.textContent = text;
  return t;
}

const isBottom = (angle) => {
  const a = norm360(angle);
  return a > 90 && a < 270;
};

/**
 * One-word caption on the inner side of a slot (nearest the center), curved along the ring.
 * Returns its size. `s.captionOptional` (a word that may not fit a narrow slot): on the outer
 * side if there's more room there, and left out (returns 0) if it doesn't fit there either.
 * The caption's side ends up in `s.captionOuter`. Too long for the slot even at `s.captionMin`
 * (the smallest it may get): cut short with "…".
 */
function drawCaption(node, g, rIn, s) {
  const capSize = Math.max(6.5, Math.min(g.w * 0.14, 10.5));
  let rCap = rIn + capSize * 0.95;
  const room = (r) => r * Math.max(4, s.span / 2 - (3 / r) / DEG) * 2 * DEG;
  const fit = (r) => room(r) / Math.max(1, s.caption.length * 0.6);
  if (s.captionOptional && fit(rCap) < Math.min(capSize, 7.5)) {
    const rOuter = rIn + g.w - capSize * 0.95;
    if (fit(rOuter) < 6) return 0;
    rCap = rOuter;
    s.captionOuter = true;
  }
  const half = Math.max(4, s.span / 2 - (3 / rCap) / DEG); // degrees, minus a little padding
  const width = room(rCap) / 1.03; // the caption's letter spacing
  const fsCap = fitSize(s.caption, width, capSize, s.captionMin ?? 5.5, 650);
  arcText(node, rCap, s.angle, half, ellipsize(s.caption, width, fsCap, 650), { class: 'caption', 'font-size': f(fsCap) });
  return capSize;
}

/** Bounding box of a ring sector (for a picture that covers the whole slot). */
function sectorBox(rIn, rOut, center, span) {
  if (span >= 359.9) return { x: -rOut, y: -rOut, w: 2 * rOut, h: 2 * rOut };
  const a0 = center - span / 2;
  const a1 = center + span / 2;
  const angles = [a0, a1];
  for (let a = Math.ceil(a0 / 90) * 90; a < a1; a += 90) angles.push(a); // arc passes an axis
  const pts = angles.flatMap((a) => [polar(rIn, a), polar(rOut, a)]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/**
 * A small mark in the slot's outer corner: a chain link (it shows a reusable menu).
 * `side`: 1 = clockwise end, -1 = the other.
 */
function drawCornerMark(node, g, ring, s, icon, side) {
  const size = Math.max(9, Math.min(g.w * 0.2, 13));
  const r = g.rOut(ring) - size * 0.75;
  // Toward the slot's clockwise edge, clear of the picture / icon in the middle.
  const room = Math.max(0, s.span / 2 - ((size * 0.75) / r) / DEG);
  const [x, y] = polar(r, s.angle + side * Math.min(room, s.span * 0.32));
  const m = el('g', { class: 'link-mark' }, node);
  el('circle', { cx: f(x), cy: f(y), r: f(size * 0.62) }, m);
  drawIcon(m, icon, x, y, size * 0.8);
}

function drawSlot(parent, g, ring, s, extraClass = '') {
  const rIn = g.rIn(ring), rOut = g.rOut(ring), rMid = g.rMid(ring);
  const node = el('g', { class: `slice ${s.cls || ''} ${extraClass}`.trim() }, parent);
  // Its own colours: they override the wheel's colour variables, for this slot only.
  for (const [k, v] of Object.entries(s.vars ?? {})) node.style.setProperty(k, v);
  const finish = () => {
    if (s.linked) drawCornerMark(node, g, ring, s, 'link', 1);
    return node;
  };
  const path = el('path', { d: slicePath(rIn, rOut, s.angle, s.span, g.slotGap), 'fill-rule': 'evenodd' }, node);
  if (s.fill) path.style.fill = s.fill;
  // Tint: a see-through colour over the slot and the background picture under it (a
  // picture filling the slot gets its own, above it).
  if (!(s.picture && s.cover)) {
    el('path', { d: path.getAttribute('d'), 'fill-rule': 'evenodd', class: 'tint-fill' }, el('g', { class: 'tint' }, node));
  }

  const label = s.label ?? '';
  const sub = s.sub ?? '';
  const full = s.span >= 359.9;
  // Text follows the slot's size: narrow slots get smaller text.
  const arc = full ? 2 * Math.PI * rMid : rMid * s.span * DEG;
  const fs = fitFont(label, Math.max(arc - 7, 6), Math.min(g.w * 0.36, 24), 6.5);
  const [tx, ty] = full ? [0, -rMid] : polar(rMid, s.angle);
  if (s.marks) {
    const fsM = Math.max(8, Math.min(arc * 0.3, g.w * 0.22, 13));
    const t = el('text', { x: f(tx), y: f(ty), 'font-size': f(fsM), class: 'marks', fill: s.markColor || '#fff' }, node);
    t.textContent = s.marks;
  }
  if (s.picture && s.cover) {
    // The picture fills the whole slot (cropped to its shape); the caption sits on top.
    node.classList.add('covered');
    const id = `slot-clip-${++captionSeq}`;
    const clip = el('clipPath', { id }, el('defs', {}, node));
    el('path', { d: path.getAttribute('d'), 'fill-rule': 'evenodd' }, clip);
    const b = sectorBox(rIn, rOut, s.angle, s.span);
    // In their own group, so the slot-shading rules (".slice > path", every other ring
    // darker...) can't paint over the picture.
    const cover = el('g', { class: 'cover' }, node);
    el('image', {
      href: s.picture, x: f(b.x), y: f(b.y), width: f(b.w), height: f(b.h),
      preserveAspectRatio: 'xMidYMid slice', 'clip-path': `url(#${id})`, class: 'cover-image',
    }, cover);
    el('path', { d: path.getAttribute('d'), 'fill-rule': 'evenodd', class: 'tint-fill' }, cover);
    // Outline / hover tint above the picture.
    el('path', { d: path.getAttribute('d'), 'fill-rule': 'evenodd', class: 'cover-edge' }, cover);
    if (s.caption) drawCaption(node, g, rIn, s);
    return finish();
  }
  if (s.icon || s.picture) {
    let size = Math.max(10, Math.min(arc * 0.6, g.w * 0.42, 26));
    // Pictures (program icons, your own .ico) get most of the slot.
    if (s.picture) size = Math.max(14, Math.min(arc * 0.9, g.w * 0.9, 56));
    let rIcon = rMid;
    if (s.caption) {
      const capSize = drawCaption(node, g, rIn, s);
      if (capSize && s.captionOuter) {
        // Caption on the outer side: the icon sits in the band inside it.
        const bandOut = rOut - capSize * 1.7;
        size = Math.max(10, Math.min(size, bandOut - rIn - 2));
        rIcon = (rIn + bandOut) / 2;
      } else if (capSize) {
        // Make room: the icon sits in the band between the caption and the outer edge.
        const bandIn = rIn + capSize * 1.7;
        size = Math.max(10, Math.min(size, rOut - bandIn - 2));
        rIcon = s.picture ? (bandIn + rOut) / 2 : Math.min(Math.max(rMid, bandIn + size / 2), rOut - size / 2 - 2);
      }
    }
    const [ix, iy] = polar(rIcon, s.angle);
    if (s.picture) {
      el('image', { href: s.picture, x: f(ix - size / 2), y: f(iy - size / 2), width: f(size), height: f(size), class: 'slot-picture', preserveAspectRatio: 'xMidYMid meet' }, node);
    } else {
      drawIcon(node, s.icon, ix, iy, size);
    }
    if (s.badge) {
      // On/off dot beside the icon (filled = on), along the ring so it never hits the caption.
      const [bx, by] = polar(rIcon, s.angle + ((size * 0.62) / rIcon) / DEG);
      el('circle', { cx: f(bx), cy: f(by), r: f(Math.max(2, size * 0.11)), class: `badge ${s.badge}` }, node);
    }
    return finish();
  }
  // A slot can bring its own text colour (presets show their own accent on their own fill).
  const ink = (t) => {
    if (!s.color) return;
    t.style.fill = s.color;
    t.style.stroke = s.outline || 'transparent';
  };
  if (s.curved) {
    // A name (preset, renamed key): follows the ring like a caption, never tiny, cut short with
    // "…" if it's too long (the message box says the full name). `sub` goes above it.
    const half = Math.max(4, s.span / 2 - (5 / rMid) / DEG);
    const widthAt = (r) => r * half * 2 * DEG;
    const size = fitSize(label || '…', widthAt(rMid), Math.min(g.w * 0.24, 13), 9.5, 600);
    const up = isBottom(s.angle) ? -1 : 1; // which way is "above" on screen, along the radius
    const rName = sub ? rMid - up * size * 0.45 : rMid;
    if (label) {
      ink(arcText(node, rName, s.angle, half, ellipsize(label, widthAt(rName), size, 600), { class: 'label', 'font-size': f(size) }));
    }
    if (sub) {
      const subSize = Math.max(7.5, size * 0.72);
      const rSub = rMid + up * size * 0.7;
      ink(arcText(node, rSub, s.angle, half, ellipsize(sub, widthAt(rSub), subSize, 600), { class: 'sub', 'font-size': f(subSize) }));
    }
    return finish();
  }
  if (label) {
    const t = el('text', { x: f(tx), y: f(ty + (sub ? fs * 0.34 : 0)), 'font-size': f(fs), class: 'label' }, node);
    t.textContent = label;
    ink(t);
  }
  if (sub) {
    const ss = fitFont(sub, Math.max(arc - 6, 6), Math.min(fs * 0.62, 12), 6);
    const t = el('text', { x: f(tx), y: f(ty - (label ? fs * 0.6 : 0)), 'font-size': f(ss), class: 'sub' }, node);
    t.textContent = sub;
    ink(t);
  }
  return finish();
}

/**
 * Draw a wheel.
 *  rings: [[{ angle, span, label, sub, cls, fill }]]
 *  hub:   { top, main, version, bottom }
 *  opts:  { guides: number of rings to outline even when empty }
 */
export function render(svg, g, size, rings, hub, opts = {}) {
  svg.innerHTML = '';
  svg.setAttribute('viewBox', `${-size / 2} ${-size / 2} ${size} ${size}`);
  const root = el('g', { class: 'wheel-root' }, svg);

  // Diagonal stripes for "transparent": a light and a dark one, to show on anything.
  const hatch = el('pattern', { id: 'clear-hatch', width: 7, height: 7, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, el('defs', {}, root));
  el('rect', { width: 2, height: 7, fill: 'rgba(255, 255, 255, 0.85)' }, hatch);
  el('rect', { x: 3.5, width: 2, height: 7, fill: 'rgba(0, 0, 0, 0.6)' }, hatch);

  // Only slots are drawn: the empty part of a ring stays invisible. While placing a
  // slot, a thin dashed line marks where a new (still empty) ring would go.
  for (let i = 0; i < (opts.guides ?? 0); i++) {
    if (!rings[i]?.length) el('circle', { r: g.rMid(i), class: 'ring-guide' }, root);
  }

  // One picture for the whole wheel, cut up by the slot shapes.
  svg.classList.toggle('has-bg', !!opts.background);
  if (opts.background) {
    const defs = el('defs', {}, root);
    const clip = el('clipPath', { id: 'slots-clip' }, defs);
    rings.forEach((slots, ri) => {
      for (const s of slots) {
        if (!s.off) el('path', { d: slicePath(g.rIn(ri), g.rOut(ri), s.angle, s.span, g.slotGap), 'fill-rule': 'evenodd' }, clip);
      }
    });
    if (opts.bgHub) el('circle', { r: g.hubR }, clip);
    const R = g.outer;
    el('image', {
      href: opts.background, x: f(-R), y: f(-R), width: f(2 * R), height: f(2 * R),
      preserveAspectRatio: 'xMidYMid slice', 'clip-path': 'url(#slots-clip)', class: 'bg-image',
    }, root);
  }

  // A gap colour: drawn only in the gaps around each slot (so see-through slots stay clear).
  if (opts.gapFill && g.slotGap) {
    const layer = el('g', { class: 'gap-layer' }, root);
    const half = g.gap / 2;
    rings.forEach((slots, ri) => {
      const rIn = ri === 0 ? g.hubR : g.rIn(ri) - half;
      const rOut = ri === rings.length - 1 ? g.rOut(ri) : g.rOut(ri) + half;
      for (const s of slots) {
        const d = `${slicePath(rIn, rOut, s.angle, s.span, 0)} ${slicePath(g.rIn(ri), g.rOut(ri), s.angle, s.span, g.slotGap)}`;
        el('path', { d, 'fill-rule': 'evenodd', class: 'gap-fill' }, layer);
      }
    });
  }

  const nodes = rings.map((slots, ri) => {
    const hl = opts.highlightRing === ri ? ' ring-hl' : '';
    const ringG = el('g', { class: `ring ring-${ri}${hl}` }, root);
    return slots.map((s) => drawSlot(ringG, g, ri, s));
  });

  const ghostLayer = el('g', { class: 'ghost-layer' }, root);

  const hubG = el('g', { class: `hub${hub.image ? ' has-image' : ''}` }, root);
  for (const [k, v] of Object.entries(opts.hubVars ?? {})) hubG.style.setProperty(k, v);
  el('circle', { r: g.hubR, class: 'hub-bg' }, hubG);
  if (hub.image) {
    // The target app's icon fills the whole center, with a scrim so the text stays readable.
    const r = g.hubR;
    const defs = el('defs', {}, hubG);
    const clip = el('clipPath', { id: 'hub-clip' }, defs);
    el('circle', { r }, clip);
    const s = r * (hub.imageZoom ?? 2.3); // icons have padding: zoom in so the artwork covers the circle
    el('image', { href: hub.image, x: f(-s / 2), y: f(-s / 2), width: f(s), height: f(s), 'clip-path': 'url(#hub-clip)', preserveAspectRatio: 'xMidYMid slice', class: 'hub-image' }, hubG);
    el('circle', { r, class: 'hub-scrim' }, hubG);
  }
  // A tint over it all (a right-click menu's center takes the slot's).
  el('circle', { r: g.hubR, class: 'hub-tint' }, hubG);
  const maxW = (g.r0 - 10) * 2;
  const halves = {};
  if (hub.halves) {
    // Two buttons side by side: hub.halves = { left: {...}, right: {...} }
    const r = g.hubR;
    for (const side of ['left', 'right']) {
      const h = hub.halves[side];
      const sign = side === 'left' ? -1 : 1;
      const node = el('g', { class: `hub-half${h.selected ? ' selected' : ''}` }, hubG);
      const d = side === 'left' ? `M -2 ${-r} A ${r} ${r} 0 0 0 -2 ${r} Z` : `M 2 ${-r} A ${r} ${r} 0 0 1 2 ${r} Z`;
      el('path', { d }, node);
      const cx = (sign * r) / 2;
      const cy = h.label ? -r * 0.12 : 0;
      if (h.swatch) el('circle', { cx: f(cx), cy: f(cy), r: f(r * 0.24), class: 'hub-swatch', fill: h.swatch }, node);
      if (h.icon) drawIcon(node, h.icon, cx, cy, Math.min(24, r * 0.5));
      if (h.label) {
        const t = el('text', { x: f(cx), y: f(r * 0.34), class: 'hub-half-label', 'font-size': f(fitFont(h.label, r * 0.85, 10, 7)) }, node);
        t.textContent = h.label;
      }
      halves[side] = node;
    }
  }
  if (hub.pie) {
    // Three buttons in a Y, like pie slices: hub.pie = [{ id, from, to, swatch, label, selected }]
    // (angles clockwise from 12 o'clock). They're hit as { center, half: id }.
    const r = g.hubR;
    const gap = 2.5;
    for (const part of hub.pie) {
      const mid = (part.from + part.to) / 2;
      const half = ((part.to - part.from) / 2) * DEG;
      const apex = gap / Math.sin(half);
      const d0 = (gap / r) / DEG;
      const [ax, ay] = polar(apex, mid);
      const [x0, y0] = polar(r, part.from + d0);
      const [x1, y1] = polar(r, part.to - d0);
      const node = el('g', { class: `hub-half pie${part.selected ? ' selected' : ''}` }, hubG);
      el('path', { d: `M ${f(ax)} ${f(ay)} L ${f(x0)} ${f(y0)} A ${f(r)} ${f(r)} 0 0 1 ${f(x1)} ${f(y1)} Z` }, node);
      const [cx, cy] = polar(r * 0.5, mid);
      const sw = r * 0.2;
      const sy = part.label ? cy - r * 0.08 : cy;
      if (part.swatch === 'transparent') {
        el('circle', { cx: f(cx), cy: f(sy), r: f(sw), class: 'hub-swatch', fill: 'url(#clear-hatch)' }, node);
      } else if (part.swatch) {
        el('circle', { cx: f(cx), cy: f(sy), r: f(sw), class: 'hub-swatch', fill: part.swatch }, node);
      }
      if (part.label) {
        const t = el('text', { x: f(cx), y: f(sy + sw + r * 0.14), class: 'hub-half-label', 'font-size': f(fitFont(part.label, r * 0.7, 9.5, 6.5)) }, node);
        t.textContent = part.label;
      }
      halves[part.id] = node;
    }
    // The Y itself, on top of the parts.
    for (const cls of ['hub-y-halo', 'hub-y']) {
      for (const part of hub.pie) {
        const [x, y] = polar(r, part.from);
        el('line', { x1: 0, y1: 0, x2: f(x), y2: f(y), class: cls }, hubG);
      }
    }
  }
  if (hub.icon) {
    drawIcon(hubG, hub.icon, 0, hub.bottom ? -6 : 0, Math.min(26, g.r0 * 0.55), 'icon hub-icon');
  }
  if (hub.top) {
    const fsTop = fitFont(hub.top, maxW, 9.5);
    const t = el('text', { y: -16, class: 'hub-top', 'font-size': f(fsTop) }, hubG);
    t.textContent = ellipsize(hub.top, maxW * 0.8, fsTop, 700); // (0.8: it may be in spaced capitals)
  }
  if (hub.main) {
    const fsMain = fitFont(hub.main, maxW, 15, 8);
    const t = el('text', { y: hub.top ? 2 : 0, class: 'hub-main', 'font-size': f(fsMain) }, hubG);
    t.textContent = ellipsize(hub.main, maxW, fsMain, 700);
  }
  // The app's version, small, right under the hotkey; the bottom line moves down for it.
  // In a small center there's room for one of the two: the version wins.
  const room = g.hubR;
  let bottomY = hub.icon ? 16 : 20;
  if (hub.version) {
    const y = (hub.top ? 2 : 0) + 16;
    const t = el('text', { y, class: 'hub-version', 'font-size': f(fitFont(hub.version, maxW - 10, 11.5, 8)) }, hubG);
    t.textContent = hub.version;
    bottomY = y + 13;
  }
  if (hub.bottom && bottomY + 5 < room) {
    const t = el('text', { y: bottomY, class: 'hub-bottom', 'font-size': f(fitFont(hub.bottom, maxW - 6, 9)) }, hubG);
    t.textContent = hub.bottom;
  }

  let active = null;
  const same = (a, b) => a === b || (a && b && a.center === b.center && a.half === b.half && a.ring === b.ring && a.index === b.index);
  const nodeOf = (hit) => (hit?.center ? (hit.half ? halves[hit.half] : hubG) : nodes[hit?.ring]?.[hit?.index]);

  return {
    setActive(hit) {
      if (same(active, hit)) return;
      nodeOf(active)?.classList.remove('active');
      active = hit;
      nodeOf(hit)?.classList.add('active');
    },
    mark(hit, cls) {
      svg.querySelectorAll(`.${cls}`).forEach((n) => n.classList.remove(cls));
      nodeOf(hit)?.classList.add(cls);
    },
    ghost(s) {
      ghostLayer.innerHTML = '';
      if (s) drawSlot(ghostLayer, g, s.ring, s, 'ghost');
    },
  };
}

/** Mouse event -> wheel coordinates (center = 0,0) in SVG units. */
export function eventToWheel(svg, ev, size) {
  const r = svg.getBoundingClientRect();
  const scale = size / Math.min(r.width, r.height);
  return {
    x: (ev.clientX - (r.left + r.width / 2)) * scale,
    y: (ev.clientY - (r.top + r.height / 2)) * scale,
  };
}

// --- key naming ---------------------------------------------------------------

const MOD_ORDER = ['ctrl', 'alt', 'shift', 'meta'];

export function modLabel(mods, platform, short = false) {
  const mac = platform === 'macos';
  const names = short
    ? { ctrl: mac ? '⌃' : 'Ctrl', alt: mac ? '⌥' : 'Alt', shift: mac ? '⇧' : 'Shift', meta: mac ? '⌘' : 'Win' }
    : { ctrl: 'Ctrl', alt: mac ? 'Option' : 'Alt', shift: 'Shift', meta: mac ? 'Cmd' : 'Win' };
  return MOD_ORDER.filter((m) => (mods || []).includes(m)).map((m) => names[m]).join(mac && short ? '' : '+');
}

export function itemLabel(item, keyMap) {
  if (item.label && item.label.trim()) return item.label.trim();
  return keyMap.get(item.key)?.label ?? item.key;
}

export function itemName(item, keyMap, platform) {
  const base = keyMap.get(item.key)?.name ?? item.key;
  const mods = modLabel(item.mods, platform);
  return mods ? `${mods}+${base}` : base;
}

/** "CommandOrControl+Shift+Space" -> "Ctrl+Shift+Space" / "⌘⇧Space". */
export function prettyHotkey(accel, platform, keyMap) {
  const mac = platform === 'macos';
  const parts = accel.split('+').map((t) => {
    const u = t.toLowerCase();
    if (['commandorcontrol', 'cmdorctrl', 'commandorctrl', 'cmdorcontrol'].includes(u)) return mac ? '⌘' : 'Ctrl';
    if (u === 'control' || u === 'ctrl') return mac ? '⌃' : 'Ctrl';
    if (u === 'alt' || u === 'option') return mac ? '⌥' : 'Alt';
    if (u === 'shift') return mac ? '⇧' : 'Shift';
    if (['super', 'command', 'cmd', 'meta'].includes(u)) return mac ? '⌘' : 'Win';
    return keyMap.get(t)?.name ?? t.replace(/^Key/, '').replace(/^Digit/, '');
  });
  if (!mac) return parts.join('+');
  const mods = parts.slice(0, -1).join('');
  return mods + parts[parts.length - 1];
}
