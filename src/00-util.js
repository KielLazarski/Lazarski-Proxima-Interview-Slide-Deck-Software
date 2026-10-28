/* ==========================================================================
   00-util.js — units, ids, DOM, colour, small helpers.

   UNITS. The model stores everything in POINTS (72 per inch). PowerPoint's
   file format uses EMU (914400 per inch, so 12700 per point); the import and
   export layers convert at the boundary and nothing inside the app sees EMU.
   The stage renders 1pt as 1px and scales with a CSS transform, so a slide
   coordinate and a stage pixel are the same number at 100% zoom.
   ========================================================================== */

const EMU_PER_PT = 12700;
const PT_PER_IN = 72;

const emuToPt = (v) => (+v || 0) / EMU_PER_PT;
const ptToEmu = (v) => Math.round((+v || 0) * EMU_PER_PT);
/* OOXML angles are 60000ths of a degree. */
const angToDeg = (v) => ((+v || 0) / 60000);
const degToAng = (v) => Math.round((+v || 0) * 60000);
/* Font sizes are hundredths of a point. */
const szToPt = (v) => (+v || 0) / 100;
const ptToSz = (v) => Math.round((+v || 0) * 100);

let _idSeq = 0;
function uid(prefix) {
  _idSeq += 1;
  return (prefix || 'el') + '_' + Date.now().toString(36) + '_' + _idSeq.toString(36);
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const round2 = (v) => Math.round(v * 100) / 100;
const deepCopy = (o) => (o === undefined ? o : JSON.parse(JSON.stringify(o)));

/* ---------- DOM ---------- */

function el(tag, attrs, kids) {
  const n = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(n.dataset, v);
      else n.setAttribute(k, v === true ? '' : v);
    }
  }
  if (kids) for (const k of [].concat(kids)) { if (k) n.appendChild(typeof k === 'string' ? document.createTextNode(k) : k); }
  return n;
}
function svgEl(tag, attrs) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (attrs) for (const k in attrs) { const v = attrs[k]; if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v); }
  return n;
}
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

function escapeXml(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    /* XML 1.0 forbids most control characters outright; strip rather than emit
       a file PowerPoint will refuse to open. */
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}
function escapeHtml(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ---------- colour ----------
   Colours live in the model as either a hex string ('#1b2a3f') or a scheme
   reference ({ scheme: 'accent1', lumMod: 60000, ... }). resolveColor() in
   20-theme.js turns the second kind into the first. These helpers work on hex.
*/

function normHex(h) {
  if (!h) return null;
  let s = String(h).trim().replace(/^#/, '');
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return '#' + s.toUpperCase();
}
function hexToRgb(h) {
  const s = normHex(h); if (!s) return null;
  return { r: parseInt(s.slice(1, 3), 16), g: parseInt(s.slice(3, 5), 16), b: parseInt(s.slice(5, 7), 16) };
}
function rgbToHex(r, g, b) {
  const c = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0').toUpperCase();
  return '#' + c(r) + c(g) + c(b);
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0; const l = (mx + mn) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s, l };
}
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

/* The four OOXML colour transforms that actually show up in real decks.
   lumMod/lumOff are the ones Office itself writes for the lighter and darker
   variants of a theme colour in every colour picker. */
function applyLumMod(hex, lumMod, lumOff) {
  const rgb = hexToRgb(hex); if (!rgb) return hex;
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  let l = hsl.l;
  if (lumMod !== null && lumMod !== undefined) l = l * (lumMod / 100000);
  if (lumOff !== null && lumOff !== undefined) l = l + (lumOff / 100000);
  const o = hslToRgb(hsl.h, hsl.s, clamp(l, 0, 1));
  return rgbToHex(o.r, o.g, o.b);
}
function applyTint(hex, tint) {   /* toward white */
  const c = hexToRgb(hex); if (!c) return hex; const t = tint / 100000;
  return rgbToHex(c.r + (255 - c.r) * (1 - t), c.g + (255 - c.g) * (1 - t), c.b + (255 - c.b) * (1 - t));
}
function applyShade(hex, shade) { /* toward black */
  const c = hexToRgb(hex); if (!c) return hex; const s = shade / 100000;
  return rgbToHex(c.r * s, c.g * s, c.b * s);
}
function applySatMod(hex, satMod) {
  const c = hexToRgb(hex); if (!c) return hex;
  const h = rgbToHsl(c.r, c.g, c.b);
  const o = hslToRgb(h.h, clamp(h.s * (satMod / 100000), 0, 1), h.l);
  return rgbToHex(o.r, o.g, o.b);
}
/* Relative luminance per WCAG, used to pick readable text over a fill. */
function luminance(hex) {
  const c = hexToRgb(hex); if (!c) return 1;
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
const contrastRatio = (a, b) => {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
const readableOn = (bg) => (luminance(bg) > 0.42 ? '#111418' : '#FFFFFF');
function mixHex(a, b, t) {
  const x = hexToRgb(a), y = hexToRgb(b);
  if (!x || !y) return a;
  return rgbToHex(x.r + (y.r - x.r) * t, x.g + (y.g - x.g) * t, x.b + (y.b - x.b) * t);
}

/* ---------- geometry ---------- */

function rotatePoint(x, y, cx, cy, deg) {
  const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r), dx = x - cx, dy = y - cy;
  return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
}
/* Axis-aligned bounds of a rotated box — needed for marquee hit-testing and
   for the multi-select bounding box. */
function rotatedBounds(b) {
  if (!b.rot) return { x: b.x, y: b.y, w: b.w, h: b.h };
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]]
    .map((p) => rotatePoint(p[0], p[1], cx, cy, b.rot));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x = Math.min.apply(null, xs), y = Math.min.apply(null, ys);
  return { x, y, w: Math.max.apply(null, xs) - x, h: Math.max.apply(null, ys) - y };
}
const rectsOverlap = (a, b) => !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
const unionRect = (list) => {
  if (!list.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of list) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

/* ---------- misc ---------- */

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function readFileAs(file, how) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(fr.error || new Error('could not read ' + file.name));
    if (how === 'text') fr.readAsText(file);
    else if (how === 'dataURL') fr.readAsDataURL(file);
    else fr.readAsArrayBuffer(file);
  });
}
function debounce(fn, ms) {
  let t = 0;
  return function () { const a = arguments, self = this; clearTimeout(t); t = setTimeout(() => fn.apply(self, a), ms); };
}
function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
}
function sanitizeFilename(s, fallback) {
  const out = String(s || '').replace(/[\/\\:*?"<>|\u0000-\u001F]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);
  return out || (fallback || 'presentation');
}
