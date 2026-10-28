/* ==========================================================================
   40-text.js — in-place text editing.

   The editable surface is the rendered body itself, so what you type is laid
   out by exactly the code that draws the finished slide. Two consequences
   shape the design:

   1. Structural keys are handled here, not by the browser. Enter, Tab and
      Backspace-at-start all change the paragraph model (split, change level,
      drop the bullet), and letting contenteditable guess produces nested
      divs and orphaned bullet spans. Characters are left to the browser and
      harvested afterwards.

   2. Serialisation is provenance-aware. Every rendered run carries its index,
      so a run whose computed style still matches what the model would produce
      keeps its original properties — including colours stored as theme
      references, which would otherwise be flattened to hex by the first edit.
   ========================================================================== */

const TextEdit = { id: null, cellRef: null, node: null, orig: null, dirty: false, handlers: null };

function editableNode() { return TextEdit.node; }

function startTextEdit(id, opts) {
  const s = curSlide();
  const e = findElement(s, id);
  if (!e || !canHaveText(e) || e.locked) return;
  if (TextEdit.id && TextEdit.id !== id) endTextEdit();
  const node = Canvas.stage.querySelector('.sp-el[data-id="' + cssEscape(id) + '"] .sp-body-inner');
  if (!node) return;

  App.editing = id;
  TextEdit.id = id; TextEdit.cellRef = null; TextEdit.node = node;
  TextEdit.orig = deepCopy(e.body);
  TextEdit.dirty = false;
  beginBatch('Edit text');
  attachEditing(node, e.body, () => e.body, (b) => { e.body = b; });

  const prompt = Canvas.stage.querySelector('.sp-el[data-id="' + cssEscape(id) + '"] .sp-ph-prompt');
  if (prompt) prompt.style.display = 'none';
  if (!(opts && opts.silent)) {
    if (bodyIsEmpty(e.body)) setCaret(0, 0);
    else selectAllText();
  }
  drawOverlay();
  refreshInspector();
}

function startTableCellEdit(e, r, c) {
  if (e.locked) return;
  const cell = e.table.rows[r] && e.table.rows[r].cells[c];
  if (!cell) return;
  if (TextEdit.id) endTextEdit();
  e._cellSel = { r0: r, c0: c, r1: r, c1: c };
  const node = Canvas.stage.querySelector('.sp-el[data-id="' + cssEscape(e.id) + '"] td[data-r="' + r + '"][data-c="' + c + '"] .sp-body-inner');
  if (!node) return;
  App.editing = e.id;
  TextEdit.id = e.id; TextEdit.cellRef = { r, c }; TextEdit.node = node;
  TextEdit.orig = deepCopy(cell.body);
  TextEdit.dirty = false;
  beginBatch('Edit cell');
  attachEditing(node, cell.body, () => cell.body, (b) => { cell.body = b; });
  selectAllText();
  drawOverlay();
}

function attachEditing(node, body, getBody, setBody) {
  node.setAttribute('contenteditable', 'true');
  node.setAttribute('spellcheck', 'true');
  node.classList.add('sp-editing');
  node.style.cursor = 'text';

  const onInput = () => {
    TextEdit.dirty = true;
    const b = serializeEditable(node, getBody());
    setBody(b);
    liveAutofit();
    scheduleThumb();
    scheduleToolbarSync();
  };
  const onKeyDown = (ev) => handleEditKey(ev, getBody, setBody);
  const onPaste = (ev) => handleEditPaste(ev, getBody, setBody);
  const onBlur = () => { /* a click elsewhere on the canvas ends the edit via its own path */ };
  const stop = (ev) => ev.stopPropagation();

  node.addEventListener('input', onInput);
  node.addEventListener('keydown', onKeyDown);
  node.addEventListener('paste', onPaste);
  node.addEventListener('blur', onBlur);
  node.addEventListener('pointerdown', stop);
  node.addEventListener('dblclick', stop);
  TextEdit.handlers = { onInput, onKeyDown, onPaste, onBlur, stop };
  node.focus({ preventScroll: true });
}

