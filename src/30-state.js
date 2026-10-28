/* ==========================================================================
   30-state.js — application state, undo history, and every mutation.

   All changes to the deck go through commit(), which snapshots the deck before
   the change and pushes it on the undo stack. Snapshots rather than inverse
   operations: a deck is small enough that the memory cost is irrelevant, and
   it removes a whole class of bug where an undo handler drifts out of step
   with the operation it is supposed to reverse.

   Text editing is the exception, since a keystroke per snapshot would fill the
   stack. Those batch: beginTextEdit() takes one snapshot, endTextEdit()
   decides whether anything actually changed.
   ========================================================================== */

const APP_NAME = 'Custom Lazarski - Proxima Interview Slide Software';
const APP_BRAND = 'Custom Lazarski \u2013 Proxima Interview';
const APP_BRAND_SUB = 'Slide Software';
const APP_VERSION = '1.0.0';
const HISTORY_MAX = 80;

const App = {
  deck: null,
  cur: 0,
  sel: [],
  editing: null,
  zoom: 'fit',
  snap: true,
  guides: true,
  grid: false,
  clipboard: null,
  dirty: false,
  fileName: null,
  history: [],
  hi: -1,
  _batch: null,
  notesOpen: true,
  lastShapeGeom: 'rect'
};

const curSlide = () => (App.deck ? App.deck.slides[clamp(App.cur, 0, App.deck.slides.length - 1)] : null);
const theme = () => deckTheme(App.deck);
const selElements = () => {
  const s = curSlide(); if (!s) return [];
  return App.sel.map((id) => findElement(s, id)).filter(Boolean);
};
const selOne = () => (App.sel.length === 1 ? selElements()[0] || null : null);

/* ---------- history ---------- */

function snapshot() {
  return { deck: JSON.stringify(App.deck), cur: App.cur, sel: App.sel.slice() };
}
function pushHistory(snap) {
  App.history = App.history.slice(0, App.hi + 1);
  App.history.push(snap);
  if (App.history.length > HISTORY_MAX) App.history.shift();
  App.hi = App.history.length - 1;
}

/* commit(label, fn) — the single entry point for changing the deck.
   The snapshot is taken BEFORE fn runs, so undo returns to the prior state. */
function commit(label, fn) {
  const before = snapshot();
  let changed = true;
  try { changed = fn() !== false; }
  catch (err) { console.error('[' + APP_NAME + '] ' + label + ' failed', err); toast('Could not ' + label.toLowerCase(), 'error'); return; }
  if (changed === false) return;
  if (App._batch) { if (!App._batch.before) App._batch.before = before; App._batch.label = label; }
  else pushHistory(before);
  App.dirty = true;
  refresh();
}
/* A batch collapses a burst of changes — a drag, a typing session — into one
   undo step. */
function beginBatch(label) { if (!App._batch) App._batch = { label, before: snapshot() }; }
function endBatch(didChange) {
  const b = App._batch; App._batch = null;
  if (!b) return;
  if (didChange === false) return;
  pushHistory(b.before);
  App.dirty = true;
}
function cancelBatch() {
  const b = App._batch; App._batch = null;
  if (b && b.before) restore(b.before);
}
function restore(snap) {
  App.deck = normalizeDeck(JSON.parse(snap.deck));
  App.cur = clamp(snap.cur, 0, App.deck.slides.length - 1);
  App.sel = (snap.sel || []).filter((id) => findElement(App.deck.slides[App.cur], id));
  App.editing = null;
  refresh();
}
function undo() {
  if (App.hi < 0) { toast('Nothing to undo'); return; }
  const redoSnap = snapshot();
  const snap = App.history[App.hi];
  App.history[App.hi] = redoSnap;
  App.hi -= 1;
  App._redoStack = App._redoStack || [];
  restore(snap);
  App.dirty = true;
}
function redo() {
  if (App.hi >= App.history.length - 1) { toast('Nothing to redo'); return; }
  App.hi += 1;
  const snap = App.history[App.hi];
  App.history[App.hi] = snapshot();
  restore(snap);
  App.dirty = true;
}
const canUndo = () => App.hi >= 0;
const canRedo = () => App.hi < App.history.length - 1;

/* ---------- selection ---------- */

