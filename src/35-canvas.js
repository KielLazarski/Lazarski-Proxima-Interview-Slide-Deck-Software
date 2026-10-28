/* ==========================================================================
   35-canvas.js — the editing surface: mounting, selection, drag, resize,
   rotate, snapping, marquee, and the on-canvas table grid.

   The slide is rendered at true size and scaled with one CSS transform. The
   selection overlay is a sibling in unscaled screen space, so handles stay a
   constant size at every zoom — the alternative, putting handles inside the
   scaled layer, makes them microscopic at 25% and gigantic at 400%.
   ========================================================================== */

const HANDLE_HIT = 9;        /* px, pointer slop around a handle */
const SNAP_PX = 6;           /* px on screen, converted to model units */
const Canvas = {
  wrap: null, pad: null, stage: null, overlay: null,
  scale: 1, drag: null, marquee: null
};

function mountCanvas(host) {
  Canvas.wrap = el('div', { class: 'cv-wrap', tabindex: '0' });
  Canvas.pad = el('div', { class: 'cv-pad' });
  Canvas.stage = el('div', { class: 'cv-stage-host' });
  Canvas.overlay = el('div', { class: 'cv-overlay' });
  Canvas.pad.appendChild(Canvas.stage);
  Canvas.pad.appendChild(Canvas.overlay);
  Canvas.wrap.appendChild(Canvas.pad);
  host.appendChild(Canvas.wrap);

  Canvas.wrap.addEventListener('pointerdown', onCanvasPointerDown);
  Canvas.wrap.addEventListener('dblclick', onCanvasDblClick);
  Canvas.wrap.addEventListener('contextmenu', onCanvasContextMenu);
  Canvas.wrap.addEventListener('wheel', onCanvasWheel, { passive: false });
  window.addEventListener('resize', debounce(() => { if (App.zoom === 'fit') layoutCanvas(); }, 80));
  return Canvas.wrap;
}

/* ---------- geometry between screen and slide ---------- */

const stageRect = () => Canvas.stage.getBoundingClientRect();
function toModel(clientX, clientY) {
  const r = stageRect();
  return { x: (clientX - r.left) / Canvas.scale, y: (clientY - r.top) / Canvas.scale };
}
const toScreen = (x, y) => ({ x: x * Canvas.scale, y: y * Canvas.scale });

function fitScale() {
  const W = App.deck.size.w, H = App.deck.size.h;
  const avail = Canvas.wrap.getBoundingClientRect();
  const padPx = 56;
  const k = Math.min((avail.width - padPx) / W, (avail.height - padPx) / H);
  return clamp(k, 0.05, 4);
}
function layoutCanvas() {
  if (!App.deck) return;
  const W = App.deck.size.w, H = App.deck.size.h;
  Canvas.scale = App.zoom === 'fit' ? fitScale() : clamp(+App.zoom, 0.05, 8);
  Canvas.stage.style.width = W + 'px';
  Canvas.stage.style.height = H + 'px';
  Canvas.stage.style.transform = 'scale(' + Canvas.scale + ')';
  const sw = W * Canvas.scale, sh = H * Canvas.scale;
  Canvas.pad.style.width = sw + 'px';
  Canvas.pad.style.height = sh + 'px';
  Canvas.overlay.style.width = sw + 'px';
  Canvas.overlay.style.height = sh + 'px';
  drawOverlay();
  const zl = $('#zoomLabel');
  if (zl) zl.textContent = Math.round(Canvas.scale * 100) + '%';
}

/* ---------- rendering the slide into the stage ---------- */

function renderCanvas() {
  const s = curSlide();
  if (!s) return;
  const editingId = App.editing;
  Canvas.stage.textContent = '';
  const node = renderSlide(s, App.deck, { prompts: true, interactive: true });
  node.classList.add('cv-slide');
  Canvas.stage.appendChild(node);
  Canvas.stage.style.background = 'transparent';
  layoutCanvas();
  /* Autofit needs the node in the document and at known scale. */
  try { applyAutofit(node, s, App.deck); } catch (e) { /* non-fatal */ }
  if (App.grid) node.classList.add('cv-grid');
  if (editingId && findElement(s, editingId)) startTextEdit(editingId, { silent: true });
  drawOverlay();
}

/* ---------- hit testing ---------- */