function endTextEdit() {
  const node = TextEdit.node;
  if (!node) { App.editing = null; return; }
  const s = curSlide();
  const e = s ? findElement(s, TextEdit.id) : null;
  if (e) {
    const target = TextEdit.cellRef
      ? (e.table.rows[TextEdit.cellRef.r] || { cells: [] }).cells[TextEdit.cellRef.c]
      : e;
    if (target) {
      const b = serializeEditable(node, target.body);
      target.body = b;
    }
  }
  const h = TextEdit.handlers;
  if (h) {
    node.removeEventListener('input', h.onInput);
    node.removeEventListener('keydown', h.onKeyDown);
    node.removeEventListener('paste', h.onPaste);
    node.removeEventListener('blur', h.onBlur);
    node.removeEventListener('pointerdown', h.stop);
    node.removeEventListener('dblclick', h.stop);
  }
  node.removeAttribute('contenteditable');
  node.classList.remove('sp-editing');

  const changed = TextEdit.dirty && e && JSON.stringify(TextEdit.cellRef
    ? (e.table.rows[TextEdit.cellRef.r].cells[TextEdit.cellRef.c].body)
    : e.body) !== JSON.stringify(TextEdit.orig);
  TextEdit.id = null; TextEdit.node = null; TextEdit.cellRef = null; TextEdit.orig = null; TextEdit.dirty = false; TextEdit.handlers = null;
  App.editing = null;
  endBatch(!!changed);
  if (changed) { App.dirty = true; markDirtyUI(); }
  renderCanvas();
  refreshThumb(App.cur);
  refreshInspector();
}

/* ---------- caret helpers ---------- */

function caretInfo() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !TextEdit.node) return null;
  const r = sel.getRangeAt(0);
  if (!TextEdit.node.contains(r.startContainer)) return null;
  const para = (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentNode).closest('.sp-para');
  if (!para) return null;
  const pi = +para.dataset.pi || 0;
  /* Offset measured in characters of the paragraph's own text, skipping the
     generated bullet so the model index matches what the user sees. */
  const walk = document.createTreeWalker(para, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentNode.closest('.sp-bullet') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
  });
  let off = 0, n;
  while ((n = walk.nextNode())) {
    if (n === r.startContainer) { off += r.startOffset; return { pi, offset: off, collapsed: sel.isCollapsed, para }; }
    off += n.nodeValue.length;
  }
  return { pi, offset: off, collapsed: sel.isCollapsed, para };
}
function setCaret(pi, offset) {
  const node = TextEdit.node;
  if (!node) return;
  const para = node.querySelector('.sp-para[data-pi="' + pi + '"]') || node.querySelector('.sp-para');
  if (!para) return;
  const walk = document.createTreeWalker(para, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentNode.closest('.sp-bullet') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
  });
  let left = Math.max(0, offset), n, last = null;
  const sel = window.getSelection();
  const r = document.createRange();
  while ((n = walk.nextNode())) {
    last = n;
    if (left <= n.nodeValue.length) { r.setStart(n, left); r.collapse(true); sel.removeAllRanges(); sel.addRange(r); return; }
    left -= n.nodeValue.length;
  }
  if (last) { r.setStart(last, last.nodeValue.length); r.collapse(true); }
  else { r.selectNodeContents(para.querySelector('.sp-ptext') || para); r.collapse(false); }
  sel.removeAllRanges(); sel.addRange(r);
}
function selectAllText() {
  const node = TextEdit.node;
  if (!node) return;
  const sel = window.getSelection(), r = document.createRange();
  r.selectNodeContents(node);
  sel.removeAllRanges(); sel.addRange(r);
}
/* Paragraph indices covered by the current selection, for paragraph-level
   formatting while editing. */
function editingParagraphRange(body) {
  const sel = window.getSelection();
  if (!TextEdit.node || !sel || !sel.rangeCount) return body.paragraphs.map((_, i) => i);
  const r = sel.getRangeAt(0);
  const paras = $$('.sp-para', TextEdit.node);
  const out = [];
  for (const p of paras) if (r.intersectsNode(p)) out.push(+p.dataset.pi || 0);
  return out.length ? out : body.paragraphs.map((_, i) => i);
}

