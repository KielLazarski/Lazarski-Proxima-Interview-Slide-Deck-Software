/* ==========================================================================
   10-geom.js — preset shape geometry.

   Every shape is drawn as an SVG path in its own local box (0,0)-(w,h), so one
   renderer covers rectangles, arrows and stars alike, and the same path data
   serves the screen, the PDF and the thumbnail.

   The formulas follow the OOXML preset definitions (ECMA-376 presetShapeDefinitions)
   rather than being eyeballed, because a shape imported from PowerPoint has to
   land on the same outline it had there. Adjust values arrive as the integer
   thousandths-of-a-percent that the format uses, and the names (adj, adj1, adj2)
   are the ones in the file, so an imported <a:avLst> maps straight across.
   ========================================================================== */

const GEOM_FALLBACK = 'rect';

/* Shorthand used by the formulas below, mirroring the spec's own names:
   l/t/r/b edges, hc/vc centres, ss the shorter side. */
function _box(w, h) {
  return { l: 0, t: 0, r: w, b: h, w, h, hc: w / 2, vc: h / 2, ss: Math.min(w, h), hd2: h / 2, wd2: w / 2 };
}
const _pin = (lo, v, hi) => (v < lo ? lo : v > hi ? hi : v);
const _num = (adj, key, dflt) => {
  const v = adj && adj[key] !== undefined && adj[key] !== null ? +adj[key] : dflt;
  return isFinite(v) ? v : dflt;
};
/* Regular polygon inscribed in the box, first vertex at the top. */
function _poly(w, h, n, rot) {
  const cx = w / 2, cy = h / 2, pts = [];
  for (let i = 0; i < n; i++) {
    const a = (rot || -Math.PI / 2) + i * 2 * Math.PI / n;
    pts.push([cx + cx * Math.cos(a), cy + cy * Math.sin(a)]);
  }
  return 'M' + pts.map((p) => p[0].toFixed(3) + ',' + p[1].toFixed(3)).join('L') + 'Z';
}
function _star(w, h, points, innerRatio) {
  const cx = w / 2, cy = h / 2, pts = [];
  for (let i = 0; i < points * 2; i++) {
    const rr = i % 2 ? innerRatio : 1;
    const a = -Math.PI / 2 + i * Math.PI / points;
    pts.push([cx + cx * rr * Math.cos(a), cy + cy * rr * Math.sin(a)]);
  }
  return 'M' + pts.map((p) => p[0].toFixed(3) + ',' + p[1].toFixed(3)).join('L') + 'Z';
}
/* Ellipse as four cubic arcs — 0.5523 is the usual circle-to-Bezier constant. */
function _ellipsePath(x, y, w, h) {
  const k = 0.5522847498, rx = w / 2, ry = h / 2, cx = x + rx, cy = y + ry;
  return 'M' + (cx - rx) + ',' + cy +
    'C' + (cx - rx) + ',' + (cy - ry * k) + ' ' + (cx - rx * k) + ',' + (cy - ry) + ' ' + cx + ',' + (cy - ry) +
    'C' + (cx + rx * k) + ',' + (cy - ry) + ' ' + (cx + rx) + ',' + (cy - ry * k) + ' ' + (cx + rx) + ',' + cy +
    'C' + (cx + rx) + ',' + (cy + ry * k) + ' ' + (cx + rx * k) + ',' + (cy + ry) + ' ' + cx + ',' + (cy + ry) +
    'C' + (cx - rx * k) + ',' + (cy + ry) + ' ' + (cx - rx) + ',' + (cy + ry * k) + ' ' + (cx - rx) + ',' + cy + 'Z';
}
function _roundRectPath(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  if (!r) return 'M' + x + ',' + y + 'H' + (x + w) + 'V' + (y + h) + 'H' + x + 'Z';
  return 'M' + (x + r) + ',' + y + 'H' + (x + w - r) + 'A' + r + ',' + r + ' 0 0 1 ' + (x + w) + ',' + (y + r) +
    'V' + (y + h - r) + 'A' + r + ',' + r + ' 0 0 1 ' + (x + w - r) + ',' + (y + h) +
    'H' + (x + r) + 'A' + r + ',' + r + ' 0 0 1 ' + x + ',' + (y + h - r) +
    'V' + (y + r) + 'A' + r + ',' + r + ' 0 0 1 ' + (x + r) + ',' + y + 'Z';
}

/* --------------------------------------------------------------------------
   The preset table. Each entry returns SVG path data; a few also declare the
   inset where text should sit (textRect) when it differs from the full box.
   -------------------------------------------------------------------------- */