function elementAt(mx, my, opts) {
  const s = curSlide();
  if (!s) return null;
  /* Topmost first: the later an element appears in the array, the higher it
     sits, matching how the renderer stacks them. */
  for (let i = s.elements.length - 1; i >= 0; i--) {
    const e = s.elements[i];
    if (e.hidden) continue;
    if (hitElement(e, mx, my)) return e;
  }
  return null;
}
function hitElement(e, mx, my) {
  /* Work in the element's own unrotated frame. */
  const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
  let p = { x: mx, y: my };
  if (e.rot) p = rotatePoint(mx, my, cx, cy, -e.rot);
  const inBox = p.x >= e.x - 1 && p.x <= e.x + e.w + 1 && p.y >= e.y - 1 && p.y <= e.y + e.h + 1;
  if (!inBox) return false;
  /* Lines and other open shapes are thin: hit near the stroke, not the box,
     or a diagonal line would swallow the whole rectangle it spans. */
  if (e.type === 'line' || isOpenGeom(e.geom)) {
    const tol = Math.max(4, (e.line && e.line.w ? e.line.w : 2) * 1.5) / Canvas.scale;
    return nearPath(e, p.x - e.x, p.y - e.y, tol);
  }
  /* An unfilled text box is still grabbable anywhere inside it — users expect
     to click the empty part of a text frame and get the frame. */
  return true;
}
/* Distance from a point to the element's path, sampled. Cheap and accurate
   enough for a hit test, and avoids needing an SVG hit-testing context. */
function nearPath(e, lx, ly, tol) {
  const d = e.custPath ? custGeomPath(e.custPath, e.w, e.h) : geomPath(e.geom || 'line', e.w, e.h, e.adj);
  const pts = samplePath(d, 64);
  for (let i = 1; i < pts.length; i++) {
    if (distToSeg(lx, ly, pts[i - 1], pts[i]) <= tol) return true;
  }
  return false;
}
let _pathProbe = null;
function samplePath(d, n) {
  if (!_pathProbe) {
    const svg = svgEl('svg', { width: 0, height: 0, style: 'position:absolute;left:-9999px' });
    _pathProbe = svgEl('path');
    svg.appendChild(_pathProbe);
    document.body.appendChild(svg);
  }
  _pathProbe.setAttribute('d', d);
  let L = 0;
  try { L = _pathProbe.getTotalLength(); } catch (err) { return []; }
  if (!L) return [];
  const out = [];
  for (let i = 0; i <= n; i++) {
    try { const p = _pathProbe.getPointAtLength(L * i / n); out.push({ x: p.x, y: p.y }); } catch (err) { break; }
  }
  return out;
}
function distToSeg(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L2 = dx * dx + dy * dy;
  let t = L2 ? ((px - a.x) * dx + (py - a.y) * dy) / L2 : 0;
  t = clamp(t, 0, 1);
  const qx = a.x + t * dx, qy = a.y + t * dy;
  return Math.hypot(px - qx, py - qy);
}

/* ---------- selection overlay ---------- */

const HANDLES = [
  { k: 'nw', x: 0, y: 0 }, { k: 'n', x: 0.5, y: 0 }, { k: 'ne', x: 1, y: 0 },
  { k: 'e', x: 1, y: 0.5 }, { k: 'se', x: 1, y: 1 }, { k: 's', x: 0.5, y: 1 },
  { k: 'sw', x: 0, y: 1 }, { k: 'w', x: 0, y: 0.5 }
];