/* ---------- structural keys ---------- */

function handleEditKey(ev, getBody, setBody) {
  const body = getBody();
  if (ev.key === 'Escape') {
    ev.preventDefault(); ev.stopPropagation();
    /* Escape reverts the whole editing session, which is what people expect
       after mistyping into a title. */
    const s = curSlide(), e = findElement(s, TextEdit.id);
    if (e) {
      if (TextEdit.cellRef) e.table.rows[TextEdit.cellRef.r].cells[TextEdit.cellRef.c].body = deepCopy(TextEdit.orig);
      else e.body = deepCopy(TextEdit.orig);
    }
    TextEdit.dirty = false;
    endTextEdit();
    return;
  }
  if (ev.key === 'Enter') {
    ev.preventDefault(); ev.stopPropagation();
    if (ev.shiftKey) { insertSoftBreak(getBody, setBody); return; }
    splitParagraph(getBody, setBody);
    return;
  }
  if (ev.key === 'Tab') {
    ev.preventDefault(); ev.stopPropagation();
    if (TextEdit.cellRef) { moveTableCell(ev.shiftKey ? -1 : 1); return; }
    changeIndent(ev.shiftKey ? -1 : 1, getBody, setBody);
    return;
  }
  if (ev.key === 'Backspace') {
    const ci = caretInfo();
    if (ci && ci.collapsed && ci.offset === 0) {
      const p = body.paragraphs[ci.pi];
      /* At the start of a bulleted line, the first Backspace removes the
         bullet rather than joining the lines. */
      if (p && p.bullet && p.bullet.type !== 'none') {
        ev.preventDefault(); ev.stopPropagation();
        TextEdit.dirty = true;
        p.bullet = { type: 'none' }; p.marL = 0; p.indent = 0;
        reRenderEditing(getBody);
        setCaret(ci.pi, 0);
        return;
      }
      if (ci.pi > 0) {
        ev.preventDefault(); ev.stopPropagation();
        mergeParagraphUp(ci.pi, getBody, setBody);
        return;
      }
    }
  }
  /* Keep the editor's own shortcuts working inside a text box. */
  const mod = ev.metaKey || ev.ctrlKey;
  if (mod && !ev.altKey) {
    const k = ev.key.toLowerCase();
    if (k === 'b' || k === 'i' || k === 'u') {
      ev.preventDefault();
      toggleRunPropOnRange(k === 'b' ? 'b' : k === 'i' ? 'i' : 'u', getBody, setBody);
      return;
    }
    if (k === 'a') { ev.preventDefault(); selectAllText(); return; }
    if (k === 'z' || k === 'y') { ev.preventDefault(); ev.stopPropagation(); endTextEdit(); (k === 'y' || ev.shiftKey) ? redo() : undo(); return; }
  }
  ev.stopPropagation();   /* plain typing must not reach the global shortcuts */
}