const PRESETS = {

  /* ---- basic ---- */
  rect: (w, h) => 'M0,0H' + w + 'V' + h + 'H0Z',
  roundRect: (w, h, a) => {
    const adj = _pin(0, _num(a, 'adj', 16667), 50000);
    return _roundRectPath(0, 0, w, h, Math.min(w, h) * adj / 100000);
  },
  round1Rect: (w, h, a) => {
    const r = Math.min(w, h) * _pin(0, _num(a, 'adj', 16667), 50000) / 100000;
    return 'M0,0H' + (w - r) + 'A' + r + ',' + r + ' 0 0 1 ' + w + ',' + r + 'V' + h + 'H0Z';
  },
  round2SameRect: (w, h, a) => {
    const r = Math.min(w, h) * _pin(0, _num(a, 'adj1', 16667), 50000) / 100000;
    return 'M' + r + ',0H' + (w - r) + 'A' + r + ',' + r + ' 0 0 1 ' + w + ',' + r + 'V' + h + 'H0V' + r + 'A' + r + ',' + r + ' 0 0 1 ' + r + ',0Z';
  },
  round2DiagRect: (w, h, a) => {
    const r = Math.min(w, h) * _pin(0, _num(a, 'adj1', 16667), 50000) / 100000;
    return 'M' + r + ',0H' + w + 'V' + (h - r) + 'A' + r + ',' + r + ' 0 0 1 ' + (w - r) + ',' + h + 'H0V' + r + 'A' + r + ',' + r + ' 0 0 1 ' + r + ',0Z';
  },
  snipRoundRect: (w, h, a) => {
    const s = Math.min(w, h) * _pin(0, _num(a, 'adj1', 16667), 50000) / 100000;
    const r = Math.min(w, h) * _pin(0, _num(a, 'adj2', 16667), 50000) / 100000;
    return 'M' + s + ',0H' + w + 'V' + h + 'H' + r + 'A' + r + ',' + r + ' 0 0 1 0,' + (h - r) + 'V' + s + 'Z';
  },
  snip1Rect: (w, h, a) => {
    const s = Math.min(w, h) * _pin(0, _num(a, 'adj', 16667), 50000) / 100000;
    return 'M0,0H' + (w - s) + 'L' + w + ',' + s + 'V' + h + 'H0Z';
  },
  snip2SameRect: (w, h, a) => {
    const s = Math.min(w, h) * _pin(0, _num(a, 'adj1', 16667), 50000) / 100000;
    return 'M' + s + ',0H' + (w - s) + 'L' + w + ',' + s + 'V' + h + 'H0V' + s + 'Z';
  },
  snip2DiagRect: (w, h, a) => {
    const s = Math.min(w, h) * _pin(0, _num(a, 'adj1', 16667), 50000) / 100000;
    return 'M' + s + ',0H' + w + 'V' + (h - s) + 'L' + (w - s) + ',' + h + 'H0V' + s + 'Z';
  },
  ellipse: (w, h) => _ellipsePath(0, 0, w, h),
  triangle: (w, h, a) => {
    const adj = _pin(0, _num(a, 'adj', 50000), 100000);
    return 'M0,' + h + 'L' + (w * adj / 100000) + ',0L' + w + ',' + h + 'Z';
  },
  rtTriangle: (w, h) => 'M0,0V' + h + 'H' + w + 'Z',
  diamond: (w, h) => 'M' + (w / 2) + ',0L' + w + ',' + (h / 2) + 'L' + (w / 2) + ',' + h + 'L0,' + (h / 2) + 'Z',
  parallelogram: (w, h, a) => {
    const d = Math.min(w, h) * _pin(0, _num(a, 'adj', 25000), 100000) / 100000;
    return 'M' + d + ',0H' + w + 'L' + (w - d) + ',' + h + 'H0Z';
  },
  trapezoid: (w, h, a) => {
    const d = Math.min(w, h) * _pin(0, _num(a, 'adj', 25000), 100000) / 100000;
    return 'M0,' + h + 'L' + d + ',0H' + (w - d) + 'L' + w + ',' + h + 'Z';
  },
  pentagon: (w, h) => _poly(w, h, 5),
  hexagon: (w, h, a) => {
    const d = Math.min(w, h) * _pin(0, _num(a, 'adj', 25000), 100000) / 100000;
    return 'M0,' + (h / 2) + 'L' + d + ',0H' + (w - d) + 'L' + w + ',' + (h / 2) + 'L' + (w - d) + ',' + h + 'H' + d + 'Z';
  },
  heptagon: (w, h) => _poly(w, h, 7),
  octagon: (w, h, a) => {
    const d = Math.min(w, h) * _pin(0, _num(a, 'adj', 29289), 50000) / 100000;
    return 'M0,' + d + 'L' + d + ',0H' + (w - d) + 'L' + w + ',' + d + 'V' + (h - d) + 'L' + (w - d) + ',' + h + 'H' + d + 'L0,' + (h - d) + 'Z';
  },
  decagon: (w, h) => _poly(w, h, 10),
  dodecagon: (w, h) => _poly(w, h, 12),
  plus: (w, h, a) => {
    const d = Math.min(w, h) * _pin(0, _num(a, 'adj', 25000), 50000) / 100000;
    return 'M' + d + ',0H' + (w - d) + 'V' + d + 'H' + w + 'V' + (h - d) + 'H' + (w - d) + 'V' + h + 'H' + d + 'V' + (h - d) + 'H0V' + d + 'H' + d + 'Z';
  },
  bevel: (w, h, a) => {
    const d = Math.min(w, h) * _pin(0, _num(a, 'adj', 12500), 50000) / 100000;
    return 'M0,0H' + w + 'V' + h + 'H0Z M' + d + ',' + d + 'H' + (w - d) + 'V' + (h - d) + 'H' + d + 'Z';
  },
  frame: (w, h, a) => {
    const d = Math.min(w, h) * _pin(0, _num(a, 'adj1', 12500), 50000) / 100000;
    return 'M0,0H' + w + 'V' + h + 'H0Z M' + d + ',' + d + 'V' + (h - d) + 'H' + (w - d) + 'V' + d + 'Z';
  },
  halfFrame: (w, h, a) => {
    const d = Math.min(w, h) * _pin(0, _num(a, 'adj1', 33333), 100000) / 100000;
    return 'M0,0H' + w + 'L' + (w - d) + ',' + d + 'H' + d + 'V' + (h - d) + 'L0,' + h + 'Z';
  },
  corner: (w, h, a) => {
    const dy = h * _pin(0, _num(a, 'adj1', 50000), 100000) / 100000;
    const dx = w * _pin(0, _num(a, 'adj2', 50000), 100000) / 100000;
    return 'M0,0H' + dx + 'V' + (h - dy) + 'H' + w + 'V' + h + 'H0Z';
  },
  diagStripe: (w, h, a) => {
    const d = _pin(0, _num(a, 'adj', 50000), 100000) / 100000;
    return 'M0,' + (h * d) + 'L' + (w * d) + ',0H' + w + 'L0,' + h + 'Z';
  },
  can: (w, h) => {
    const ry = Math.min(h / 4, w / 4);
    return 'M0,' + ry + 'A' + (w / 2) + ',' + ry + ' 0 0 1 ' + w + ',' + ry + 'V' + (h - ry) +
      'A' + (w / 2) + ',' + ry + ' 0 0 1 0,' + (h - ry) + 'Z' +
      'M0,' + ry + 'A' + (w / 2) + ',' + ry + ' 0 0 0 ' + w + ',' + ry;
  },
  cube: (w, h, a) => {
    const d = Math.min(w, h) * _pin(0, _num(a, 'adj', 25000), 100000) / 100000;
    return 'M0,' + d + 'L' + d + ',0H' + w + 'V' + (h - d) + 'L' + (w - d) + ',' + h + 'H0Z' +
      'M0,' + d + 'H' + (w - d) + 'V' + h + 'M' + (w - d) + ',' + d + 'L' + w + ',0';
  },
  donut: (w, h, a) => {
    const d = Math.min(w, h) * _pin(0, _num(a, 'adj', 25000), 50000) / 100000;
    return _ellipsePath(0, 0, w, h) + ' ' + _ellipsePath(d, d, w - 2 * d, h - 2 * d);
  },
  teardrop: (w, h) => {
    const k = 0.5522847498, rx = w / 2, ry = h / 2;
    return 'M0,' + ry + 'C0,' + (ry - ry * k) + ' ' + (rx - rx * k) + ',0 ' + rx + ',0' +
      'C' + (rx + rx * k) + ',0 ' + w + ',' + (ry - ry * k) + ' ' + w + ',' + ry +
      'L' + w + ',0L' + rx + ',0' +
      'M' + w + ',' + ry + 'C' + w + ',' + (ry + ry * k) + ' ' + (rx + rx * k) + ',' + h + ' ' + rx + ',' + h +
      'C' + (rx - rx * k) + ',' + h + ' 0,' + (ry + ry * k) + ' 0,' + ry + 'Z';
  },
  pie: (w, h, a) => {
    const a1 = _num(a, 'adj1', 0) / 60000, a2 = _num(a, 'adj2', 270) / 60000;
    const rx = w / 2, ry = h / 2;
    const p1 = [rx + rx * Math.cos(a1 * Math.PI / 180), ry + ry * Math.sin(a1 * Math.PI / 180)];
    const p2 = [rx + rx * Math.cos(a2 * Math.PI / 180), ry + ry * Math.sin(a2 * Math.PI / 180)];
    const large = ((a2 - a1 + 360) % 360) > 180 ? 1 : 0;
    return 'M' + rx + ',' + ry + 'L' + p1[0] + ',' + p1[1] + 'A' + rx + ',' + ry + ' 0 ' + large + ' 1 ' + p2[0] + ',' + p2[1] + 'Z';
  },
  blockArc: (w, h, a) => {
    const a1 = _num(a, 'adj1', 10800000) / 60000, a2 = _num(a, 'adj2', 0) / 60000;
    const th = _pin(0, _num(a, 'adj3', 25000), 50000) / 100000;
    const rx = w / 2, ry = h / 2, irx = rx * (1 - 2 * th), iry = ry * (1 - 2 * th);
    const P = (ang, Rx, Ry) => [rx + Rx * Math.cos(ang * Math.PI / 180), ry + Ry * Math.sin(ang * Math.PI / 180)];
    const o1 = P(a1, rx, ry), o2 = P(a2, rx, ry), i2 = P(a2, irx, iry), i1 = P(a1, irx, iry);
    const large = ((a2 - a1 + 360) % 360) > 180 ? 1 : 0;
    return 'M' + o1 + 'A' + rx + ',' + ry + ' 0 ' + large + ' 1 ' + o2 + 'L' + i2 + 'A' + irx + ',' + iry + ' 0 ' + large + ' 0 ' + i1 + 'Z';
  },

  /* ---- arrows ---- */
  rightArrow: (w, h, a) => {
    const B = _box(w, h);
    const maxA2 = 100000 * B.w / B.ss;
    const a1 = _pin(0, _num(a, 'adj1', 50000), 100000), a2 = _pin(0, _num(a, 'adj2', 50000), maxA2);
    const dy = B.hd2 * a1 / 100000, x2 = B.r - B.ss * a2 / 100000;
    return 'M0,' + (B.vc - dy) + 'H' + x2 + 'V0L' + B.r + ',' + B.vc + 'L' + x2 + ',' + B.b + 'V' + (B.vc + dy) + 'H0Z';
  },
  leftArrow: (w, h, a) => {
    const B = _box(w, h);
    const maxA2 = 100000 * B.w / B.ss;
    const a1 = _pin(0, _num(a, 'adj1', 50000), 100000), a2 = _pin(0, _num(a, 'adj2', 50000), maxA2);
    const dy = B.hd2 * a1 / 100000, x1 = B.ss * a2 / 100000;
    return 'M' + B.r + ',' + (B.vc - dy) + 'H' + x1 + 'V0L0,' + B.vc + 'L' + x1 + ',' + B.b + 'V' + (B.vc + dy) + 'H' + B.r + 'Z';
  },
  upArrow: (w, h, a) => {
    const B = _box(w, h);
    const maxA2 = 100000 * B.h / B.ss;
    const a1 = _pin(0, _num(a, 'adj1', 50000), 100000), a2 = _pin(0, _num(a, 'adj2', 50000), maxA2);
    const dx = B.wd2 * a1 / 100000, y1 = B.ss * a2 / 100000;
    return 'M' + (B.hc - dx) + ',' + B.b + 'V' + y1 + 'H0L' + B.hc + ',0L' + B.r + ',' + y1 + 'H' + (B.hc + dx) + 'V' + B.b + 'Z';
  },
  downArrow: (w, h, a) => {
    const B = _box(w, h);
    const maxA2 = 100000 * B.h / B.ss;
    const a1 = _pin(0, _num(a, 'adj1', 50000), 100000), a2 = _pin(0, _num(a, 'adj2', 50000), maxA2);
    const dx = B.wd2 * a1 / 100000, y2 = B.b - B.ss * a2 / 100000;
    return 'M' + (B.hc - dx) + ',0V' + y2 + 'H0L' + B.hc + ',' + B.b + 'L' + B.r + ',' + y2 + 'H' + (B.hc + dx) + 'V0Z';
  },
  leftRightArrow: (w, h, a) => {
    const B = _box(w, h);
    const a1 = _pin(0, _num(a, 'adj1', 50000), 100000), a2 = _pin(0, _num(a, 'adj2', 50000), 50000);
    const dy = B.hd2 * a1 / 100000, dx = B.ss * a2 / 100000;
    return 'M0,' + B.vc + 'L' + dx + ',0V' + (B.vc - dy) + 'H' + (B.r - dx) + 'V0L' + B.r + ',' + B.vc +
      'L' + (B.r - dx) + ',' + B.b + 'V' + (B.vc + dy) + 'H' + dx + 'V' + B.b + 'Z';
  },
  upDownArrow: (w, h, a) => {
    const B = _box(w, h);
    const a1 = _pin(0, _num(a, 'adj1', 50000), 100000), a2 = _pin(0, _num(a, 'adj2', 50000), 50000);
    const dx = B.wd2 * a1 / 100000, dy = B.ss * a2 / 100000;
    return 'M' + B.hc + ',0L' + B.r + ',' + dy + 'H' + (B.hc + dx) + 'V' + (B.b - dy) + 'H' + B.r + 'L' + B.hc + ',' + B.b +
      'L0,' + (B.b - dy) + 'H' + (B.hc - dx) + 'V' + dy + 'H0Z';
  },
  notchedRightArrow: (w, h, a) => {
    const B = _box(w, h);
    const a1 = _pin(0, _num(a, 'adj1', 50000), 100000), a2 = _pin(0, _num(a, 'adj2', 50000), 100000 * B.w / B.ss);
    const dy = B.hd2 * a1 / 100000, x2 = B.r - B.ss * a2 / 100000, notch = (B.ss * a2 / 100000) * dy / B.hd2;
    return 'M0,' + (B.vc - dy) + 'H' + x2 + 'V0L' + B.r + ',' + B.vc + 'L' + x2 + ',' + B.b + 'V' + (B.vc + dy) + 'H0L' + notch + ',' + B.vc + 'Z';
  },
  homePlate: (w, h, a) => {
    const B = _box(w, h);
    const dx = B.ss * _pin(0, _num(a, 'adj', 50000), 100000) / 100000;
    return 'M0,0H' + (B.r - dx) + 'L' + B.r + ',' + B.vc + 'L' + (B.r - dx) + ',' + B.b + 'H0Z';
  },
  chevron: (w, h, a) => {
    const B = _box(w, h);
    const dx = B.ss * _pin(0, _num(a, 'adj', 50000), 100000) / 100000;
    return 'M0,0H' + (B.r - dx) + 'L' + B.r + ',' + B.vc + 'L' + (B.r - dx) + ',' + B.b + 'H0L' + dx + ',' + B.vc + 'Z';
  },
  bentArrow: (w, h, a) => {
    const B = _box(w, h);
    const th = B.ss * _pin(0, _num(a, 'adj1', 25000), 50000) / 100000;
    const head = B.ss * _pin(0, _num(a, 'adj2', 25000), 50000) / 100000;
    return 'M0,' + B.b + 'V' + (head * 2) + 'Q0,' + head + ' ' + head + ',' + head + 'H' + (B.r - head) + 'V0L' + B.r + ',' + (head * 1.5) +
      'L' + (B.r - head) + ',' + (head * 3) + 'V' + (head * 2) + 'H' + (head + th) + 'Q' + th + ',' + (head * 2) + ' ' + th + ',' + (head * 2 + th) + 'V' + B.b + 'Z';
  },
  curvedRightArrow: (w, h, a) => {
    const B = _box(w, h);
    const th = B.h * _pin(0, _num(a, 'adj1', 25000), 50000) / 100000;
    return 'M0,0Q' + B.r + ',0 ' + B.r + ',' + B.vc + 'L' + (B.r + th / 2) + ',' + B.vc + 'L' + (B.r - th) + ',' + B.b +
      'L' + (B.r - th * 2.5) + ',' + B.vc + 'L' + (B.r - th) + ',' + B.vc + 'Q' + (B.r - th) + ',' + th + ' 0,' + th + 'Z';
  },
  stripedRightArrow: (w, h, a) => PRESETS.rightArrow(w, h, a),
  quadArrow: (w, h, a) => {
    const B = _box(w, h);
    const th = B.ss * _pin(0, _num(a, 'adj1', 22500), 50000) / 100000;
    const hd = B.ss * _pin(0, _num(a, 'adj3', 22500), 50000) / 100000;
    return 'M' + B.hc + ',0L' + (B.hc + hd) + ',' + hd + 'H' + (B.hc + th) + 'V' + (B.vc - th) + 'H' + (B.r - hd) + 'V' + (B.vc - hd) +
      'L' + B.r + ',' + B.vc + 'L' + (B.r - hd) + ',' + (B.vc + hd) + 'V' + (B.vc + th) + 'H' + (B.hc + th) + 'V' + (B.b - hd) +
      'H' + (B.hc + hd) + 'L' + B.hc + ',' + B.b + 'L' + (B.hc - hd) + ',' + (B.b - hd) + 'H' + (B.hc - th) + 'V' + (B.vc + th) +
      'H' + hd + 'V' + (B.vc + hd) + 'L0,' + B.vc + 'L' + hd + ',' + (B.vc - hd) + 'V' + (B.vc - th) + 'H' + (B.hc - th) + 'V' + hd + 'H' + (B.hc - hd) + 'Z';
  },

  /* ---- maths ---- */
  mathPlus: (w, h, a) => {
    const B = _box(w, h), d = B.ss * _pin(0, _num(a, 'adj1', 23520), 42000) / 100000;
    return 'M' + (B.hc - d / 2) + ',' + (B.vc - B.hd2 * 0.8) + 'H' + (B.hc + d / 2) + 'V' + (B.vc - d / 2) + 'H' + (B.r * 0.1 + B.w * 0.8) + 'V' + (B.vc + d / 2) +
      'H' + (B.hc + d / 2) + 'V' + (B.vc + B.hd2 * 0.8) + 'H' + (B.hc - d / 2) + 'V' + (B.vc + d / 2) + 'H' + (B.r * 0.1) + 'V' + (B.vc - d / 2) + 'H' + (B.hc - d / 2) + 'Z';
  },
  mathMinus: (w, h, a) => {
    const B = _box(w, h), d = B.ss * _pin(0, _num(a, 'adj1', 23520), 100000) / 100000;
    return 'M' + (B.w * 0.1) + ',' + (B.vc - d / 2) + 'H' + (B.w * 0.9) + 'V' + (B.vc + d / 2) + 'H' + (B.w * 0.1) + 'Z';
  },
  mathMultiply: (w, h, a) => {
    const B = _box(w, h), d = B.ss * _pin(0, _num(a, 'adj1', 23520), 51965) / 100000;
    const s = d / Math.SQRT2;
    return 'M' + (B.w * 0.1) + ',' + (B.h * 0.1 + s) + 'L' + (B.w * 0.1 + s) + ',' + (B.h * 0.1) + 'L' + B.hc + ',' + (B.vc - s) +
      'L' + (B.w * 0.9 - s) + ',' + (B.h * 0.1) + 'L' + (B.w * 0.9) + ',' + (B.h * 0.1 + s) + 'L' + (B.hc + s) + ',' + B.vc +
      'L' + (B.w * 0.9) + ',' + (B.h * 0.9 - s) + 'L' + (B.w * 0.9 - s) + ',' + (B.h * 0.9) + 'L' + B.hc + ',' + (B.vc + s) +
      'L' + (B.w * 0.1 + s) + ',' + (B.h * 0.9) + 'L' + (B.w * 0.1) + ',' + (B.h * 0.9 - s) + 'L' + (B.hc - s) + ',' + B.vc + 'Z';
  },
  mathEqual: (w, h, a) => {
    const B = _box(w, h), d = B.ss * _pin(0, _num(a, 'adj1', 23520), 36745) / 100000, gap = B.h * 0.18;
    return 'M' + (B.w * 0.1) + ',' + (B.vc - gap - d) + 'H' + (B.w * 0.9) + 'V' + (B.vc - gap) + 'H' + (B.w * 0.1) + 'Z' +
      'M' + (B.w * 0.1) + ',' + (B.vc + gap) + 'H' + (B.w * 0.9) + 'V' + (B.vc + gap + d) + 'H' + (B.w * 0.1) + 'Z';
  },
  mathNotEqual: (w, h, a) => PRESETS.mathEqual(w, h, a) +
    'M' + (w * 0.42) + ',' + (h * 0.95) + 'L' + (w * 0.58) + ',' + (h * 0.05) + 'L' + (w * 0.64) + ',' + (h * 0.05) + 'L' + (w * 0.48) + ',' + (h * 0.95) + 'Z',
  mathDivide: (w, h, a) => {
    const B = _box(w, h), d = B.ss * 0.12, r = B.ss * 0.08;
    return 'M' + (B.w * 0.1) + ',' + (B.vc - d / 2) + 'H' + (B.w * 0.9) + 'V' + (B.vc + d / 2) + 'H' + (B.w * 0.1) + 'Z' +
      _ellipsePath(B.hc - r, B.h * 0.16 - r, r * 2, r * 2) + _ellipsePath(B.hc - r, B.h * 0.84 - r, r * 2, r * 2);
  },

  /* ---- stars and seals ---- */
  star4: (w, h) => _star(w, h, 4, 0.19),
  star5: (w, h) => _star(w, h, 5, 0.38),
  star6: (w, h) => _star(w, h, 6, 0.45),
  star7: (w, h) => _star(w, h, 7, 0.5),
  star8: (w, h) => _star(w, h, 8, 0.54),
  star10: (w, h) => _star(w, h, 10, 0.6),
  star12: (w, h) => _star(w, h, 12, 0.65),
  star16: (w, h) => _star(w, h, 16, 0.72),
  star24: (w, h) => _star(w, h, 24, 0.8),
  star32: (w, h) => _star(w, h, 32, 0.85),
  irregularSeal1: (w, h) => _star(w, h, 12, 0.72),
  irregularSeal2: (w, h) => _star(w, h, 14, 0.75),

  /* ---- symbols ---- */
  heart: (w, h) => 'M' + (w / 2) + ',' + h + 'C' + (-w * 0.08) + ',' + (h * 0.56) + ' 0,' + (-h * 0.05) + ' ' + (w / 2) + ',' + (h * 0.26) +
    'C' + w + ',' + (-h * 0.05) + ' ' + (w * 1.08) + ',' + (h * 0.56) + ' ' + (w / 2) + ',' + h + 'Z',
  sun: (w, h) => {
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2, r = R * 0.45;
    let p = _ellipsePath(cx - r, cy - r, r * 2, r * 2);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4, a1 = a - 0.14, a2 = a + 0.14;
      p += 'M' + (cx + r * Math.cos(a1)) + ',' + (cy + r * Math.sin(a1)) +
        'L' + (cx + R * Math.cos(a)) + ',' + (cy + R * Math.sin(a)) +
        'L' + (cx + r * Math.cos(a2)) + ',' + (cy + r * Math.sin(a2)) + 'Z';
    }
    return p;
  },
  moon: (w, h) => 'M' + w + ',0A' + w + ',' + (h / 2) + ' 0 1 0 ' + w + ',' + h + 'A' + (w * 0.62) + ',' + (h * 0.38) + ' 0 1 1 ' + w + ',0Z',
  lightningBolt: (w, h) => 'M' + (w * 0.34) + ',0L' + (w * 0.86) + ',' + (h * 0.42) + 'L' + (w * 0.55) + ',' + (h * 0.45) +
    'L' + w + ',' + h + 'L' + (w * 0.2) + ',' + (h * 0.52) + 'L' + (w * 0.49) + ',' + (h * 0.49) + 'L0,' + (h * 0.2) + 'Z',
  cloud: (w, h) => 'M' + (w * 0.17) + ',' + (h * 0.96) + 'C' + (w * 0.02) + ',' + (h * 0.94) + ' ' + (-w * 0.04) + ',' + (h * 0.66) + ' ' + (w * 0.11) + ',' + (h * 0.56) +
    'C' + (w * 0.06) + ',' + (h * 0.3) + ' ' + (w * 0.3) + ',' + (h * 0.14) + ' ' + (w * 0.42) + ',' + (h * 0.26) +
    'C' + (w * 0.5) + ',' + (h * 0.02) + ' ' + (w * 0.8) + ',' + (h * 0.04) + ' ' + (w * 0.81) + ',' + (h * 0.29) +
    'C' + (w * 1.02) + ',' + (h * 0.33) + ' ' + (w * 1.01) + ',' + (h * 0.73) + ' ' + (w * 0.84) + ',' + (h * 0.81) +
    'C' + (w * 0.84) + ',' + (h * 1.0) + ' ' + (w * 0.4) + ',' + (h * 1.06) + ' ' + (w * 0.17) + ',' + (h * 0.96) + 'Z',
  smileyFace: (w, h) => _ellipsePath(0, 0, w, h) +
    _ellipsePath(w * 0.27, h * 0.27, w * 0.1, h * 0.14) + _ellipsePath(w * 0.63, h * 0.27, w * 0.1, h * 0.14) +
    'M' + (w * 0.26) + ',' + (h * 0.62) + 'Q' + (w * 0.5) + ',' + (h * 0.86) + ' ' + (w * 0.74) + ',' + (h * 0.62) +
    'Q' + (w * 0.5) + ',' + (h * 0.78) + ' ' + (w * 0.26) + ',' + (h * 0.62) + 'Z',
  noSmoking: (w, h) => _ellipsePath(0, 0, w, h) + _ellipsePath(w * 0.1, h * 0.1, w * 0.8, h * 0.8) +
    'M' + (w * 0.2) + ',' + (h * 0.26) + 'L' + (w * 0.8) + ',' + (h * 0.78) + 'L' + (w * 0.74) + ',' + (h * 0.86) + 'L' + (w * 0.14) + ',' + (h * 0.34) + 'Z',
  arc: (w, h) => 'M' + w + ',' + (h / 2) + 'A' + (w / 2) + ',' + (h / 2) + ' 0 0 0 ' + (w / 2) + ',0',
  chord: (w, h) => 'M' + (w * 0.854) + ',' + (h * 0.146) + 'A' + (w / 2) + ',' + (h / 2) + ' 0 1 1 ' + (w * 0.146) + ',' + (h * 0.854) + 'Z',

  /* ---- brackets and braces ---- */
  bracketPair: (w, h, a) => {
    const r = Math.min(w, h) * _pin(0, _num(a, 'adj', 16667), 50000) / 100000;
    return 'M' + r + ',0A' + r + ',' + r + ' 0 0 0 0,' + r + 'V' + (h - r) + 'A' + r + ',' + r + ' 0 0 0 ' + r + ',' + h +
      'M' + (w - r) + ',0A' + r + ',' + r + ' 0 0 1 ' + w + ',' + r + 'V' + (h - r) + 'A' + r + ',' + r + ' 0 0 1 ' + (w - r) + ',' + h;
  },
  leftBracket: (w, h, a) => {
    const r = Math.min(w, h) * _pin(0, _num(a, 'adj', 8333), 50000) / 100000;
    return 'M' + w + ',0A' + r + ',' + r + ' 0 0 0 0,' + r + 'V' + (h - r) + 'A' + r + ',' + r + ' 0 0 0 ' + w + ',' + h;
  },
  rightBracket: (w, h, a) => {
    const r = Math.min(w, h) * _pin(0, _num(a, 'adj', 8333), 50000) / 100000;
    return 'M0,0A' + r + ',' + r + ' 0 0 1 ' + w + ',' + r + 'V' + (h - r) + 'A' + r + ',' + r + ' 0 0 1 0,' + h;
  },
  bracePair: (w, h, a) => {
    const r = Math.min(w, h) * _pin(0, _num(a, 'adj', 8333), 25000) / 100000;
    const q = (x0, dir) => 'M' + (x0 + dir * r) + ',0Q' + x0 + ',0 ' + x0 + ',' + r + 'V' + (h / 2 - r) + 'Q' + x0 + ',' + (h / 2) + ' ' + (x0 - dir * r) + ',' + (h / 2) +
      'Q' + x0 + ',' + (h / 2) + ' ' + x0 + ',' + (h / 2 + r) + 'V' + (h - r) + 'Q' + x0 + ',' + h + ' ' + (x0 + dir * r) + ',' + h;
    return q(r, 1) + q(w - r, -1);
  },
  leftBrace: (w, h, a) => {
    const r = Math.min(w, h) * _pin(0, _num(a, 'adj1', 8333), 25000) / 100000;
    return 'M' + w + ',0Q' + (w / 2) + ',0 ' + (w / 2) + ',' + r + 'V' + (h / 2 - r) + 'Q' + (w / 2) + ',' + (h / 2) + ' 0,' + (h / 2) +
      'Q' + (w / 2) + ',' + (h / 2) + ' ' + (w / 2) + ',' + (h / 2 + r) + 'V' + (h - r) + 'Q' + (w / 2) + ',' + h + ' ' + w + ',' + h;
  },
  rightBrace: (w, h, a) => {
    const r = Math.min(w, h) * _pin(0, _num(a, 'adj1', 8333), 25000) / 100000;
    return 'M0,0Q' + (w / 2) + ',0 ' + (w / 2) + ',' + r + 'V' + (h / 2 - r) + 'Q' + (w / 2) + ',' + (h / 2) + ' ' + w + ',' + (h / 2) +
      'Q' + (w / 2) + ',' + (h / 2) + ' ' + (w / 2) + ',' + (h / 2 + r) + 'V' + (h - r) + 'Q' + (w / 2) + ',' + h + ' 0,' + h;
  },

  /* ---- callouts ---- */
  wedgeRectCallout: (w, h, a) => {
    const dx = w * (_num(a, 'adj1', -20833) / 100000), dy = h * (_num(a, 'adj2', 62500) / 100000);
    const px = w / 2 + dx, py = h / 2 + dy;
    return 'M0,0H' + w + 'V' + h + 'H0Z M' + (w * 0.25) + ',' + h + 'L' + px + ',' + py + 'L' + (w * 0.45) + ',' + h + 'Z';
  },
  wedgeRoundRectCallout: (w, h, a) => {
    const r = Math.min(w, h) * 0.16;
    const dx = w * (_num(a, 'adj1', -20833) / 100000), dy = h * (_num(a, 'adj2', 62500) / 100000);
    return _roundRectPath(0, 0, w, h, r) + ' M' + (w * 0.25) + ',' + h + 'L' + (w / 2 + dx) + ',' + (h / 2 + dy) + 'L' + (w * 0.45) + ',' + h + 'Z';
  },
  wedgeEllipseCallout: (w, h, a) => {
    const dx = w * (_num(a, 'adj1', -20833) / 100000), dy = h * (_num(a, 'adj2', 62500) / 100000);
    return _ellipsePath(0, 0, w, h) + ' M' + (w * 0.3) + ',' + (h * 0.92) + 'L' + (w / 2 + dx) + ',' + (h / 2 + dy) + 'L' + (w * 0.5) + ',' + h + 'Z';
  },

  /* ---- flowchart ---- */
  flowChartProcess: (w, h) => 'M0,0H' + w + 'V' + h + 'H0Z',
  flowChartAlternateProcess: (w, h) => _roundRectPath(0, 0, w, h, Math.min(w, h) * 0.16),
  flowChartDecision: (w, h) => 'M' + (w / 2) + ',0L' + w + ',' + (h / 2) + 'L' + (w / 2) + ',' + h + 'L0,' + (h / 2) + 'Z',
  flowChartInputOutput: (w, h) => 'M' + (w * 0.2) + ',0H' + w + 'L' + (w * 0.8) + ',' + h + 'H0Z',
  flowChartTerminator: (w, h) => _roundRectPath(0, 0, w, h, h / 2),
  flowChartPreparation: (w, h) => 'M' + (w * 0.2) + ',0H' + (w * 0.8) + 'L' + w + ',' + (h / 2) + 'L' + (w * 0.8) + ',' + h + 'H' + (w * 0.2) + 'L0,' + (h / 2) + 'Z',
  flowChartDocument: (w, h) => 'M0,0H' + w + 'V' + (h * 0.84) + 'Q' + (w * 0.75) + ',' + (h * 1.06) + ' ' + (w / 2) + ',' + (h * 0.92) +
    'Q' + (w * 0.25) + ',' + (h * 0.78) + ' 0,' + h + 'Z',
  flowChartMultidocument: (w, h) => 'M0,' + (h * 0.14) + 'H' + (w * 0.88) + 'V' + (h * 0.78) + 'Q' + (w * 0.66) + ',' + (h * 0.96) + ' ' + (w * 0.44) + ',' + (h * 0.86) +
    'Q' + (w * 0.22) + ',' + (h * 0.76) + ' 0,' + (h * 0.94) + 'Z M' + (w * 0.06) + ',' + (h * 0.14) + 'V' + (h * 0.07) + 'H' + (w * 0.94) + 'V' + (h * 0.72) +
    'M' + (w * 0.12) + ',' + (h * 0.07) + 'V0H' + w + 'V' + (h * 0.66),
  flowChartPredefinedProcess: (w, h) => 'M0,0H' + w + 'V' + h + 'H0Z M' + (w * 0.125) + ',0V' + h + 'M' + (w * 0.875) + ',0V' + h,
  flowChartInternalStorage: (w, h) => 'M0,0H' + w + 'V' + h + 'H0Z M' + (w * 0.125) + ',0V' + h + 'M0,' + (h * 0.125) + 'H' + w,
  flowChartConnector: (w, h) => _ellipsePath(0, 0, w, h),
  flowChartManualInput: (w, h) => 'M0,' + (h * 0.2) + 'L' + w + ',0V' + h + 'H0Z',
  flowChartManualOperation: (w, h) => 'M0,0H' + w + 'L' + (w * 0.8) + ',' + h + 'H' + (w * 0.2) + 'Z',
  flowChartDelay: (w, h) => 'M0,0H' + (w / 2) + 'A' + (w / 2) + ',' + (h / 2) + ' 0 0 1 ' + (w / 2) + ',' + h + 'H0Z',
  flowChartMagneticDisk: (w, h) => {
    const ry = h * 0.16;
    return 'M0,' + ry + 'A' + (w / 2) + ',' + ry + ' 0 0 1 ' + w + ',' + ry + 'V' + (h - ry) + 'A' + (w / 2) + ',' + ry + ' 0 0 1 0,' + (h - ry) + 'Z' +
      'M0,' + ry + 'A' + (w / 2) + ',' + ry + ' 0 0 0 ' + w + ',' + ry;
  },
  flowChartMagneticDrum: (w, h) => {
    const rx = w * 0.16;
    return 'M' + rx + ',0H' + (w - rx) + 'A' + rx + ',' + (h / 2) + ' 0 0 1 ' + (w - rx) + ',' + h + 'H' + rx + 'A' + rx + ',' + (h / 2) + ' 0 0 1 ' + rx + ',0Z' +
      'M' + (w - rx) + ',0A' + rx + ',' + (h / 2) + ' 0 0 0 ' + (w - rx) + ',' + h;
  },
  flowChartDisplay: (w, h) => 'M0,' + (h / 2) + 'L' + (w * 0.17) + ',0H' + (w * 0.83) + 'A' + (w * 0.17) + ',' + (h / 2) + ' 0 0 1 ' + (w * 0.83) + ',' + h + 'H' + (w * 0.17) + 'Z',
  flowChartExtract: (w, h) => 'M' + (w / 2) + ',0L' + w + ',' + h + 'H0Z',
  flowChartMerge: (w, h) => 'M0,0H' + w + 'L' + (w / 2) + ',' + h + 'Z',
  flowChartOr: (w, h) => _ellipsePath(0, 0, w, h) + 'M' + (w / 2) + ',0V' + h + 'M0,' + (h / 2) + 'H' + w,
  flowChartSummingJunction: (w, h) => _ellipsePath(0, 0, w, h) +
    'M' + (w * 0.146) + ',' + (h * 0.146) + 'L' + (w * 0.854) + ',' + (h * 0.854) + 'M' + (w * 0.854) + ',' + (h * 0.146) + 'L' + (w * 0.146) + ',' + (h * 0.854),
  flowChartSort: (w, h) => 'M' + (w / 2) + ',0L' + w + ',' + (h / 2) + 'L' + (w / 2) + ',' + h + 'L0,' + (h / 2) + 'Z M0,' + (h / 2) + 'H' + w,
  flowChartOffpageConnector: (w, h) => 'M0,0H' + w + 'V' + (h * 0.8) + 'L' + (w / 2) + ',' + h + 'L0,' + (h * 0.8) + 'Z',
  flowChartPunchedCard: (w, h) => 'M' + (w * 0.18) + ',0H' + w + 'V' + h + 'H0V' + (h * 0.18) + 'Z',
  flowChartPunchedTape: (w, h) => 'M0,' + (h * 0.12) + 'Q' + (w * 0.25) + ',' + (-h * 0.06) + ' ' + (w / 2) + ',' + (h * 0.12) +
    'Q' + (w * 0.75) + ',' + (h * 0.3) + ' ' + w + ',' + (h * 0.12) + 'V' + (h * 0.88) +
    'Q' + (w * 0.75) + ',' + (h * 1.06) + ' ' + (w / 2) + ',' + (h * 0.88) + 'Q' + (w * 0.25) + ',' + (h * 0.7) + ' 0,' + (h * 0.88) + 'Z',

  /* ---- banners, scrolls, waves ---- */
  ribbon: (w, h, a) => {
    const B = _box(w, h), d = B.h * 0.25, n = B.w * 0.12;
    return 'M0,0H' + n + 'L' + (n * 1.6) + ',' + (B.h / 2) + 'L' + n + ',' + B.h + 'H0L' + (n * 0.6) + ',' + (B.h / 2) + 'Z' +
      'M' + (B.w - n) + ',0H' + B.w + 'L' + (B.w - n * 0.6) + ',' + (B.h / 2) + 'L' + B.w + ',' + B.h + 'H' + (B.w - n) + 'L' + (B.w - n * 1.6) + ',' + (B.h / 2) + 'Z' +
      'M' + n + ',' + (d * 0.4) + 'H' + (B.w - n) + 'V' + (B.h - d * 0.4) + 'H' + n + 'Z';
  },
  verticalScroll: (w, h) => {
    const c = Math.min(w, h) * 0.18;
    return 'M' + c + ',' + c + 'H' + (w - c) + 'V' + h + 'H' + c + 'Z' +
      'M' + c + ',' + c + 'A' + (c / 2) + ',' + (c / 2) + ' 0 0 1 ' + c + ',0H' + w + 'V' + (h - c) +
      'M' + (w - c) + ',' + c + 'H' + w;
  },
  horizontalScroll: (w, h) => {
    const c = Math.min(w, h) * 0.18;
    return 'M' + c + ',' + c + 'H' + w + 'V' + (h - c) + 'H0Z' + 'M' + c + ',' + c + 'A' + (c / 2) + ',' + (c / 2) + ' 0 0 0 0,' + c + 'V' + (h - c) + 'H' + (w - c) + 'V' + h;
  },
  wave: (w, h, a) => {
    const amp = h * (_pin(0, _num(a, 'adj1', 12500), 20000) / 100000);
    return 'M0,' + amp + 'Q' + (w * 0.25) + ',' + (-amp) + ' ' + (w / 2) + ',' + amp + 'T' + w + ',' + amp +
      'V' + (h - amp) + 'Q' + (w * 0.75) + ',' + (h + amp) + ' ' + (w / 2) + ',' + (h - amp) + 'T0,' + (h - amp) + 'Z';
  },
  doubleWave: (w, h, a) => {
    const amp = h * (_pin(0, _num(a, 'adj1', 6500), 12000) / 100000);
    return 'M0,' + amp + 'Q' + (w * 0.125) + ',' + (-amp) + ' ' + (w * 0.25) + ',' + amp + 'T' + (w * 0.5) + ',' + amp + 'T' + (w * 0.75) + ',' + amp + 'T' + w + ',' + amp +
      'V' + (h - amp) + 'Q' + (w * 0.875) + ',' + (h + amp) + ' ' + (w * 0.75) + ',' + (h - amp) + 'T' + (w * 0.5) + ',' + (h - amp) + 'T' + (w * 0.25) + ',' + (h - amp) + 'T0,' + (h - amp) + 'Z';
  },

  /* ---- lines and connectors (open paths) ---- */
  line: (w, h) => 'M0,0L' + w + ',' + h,
  straightConnector1: (w, h) => 'M0,0L' + w + ',' + h,
  bentConnector2: (w, h) => 'M0,0H' + w + 'V' + h,
  bentConnector3: (w, h) => 'M0,0H' + (w / 2) + 'V' + h + 'H' + w,
  bentConnector4: (w, h) => 'M0,0H' + (w / 2) + 'V' + (h / 2) + 'H' + w + 'V' + h,
  bentConnector5: (w, h) => 'M0,0H' + (w / 3) + 'V' + (h / 2) + 'H' + (2 * w / 3) + 'V' + h + 'H' + w,
  curvedConnector2: (w, h) => 'M0,0Q' + w + ',0 ' + w + ',' + h,
  curvedConnector3: (w, h) => 'M0,0Q' + (w / 2) + ',0 ' + (w / 2) + ',' + (h / 2) + 'T' + w + ',' + h,
  curvedConnector4: (w, h) => 'M0,0Q' + (w / 2) + ',0 ' + (w / 2) + ',' + (h / 2) + 'T' + w + ',' + h,
  curvedConnector5: (w, h) => 'M0,0Q' + (w / 2) + ',0 ' + (w / 2) + ',' + (h / 2) + 'T' + w + ',' + h
};