function drawOverlay() {
  const ov = Canvas.overlay;
  if (!ov) return;
  ov.textContent = '';
  const s = curSlide();
  if (!s) return;
  const els = selElements();
  const k = Canvas.scale;

  /* Alignment guides produced by the live drag. */
  if (Canvas.drag && Canvas.drag.guides) {
    for (const g of Canvas.drag.guides) {
      ov.appendChild(el('div', {
        class: 'cv-guide cv-guide-' + g.axis,
        style: g.axis === 'v'
          ? { left: round2(g.at * k) + 'px', top: '0px', height: '100%' }
          : { top: round2(g.at * k) + 'px', left: '0px', width: '100%' }
      }));
    }
  }
  if (Canvas.marquee) {
    const m = Canvas.marquee;
    ov.appendChild(el('div', {
      class: 'cv-marquee',
      style: {
        left: round2(Math.min(m.x0, m.x1) * k) + 'px', top: round2(Math.min(m.y0, m.y1) * k) + 'px',
        width: round2(Math.abs(m.x1 - m.x0) * k) + 'px', height: round2(Math.abs(m.y1 - m.y0) * k) + 'px'
      }
    }));
  }
  if (!els.length) return;

  const editing = App.editing;
  for (const e of els) {
    const box = el('div', { class: 'cv-selbox' + (editing === e.id ? ' cv-editing' : ''), dataset: { id: e.id } });
    box.style.left = round2(e.x * k) + 'px';
    box.style.top = round2(e.y * k) + 'px';
    box.style.width = round2(e.w * k) + 'px';
    box.style.height = round2(e.h * k) + 'px';
    if (e.rot) box.style.transform = 'rotate(' + round2(e.rot) + 'deg)';
    ov.appendChild(box);
  }
  /* Handles go on a single box: the one selected element, or the bounding box
     of several. Resizing a rotated multi-selection is not well defined, so the
     overlay offers move-only there. */
  const single = els.length === 1 ? els[0] : null;
  if (single && !single.locked && editing !== single.id) {
    const hb = el('div', { class: 'cv-handles' });
    hb.style.left = round2(single.x * k) + 'px';
    hb.style.top = round2(single.y * k) + 'px';
    hb.style.width = round2(single.w * k) + 'px';
    hb.style.height = round2(single.h * k) + 'px';
    if (single.rot) hb.style.transform = 'rotate(' + round2(single.rot) + 'deg)';
    const linear = single.type === 'line' || isOpenGeom(single.geom);
    for (const h of HANDLES) {
      if (linear && h.k !== 'nw' && h.k !== 'se') continue;   /* endpoints only */
      hb.appendChild(el('div', {
        class: 'cv-h cv-h-' + h.k, dataset: { h: h.k },
        style: { left: round2(h.x * 100) + '%', top: round2(h.y * 100) + '%' }
      }));
    }
    hb.appendChild(el('div', { class: 'cv-rot', dataset: { h: 'rot' } }));
    ov.appendChild(hb);
    if (single.type === 'shape' && ADJUSTABLE[single.geom]) addAdjustHandle(hb, single);
  } else if (els.length > 1) {
    const u = unionRect(els.map((e) => rotatedBounds(elementBox(e))));
    const hb = el('div', { class: 'cv-handles cv-multi' });
    hb.style.left = round2(u.x * k) + 'px'; hb.style.top = round2(u.y * k) + 'px';
    hb.style.width = round2(u.w * k) + 'px'; hb.style.height = round2(u.h * k) + 'px';
    for (const h of HANDLES) {
      hb.appendChild(el('div', { class: 'cv-h cv-h-' + h.k, dataset: { h: h.k, multi: '1' }, style: { left: round2(h.x * 100) + '%', top: round2(h.y * 100) + '%' } }));
    }
    ov.appendChild(hb);
  }
  /* Table grid handles for column and row edges. */
  if (single && single.type === 'table' && editing !== single.id) addTableHandles(ov, single);
}

/* Shapes whose first adjust value is worth exposing as a yellow handle. */
const ADJUSTABLE = {
  roundRect: { axis: 'x', max: 50000 }, round1Rect: { axis: 'x', max: 50000 },
  snip1Rect: { axis: 'x', max: 50000 }, hexagon: { axis: 'x', max: 100000 },
  octagon: { axis: 'x', max: 50000 }, parallelogram: { axis: 'x', max: 100000 },
  trapezoid: { axis: 'x', max: 100000 }, chevron: { axis: 'x', max: 100000 },
  homePlate: { axis: 'x', max: 100000 }, plus: { axis: 'x', max: 50000 },
  triangle: { axis: 'x', max: 100000 }, donut: { axis: 'x', max: 50000 },
  frame: { axis: 'x', max: 50000 }, bevel: { axis: 'x', max: 50000 },
  rightArrow: { axis: 'y', max: 100000, key: 'adj1' }, leftArrow: { axis: 'y', max: 100000, key: 'adj1' },
  upArrow: { axis: 'x', max: 100000, key: 'adj1' }, downArrow: { axis: 'x', max: 100000, key: 'adj1' },
  leftRightArrow: { axis: 'y', max: 100000, key: 'adj1' }, upDownArrow: { axis: 'x', max: 100000, key: 'adj1' },
  wave: { axis: 'y', max: 20000, key: 'adj1' }, cube: { axis: 'x', max: 100000 },
  diagStripe: { axis: 'x', max: 100000 }, corner: { axis: 'x', max: 100000, key: 'adj1' }
};
function addAdjustHandle(hb, e) {
  const cfg = ADJUSTABLE[e.geom];
  const key = cfg.key || 'adj';
  const v = (e.adj && e.adj[key] !== undefined) ? e.adj[key] : defaultAdj(e.geom, key);
  const frac = clamp(v / cfg.max, 0, 1);
  hb.appendChild(el('div', {
    class: 'cv-adj', dataset: { h: 'adj', key },
    style: cfg.axis === 'x'
      ? { left: round2(frac * 50) + '%', top: '0%' }
      : { left: '100%', top: round2(frac * 50) + '%' }
  }));
}
function defaultAdj(geom, key) {
  const probe = { roundRect: 16667, hexagon: 25000, octagon: 29289, parallelogram: 25000, trapezoid: 25000, chevron: 50000, homePlate: 50000, plus: 25000, triangle: 50000, donut: 25000, frame: 12500, bevel: 12500, cube: 25000, diagStripe: 50000, snip1Rect: 16667, round1Rect: 16667 };
  if (probe[geom] !== undefined) return probe[geom];
  if (geom === 'wave') return 12500;
  return 50000;
}