function splitParagraph(getBody, setBody) {
  const ci = caretInfo();
  const body = serializeEditable(TextEdit.node, getBody());
  setBody(body);
  const pi = ci ? ci.pi : body.paragraphs.length - 1;
  const off = ci ? ci.offset : 0;
  const p = body.paragraphs[pi] || mkPara([mkRun('')]);
  const text = (p.runs || []).map((r) => (r.br ? '\n' : r.t || '')).join('');
  const left = text.slice(0, off), right = text.slice(off);
  /* Split keeps each side's own run styling by walking the runs rather than
     re-typing the text in one style. */
  const { a, b } = splitRuns(p.runs || [], off);
  const pLeft = Object.assign({}, p, { runs: a.length ? a : [mkRun('', firstRunProps(p))] });
  const pRight = Object.assign(deepCopy(p), { runs: b.length ? b : [mkRun('', firstRunProps(p))] });
  body.paragraphs.splice(pi, 1, pLeft, pRight);
  TextEdit.dirty = true;
  reRenderEditing(getBody);
  setCaret(pi + 1, 0);
  liveAutofit();
  scheduleThumb();
}
function splitRuns(runs, off) {
  const a = [], b = [];
  let used = 0;
  for (const r of runs) {
    const len = r.br ? 1 : (r.t || '').length;
    if (used + len <= off) { a.push(deepCopy(r)); used += len; continue; }
    if (used >= off) { b.push(deepCopy(r)); used += len; continue; }
    const cut = off - used;
    if (r.br) { b.push(deepCopy(r)); }
    else {
      const l = deepCopy(r); l.t = (r.t || '').slice(0, cut);
      const rr = deepCopy(r); rr.t = (r.t || '').slice(cut);
      if (l.t) a.push(l);
      if (rr.t) b.push(rr);
    }
    used += len;
  }
  return { a, b };
}
const firstRunProps = (p) => {
  const r = (p.runs || []).find((x) => !x.br) || {};
  const o = {};
  for (const k of ['sz', 'font', 'b', 'i', 'u', 'color', 'caps', 'spc', 'strike']) if (r[k] !== undefined) o[k] = deepCopy(r[k]);
  return o;
};
function insertSoftBreak(getBody, setBody) {
  const ci = caretInfo();
  const body = serializeEditable(TextEdit.node, getBody());
  setBody(body);
  const p = body.paragraphs[ci ? ci.pi : 0];
  if (!p) return;
  const { a, b } = splitRuns(p.runs || [], ci ? ci.offset : 0);
  p.runs = a.concat([{ br: true }], b);
  TextEdit.dirty = true;
  reRenderEditing(getBody);
  setCaret(ci ? ci.pi : 0, (ci ? ci.offset : 0) + 1);
}
function mergeParagraphUp(pi, getBody, setBody) {
  const body = serializeEditable(TextEdit.node, getBody());
  setBody(body);
  const prev = body.paragraphs[pi - 1], cur = body.paragraphs[pi];
  if (!prev || !cur) return;
  const at = (prev.runs || []).reduce((n, r) => n + (r.br ? 1 : (r.t || '').length), 0);
  prev.runs = (prev.runs || []).concat(cur.runs || []);
  body.paragraphs.splice(pi, 1);
  TextEdit.dirty = true;
  reRenderEditing(getBody);
  setCaret(pi - 1, at);
  liveAutofit();
  scheduleThumb();
}
function changeIndent(delta, getBody, setBody) {
  const ci = caretInfo();
  const body = serializeEditable(TextEdit.node, getBody());
  setBody(body);
  const idxs = editingParagraphRange(body);
  for (const i of idxs) {
    const p = body.paragraphs[i];
    if (!p) continue;
    const lvl = clamp((p.lvl || 0) + delta, 0, 7);
    p.lvl = lvl;
    /* Indents follow the level so a demoted line visibly steps in, and a
       demoted plain line becomes a bullet, as in every other editor. */
    const step = 21.6;
    if (p.bullet && p.bullet.type !== 'none') {
      p.marL = step * (lvl + 1);
      p.indent = -step;
      if (p.bullet.type === 'char') p.bullet.char = bulletChar(lvl);
    } else if (delta > 0 && lvl > 0) {
      p.bullet = { type: 'char', char: bulletChar(lvl) };
      p.marL = step * (lvl + 1);
      p.indent = -step;
    } else {
      p.marL = step * lvl;
      p.indent = 0;
    }
  }
  TextEdit.dirty = true;
  reRenderEditing(getBody);
  if (ci) setCaret(ci.pi, ci.offset);
  liveAutofit();
  scheduleThumb();
}
function toggleRunPropOnRange(prop, getBody, setBody) {
  const ci = caretInfo();
  const sel = window.getSelection();
  const body = serializeEditable(TextEdit.node, getBody());
  setBody(body);
  if (sel && !sel.isCollapsed) {
    /* Work out the selected character span, then flip the property over just
       those runs, splitting runs at the boundaries. */
    const range = selectedCharRange(body);
    if (range) {
      const on = !allRunsHave(body, range, prop);
      applyToCharRange(body, range, prop === 'u' ? { u: on ? 'sng' : null } : { [prop]: on ? true : null });
      TextEdit.dirty = true;
      reRenderEditing(getBody);
      restoreCharRange(range);
      scheduleToolbarSync();
      return;
    }
  }
  /* With a collapsed caret, flip the whole paragraph — the common intent when
     someone bolds a heading they just typed. */
  const p = body.paragraphs[ci ? ci.pi : 0];
  if (!p) return;
  const on = !(p.runs || []).every((r) => r.br || (prop === 'u' ? (r.u && r.u !== 'none') : r[prop]));
  for (const r of p.runs || []) {
    if (r.br) continue;
    if (prop === 'u') { if (on) r.u = 'sng'; else delete r.u; }
    else if (on) r[prop] = true; else delete r[prop];
  }
  p.defRPr = Object.assign({}, p.defRPr, prop === 'u' ? { u: on ? 'sng' : null } : { [prop]: on || null });
  TextEdit.dirty = true;
  reRenderEditing(getBody);
  if (ci) setCaret(ci.pi, ci.offset);
  scheduleToolbarSync();
}
function selectedCharRange(body) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  const a = pointToChar(r.startContainer, r.startOffset);
  const b = pointToChar(r.endContainer, r.endOffset);
  if (!a || !b) return null;
  return { from: a, to: b };
}
function pointToChar(container, offset) {
  const node = container.nodeType === 1 ? container : container.parentNode;
  const para = node.closest && node.closest('.sp-para');
  if (!para) return null;
  const pi = +para.dataset.pi || 0;
  const walk = document.createTreeWalker(para, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentNode.closest('.sp-bullet') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
  });
  let off = 0, n;
  while ((n = walk.nextNode())) {
    if (n === container) return { pi, off: off + offset };
    off += n.nodeValue.length;
  }
  return { pi, off };
}
function allRunsHave(body, range, prop) {
  let all = true;
  eachCharRun(body, range, (r) => {
    const has = prop === 'u' ? (r.u && r.u !== 'none') : !!r[prop];
    if (!has) all = false;
  });
  return all;
}
function applyToCharRange(body, range, props) {
  for (let pi = range.from.pi; pi <= range.to.pi; pi++) {
    const p = body.paragraphs[pi];
    if (!p) continue;
    const start = pi === range.from.pi ? range.from.off : 0;
    const total = (p.runs || []).reduce((n, r) => n + (r.br ? 1 : (r.t || '').length), 0);
    const end = pi === range.to.pi ? range.to.off : total;
    p.runs = splitAt(p.runs || [], start);
    p.runs = splitAt(p.runs, end);
    let pos = 0;
    for (const r of p.runs) {
      const len = r.br ? 1 : (r.t || '').length;
      if (pos >= start && pos + len <= end && !r.br) {
        for (const k in props) { if (props[k] === null) delete r[k]; else r[k] = props[k]; }
      }
      pos += len;
    }
  }
}
function splitAt(runs, at) {
  const out = [];
  let pos = 0;
  for (const r of runs) {
    const len = r.br ? 1 : (r.t || '').length;
    if (!r.br && pos < at && at < pos + len) {
      const a = deepCopy(r); a.t = r.t.slice(0, at - pos);
      const b = deepCopy(r); b.t = r.t.slice(at - pos);
      out.push(a, b);
    } else out.push(r);
    pos += len;
  }
  return out;
}
function eachCharRun(body, range, fn) {
  for (let pi = range.from.pi; pi <= range.to.pi; pi++) {
    const p = body.paragraphs[pi];
    if (!p) continue;
    const start = pi === range.from.pi ? range.from.off : 0;
    const total = (p.runs || []).reduce((n, r) => n + (r.br ? 1 : (r.t || '').length), 0);
    const end = pi === range.to.pi ? range.to.off : total;
    let pos = 0;
    for (const r of p.runs || []) {
      const len = r.br ? 1 : (r.t || '').length;
      if (!r.br && pos < end && pos + len > start) fn(r);
      pos += len;
    }
  }
}
function restoreCharRange(range) {
  const node = TextEdit.node;
  if (!node) return;
  const locate = (pt) => {
    const para = node.querySelector('.sp-para[data-pi="' + pt.pi + '"]');
    if (!para) return null;
    const walk = document.createTreeWalker(para, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentNode.closest('.sp-bullet') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
    });
    let left = pt.off, n, last = null;
    while ((n = walk.nextNode())) { last = n; if (left <= n.nodeValue.length) return { n, off: left }; left -= n.nodeValue.length; }
    return last ? { n: last, off: last.nodeValue.length } : null;
  };
  const a = locate(range.from), b = locate(range.to);
  if (!a || !b) return;
  const sel = window.getSelection(), r = document.createRange();
  r.setStart(a.n, a.off); r.setEnd(b.n, b.off);
  sel.removeAllRanges(); sel.addRange(r);
}