/* Shapes whose outline is a stroked line rather than a filled region: they
   must not pick up a fill on import or when a theme is applied. */
const OPEN_GEOMS = {
  line: 1, straightConnector1: 1, bentConnector2: 1, bentConnector3: 1, bentConnector4: 1, bentConnector5: 1,
  curvedConnector2: 1, curvedConnector3: 1, curvedConnector4: 1, curvedConnector5: 1, arc: 1, bracketPair: 1,
  bracePair: 1, leftBracket: 1, rightBracket: 1, leftBrace: 1, rightBrace: 1
};
const isOpenGeom = (g) => !!OPEN_GEOMS[g];

/* Where text sits inside a shape, as a fraction of the box, for the presets
   whose usable area is clearly smaller than their bounds. */
const TEXT_RECTS = {
  diamond: [0.25, 0.25, 0.5, 0.5], flowChartDecision: [0.25, 0.25, 0.5, 0.5],
  triangle: [0.25, 0.5, 0.5, 0.5], rtTriangle: [0.06, 0.5, 0.56, 0.44],
  ellipse: [0.15, 0.15, 0.7, 0.7], flowChartConnector: [0.15, 0.15, 0.7, 0.7],
  star5: [0.26, 0.3, 0.48, 0.42], star4: [0.3, 0.3, 0.4, 0.4],
  rightArrow: [0.04, 0.3, 0.72, 0.4], leftArrow: [0.24, 0.3, 0.72, 0.4],
  upArrow: [0.3, 0.24, 0.4, 0.72], downArrow: [0.3, 0.04, 0.4, 0.72],
  chevron: [0.2, 0.1, 0.6, 0.8], homePlate: [0.06, 0.1, 0.72, 0.8],
  hexagon: [0.16, 0.06, 0.68, 0.88], pentagon: [0.2, 0.2, 0.6, 0.6],
  teardrop: [0.14, 0.14, 0.62, 0.72], heart: [0.2, 0.26, 0.6, 0.44],
  cloud: [0.16, 0.26, 0.68, 0.5], can: [0.08, 0.26, 0.84, 0.5],
  flowChartInputOutput: [0.2, 0.06, 0.6, 0.88], parallelogram: [0.18, 0.06, 0.64, 0.88],
  trapezoid: [0.18, 0.1, 0.64, 0.8], blockArc: [0.2, 0.2, 0.6, 0.6], donut: [0.28, 0.28, 0.44, 0.44]
};