function addTableHandles(ov, e) {
  const k = Canvas.scale;
  let x = 0;
  e.table.cols.forEach((cw, i) => {
    x += cw;
    if (i === e.table.cols.length - 1) return;
    ov.appendChild(el('div', {
      class: 'cv-tcol', dataset: { col: i },
      style: { left: round2((e.x + x) * k) + 'px', top: round2(e.y * k) + 'px', height: round2(e.h * k) + 'px' }
    }));
  });
  let y = 0;
  e.table.rows.forEach((row, i) => {
    y += row.h;
    if (i === e.table.rows.length - 1) return;
    ov.appendChild(el('div', {
      class: 'cv-trow', dataset: { row: i },
      style: { top: round2((e.y + y) * k) + 'px', left: round2(e.x * k) + 'px', width: round2(e.w * k) + 'px' }
    }));
  });
}

/* ---------- pointer interaction ---------- */

function onCanvasPointerDown(ev) {
  if (ev.button === 2) return;                  /* context menu path */
  if (ev.target.closest('.sp-text[contenteditable="true"]')) return;   /* typing */
  const m = toModel(ev.clientX, ev.clientY);
  const handleEl = ev.target.closest('.cv-h, .cv-rot, .cv-adj, .cv-tcol, .cv-trow');
  Canvas.wrap.focus({ preventScroll: true });

  if (handleEl) {
    const kind = handleEl.dataset.h;
    if (handleEl.classList.contains('cv-tcol')) return startTableResize(ev, 'col', +handleEl.dataset.col);
    if (handleEl.classList.contains('cv-trow')) return startTableResize(ev, 'row', +handleEl.dataset.row);
    if (kind === 'rot') return startRotate(ev);
    if (kind === 'adj') return startAdjust(ev, handleEl.dataset.key);
    return startResize(ev, kind, handleEl.dataset.multi === '1');
  }

  const hit = elementAt(m.x, m.y);
  if (hit) {
    if (ev.shiftKey || ev.metaKey || ev.ctrlKey) select([hit.id], true);
    else if (App.sel.indexOf(hit.id) < 0) select([hit.id]);
    if (App.editing && App.editing !== hit.id) endTextEdit();
    /* Clicking inside a table while it is selected picks a cell. */
    if (hit.type === 'table' && App.sel.length === 1 && App.sel[0] === hit.id) {
      const cell = cellAt(hit, m.x, m.y);
      if (cell) { hit._cellSel = { r0: cell.r, c0: cell.c, r1: cell.r, c1: cell.c }; }
    }
    if (!hit.locked) startMove(ev, m);
    return;
  }
  if (!ev.shiftKey) { endTextEdit(); clearSelection(); }
  startMarquee(ev, m);
}

function dragLoop(ev, onMove, onDone) {
  const move = (e) => { onMove(e); };
  const up = (e) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', esc, true);
    onDone(e, false);
  };
  const cancel = (e) => { up(e); };
  const esc = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', esc, true);
      onDone(e, true);
    }
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', esc, true);
}

/* ---------- move ---------- */

function startMove(ev, m0) {
  const els = selElements().filter((e) => !e.locked);
  if (!els.length) return;
  ev.preventDefault();
  const start = els.map((e) => ({ e, x: e.x, y: e.y }));
  let moved = false;
  beginBatch('Move');
  Canvas.drag = { kind: 'move', guides: [] };

  dragLoop(ev, (e) => {
    const m = toModel(e.clientX, e.clientY);
    let dx = m.x - m0.x, dy = m.y - m0.y;
    if (!moved && Math.abs(dx) * Canvas.scale < 2 && Math.abs(dy) * Canvas.scale < 2) return;
    moved = true;
    if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }   /* constrain to one axis */
    const snapOn = App.snap && !e.altKey;
    let guides = [];
    if (snapOn) {
      const box = unionRect(start.map((s) => ({ x: s.x + dx, y: s.y + dy, w: s.e.w, h: s.e.h })));
      const sn = snapBox(box, els.map((x) => x.id));
      dx += sn.dx; dy += sn.dy; guides = sn.guides;
    }
    for (const s of start) { s.e.x = round2(s.x + dx); s.e.y = round2(s.y + dy); }
    Canvas.drag.guides = guides;
    syncSelectedNodes();
  }, (e, cancelled) => {
    Canvas.drag = null;
    if (cancelled || !moved) {
      for (const s of start) { s.e.x = s.x; s.e.y = s.y; }
      endBatch(false);
      renderCanvas();
      return;
    }
    endBatch(true);
    App.dirty = true;
    refreshThumb(App.cur);
    drawOverlay();
    markDirtyUI();
  });
}

/* Update the DOM for the dragged elements only. Re-rendering the whole slide
   on every pointermove is visibly slow once a slide has a few dozen shapes. */