function select(ids, additive) {
  const s = curSlide(); if (!s) return;
  let next = [].concat(ids || []).filter((id) => findElement(s, id));
  if (additive) {
    const set = new Set(App.sel);
    for (const id of next) { if (set.has(id)) set.delete(id); else set.add(id); }
    next = Array.from(set);
  }
  next = groupMembers(s, next);
  App.sel = next;
  if (App.editing && App.sel.indexOf(App.editing) < 0) App.editing = null;
  refreshSelection();
}
const selectAll = () => select((curSlide().elements || []).map((e) => e.id));
const clearSelection = () => { App.sel = []; App.editing = null; refreshSelection(); };

function gotoSlide(i, keepSel) {
  const n = App.deck.slides.length;
  const next = clamp(i, 0, n - 1);
  if (next === App.cur && keepSel) return;
  App.cur = next;
  if (!keepSel) { App.sel = []; App.editing = null; }
  refresh();
}

/* ---------- slide operations ---------- */

function addSlide(layoutId, atIndex) {
  commit('Add slide', () => {
    const s = newSlideFor(App.deck, layoutId || 'titleContent');
    const at = atIndex === undefined ? App.cur + 1 : atIndex;
    App.deck.slides.splice(clamp(at, 0, App.deck.slides.length), 0, s);
    App.cur = clamp(at, 0, App.deck.slides.length - 1);
    App.sel = [];
  });
}
function duplicateSlide(i) {
  commit('Duplicate slide', () => {
    const idx = i === undefined ? App.cur : i;
    const copy = deepCopy(App.deck.slides[idx]);
    copy.id = uid('sld');
    const gmap = {};
    for (const e of copy.elements) {
      e.id = uid(e.type);
      if (e.groupId) { gmap[e.groupId] = gmap[e.groupId] || uid('grp'); e.groupId = gmap[e.groupId]; }
    }
    App.deck.slides.splice(idx + 1, 0, copy);
    App.cur = idx + 1;
    App.sel = [];
  });
}
function deleteSlide(i) {
  if (App.deck.slides.length <= 1) {
    commit('Clear slide', () => { App.deck.slides[0] = newSlideFor(App.deck, 'title'); App.sel = []; });
    return;
  }
  commit('Delete slide', () => {
    const idx = i === undefined ? App.cur : i;
    App.deck.slides.splice(idx, 1);
    App.cur = clamp(idx, 0, App.deck.slides.length - 1);
    App.sel = [];
  });
}
function reorderSlide(from, to) {
  if (from === to) return;
  commit('Move slide', () => {
    moveInArray(App.deck.slides, from, to);
    App.cur = clamp(to > from ? to : to, 0, App.deck.slides.length - 1);
  });
}
function applyLayout(layoutId) {
  commit('Apply layout', () => {
    const s = curSlide();
    /* Carry text across to the matching placeholder rather than discarding it
       — changing layout should not cost the user their words. */
    const keep = (s.elements || []).filter((e) => e.ph && isTextish(e) && !bodyIsEmpty(e.body));
    const byType = {};
    for (const e of keep) { const k = e.ph.type + ':' + (e.ph.idx || 0); byType[k] = e; }
    const extras = (s.elements || []).filter((e) => !e.ph);
    const fresh = layoutElements(layoutId, App.deck.size.w, App.deck.size.h, theme());
    for (const f of fresh) {
      const k = f.ph.type + ':' + (f.ph.idx || 0);
      let src = byType[k];
      if (!src) src = keep.find((e) => e.ph.type === f.ph.type && !e._used);
      if (src && isTextish(src) && f.body) {
        src._used = true;
        /* Keep the words and the author's own run styling, take position and
           default sizes from the new layout. */
        f.body.paragraphs = deepCopy(src.body.paragraphs);
      }
    }
    for (const e of keep) delete e._used;
    s.layout = layoutId;
    s.elements = fresh.concat(extras);
    App.sel = [];
  });
}
function setSlideBackground(bg) {
  commit('Change background', () => { curSlide().bg = bg; });
}
function setDeckTheme(id) {
  commit('Change theme', () => { App.deck.themeId = id; App.deck.theme = null; });
}
function setSlideSize(key) {
  const s = SLIDE_SIZES[key];
  if (!s) return;
  commit('Change slide size', () => {
    const old = App.deck.size, kx = s.w / old.w, ky = s.h / old.h;
    App.deck.size = { w: s.w, h: s.h };
    /* Scale geometry so a resize does not throw the deck away. Font sizes
       follow the smaller factor, which keeps text proportionate without
       letting it overflow on the tighter axis. */
    const kf = Math.min(kx, ky);
    for (const sl of App.deck.slides) {
      for (const e of sl.elements) {
        e.x *= kx; e.y *= ky; e.w *= kx; e.h *= ky;
        scaleElementText(e, kf);
        if (e.type === 'table' && e.table) {
          e.table.cols = e.table.cols.map((c) => c * kx);
          for (const r of e.table.rows) r.h *= ky;
          syncTableSize(e);
        }
      }
    }
  });
}
function scaleElementText(e, k) {
  if (k === 1) return;
  const scaleBody = (b) => {
    if (!b) return;
    for (const p of b.paragraphs || []) {
      if (p.marL) p.marL *= k;
      if (p.indent) p.indent *= k;
      if (p.spcBef) p.spcBef *= k;
      if (p.spcAft) p.spcAft *= k;
      if (p.lnSpc && p.lnSpc.pts) p.lnSpc.pts *= k;
      if (p.defRPr && p.defRPr.sz) p.defRPr.sz = Math.max(1, round2(p.defRPr.sz * k));
      for (const r of p.runs || []) if (r.sz) r.sz = Math.max(1, round2(r.sz * k));
    }
    if (b.ins) for (const sidek of ['l', 't', 'r', 'b']) b.ins[sidek] *= k;
  };
  scaleBody(e.body);
  if (e.type === 'table' && e.table) for (const r of e.table.rows) for (const c of r.cells) scaleBody(c.body);
  if (e.line && e.line.w) e.line.w = Math.max(0.25, e.line.w * k);
}