/* --------------------------------------------------------------------------
   Public helpers
   -------------------------------------------------------------------------- */
function geomPath(geom, w, h, adj) {
  w = Math.max(0.01, +w || 0); h = Math.max(0.01, +h || 0);
  const fn = PRESETS[geom] || PRESETS[GEOM_FALLBACK];
  try { return fn(w, h, adj || {}); }
  catch (e) { return PRESETS.rect(w, h); }
}
function geomTextRect(geom, w, h) {
  const t = TEXT_RECTS[geom];
  if (!t) return { x: 0, y: 0, w, h };
  return { x: w * t[0], y: h * t[1], w: w * t[2], h: h * t[3] };
}
const hasPreset = (g) => !!PRESETS[g];

/* custGeom: translate the OOXML path command list into SVG path data.
   The source coordinates live in the shape's own <a:path w=.. h=..> space, so
   everything is scaled into the element box on the way through. */
function custGeomPath(paths, w, h) {
  let out = '';
  for (const p of paths || []) {
    const sx = p.w ? w / p.w : 1, sy = p.h ? h / p.h : 1;
    const X = (v) => (v * sx).toFixed(3), Y = (v) => (v * sy).toFixed(3);
    for (const c of p.cmds || []) {
      const pt = c.pts || [];
      if (c.t === 'moveTo' && pt[0]) out += 'M' + X(pt[0].x) + ',' + Y(pt[0].y);
      else if (c.t === 'lnTo' && pt[0]) out += 'L' + X(pt[0].x) + ',' + Y(pt[0].y);
      else if (c.t === 'cubicBezTo' && pt.length >= 3) {
        out += 'C' + X(pt[0].x) + ',' + Y(pt[0].y) + ' ' + X(pt[1].x) + ',' + Y(pt[1].y) + ' ' + X(pt[2].x) + ',' + Y(pt[2].y);
      } else if (c.t === 'quadBezTo' && pt.length >= 2) {
        out += 'Q' + X(pt[0].x) + ',' + Y(pt[0].y) + ' ' + X(pt[1].x) + ',' + Y(pt[1].y);
      } else if (c.t === 'arcTo') {
        /* <a:arcTo> gives radii plus a start angle and a swept angle. SVG's A
           command wants an end point instead, so the sweep is integrated to
           find where the pen lands; angles are 60000ths of a degree. */
        const wR = (c.wR || 0) * sx, hR = (c.hR || 0) * sy;
        const st = (c.stAng || 0) / 60000 * Math.PI / 180, sw = (c.swAng || 0) / 60000 * Math.PI / 180;
        const cur = _lastPoint(out);
        if (cur && (wR || hR)) {
          const cx = cur.x - wR * Math.cos(st), cy = cur.y - hR * Math.sin(st);
          const ex = cx + wR * Math.cos(st + sw), ey = cy + hR * Math.sin(st + sw);
          const large = Math.abs(sw) > Math.PI ? 1 : 0, sweep = sw > 0 ? 1 : 0;
          out += 'A' + Math.abs(wR).toFixed(3) + ',' + Math.abs(hR).toFixed(3) + ' 0 ' + large + ' ' + sweep + ' ' + ex.toFixed(3) + ',' + ey.toFixed(3);
        }
      } else if (c.t === 'close') out += 'Z';
    }
  }
  return out || PRESETS.rect(w, h);
}
/* Walk back through emitted path data for the current pen position — arcTo is
   relative to it and SVG does not expose it. */