function syncSelectedNodes() {
  const slide = curSlide();
  for (const e of selElements()) {
    const node = Canvas.stage.querySelector('.sp-el[data-id="' + cssEscape(e.id) + '"]');
    if (node) {
      node.style.left = round2(e.x) + 'px'; node.style.top = round2(e.y) + 'px';
      node.style.width = round2(Math.max(0, e.w)) + 'px'; node.style.height = round2(Math.max(0, e.h)) + 'px';
      node.style.transform = e.rot ? 'rotate(' + round2(e.rot) + 'deg)' : '';
    }
  }
  drawOverlay();
}

/* ---------- snapping ---------- */

function snapTargets(excludeIds) {
  const s = curSlide();
  const W = App.deck.size.w, H = App.deck.size.h;
  const v = [0, W / 2, W], h = [0, H / 2, H];
  const skip = new Set(excludeIds || []);
  for (const e of s.elements) {
    if (skip.has(e.id) || e.hidden) continue;
    const b = rotatedBounds(elementBox(e));
    v.push(b.x, b.x + b.w / 2, b.x + b.w);
    h.push(b.y, b.y + b.h / 2, b.y + b.h);
  }
  return { v, h };
}
function snapBox(box, excludeIds) {
  const tol = SNAP_PX / Canvas.scale;
  const t = snapTargets(excludeIds);
  const guides = [];
  let dx = 0, dy = 0, bestX = tol + 1, bestY = tol + 1;
  const mine = { v: [box.x, box.x + box.w / 2, box.x + box.w], h: [box.y, box.y + box.h / 2, box.y + box.h] };
  for (const my of mine.v) for (const at of t.v) {
    const d = at - my;
    if (Math.abs(d) < Math.abs(bestX)) { bestX = d; dx = d; }
  }
  for (const my of mine.h) for (const at of t.h) {
    const d = at - my;
    if (Math.abs(d) < Math.abs(bestY)) { bestY = d; dy = d; }
  }
  if (Math.abs(dx) > tol) dx = 0;
  if (Math.abs(dy) > tol) dy = 0;
  if (dx) for (const my of mine.v) for (const at of t.v) if (Math.abs(at - (my + dx)) < 0.02) guides.push({ axis: 'v', at });
  if (dy) for (const my of mine.h) for (const at of t.h) if (Math.abs(at - (my + dy)) < 0.02) guides.push({ axis: 'h', at });
  /* Dedupe so one guide is not drawn three times. */
  const seen = new Set();
  return { dx, dy, guides: guides.filter((g) => { const k = g.axis + g.at.toFixed(2); if (seen.has(k)) return false; seen.add(k); return true; }) };
}

/* ---------- resize ---------- */