/* Re-render only the body being edited, preserving the editing attachment. */
function reRenderEditing(getBody) {
  const node = TextEdit.node;
  if (!node) return;
  const body = getBody();
  const fresh = renderBody(body, theme(), 1);
  const freshInner = fresh.querySelector('.sp-body-inner');
  node.textContent = '';
  while (freshInner.firstChild) node.appendChild(freshInner.firstChild);
}

/* Grow or shrink the frame while typing, without disturbing the caret. */
function liveAutofit() {
  const s = curSlide();
  const e = s ? findElement(s, TextEdit.id) : null;
  if (!e || !e.body) return;
  const wrap = Canvas.stage.querySelector('.sp-el[data-id="' + cssEscape(e.id) + '"]');
  if (!wrap) return;
  if (e.body.autofit === 'resize' && e.type === 'text') {
    const inner = wrap.querySelector('.sp-body-inner');
    const ins = e.body.ins || { t: 3.6, b: 3.6 };
    const need = inner.scrollHeight + ins.t + ins.b;
    if (Math.abs(need - e.h) > 1) {
      e.h = Math.max(8, round2(need));
      wrap.style.height = e.h + 'px';
      const holder = wrap.querySelector('.sp-text');
      if (holder) holder.style.height = e.h + 'px';
      drawOverlay();
    }
  } else if (e.body.autofit === 'shrink') {
    const holder = wrap.querySelector('.sp-text');
    const bodyNode = wrap.querySelector('.sp-body');
    if (!holder || !bodyNode) return;
    shrinkBodyToFit(bodyNode, holder);
  }
}