function _lastPoint(d) {
  const m = String(d).match(/[-\d.]+\s*,\s*[-\d.]+(?!.*[-\d.]+\s*,\s*[-\d.]+)/s);
  if (!m) return null;
  const parts = m[0].split(',');
  return { x: parseFloat(parts[0]), y: parseFloat(parts[1]) };
}

/* The shapes offered in the insert menu, grouped the way users look for them. */
const SHAPE_MENU = [
  { group: 'Basic', items: ['rect', 'roundRect', 'ellipse', 'triangle', 'rtTriangle', 'diamond', 'parallelogram', 'trapezoid', 'pentagon', 'hexagon', 'octagon', 'plus', 'can', 'cube', 'donut', 'frame', 'corner', 'bevel', 'teardrop', 'heart', 'lightningBolt', 'sun', 'moon', 'cloud', 'smileyFace'] },
  { group: 'Arrows', items: ['rightArrow', 'leftArrow', 'upArrow', 'downArrow', 'leftRightArrow', 'upDownArrow', 'quadArrow', 'notchedRightArrow', 'homePlate', 'chevron', 'bentArrow', 'curvedRightArrow'] },
  { group: 'Stars', items: ['star4', 'star5', 'star6', 'star8', 'star10', 'star12', 'star16', 'star24', 'irregularSeal1'] },
  { group: 'Flowchart', items: ['flowChartProcess', 'flowChartAlternateProcess', 'flowChartDecision', 'flowChartInputOutput', 'flowChartTerminator', 'flowChartPreparation', 'flowChartDocument', 'flowChartPredefinedProcess', 'flowChartConnector', 'flowChartManualInput', 'flowChartManualOperation', 'flowChartDelay', 'flowChartMagneticDisk', 'flowChartDisplay', 'flowChartOffpageConnector'] },
  { group: 'Maths', items: ['mathPlus', 'mathMinus', 'mathMultiply', 'mathDivide', 'mathEqual', 'mathNotEqual'] },
  { group: 'Banners', items: ['ribbon', 'wave', 'doubleWave', 'verticalScroll', 'horizontalScroll'] },
  { group: 'Callouts', items: ['wedgeRectCallout', 'wedgeRoundRectCallout', 'wedgeEllipseCallout'] },
  { group: 'Brackets', items: ['bracketPair', 'bracePair', 'leftBracket', 'rightBracket', 'leftBrace', 'rightBrace'] },
  { group: 'Lines', items: ['line', 'bentConnector3', 'curvedConnector3', 'arc'] }
];