function startResize(ev, which, multi) {
  ev.preventDefault(); ev.stopPropagation();
  const els = selElements().filter((e) => !e.locked);
  if (!els.length) return;
  const m0 = toModel(ev.clientX, ev.clientY);
  const base = multi
    ? unionRect(els.map((e) => rotatedBounds(elementBox(e))))
    : { x: els[0].x, y: els[0].y, w: els[0].w, h: els[0].h };
  const start = els.map((e) => ({ e, x: e.x, y: e.y, w: e.w, h: e.h, body: e.body ? deepCopy(e.body) : null, table: e.table ? deepCopy(e.table) : null, line: e.line ? deepCopy(e.line) : null }));
  const rot = (!multi && els[0].rot) || 0;
  const west = /w/.test(which), east = /e/.test(which), north = /^n/.test(which), south = /^s/.test(which);
  let moved = false;
  beginBatch('Resize');
  Canvas.drag = { kind: 'resize', guides: [] };

  dragLoop(ev, (e) => {
    let m = toModel(e.clientX, e.clientY);
    /* For a rotated element the pointer delta has to be expressed in the
       element's own frame, or dragging the east handle on a 30° box drifts. */
    let d = { x: m.x - m0.x, y: m.y - m0.y };
    if (rot) {
      const r = -rot * Math.PI / 180;
      d = { x: d.x * Math.cos(r) - d.y * Math.sin(r), y: d.x * Math.sin(r) + d.y * Math.cos(r) };
    }
    if (!moved && Math.hypot(d.x, d.y) * Canvas.scale < 2) return;
    moved = true;

    let nx = base.x, ny = base.y, nw = base.w, nh = base.h;
    if (east) nw = base.w + d.x;
    if (west) { nw = base.w - d.x; nx = base.x + d.x; }
    if (south) nh = base.h + d.y;
    if (north) { nh = base.h - d.y; ny = base.y + d.y; }

    /* Shift keeps the aspect ratio; images default to it, since squashing a
       photo is almost never what is wanted. */
    const keepRatio = e.shiftKey || (!e.altKey && els.length === 1 && els[0].type === 'image' && /nw|ne|sw|se/.test(which));
    if (keepRatio && base.w > 0 && base.h > 0) {
      const ar = base.w / base.h;
      if (/nw|ne|sw|se/.test(which)) {
        if (Math.abs(nw / ar) > Math.abs(nh)) nh = nw / ar; else nw = nh * ar;
        if (west) nx = base.x + base.w - nw;
        if (north) ny = base.y + base.h - nh;
      }
    }
    const MIN = 4;
    if (nw < MIN) { if (west) nx = base.x + base.w - MIN; nw = MIN; }
    if (nh < MIN) { if (north) ny = base.y + base.h - MIN; nh = MIN; }

    if (App.snap && !e.altKey && !rot) {
      const sn = snapBox({ x: nx, y: ny, w: nw, h: nh }, els.map((x) => x.id));
      /* Only shift the edges being dragged, so snapping does not move the
         anchored side. */
      if (west && sn.dx) { nx += sn.dx; nw -= sn.dx; }
      else if (east && sn.dx) nw += sn.dx;
      if (north && sn.dy) { ny += sn.dy; nh -= sn.dy; }
      else if (south && sn.dy) nh += sn.dy;
      Canvas.drag.guides = sn.guides;
    }

    const kx = base.w ? nw / base.w : 1, ky = base.h ? nh / base.h : 1;
    for (const s of start) {
      if (multi) {
        s.e.x = round2(nx + (s.x - base.x) * kx);
        s.e.y = round2(ny + (s.y - base.y) * ky);
        s.e.w = round2(Math.max(MIN, s.w * kx));
        s.e.h = round2(Math.max(MIN, s.h * ky));
      } else {
        s.e.x = round2(nx); s.e.y = round2(ny);
        s.e.w = round2(nw); s.e.h = round2(nh);
      }
      if (s.e.type === 'table' && s.table) {
        s.e.table = deepCopy(s.table);
        const cw = s.table.cols.reduce((a, b) => a + b, 0) || 1;
        const ch = s.table.rows.reduce((a, r) => a + r.h, 0) || 1;
        const fx = s.e.w / cw, fy = s.e.h / ch;
        s.e.table.cols = s.table.cols.map((c) => c * fx);
        s.e.table.rows.forEach((r, i) => { r.h = s.table.rows[i].h * fy; });
        syncTableSize(s.e);
      }
      /* Alt scales the contents with the frame, which is what you want when
         enlarging a finished diagram. */
      if (e.altKey && s.body) {
        s.e.body = deepCopy(s.body);
        scaleElementText(s.e, Math.min(kx, ky));
      } else if (s.body) s.e.body = deepCopy(s.body);
    }
    renderResizePreview(start.map((s) => s.e));
  }, (e, cancelled) => {
    Canvas.drag = null;
    if (cancelled || !moved) {
      for (const s of start) { s.e.x = s.x; s.e.y = s.y; s.e.w = s.w; s.e.h = s.h; if (s.body) s.e.body = s.body; if (s.table) s.e.table = s.table; }
      endBatch(false);
    } else { endBatch(true); App.dirty = true; markDirtyUI(); refreshThumb(App.cur); }
    renderCanvas();
  });
}
/* Shapes must be redrawn as they resize (their path depends on w/h), so the
   preview replaces just those nodes rather than the whole slide. */
function renderResizePreview(els) {
  for (const e of els) {
    const old = Canvas.stage.querySelector('.sp-el[data-id="' + cssEscape(e.id) + '"]');
    if (!old) continue;
    const fresh = renderElement(e, App.deck, { prompts: true });
    old.replaceWith(fresh);
  }
  drawOverlay();
}

/* ---------- rotate ---------- */

function startRotate(ev) {
  ev.preventDefault(); ev.stopPropagation();
  const e0 = selOne();
  if (!e0 || e0.locked) return;
  const cx = e0.x + e0.w / 2, cy = e0.y + e0.h / 2;
  const m0 = toModel(ev.clientX, ev.clientY);
  const a0 = Math.atan2(m0.y - cy, m0.x - cx) * 180 / Math.PI;
  const r0 = e0.rot || 0;
  let moved = false;
  beginBatch('Rotate');
  Canvas.drag = { kind: 'rotate' };
  dragLoop(ev, (e) => {
    const m = toModel(e.clientX, e.clientY);
    const a = Math.atan2(m.y - cy, m.x - cx) * 180 / Math.PI;
    let r = r0 + (a - a0);
    /* Unmodified rotation snaps to 15°; Alt gives free rotation. */
    if (!e.altKey) r = Math.round(r / 15) * 15;
    r = ((r % 360) + 360) % 360;
    if (Math.abs(r - (e0.rot || 0)) < 0.01) return;
    moved = true;
    e0.rot = round2(r);
    const node = Canvas.stage.querySelector('.sp-el[data-id="' + cssEscape(e0.id) + '"]');
    if (node) node.style.transform = 'rotate(' + e0.rot + 'deg)';
    drawOverlay();
    showHud(Math.round(r) + '°');
  }, (e, cancelled) => {
    Canvas.drag = null; hideHud();
    if (cancelled || !moved) { e0.rot = r0; endBatch(false); }
    else { endBatch(true); App.dirty = true; markDirtyUI(); refreshThumb(App.cur); }
    renderCanvas();
  });
}