/* ---------- paste ---------- */

function handleEditPaste(ev, getBody, setBody) {
  const dt = ev.clipboardData;
  if (!dt) return;
  ev.preventDefault(); ev.stopPropagation();
  const text = dt.getData('text/plain') || '';
  if (!text) {
    /* An image on the clipboard while editing text belongs on the slide, not
       in the paragraph. */
    const file = Array.prototype.find.call(dt.files || [], (f) => /^image\//.test(f.type));
    if (file) { endTextEdit(); insertImageFiles([file]); }
    return;
  }
  const ci = caretInfo();
  const body = serializeEditable(TextEdit.node, getBody());
  setBody(body);
  const lines = text.replace(/\r\n|\r/g, '\n').split('\n');
  const pi = ci ? ci.pi : body.paragraphs.length - 1;
  const off = ci ? ci.offset : 0;
  const p = body.paragraphs[pi] || mkPara([mkRun('')]);
  const props = firstRunProps(p);
  const { a, b } = splitRuns(p.runs || [], off);
  if (lines.length === 1) {
    p.runs = a.concat([mkRun(lines[0], props)], b);
    TextEdit.dirty = true;
    reRenderEditing(getBody);
    setCaret(pi, off + lines[0].length);
  } else {
    const made = lines.map((l, i) => {
      const np = Object.assign(deepCopy(p), { runs: [mkRun(l, props)] });
      if (i === 0) np.runs = a.concat([mkRun(l, props)]);
      if (i === lines.length - 1) np.runs = [mkRun(l, props)].concat(b);
      return np;
    });
    body.paragraphs.splice(pi, 1, ...made);
    TextEdit.dirty = true;
    reRenderEditing(getBody);
    setCaret(pi + lines.length - 1, lines[lines.length - 1].length);
  }
  liveAutofit();
  scheduleThumb();
}

/* ---------- serialisation ----------
   Walk the edited DOM and rebuild paragraphs and runs. Each text node's
   effective style comes from getComputedStyle, which is the only way to read
   back formatting the browser itself applied. The original run is then
   consulted: where the computed value agrees with what that run would have
   produced, the run's stored property is kept, so theme-linked colours and
   '+mj-lt' font references are not flattened into literals by editing.
   -------------------------------------------------------------------------- */
function serializeEditable(node, origBody) {
  const th = theme();
  const paras = [];
  const blocks = $$(':scope > .sp-para', node);
  const list = blocks.length ? blocks : [node];

  for (const blk of list) {
    const origIdx = blk.dataset && blk.dataset.pi !== undefined ? +blk.dataset.pi : -1;
    const orig = (origBody && origBody.paragraphs && origBody.paragraphs[origIdx]) || null;
    const p = orig ? deepCopy(orig) : mkPara([]);
    p.runs = [];
    const walk = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: (n) => {
        if (n.nodeType === 1) {
          if (n.closest('.sp-bullet')) return NodeFilter.FILTER_REJECT;
          return n.tagName === 'BR' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        }
        if (n.parentNode.closest('.sp-bullet')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let n;
    while ((n = walk.nextNode())) {
      if (n.nodeType === 1 && n.tagName === 'BR') { p.runs.push({ br: true }); continue; }
      let t = n.nodeValue || '';
      t = t.replace(/​/g, '');          /* the zero-width space used to hold empty lines open */
      if (!t) continue;
      const host = n.parentNode;
      const props = readRunProps(host, th, origBody, origIdx);
      const prev = p.runs[p.runs.length - 1];
      /* Coalesce adjacent identical runs — contenteditable fragments text
         constantly and an unmerged body grows without bound. */
      if (prev && !prev.br && sameRunProps(prev, props)) prev.t += t;
      else p.runs.push(Object.assign({ t }, props));
    }
    if (!p.runs.length) p.runs = [mkRun('', orig ? firstRunProps(orig) : {})];
    /* A paragraph the browser created by splitting has no index of its own;
       carry the previous paragraph's formatting so the list stays consistent. */
    if (origIdx < 0 && paras.length) {
      const prevP = paras[paras.length - 1];
      for (const k of ['align', 'lvl', 'bullet', 'marL', 'indent', 'lnSpc', 'spcBef', 'spcAft', 'defRPr']) {
        if (p[k] === undefined && prevP[k] !== undefined) p[k] = deepCopy(prevP[k]);
      }
    }
    paras.push(p);
  }
  const out = Object.assign({}, origBody || mkBody([]), { paragraphs: paras.length ? paras : [mkPara([mkRun('')])] });
  return out;
}

function readRunProps(hostEl, th, origBody, pi) {
  const cs = getComputedStyle(hostEl);
  const out = {};
  /* The original run, if this text still sits inside one. */
  const runEl = hostEl.closest ? hostEl.closest('.sp-run') : null;
  const ri = runEl && runEl.dataset.ri !== undefined ? +runEl.dataset.ri : -1;
  const origP = (origBody && origBody.paragraphs && origBody.paragraphs[pi]) || null;
  const origR = (origP && origP.runs && origP.runs[ri]) || null;
  const inherit = (origP && origP.defRPr) || null;

  /* size: the rendered size may carry an autofit multiplier, so prefer the
     unscaled value recorded at render time and fall back to dividing it out. */
  const px = parseFloat(cs.fontSize) || 18;
  const recorded = runEl && runEl.dataset.bsz ? parseFloat(runEl.dataset.bsz) : NaN;
  const bodyEl = hostEl.closest ? hostEl.closest('.sp-body') : null;
  const fsVar = bodyEl && bodyEl.dataset.fs ? (parseFloat(bodyEl.dataset.fs) || 1) : 1;
  const sz = isFinite(recorded) && Math.abs(recorded * fsVar - px) < 0.6 ? round2(recorded) : round2(px / (fsVar || 1));
  if (origR && origR.sz !== undefined && Math.abs(origR.sz - sz) < 0.6) out.sz = origR.sz;
  else if (!inherit || Math.abs((inherit.sz || 18) - sz) > 0.6) out.sz = sz;

  const bold = (parseInt(cs.fontWeight, 10) || 400) >= 600;
  if (bold) out.b = true;
  if (cs.fontStyle === 'italic' || cs.fontStyle === 'oblique') out.i = true;
  const dec = cs.textDecorationLine || cs.textDecoration || '';
  if (/underline/.test(dec)) out.u = (origR && origR.u) || 'sng';
  if (/line-through/.test(dec)) out.strike = (origR && origR.strike) || 'sngStrike';

  const fam = (cs.fontFamily || '').split(',')[0].replace(/^["']|["']$/g, '').trim();
  if (origR && origR.font !== undefined && fontStack(origR.font, th).split(',')[0].replace(/^["']|["']$/g, '').trim() === fam) out.font = origR.font;
  else if (fam && fam !== fontStack(undefined, th).split(',')[0].replace(/^["']|["']$/g, '').trim()) out.font = fam;

  const col = rgbStringToHex(cs.color);
  if (origR && origR.color !== undefined && resolveColor(origR.color, th) === col) out.color = deepCopy(origR.color);
  else if (col && (!inherit || resolveColor(inherit.color, th) !== col) && col !== (th.fg || '#000000')) out.color = col;

  if (cs.textTransform === 'uppercase') out.caps = 'all';
  const ls = parseFloat(cs.letterSpacing);
  if (ls && isFinite(ls)) out.spc = Math.round(ls * 100);
  if (origR && origR.link) out.link = origR.link;
  else {
    const a = hostEl.closest ? hostEl.closest('a[href]') : null;
    if (a) out.link = a.getAttribute('href');
  }
  if (origR && origR.baseline) out.baseline = origR.baseline;
  if (origR && origR.highlight) out.highlight = deepCopy(origR.highlight);
  return out;
}
const RUN_KEYS = ['sz', 'font', 'b', 'i', 'u', 'strike', 'color', 'caps', 'spc', 'link', 'baseline', 'highlight'];
function sameRunProps(a, b) {
  for (const k of RUN_KEYS) {
    const x = a[k], y = b[k];
    if (JSON.stringify(x === undefined ? null : x) !== JSON.stringify(y === undefined ? null : y)) return false;
  }
  return true;
}
function rgbStringToHex(s) {
  const m = String(s || '').match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (!m) return normHex(s);
  return rgbToHex(+m[1], +m[2], +m[3]);
}

/* ---------- table cell navigation ---------- */

function moveTableCell(dir) {
  const s = curSlide();
  const e = findElement(s, TextEdit.id);
  const ref = TextEdit.cellRef;
  if (!e || !ref) return;
  const cols = e.table.cols.length, rows = e.table.rows.length;
  let r = ref.r, c = ref.c + dir;
  if (c >= cols) { c = 0; r += 1; }
  if (c < 0) { c = cols - 1; r -= 1; }
  endTextEdit();
  const e2 = findElement(curSlide(), e.id);
  if (!e2) return;
  if (r >= rows) {
    /* Tab out of the last cell adds a row, as in Word. */
    commit('Add row', () => {
      const t = e2.table;
      const h = t.rows[t.rows.length - 1].h;
      t.rows.push({ h, cells: t.cols.map(() => ({ body: mkBody([mkPara([mkRun('')])], { anchor: 'ctr' }), fill: null, span: 1, rowSpan: 1 })) });
      syncTableSize(e2);
    });
    r = rows; c = 0;
  }
  if (r < 0) return;
  select([e2.id]);
  startTableCellEdit(findElement(curSlide(), e2.id), r, c);
}