/* ---------- element operations ---------- */

function addElement(e, opts) {
  commit('Insert ' + (e.type === 'shape' ? shapeLabel(e.geom) : e.type), () => {
    const s = curSlide();
    s.elements.push(e);
    App.sel = [e.id];
    if (opts && opts.edit && canHaveText(e)) App.editing = e.id;
  });
  return e;
}
function updateSel(label, fn) {
  const els = selElements();
  if (!els.length) return;
  commit(label, () => { for (const e of els) fn(e); });
}
function deleteSel() {
  if (!App.sel.length) return;
  commit('Delete', () => {
    const s = curSlide();
    const kill = new Set(App.sel);
    s.elements = s.elements.filter((e) => !kill.has(e.id));
    App.sel = [];
    App.editing = null;
  });
}
function duplicateSel(dx, dy) {
  if (!App.sel.length) return;
  commit('Duplicate', () => {
    const s = curSlide();
    const gmap = {}, ids = [];
    for (const src of selElements()) {
      const c = deepCopy(src);
      c.id = uid(c.type);
      c.x += (dx === undefined ? 12 : dx);
      c.y += (dy === undefined ? 12 : dy);
      if (c.groupId) { gmap[c.groupId] = gmap[c.groupId] || uid('grp'); c.groupId = gmap[c.groupId]; }
      s.elements.push(c);
      ids.push(c.id);
    }
    App.sel = ids;
  });
}
function nudgeSel(dx, dy) {
  if (!App.sel.length) return;
  commit('Move', () => { for (const e of selElements()) { e.x = round2(e.x + dx); e.y = round2(e.y + dy); } });
}
function orderSel(where) {
  if (!App.sel.length) return;
  commit('Reorder', () => {
    const s = curSlide();
    const sel = new Set(App.sel);
    const picked = s.elements.filter((e) => sel.has(e.id));
    const rest = s.elements.filter((e) => !sel.has(e.id));
    if (where === 'front') s.elements = rest.concat(picked);
    else if (where === 'back') s.elements = picked.concat(rest);
    else {
      /* One step at a time, walking from the correct end so a multi-selection
         keeps its internal order. */
      const arr = s.elements.slice();
      const idxs = arr.map((e, i) => (sel.has(e.id) ? i : -1)).filter((i) => i >= 0);
      if (where === 'forward') {
        for (let k = idxs.length - 1; k >= 0; k--) { const i = idxs[k]; if (i < arr.length - 1 && !sel.has(arr[i + 1].id)) { const t = arr[i]; arr[i] = arr[i + 1]; arr[i + 1] = t; } }
      } else {
        for (let k = 0; k < idxs.length; k++) { const i = idxs[k]; if (i > 0 && !sel.has(arr[i - 1].id)) { const t = arr[i]; arr[i] = arr[i - 1]; arr[i - 1] = t; } }
      }
      s.elements = arr;
    }
  });
}
function alignSel(how) {
  const els = selElements();
  if (!els.length) return;
  commit('Align', () => {
    /* One element aligns to the slide; several align to each other, which is
       what people expect from every other editor. */
    const box = els.length === 1
      ? { x: 0, y: 0, w: App.deck.size.w, h: App.deck.size.h }
      : unionRect(els.map((e) => rotatedBounds(elementBox(e))));
    for (const e of els) {
      const b = rotatedBounds(elementBox(e));
      const ox = e.x - b.x, oy = e.y - b.y;
      if (how === 'left') e.x = box.x + ox;
      else if (how === 'hcenter') e.x = box.x + (box.w - b.w) / 2 + ox;
      else if (how === 'right') e.x = box.x + box.w - b.w + ox;
      else if (how === 'top') e.y = box.y + oy;
      else if (how === 'vcenter') e.y = box.y + (box.h - b.h) / 2 + oy;
      else if (how === 'bottom') e.y = box.y + box.h - b.h + oy;
      e.x = round2(e.x); e.y = round2(e.y);
    }
  });
}
function distributeSel(axis) {
  const els = selElements();
  if (els.length < 3) { toast('Select three or more to distribute'); return; }
  commit('Distribute', () => {
    const horiz = axis === 'h';
    const boxes = els.map((e) => ({ e, b: rotatedBounds(elementBox(e)) }));
    boxes.sort((a, b) => (horiz ? a.b.x - b.b.x : a.b.y - b.b.y));
    const first = boxes[0].b, last = boxes[boxes.length - 1].b;
    const span = horiz ? (last.x + last.w) - first.x : (last.y + last.h) - first.y;
    const used = boxes.reduce((t, o) => t + (horiz ? o.b.w : o.b.h), 0);
    const gap = (span - used) / (boxes.length - 1);
    let pos = horiz ? first.x : first.y;
    for (const o of boxes) {
      if (horiz) { o.e.x = round2(pos + (o.e.x - o.b.x)); pos += o.b.w + gap; }
      else { o.e.y = round2(pos + (o.e.y - o.b.y)); pos += o.b.h + gap; }
    }
  });
}
function groupSel() {
  if (App.sel.length < 2) return;
  commit('Group', () => { const g = uid('grp'); for (const e of selElements()) e.groupId = g; });
}
function ungroupSel() {
  if (!App.sel.length) return;
  commit('Ungroup', () => { for (const e of selElements()) delete e.groupId; });
}
function matchSize(which) {
  const els = selElements();
  if (els.length < 2) return;
  commit('Match size', () => {
    const ref = els[0];
    for (const e of els.slice(1)) {
      if (which !== 'h') e.w = ref.w;
      if (which !== 'w') e.h = ref.h;
      if (e.type === 'table') { /* tables derive size from rows and columns */
        const kx = e.w / e.table.cols.reduce((a, b) => a + b, 0);
        e.table.cols = e.table.cols.map((c) => c * kx);
        const ky = e.h / e.table.rows.reduce((a, r) => a + r.h, 0);
        for (const r of e.table.rows) r.h *= ky;
        syncTableSize(e);
      }
    }
  });
}
function flipSel(axis) {
  updateSel('Flip', (e) => {
    if (axis === 'h') e.flipH = !e.flipH; else e.flipV = !e.flipV;
  });
}