/* ---------- shape adjust handle ---------- */

function startAdjust(ev, key) {
  ev.preventDefault(); ev.stopPropagation();
  const e0 = selOne();
  if (!e0) return;
  const cfg = ADJUSTABLE[e0.geom];
  if (!cfg) return;
  const m0 = toModel(ev.clientX, ev.clientY);
  const v0 = (e0.adj && e0.adj[key] !== undefined) ? e0.adj[key] : defaultAdj(e0.geom, key);
  let moved = false;
  beginBatch('Adjust shape');
  dragLoop(ev, (e) => {
    const m = toModel(e.clientX, e.clientY);
    const span = cfg.axis === 'x' ? e0.w / 2 : e0.h / 2;
    const d = cfg.axis === 'x' ? (m.x - m0.x) : (m.y - m0.y);
    const v = clamp(v0 + (d / Math.max(1, span)) * cfg.max, 0, cfg.max);
    moved = true;
    e0.adj = Object.assign({}, e0.adj, { [key]: Math.round(v) });
    renderResizePreview([e0]);
    showHud(Math.round(v / 1000) + '%');
  }, (e, cancelled) => {
    hideHud();
    if (cancelled || !moved) { endBatch(false); if (cancelled) e0.adj = Object.assign({}, e0.adj, { [key]: v0 }); }
    else { endBatch(true); App.dirty = true; markDirtyUI(); refreshThumb(App.cur); }
    renderCanvas();
  });
}

/* ---------- table column and row resize ---------- */

function startTableResize(ev, which, idx) {
  ev.preventDefault(); ev.stopPropagation();
  const e0 = selOne();
  if (!e0 || e0.type !== 'table') return;
  const m0 = toModel(ev.clientX, ev.clientY);
  const before = deepCopy(e0.table);
  let moved = false;
  beginBatch('Resize table');
  dragLoop(ev, (e) => {
    const m = toModel(e.clientX, e.clientY);
    moved = true;
    if (which === 'col') {
      const d = m.x - m0.x;
      const a = before.cols[idx], b = before.cols[idx + 1];
      const na = clamp(a + d, 16, a + b - 16);
      e0.table.cols[idx] = round2(na);
      e0.table.cols[idx + 1] = round2(a + b - na);
    } else {
      const d = m.y - m0.y;
      const a = before.rows[idx].h;
      e0.table.rows[idx].h = round2(Math.max(14, a + d));
    }
    syncTableSize(e0);
    renderResizePreview([e0]);
  }, (e, cancelled) => {
    if (cancelled || !moved) { e0.table = before; syncTableSize(e0); endBatch(false); }
    else { endBatch(true); App.dirty = true; markDirtyUI(); refreshThumb(App.cur); }
    renderCanvas();
  });
}
function cellAt(e, mx, my) {
  let y = e.y;
  for (let r = 0; r < e.table.rows.length; r++) {
    const row = e.table.rows[r];
    if (my >= y && my <= y + row.h) {
      let x = e.x;
      for (let c = 0; c < e.table.cols.length; c++) {
        if (mx >= x && mx <= x + e.table.cols[c]) return { r, c };
        x += e.table.cols[c];
      }
    }
    y += row.h;
  }
  return null;
}

/* ---------- marquee ---------- */

function startMarquee(ev, m0) {
  const additive = ev.shiftKey;
  const was = App.sel.slice();
  Canvas.marquee = { x0: m0.x, y0: m0.y, x1: m0.x, y1: m0.y };
  dragLoop(ev, (e) => {
    const m = toModel(e.clientX, e.clientY);
    Canvas.marquee.x1 = m.x; Canvas.marquee.y1 = m.y;
    const r = {
      x: Math.min(m0.x, m.x), y: Math.min(m0.y, m.y),
      w: Math.abs(m.x - m0.x), h: Math.abs(m.y - m0.y)
    };
    const hits = (curSlide().elements || []).filter((el2) => !el2.hidden && rectsOverlap(r, rotatedBounds(elementBox(el2)))).map((el2) => el2.id);
    App.sel = groupMembers(curSlide(), additive ? Array.from(new Set(was.concat(hits))) : hits);
    drawOverlay();
    refreshInspector();
  }, () => {
    Canvas.marquee = null;
    drawOverlay();
    refreshInspector();
  });
}

/* ---------- double click, wheel, context menu ---------- */