const SHAPE_LABELS = {
  rect: 'Rectangle', roundRect: 'Rounded rectangle', ellipse: 'Ellipse', triangle: 'Triangle',
  rtTriangle: 'Right triangle', diamond: 'Diamond', parallelogram: 'Parallelogram', trapezoid: 'Trapezoid',
  pentagon: 'Pentagon', hexagon: 'Hexagon', octagon: 'Octagon', plus: 'Cross', can: 'Cylinder', cube: 'Cube',
  donut: 'Ring', frame: 'Frame', corner: 'Corner', bevel: 'Bevel', teardrop: 'Teardrop', heart: 'Heart',
  lightningBolt: 'Lightning bolt', sun: 'Sun', moon: 'Moon', cloud: 'Cloud', smileyFace: 'Smiley',
  rightArrow: 'Arrow right', leftArrow: 'Arrow left', upArrow: 'Arrow up', downArrow: 'Arrow down',
  leftRightArrow: 'Arrow left-right', upDownArrow: 'Arrow up-down', quadArrow: 'Arrow, four way',
  notchedRightArrow: 'Notched arrow', homePlate: 'Pentagon arrow', chevron: 'Chevron',
  bentArrow: 'Bent arrow', curvedRightArrow: 'Curved arrow',
  star4: '4-point star', star5: '5-point star', star6: '6-point star', star8: '8-point star',
  star10: '10-point star', star12: '12-point star', star16: '16-point star', star24: '24-point star',
  irregularSeal1: 'Explosion',
  flowChartProcess: 'Process', flowChartAlternateProcess: 'Alternate process', flowChartDecision: 'Decision',
  flowChartInputOutput: 'Data', flowChartTerminator: 'Terminator', flowChartPreparation: 'Preparation',
  flowChartDocument: 'Document', flowChartPredefinedProcess: 'Predefined process', flowChartConnector: 'Connector',
  flowChartManualInput: 'Manual input', flowChartManualOperation: 'Manual operation', flowChartDelay: 'Delay',
  flowChartMagneticDisk: 'Database', flowChartDisplay: 'Display', flowChartOffpageConnector: 'Off-page connector',
  mathPlus: 'Plus', mathMinus: 'Minus', mathMultiply: 'Multiply', mathDivide: 'Divide',
  mathEqual: 'Equal', mathNotEqual: 'Not equal',
  ribbon: 'Ribbon', wave: 'Wave', doubleWave: 'Double wave', verticalScroll: 'Vertical scroll',
  horizontalScroll: 'Horizontal scroll',
  wedgeRectCallout: 'Rectangular callout', wedgeRoundRectCallout: 'Rounded callout', wedgeEllipseCallout: 'Oval callout',
  bracketPair: 'Brackets', bracePair: 'Braces', leftBracket: 'Left bracket', rightBracket: 'Right bracket',
  leftBrace: 'Left brace', rightBrace: 'Right brace',
  line: 'Line', bentConnector3: 'Elbow connector', curvedConnector3: 'Curved connector', arc: 'Arc'
};
const shapeLabel = (g) => SHAPE_LABELS[g] || g;