/* ---------- clipboard ----------
   The app keeps its own clipboard so elements paste with full fidelity, and
   also writes plain text to the system clipboard so content can leave. */
function copySel() {
  const els = selElements();
  if (!els.length) return;
  App.clipboard = { kind: 'elements', data: deepCopy(els) };
  const txt = els.map((e) => bodyToText(e.body)).filter(Boolean).join('\n');
  if (txt && navigator.clipboard) navigator.clipboard.writeText(txt).catch(() => {});
  toast(els.length + (els.length === 1 ? ' item copied' : ' items copied'));
}
function cutSel() { copySel(); deleteSel(); }
function pasteClipboard() {
  if (!App.clipboard || App.clipboard.kind !== 'elements') return false;
  commit('Paste', () => {
    const s = curSlide();
    const gmap = {}, ids = [];
    for (const src of App.clipboard.data) {
      const c = normalizeElement(deepCopy(src));
      if (!c) continue;
      c.id = uid(c.type);
      c.x += 16; c.y += 16;
      if (c.groupId) { gmap[c.groupId] = gmap[c.groupId] || uid('grp'); c.groupId = gmap[c.groupId]; }
      s.elements.push(c); ids.push(c.id);
    }
    App.sel = ids;
  });
  /* Paste again offsets again, matching the usual stair-step behaviour. */
  App.clipboard.data = App.clipboard.data.map((e) => { const c = deepCopy(e); c.x += 16; c.y += 16; return c; });
  return true;
}