function onCanvasDblClick(ev) {
  const m = toModel(ev.clientX, ev.clientY);
  const hit = elementAt(m.x, m.y);
  if (!hit) { ev.preventDefault(); return; }
  if (hit.type === 'image') { openImageReplace(hit); return; }
  if (hit.type === 'table') {
    const cell = cellAt(hit, m.x, m.y);
    select([hit.id]);
    if (cell) startTableCellEdit(hit, cell.r, cell.c);
    return;
  }
  if (canHaveText(hit)) { select([hit.id]); startTextEdit(hit.id); }
}

function onCanvasWheel(ev) {
  if (!(ev.ctrlKey || ev.metaKey)) return;    /* plain wheel scrolls the pane */
  ev.preventDefault();
  const k = Canvas.scale * (ev.deltaY < 0 ? 1.1 : 1 / 1.1);
  App.zoom = clamp(k, 0.1, 8);
  layoutCanvas();
}

function onCanvasContextMenu(ev) {
  const m = toModel(ev.clientX, ev.clientY);
  const hit = elementAt(m.x, m.y);
  if (hit && App.sel.indexOf(hit.id) < 0) select([hit.id]);
  ev.preventDefault();
  showContextMenu(ev.clientX, ev.clientY, hit);
}

/* ---------- a transient readout for rotation and adjust drags ---------- */
let _hud = null;
function showHud(text) {
  if (!_hud) { _hud = el('div', { class: 'cv-hud' }); Canvas.wrap.appendChild(_hud); }
  _hud.textContent = text;
  _hud.style.display = 'block';
}
function hideHud() { if (_hud) _hud.style.display = 'none'; }

/* ---------- drawing a new shape by dragging ---------- */
let _pendingInsert = null;
function armInsert(kind, geom) {
  _pendingInsert = { kind, geom };
  Canvas.wrap.classList.add('cv-arm');
  const once = (ev) => {
    if (ev.button === 2) return;
    Canvas.wrap.removeEventListener('pointerdown', once, true);
    Canvas.wrap.classList.remove('cv-arm');
    const ins = _pendingInsert; _pendingInsert = null;
    if (!ins) return;
    ev.preventDefault(); ev.stopPropagation();
    const m0 = toModel(ev.clientX, ev.clientY);
    let box = null;
    const ghost = el('div', { class: 'cv-ghost' });
    Canvas.overlay.appendChild(ghost);
    dragLoop(ev, (e) => {
      const m = toModel(e.clientX, e.clientY);
      let w = m.x - m0.x, h = m.y - m0.y;
      if (e.shiftKey) { const s = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * s; h = Math.sign(h || 1) * s; }
      box = { x: Math.min(m0.x, m0.x + w), y: Math.min(m0.y, m0.y + h), w: Math.abs(w), h: Math.abs(h) };
      const k = Canvas.scale;
      ghost.style.left = round2(box.x * k) + 'px'; ghost.style.top = round2(box.y * k) + 'px';
      ghost.style.width = round2(box.w * k) + 'px'; ghost.style.height = round2(box.h * k) + 'px';
    }, (e, cancelled) => {
      ghost.remove();
      if (cancelled) return;
      /* A click with no drag gets a sensible default size rather than a
         zero-sized element the user then cannot find. */
      if (!box || box.w < 6 || box.h < 6) {
        const dflt = ins.kind === 'text' ? { w: 280, h: 48 } : ins.kind === 'table' ? { w: 480, h: 180 } : { w: 180, h: 120 };
        box = { x: m0.x, y: m0.y, w: dflt.w, h: dflt.h };
      }
      insertAtBox(ins, box);
    });
  };
  Canvas.wrap.addEventListener('pointerdown', once, true);
}
function insertAtBox(ins, box) {
  const W = App.deck.size.w, H = App.deck.size.h;
  const x = clamp(box.x, -box.w / 2, W - box.w / 2), y = clamp(box.y, -box.h / 2, H - box.h / 2);
  if (ins.kind === 'text') {
    addElement(mkElement('text', { x, y, w: box.w, h: box.h }), { edit: true });
  } else if (ins.kind === 'table') {
    const e = mkElement('table', { x, y, w: box.w, h: box.h });
    e.table = mkTable(3, 3, box.w, box.h);
    syncTableSize(e);
    addElement(e);
  } else if (ins.kind === 'line') {
    addElement(mkElement('line', { x, y, w: box.w, h: box.h, geom: ins.geom || 'line' }));
  } else {
    const open = isOpenGeom(ins.geom);
    App.lastShapeGeom = ins.geom;
    addElement(mkElement(open ? 'line' : 'shape', {
      x, y, w: box.w, h: box.h, geom: ins.geom,
      fill: open ? { type: 'none' } : { type: 'solid', color: { scheme: 'accent1' } },
      line: open ? { color: { scheme: 'tx1' }, w: 2, dash: 'solid' } : null
    }));
  }
}