/* ---------- text run formatting ----------
   Applied to the selected runs when editing, or to every run in the element
   when it is merely selected — the distinction users expect without thinking
   about it. */
function applyRunProps(props, label) {
  const els = selElements();
  if (!els.length) return;
  if (App.editing) { applyRunPropsToSelectionRange(props, label); return; }
  commit(label || 'Format text', () => {
    for (const e of els) {
      if (e.type === 'table' && e.table) {
        const cells = selectedCells(e);
        for (const c of cells) applyPropsToBody(c.body, props);
      } else if (e.body) applyPropsToBody(e.body, props);
    }
  });
}
function applyPropsToBody(body, props) {
  for (const p of body.paragraphs || []) {
    p.defRPr = Object.assign({}, p.defRPr || {}, props);
    for (const r of p.runs || []) {
      if (r.br) continue;
      for (const k in props) {
        if (props[k] === null) delete r[k]; else r[k] = props[k];
      }
    }
  }
}
function applyParaProps(props, label) {
  const els = selElements();
  if (!els.length) return;
  commit(label || 'Format paragraph', () => {
    for (const e of els) {
      const bodies = (e.type === 'table' && e.table) ? selectedCells(e).map((c) => c.body) : (e.body ? [e.body] : []);
      for (const b of bodies) {
        const idxs = (App.editing === e.id) ? editingParagraphRange(b) : b.paragraphs.map((_, i) => i);
        for (const i of idxs) {
          const p = b.paragraphs[i]; if (!p) continue;
          for (const k in props) { if (props[k] === null) delete p[k]; else p[k] = props[k]; }
        }
      }
    }
  });
}
function applyBodyProps(props, label) {
  updateSel(label || 'Format box', (e) => {
    if (e.type === 'table' && e.table) { for (const c of selectedCells(e)) Object.assign(c.body, props); }
    else if (e.body) Object.assign(e.body, props);
  });
}
/* Cells currently targeted inside a table element: the marked range, or all
   of them when the table is selected as a whole. */
function selectedCells(e) {
  const out = [];
  const r = e._cellSel;
  e.table.rows.forEach((row, ri) => row.cells.forEach((c, ci) => {
    if (c.merged) return;
    if (!r) out.push(c);
    else if (ri >= Math.min(r.r0, r.r1) && ri <= Math.max(r.r0, r.r1) && ci >= Math.min(r.c0, r.c1) && ci <= Math.max(r.c0, r.c1)) out.push(c);
  }));
  return out;
}

/* ---------- document ---------- */

function loadDeck(deck, name, opts) {
  App.deck = normalizeDeck(deck);
  App.cur = 0; App.sel = []; App.editing = null;
  App.history = []; App.hi = -1;
  App.dirty = false;
  App.fileName = name || null;
  App.zoom = 'fit';
  if (!(opts && opts.quiet)) refresh(true);
}
function newDeck() {
  const d = mkDeck();
  d.slides = [newSlideFor(d, 'title')];
  loadDeck(d, null);
}
const deckTitle = () => (App.deck && App.deck.title) || 'Untitled presentation';
function setDeckTitle(t) {
  commit('Rename', () => { App.deck.title = String(t || '').slice(0, 160) || 'Untitled presentation'; });
}
