/* ==========================================================================
   45-ui.js — the application shell.

   Layout: a menu bar, a contextual format toolbar, the slide list, the canvas,
   a notes strip, an inspector, a status bar. The toolbar and inspector are
   rebuilt from the selection rather than mutated in place, which costs a
   little DOM churn and removes any possibility of a control showing a stale
   value for a different element.
   ========================================================================== */

const UI = { toolbar: null, sidebar: null, inspector: null, notes: null, popover: null, thumbTimer: 0, toolbarTimer: 0 };

/* ---------- tiny primitives ---------- */

function icon(name) {
  /* Inline strokes rather than a font or sprite sheet: one file, no network,
     and they take the current colour. */
  const P = {
    text: 'M4 5h12M10 5v10M7 15h6',
    shape: 'M3 4h14v12H3z',
    image: 'M3 4h14v12H3zM3 13l4-4 3 3 3-3 4 4',
    table: 'M3 4h14v12H3zM3 8h14M3 12h14M8 4v12M13 4v12',
    line: 'M4 16L16 4',
    play: 'M6 4l10 6-10 6z',
    plus: 'M10 4v12M4 10h12',
    copy: 'M7 7h9v9H7zM4 4h9v3M4 4v9h3',
    trash: 'M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10',
    undo: 'M7 8H4V5M4.5 8a6 6 0 1 1 1 7',
    redo: 'M13 8h3V5M15.5 8a6 6 0 1 0-1 7',
    front: 'M4 7l6-3 6 3-6 3zM4 12l6 3 6-3',
    back: 'M4 13l6 3 6-3-6-3zM4 8l6-3 6 3',
    alignL: 'M3 4v12M6 7h9M6 11h6',
    alignC: 'M10 4v12M5 7h10M7 11h6',
    alignR: 'M17 4v12M5 7h9M8 11h6',
    bullets: 'M4 6h.01M4 10h.01M4 14h.01M8 6h8M8 10h8M8 14h8',
    numbers: 'M3 6h1V4M3 10h2l-2 3h2M3.5 14h1M8 6h8M8 10h8M8 14h8',
    grid: 'M3 3h14v14H3zM3 7.6h14M3 12.3h14M7.6 3v14M12.3 3v14',
    magnet: 'M5 4v6a5 5 0 0 0 10 0V4h-3v6a2 2 0 0 1-4 0V4z',
    notes: 'M4 4h12v12H4zM7 8h6M7 11h4',
    layout: 'M3 4h14v12H3zM3 8h14M8 8v8',
    theme: 'M10 3a7 7 0 1 0 0 14c1 0 1.5-.6 1.5-1.3 0-1.4-1.6-1.3-1.6-2.4 0-.8.7-1.3 1.8-1.3H14a3 3 0 0 0 3-3A7 7 0 0 0 10 3z',
    file: 'M5 3h6l4 4v10H5zM11 3v4h4',
    chev: 'M6 8l4 4 4-4',
    close: 'M5 5l10 10M15 5L5 15',
    lock: 'M6 9V7a4 4 0 0 1 8 0v2M4.5 9h11v7h-11z',
    group: 'M3 3h6v6H3zM11 11h6v6h-6zM9 6h2v5h-2'
  };
  const d = P[name] || P.shape;
  const svg = svgEl('svg', { class: 'ic', viewBox: '0 0 20 20', 'aria-hidden': 'true' });
  svg.appendChild(svgEl('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  return svg;
}

function btn(opts) {
  const b = el('button', {
    class: 'btn' + (opts.small ? ' btn-s' : '') + (opts.active ? ' on' : '') + (opts.cls ? ' ' + opts.cls : ''),
    title: opts.title || opts.label || '',
    'aria-label': opts.title || opts.label || '',
    onclick: opts.onclick,
    disabled: opts.disabled || null
  });
  if (opts.icon) b.appendChild(icon(opts.icon));
  if (opts.label) b.appendChild(el('span', { text: opts.label }));
  if (opts.caret) b.appendChild(icon('chev'));
  return b;
}

function closePopover() {
  if (UI.popover) { UI.popover.remove(); UI.popover = null; }
  $$('.menu-open').forEach((n) => n.classList.remove('menu-open'));
}
function openPopover(anchor, build, opts) {
  const already = UI.popover && UI.popover._anchor === anchor;
  closePopover();
  if (already) return null;
  const pop = el('div', { class: 'pop' + ((opts && opts.cls) ? ' ' + opts.cls : '') });
  pop._anchor = anchor;
  build(pop, () => closePopover());
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let left = (opts && opts.alignRight) ? r.right - pw : r.left;
  left = clamp(left, 6, window.innerWidth - pw - 6);
  let top = r.bottom + 4;
  if (top + ph > window.innerHeight - 6) top = Math.max(6, r.top - ph - 4);
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
  anchor.classList.add('menu-open');
  UI.popover = pop;
  return pop;
}
function menuItem(label, onclick, opts) {
  const o = opts || {};
  const it = el('button', {
    class: 'mi' + (o.danger ? ' danger' : '') + (o.checked ? ' checked' : ''),
    disabled: o.disabled || null,
    onclick: (ev) => { ev.stopPropagation(); closePopover(); if (onclick) onclick(); }
  });
  it.appendChild(el('span', { class: 'mi-l', text: label }));
  if (o.key) it.appendChild(el('span', { class: 'mi-k', text: o.key }));
  return it;
}
const menuSep = () => el('div', { class: 'mi-sep' });
function menuHead(t) { return el('div', { class: 'mi-head', text: t }); }

/* ---------- toast, busy, dialogs ---------- */

let _toastHost = null;
function toast(msg, kind) {
  if (!_toastHost) { _toastHost = el('div', { class: 'toasts' }); document.body.appendChild(_toastHost); }
  const t = el('div', { class: 'toast' + (kind ? ' ' + kind : ''), text: msg });
  _toastHost.appendChild(t);
  setTimeout(() => t.classList.add('in'), 10);
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, kind === 'error' ? 6000 : 3200);
}
function showBusy(msg) {
  const o = el('div', { class: 'busy' }, [el('div', { class: 'busy-box' }, [el('div', { class: 'spin' }), el('div', { text: msg || 'Working…' })])]);
  document.body.appendChild(o);
  return () => o.remove();
}
function modal(title, bodyNode, buttons) {
  return new Promise((res) => {
    const close = (v) => { wrap.remove(); document.removeEventListener('keydown', onKey, true); res(v); };
    const onKey = (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(false); }
      else if (ev.key === 'Enter' && ev.target.tagName !== 'TEXTAREA') { ev.preventDefault(); ev.stopPropagation(); close(true); }
    };
    const foot = el('div', { class: 'dlg-foot' });
    for (const b of buttons) {
      foot.appendChild(el('button', {
        class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''),
        text: b.label, onclick: () => close(b.value)
      }));
    }
    const box = el('div', { class: 'dlg', role: 'dialog', 'aria-modal': 'true' }, [
      el('div', { class: 'dlg-head', text: title }),
      el('div', { class: 'dlg-body' }, [bodyNode]),
      foot
    ]);
    const wrap = el('div', { class: 'dlg-wrap', onclick: (ev) => { if (ev.target === wrap) close(false); } }, [box]);
    document.body.appendChild(wrap);
    document.addEventListener('keydown', onKey, true);
    const first = box.querySelector('input, textarea, button.primary');
    if (first) first.focus();
  });
}
const alertDialog = (title, text) => modal(title, el('p', { class: 'dlg-text', text }), [{ label: 'OK', value: true, primary: true }]);
const confirmDialog = (title, text, okLabel) => modal(title, el('p', { class: 'dlg-text', text }),
  [{ label: 'Cancel', value: false }, { label: okLabel || 'OK', value: true, primary: true, danger: /discard|delete/i.test(okLabel || '') }]);
function showImportNotes(name, d) {
  const body = el('div');
  body.appendChild(el('p', { class: 'dlg-text', text: 'Opened ' + name + ' — ' + d.summary + '.' }));
  body.appendChild(el('p', { class: 'dlg-text dim', text: 'Some things in the file could not be brought across exactly:' }));
  const ul = el('ul', { class: 'dlg-list' });
  for (const w of d.warnings) ul.appendChild(el('li', { text: w }));
  body.appendChild(ul);
  return modal('Import notes', body, [{ label: 'OK', value: true, primary: true }]);
}

/* ---------- colour control ---------- */

function colorSwatch(color, onPick, opts) {
  const o = opts || {};
  const hex = resolveColor(color, theme());
  const sw = el('button', {
    class: 'swatch' + (o.small ? ' small' : ''), title: o.title || 'Colour',
    onclick: (ev) => { ev.stopPropagation(); openColorPicker(ev.currentTarget, color, onPick, o); }
  });
  const chip = el('span', { class: 'swatch-chip' });
  if (!hex) chip.classList.add('none');
  else chip.style.background = cssColorOr(color, theme(), 'transparent');
  sw.appendChild(chip);
  if (o.label) sw.appendChild(el('span', { class: 'swatch-label', text: o.label }));
  return sw;
}
function openColorPicker(anchor, current, onPick, opts) {
  const o = opts || {};
  openPopover(anchor, (pop, close) => {
    pop.classList.add('pop-color');
    if (o.allowNone) {
      pop.appendChild(el('button', { class: 'mi', text: 'No colour', onclick: () => { close(); onPick(null); } }));
      pop.appendChild(menuSep());
    }
    pop.appendChild(menuHead('Theme'));
    const th = theme();
    const rowNames = ['lt1', 'tx1', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];
    const grid = el('div', { class: 'cgrid' });
    for (const slot of rowNames) {
      const base = { scheme: slot === 'lt1' ? 'bg1' : slot };
      grid.appendChild(chipBtn(base, close, onPick));
    }
    pop.appendChild(grid);
    /* Office writes lighter and darker variants with lumMod/lumOff; offering
       the same five steps keeps a deck's palette internally consistent. */
    const variants = [
      { lumMod: 20000, lumOff: 80000 }, { lumMod: 40000, lumOff: 60000 },
      { lumMod: 60000, lumOff: 40000 }, { lumMod: 75000 }, { lumMod: 50000 }
    ];
    for (const v of variants) {
      const row = el('div', { class: 'cgrid' });
      for (const slot of rowNames) row.appendChild(chipBtn(Object.assign({ scheme: slot === 'lt1' ? 'bg1' : slot }, v), close, onPick));
      pop.appendChild(row);
    }
    pop.appendChild(menuSep());
    pop.appendChild(menuHead('Standard'));
    const std = ['#000000', '#404040', '#808080', '#BFBFBF', '#FFFFFF', '#C00000', '#FF0000', '#FFC000', '#FFFF00', '#92D050', '#00B050', '#00B0F0', '#0070C0', '#002060', '#7030A0'];
    const g2 = el('div', { class: 'cgrid' });
    for (const h of std) g2.appendChild(chipBtn({ hex: h }, close, onPick));
    pop.appendChild(g2);
    pop.appendChild(menuSep());
    const cur = resolveColor(current, th) || '#000000';
    const inp = el('input', { type: 'color', class: 'cinput', value: cur });
    const hexIn = el('input', { class: 'inp hexin', type: 'text', value: cur, maxlength: '7', spellcheck: 'false' });
    inp.addEventListener('input', () => { hexIn.value = inp.value.toUpperCase(); });
    inp.addEventListener('change', () => { close(); onPick({ hex: normHex(inp.value) }); });
    hexIn.addEventListener('change', () => {
      const h = normHex(hexIn.value);
      if (h) { close(); onPick({ hex: h }); } else hexIn.value = cur;
    });
    pop.appendChild(el('div', { class: 'crow' }, [inp, hexIn]));
    if (o.allowAlpha) {
      const a = (current && typeof current === 'object' && current.alpha !== undefined) ? Math.round(current.alpha / 1000) : 100;
      const sl = el('input', { class: 'rng', type: 'range', min: '0', max: '100', value: String(a) });
      const lab = el('span', { class: 'rng-val', text: a + '%' });
      sl.addEventListener('input', () => { lab.textContent = sl.value + '%'; });
      sl.addEventListener('change', () => {
        const c = typeof current === 'string' ? { hex: current } : Object.assign({}, current || { hex: cur });
        c.alpha = Math.round(+sl.value * 1000);
        if (+sl.value >= 100) delete c.alpha;
        onPick(c);
      });
      pop.appendChild(el('div', { class: 'crow' }, [el('span', { class: 'crow-l', text: 'Opacity' }), sl, lab]));
    }
  }, { cls: 'pop-wide' });
}
function chipBtn(color, close, onPick) {
  const b = el('button', { class: 'chip', title: resolveColor(color, theme()) || '', onclick: () => { close(); onPick(color); } });
  b.style.background = cssColorOr(color, theme(), 'transparent');
  return b;
}

/* ---------- select / number inputs ---------- */

function selectEl(options, value, onChange, cls) {
  const s = el('select', { class: 'sel' + (cls ? ' ' + cls : ''), onchange: () => onChange(s.value) });
  for (const o of options) {
    const op = el('option', { value: String(o.value), text: o.label });
    if (String(o.value) === String(value)) op.selected = true;
    s.appendChild(op);
  }
  return s;
}
function numInput(value, onChange, opts) {
  const o = opts || {};
  const i = el('input', {
    class: 'inp num' + (o.cls ? ' ' + o.cls : ''), type: 'text', inputmode: 'decimal',
    value: value === null || value === undefined ? '' : String(round2(value)),
    title: o.title || ''
  });
  const apply = () => {
    const v = parseFloat(i.value.replace(/[^\d.\-]/g, ''));
    if (!isFinite(v)) { i.value = value === null ? '' : String(round2(value)); return; }
    onChange(clamp(v, o.min === undefined ? -100000 : o.min, o.max === undefined ? 100000 : o.max));
  };
  i.addEventListener('change', apply);
  i.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') { ev.preventDefault(); apply(); i.blur(); }
    /* Arrow keys nudge, which is what a numeric field should do. */
    if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
      ev.preventDefault();
      const step = (ev.shiftKey ? 10 : 1) * (ev.key === 'ArrowUp' ? 1 : -1);
      const v = (parseFloat(i.value) || 0) + step;
      i.value = String(round2(v));
      apply();
    }
  });
  return i;
}
function labeledRow(label, nodes) {
  return el('div', { class: 'frow' }, [el('label', { class: 'flab', text: label })].concat(nodes));
}

/* ==========================================================================
   SHELL
   ========================================================================== */

function buildShell() {
  const root = el('div', { class: 'app' });

  /* ---- menu bar ---- */
  const titleInput = el('input', { class: 'title-in', id: 'deckTitle', type: 'text', spellcheck: 'false', 'aria-label': 'Presentation name' });
  titleInput.addEventListener('change', () => setDeckTitle(titleInput.value));
  titleInput.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') titleInput.blur(); });

  const bar = el('header', { class: 'bar' }, [
    /* The full name is long for a 46px bar, so it is set as a lockup: the
       identifying part stays, the generic tail drops on a narrow window, and
       the title attribute always carries the whole thing. */
    el('div', { class: 'brand', title: APP_NAME }, [
      el('span', { class: 'brand-mark', text: '◧' }),
      el('span', { class: 'brand-name', text: APP_BRAND }),
      el('span', { class: 'brand-sub', text: APP_BRAND_SUB })
    ]),
    el('div', { class: 'menus' }, [
      btn({ label: 'File', caret: true, cls: 'menu', onclick: (ev) => fileMenu(ev.currentTarget) }),
      btn({ label: 'Insert', caret: true, cls: 'menu', onclick: (ev) => insertMenu(ev.currentTarget) }),
      btn({ label: 'Slide', caret: true, cls: 'menu', onclick: (ev) => slideMenu(ev.currentTarget) }),
      btn({ label: 'Arrange', caret: true, cls: 'menu', onclick: (ev) => arrangeMenu(ev.currentTarget) }),
      btn({ label: 'View', caret: true, cls: 'menu', onclick: (ev) => viewMenu(ev.currentTarget) })
    ]),
    titleInput,
    el('div', { class: 'bar-r' }, [
      btn({ icon: 'undo', title: 'Undo  ⌘Z', cls: 'ghost', onclick: undo }),
      btn({ icon: 'redo', title: 'Redo  ⇧⌘Z', cls: 'ghost', onclick: redo }),
      el('span', { class: 'dirty', id: 'dirtyDot', title: 'Unsaved changes' }),
      btn({ icon: 'play', label: 'Present', cls: 'primary', onclick: () => startPresent() })
    ])
  ]);
  root.appendChild(bar);

  /* ---- toolbar ---- */
  UI.toolbar = el('div', { class: 'tools', id: 'toolbar' });
  root.appendChild(UI.toolbar);

  /* ---- body ---- */
  UI.sidebar = el('aside', { class: 'side', id: 'sideBar' });
  const center = el('main', { class: 'center' });
  const canvasHost = el('div', { class: 'cv-host' });
  mountCanvas(canvasHost);
  UI.notes = el('div', { class: 'notes-strip', id: 'notesStrip' });
  const status = el('div', { class: 'status', id: 'statusBar' });
  center.appendChild(canvasHost);
  center.appendChild(UI.notes);
  center.appendChild(status);
  UI.inspector = el('aside', { class: 'insp', id: 'inspector' });
  root.appendChild(el('div', { class: 'body' }, [UI.sidebar, center, UI.inspector]));

  document.body.appendChild(root);

  document.addEventListener('pointerdown', (ev) => {
    if (UI.popover && !UI.popover.contains(ev.target) && !ev.target.closest('.menu-open')) closePopover();
  }, true);
  window.addEventListener('blur', closePopover);
  /* The panels that depend on a deck are filled by the first refresh(); the
     shell is built before a deck exists so a load failure still has a UI to
     report itself in. */
}

/* ---------- menus ---------- */

function fileMenu(anchor) {
  openPopover(anchor, (pop) => {
    pop.appendChild(menuItem('New presentation', () => newDeckGuarded(), { key: '⌘N' }));
    pop.appendChild(menuItem('Open…', () => pickFiles('.pptx,.json,application/vnd.openxmlformats-officedocument.presentationml.presentation', false, (f) => f.length && openDeckFile(f[0])), { key: '⌘O' }));
    pop.appendChild(menuSep());
    pop.appendChild(menuHead('Save'));
    pop.appendChild(menuItem('Save project (.deck.json)', saveProject, { key: '⌘S' }));
    pop.appendChild(menuItem('Export PowerPoint (.pptx)', savePptx));
    pop.appendChild(menuItem('Export PDF…', exportPdf, { key: '⌘P' }));
    pop.appendChild(menuSep());
    pop.appendChild(menuItem('Keyboard shortcuts', showShortcuts, { key: '?' }));
    pop.appendChild(menuItem('About ' + APP_NAME, showAbout));
  });
}
async function newDeckGuarded() {
  if (App.dirty && !(await confirmDialog('New presentation?', 'The current presentation has unsaved changes.', 'Discard and start new'))) return;
  newDeck();
  toast('New presentation');
}
function insertMenu(anchor) {
  openPopover(anchor, (pop) => {
    pop.appendChild(menuItem('Text box', () => armInsert('text'), { key: 'T' }));
    pop.appendChild(menuItem('Picture…', () => pickFiles('image/*', true, insertImageFiles)));
    pop.appendChild(menuItem('Table…', () => insertTableDialog()));
    pop.appendChild(menuSep());
    pop.appendChild(menuItem('Shape…', () => shapePickerDialog(anchor), { key: 'S' }));
    pop.appendChild(menuItem('Line', () => armInsert('line', 'line'), { key: 'L' }));
    pop.appendChild(menuSep());
    pop.appendChild(menuItem('Slide number on every slide', insertSlideNumbers));
  });
}
function slideMenu(anchor) {
  openPopover(anchor, (pop) => {
    pop.appendChild(menuItem('New slide', () => addSlide('titleContent'), { key: '⌘M' }));
    pop.appendChild(menuItem('Duplicate slide', () => duplicateSlide()));
    pop.appendChild(menuItem('Delete slide', () => deleteSlide(), { danger: true, disabled: App.deck.slides.length < 1 }));
    pop.appendChild(menuSep());
    pop.appendChild(menuHead('Layout'));
    for (const l of LAYOUTS) pop.appendChild(menuItem(l.name, () => applyLayout(l.id), { checked: curSlide().layout === l.id }));
    pop.appendChild(menuSep());
    pop.appendChild(menuItem('Move slide up', () => reorderSlide(App.cur, App.cur - 1), { disabled: App.cur === 0 }));
    pop.appendChild(menuItem('Move slide down', () => reorderSlide(App.cur, App.cur + 1), { disabled: App.cur >= App.deck.slides.length - 1 }));
  });
}
function arrangeMenu(anchor) {
  const n = App.sel.length;
  openPopover(anchor, (pop) => {
    pop.appendChild(menuItem('Bring to front', () => orderSel('front'), { disabled: !n, key: '⌘⇧]' }));
    pop.appendChild(menuItem('Bring forward', () => orderSel('forward'), { disabled: !n, key: '⌘]' }));
    pop.appendChild(menuItem('Send backward', () => orderSel('backward'), { disabled: !n, key: '⌘[' }));
    pop.appendChild(menuItem('Send to back', () => orderSel('back'), { disabled: !n, key: '⌘⇧[' }));
    pop.appendChild(menuSep());
    pop.appendChild(menuHead(n > 1 ? 'Align to each other' : 'Align to slide'));
    const ag = el('div', { class: 'mi-grid' });
    for (const a of [['left', 'Left'], ['hcenter', 'Centre'], ['right', 'Right'], ['top', 'Top'], ['vcenter', 'Middle'], ['bottom', 'Bottom']]) {
      ag.appendChild(el('button', { class: 'mi-gb', text: a[1], disabled: !n || null, onclick: () => { closePopover(); alignSel(a[0]); } }));
    }
    pop.appendChild(ag);
    pop.appendChild(menuItem('Distribute horizontally', () => distributeSel('h'), { disabled: n < 3 }));
    pop.appendChild(menuItem('Distribute vertically', () => distributeSel('v'), { disabled: n < 3 }));
    pop.appendChild(menuSep());
    pop.appendChild(menuItem('Group', groupSel, { disabled: n < 2, key: '⌘G' }));
    pop.appendChild(menuItem('Ungroup', ungroupSel, { disabled: !n, key: '⌘⇧G' }));
    pop.appendChild(menuSep());
    pop.appendChild(menuItem('Flip horizontally', () => flipSel('h'), { disabled: !n }));
    pop.appendChild(menuItem('Flip vertically', () => flipSel('v'), { disabled: !n }));
    pop.appendChild(menuItem('Match size to first', () => matchSize('both'), { disabled: n < 2 }));
  });
}
function viewMenu(anchor) {
  openPopover(anchor, (pop) => {
    pop.appendChild(menuItem('Fit to window', () => { App.zoom = 'fit'; layoutCanvas(); }, { key: '⌘0' }));
    for (const z of [0.5, 0.75, 1, 1.5, 2]) pop.appendChild(menuItem(Math.round(z * 100) + '%', () => { App.zoom = z; layoutCanvas(); }));
    pop.appendChild(menuSep());
    pop.appendChild(menuItem('Snap to guides', () => { App.snap = !App.snap; buildStatusBar(); }, { checked: App.snap }));
    pop.appendChild(menuItem('Show grid', () => { App.grid = !App.grid; renderCanvas(); buildStatusBar(); }, { checked: App.grid }));
    pop.appendChild(menuItem('Speaker notes', () => { App.notesOpen = !App.notesOpen; buildNotesStrip(); layoutCanvas(); }, { checked: App.notesOpen }));
    pop.appendChild(menuSep());
    pop.appendChild(menuItem('Present from first slide', () => startPresent(0)));
    pop.appendChild(menuItem('Present from this slide', () => startPresent(App.cur), { key: '⌘↩' }));
  });
}

function showShortcuts() {
  const rows = [
    ['Navigation', ''],
    ['Next / previous slide', 'Page Down / Page Up'],
    ['First / last slide', 'Home / End'],
    ['Fit to window', '⌘0'],
    ['Zoom', '⌘ + scroll'],
    ['Editing', ''],
    ['New slide', '⌘M'],
    ['Duplicate selection', '⌘D'],
    ['Select all on slide', '⌘A'],
    ['Edit text in selected shape', 'Return'],
    ['Finish editing', 'Esc'],
    ['Nudge / nudge far', 'Arrows / ⇧Arrows'],
    ['Constrain move or ratio', 'hold ⇧'],
    ['Ignore snapping', 'hold ⌥'],
    ['Free rotation', 'hold ⌥ while rotating'],
    ['Insert', ''],
    ['Text box / shape / line', 'T / S / L'],
    ['Arrange', ''],
    ['Front / back', '⌘⇧] / ⌘⇧['],
    ['Forward / backward', '⌘] / ⌘['],
    ['Group / ungroup', '⌘G / ⌘⇧G'],
    ['Presenting', ''],
    ['Start from this slide', '⌘↩'],
    ['Notes / blank / go to', 'N / B / G'],
    ['Exit', 'Esc']
  ];
  const t = el('table', { class: 'keys' });
  for (const [a, b] of rows) {
    if (!b) { t.appendChild(el('tr', { class: 'keys-h' }, [el('th', { colspan: '2', text: a })])); continue; }
    t.appendChild(el('tr', {}, [el('td', { text: a }), el('td', {}, [el('kbd', { text: b })])]));
  }
  modal('Keyboard shortcuts', t, [{ label: 'Close', value: true, primary: true }]);
}
function showAbout() {
  const b = el('div');
  b.appendChild(el('p', { class: 'dlg-text', text: APP_NAME + ' ' + APP_VERSION + ' — a presentation editor that runs entirely in this page.' }));
  b.appendChild(el('p', { class: 'dlg-text dim', text: 'Opens and writes PowerPoint (.pptx) files, exports PDF, and saves a lossless project file. No server, no network: everything happens in your browser, and nothing you open leaves this machine.' }));
  b.appendChild(el('p', { class: 'dlg-text dim', text: 'PowerPoint import brings across shapes, text with its formatting, pictures, tables and SmartArt at their real positions. Charts are left as a labelled frame — the import notes say which slides they were on.' }));
  modal('About', b, [{ label: 'Close', value: true, primary: true }]);
}

/* ---------- insert helpers ---------- */

function insertTableDialog() {
  const rows = numInput(3, () => {}, { min: 1, max: 40 });
  const cols = numInput(3, () => {}, { min: 1, max: 20 });
  const body = el('div', { class: 'fgrid' }, [labeledRow('Rows', [rows]), labeledRow('Columns', [cols])]);
  modal('Insert table', body, [{ label: 'Cancel', value: false }, { label: 'Insert', value: true, primary: true }]).then((ok) => {
    if (!ok) return;
    const r = clamp(parseInt(rows.value, 10) || 3, 1, 40), c = clamp(parseInt(cols.value, 10) || 3, 1, 20);
    const W = App.deck.size.w;
    const w = round2(W * 0.72), h = round2(Math.min(App.deck.size.h * 0.6, r * 30));
    const e = mkElement('table', { x: round2((W - w) / 2), y: round2(App.deck.size.h * 0.28), w, h });
    e.table = mkTable(r, c, w, h);
    e.firstRow = true; e.bandRow = true;
    syncTableSize(e);
    addElement(e);
  });
}
function shapePickerDialog(anchor) {
  openPopover(anchor || $('.menus'), (pop) => {
    pop.classList.add('pop-shapes');
    for (const g of SHAPE_MENU) {
      pop.appendChild(menuHead(g.group));
      const grid = el('div', { class: 'sgrid' });
      for (const name of g.items) {
        const b = el('button', { class: 'sgb', title: shapeLabel(name), onclick: () => { closePopover(); armInsert(isOpenGeom(name) ? 'line' : 'shape', name); } });
        const svg = svgEl('svg', { viewBox: '0 0 28 22', 'aria-hidden': 'true' });
        const p = svgEl('path', {
          d: geomPath(name, 26, 20, null), transform: 'translate(1,1)',
          fill: isOpenGeom(name) ? 'none' : 'currentColor', stroke: 'currentColor',
          'stroke-width': isOpenGeom(name) ? 1.6 : 0.8, 'fill-rule': 'evenodd', 'stroke-linejoin': 'round'
        });
        svg.appendChild(p);
        b.appendChild(svg);
        grid.appendChild(b);
      }
      pop.appendChild(grid);
    }
  }, { cls: 'pop-wide' });
}
function insertSlideNumbers() {
  commit('Add slide numbers', () => {
    const W = App.deck.size.w, H = App.deck.size.h;
    App.deck.slides.forEach((s, i) => {
      s.elements = s.elements.filter((e) => e.name !== 'Slide number');
      s.elements.push(mkElement('text', {
        name: 'Slide number',
        x: round2(W - 64), y: round2(H - 34), w: 44, h: 20,
        body: mkBody([mkPara([mkRun(String(i + 1), { sz: 11, color: { scheme: 'tx2' } })], { align: 'r' })], { anchor: 'ctr' })
      }));
    });
  });
  toast('Slide numbers added');
}

/* ==========================================================================
   TOOLBAR — rebuilt from the current selection
   ========================================================================== */

function buildToolbar() {
  const tb = UI.toolbar;
  if (!tb || !App.deck) return;
  tb.textContent = '';
  const els = selElements();
  const one = els.length === 1 ? els[0] : null;
  const textish = els.filter((e) => canHaveText(e) && e.body);
  const shapes = els.filter((e) => e.type === 'shape' || e.type === 'line' || e.type === 'text');

  const grp = (kids) => el('div', { class: 'tgrp' }, kids.filter(Boolean));

  /* Always-present insert cluster. */
  tb.appendChild(grp([
    btn({ icon: 'plus', title: 'New slide  ⌘M', cls: 'ghost', onclick: () => addSlide('titleContent') }),
    btn({ icon: 'text', title: 'Text box  (T)', cls: 'ghost', onclick: () => armInsert('text') }),
    btn({ icon: 'shape', title: 'Shape  (S)', cls: 'ghost', caret: true, onclick: (ev) => shapePickerDialog(ev.currentTarget) }),
    btn({ icon: 'image', title: 'Picture', cls: 'ghost', onclick: () => pickFiles('image/*', true, insertImageFiles) }),
    btn({ icon: 'table', title: 'Table', cls: 'ghost', onclick: insertTableDialog })
  ]));

  if (!els.length) {
    tb.appendChild(el('div', { class: 'thint', text: 'Nothing selected — click an item on the slide, or use the buttons above to add one.' }));
    return;
  }

  if (textish.length) {
    const probe = probeRunProps(textish);
    const fonts = FONT_MENU.map((f) => ({ value: f, label: f }));
    fonts.unshift({ value: '+mj-lt', label: 'Theme heading' }, { value: '+mn-lt', label: 'Theme body' });
    tb.appendChild(grp([
      selectEl(fonts, probe.font === undefined ? '+mn-lt' : probe.font, (v) => applyRunProps({ font: v }, 'Change font'), 'font'),
      (() => {
        const sizes = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 54, 60, 72, 88, 96].map((s) => ({ value: s, label: String(s) }));
        if (probe.sz && sizes.every((s) => s.value !== probe.sz)) sizes.push({ value: probe.sz, label: String(probe.sz) });
        return selectEl(sizes.sort((a, b) => a.value - b.value), probe.sz || 18, (v) => applyRunProps({ sz: +v }, 'Change size'), 'size');
      })(),
      btn({ label: 'A−', title: 'Smaller', small: true, cls: 'ghost', onclick: () => stepFontSize(-1) }),
      btn({ label: 'A+', title: 'Larger', small: true, cls: 'ghost', onclick: () => stepFontSize(1) })
    ]));
    tb.appendChild(grp([
      btn({ label: 'B', title: 'Bold  ⌘B', cls: 'ghost bold', active: probe.b === true, onclick: () => toggleRun('b') }),
      btn({ label: 'I', title: 'Italic  ⌘I', cls: 'ghost ital', active: probe.i === true, onclick: () => toggleRun('i') }),
      btn({ label: 'U', title: 'Underline  ⌘U', cls: 'ghost undl', active: !!probe.u, onclick: () => toggleRun('u') }),
      btn({ label: 'S', title: 'Strikethrough', cls: 'ghost strk', active: !!probe.strike, onclick: () => toggleRun('strike') }),
      colorSwatch(probe.color === undefined ? { scheme: 'tx1' } : probe.color, (c) => applyRunProps({ color: c }, 'Change text colour'), { title: 'Text colour', small: true, allowAlpha: true })
    ]));
    const pp = probeParaProps(textish);
    tb.appendChild(grp([
      btn({ icon: 'alignL', title: 'Align left', cls: 'ghost', active: (pp.align || 'l') === 'l', onclick: () => applyParaProps({ align: 'l' }, 'Align left') }),
      btn({ icon: 'alignC', title: 'Centre', cls: 'ghost', active: pp.align === 'ctr', onclick: () => applyParaProps({ align: 'ctr' }, 'Centre') }),
      btn({ icon: 'alignR', title: 'Align right', cls: 'ghost', active: pp.align === 'r', onclick: () => applyParaProps({ align: 'r' }, 'Align right') }),
      btn({ icon: 'bullets', title: 'Bulleted list', cls: 'ghost', active: !!(pp.bullet && pp.bullet.type === 'char'), onclick: () => toggleBullet('char') }),
      btn({ icon: 'numbers', title: 'Numbered list', cls: 'ghost', active: !!(pp.bullet && pp.bullet.type === 'num'), onclick: () => toggleBullet('num') }),
      btn({ label: '→|', title: 'Increase indent  (Tab)', small: true, cls: 'ghost', onclick: () => indentSel(1) }),
      btn({ label: '|←', title: 'Decrease indent  (⇧Tab)', small: true, cls: 'ghost', onclick: () => indentSel(-1) })
    ]));
  }

  if (shapes.length) {
    const f = one && one.fill ? one.fill : (shapes[0].fill || null);
    tb.appendChild(grp([
      colorSwatch(f && f.type === 'solid' ? f.color : null, (c) => updateSel('Change fill', (e) => { e.fill = c ? { type: 'solid', color: c } : { type: 'none' }; }), { title: 'Fill', small: true, allowNone: true, allowAlpha: true }),
      colorSwatch(shapes[0].line ? shapes[0].line.color : null, (c) => updateSel('Change outline', (e) => {
        if (!c) e.line = { type: 'none' };
        else e.line = Object.assign({ w: 1, dash: 'solid' }, e.line && e.line.type !== 'none' ? e.line : {}, { color: c, type: undefined });
      }), { title: 'Outline', small: true, allowNone: true }),
      numInput(shapes[0].line && shapes[0].line.w, (v) => updateSel('Outline width', (e) => {
        if (!e.line || e.line.type === 'none') e.line = { color: { scheme: 'tx1' }, dash: 'solid' };
        e.line.w = v; delete e.line.type;
      }), { min: 0.25, max: 64, cls: 'w3', title: 'Outline width (pt)' })
    ]));
  }

  tb.appendChild(grp([
    btn({ icon: 'front', title: 'Bring to front', cls: 'ghost', onclick: () => orderSel('front') }),
    btn({ icon: 'back', title: 'Send to back', cls: 'ghost', onclick: () => orderSel('back') }),
    btn({ icon: 'copy', title: 'Duplicate  ⌘D', cls: 'ghost', onclick: () => duplicateSel() }),
    btn({ icon: 'trash', title: 'Delete', cls: 'ghost danger', onclick: deleteSel })
  ]));
  if (els.length > 1) {
    tb.appendChild(grp([
      btn({ icon: 'group', title: 'Group  ⌘G', cls: 'ghost', onclick: groupSel }),
      el('span', { class: 'tcount', text: els.length + ' selected' })
    ]));
  }
}

/* What a group of elements agrees on, for showing toolbar state. undefined
   means "they differ", which is why the controls show nothing rather than
   the first element's value. */
function probeRunProps(els) {
  const out = {};
  let first = true;
  const visit = (body) => {
    for (const p of body.paragraphs || []) {
      for (const r of p.runs || []) {
        if (r.br) continue;
        const v = {};
        for (const k of ['sz', 'font', 'b', 'i', 'u', 'strike', 'color']) v[k] = r[k] !== undefined ? r[k] : (p.defRPr || {})[k];
        if (first) { Object.assign(out, v); first = false; continue; }
        for (const k in v) if (JSON.stringify(out[k]) !== JSON.stringify(v[k])) out[k] = undefined;
      }
    }
  };
  for (const e of els) {
    if (e.type === 'table' && e.table) { for (const c of selectedCells(e)) visit(c.body); }
    else if (e.body) visit(e.body);
  }
  if (out.b === undefined && !first) out.b = false;
  return out;
}
function probeParaProps(els) {
  const out = {};
  let first = true;
  const visit = (body) => {
    for (const p of body.paragraphs || []) {
      const v = { align: p.align || 'l', bullet: p.bullet || null, lvl: p.lvl || 0 };
      if (first) { Object.assign(out, v); first = false; continue; }
      for (const k in v) if (JSON.stringify(out[k]) !== JSON.stringify(v[k])) out[k] = undefined;
    }
  };
  for (const e of els) {
    if (e.type === 'table' && e.table) { for (const c of selectedCells(e)) visit(c.body); }
    else if (e.body) visit(e.body);
  }
  return out;
}
function toggleRun(prop) {
  if (App.editing) {
    const s = curSlide(), e = findElement(s, App.editing);
    if (e) {
      const getB = TextEdit.cellRef
        ? () => e.table.rows[TextEdit.cellRef.r].cells[TextEdit.cellRef.c].body
        : () => e.body;
      const setB = TextEdit.cellRef
        ? (b) => { e.table.rows[TextEdit.cellRef.r].cells[TextEdit.cellRef.c].body = b; }
        : (b) => { e.body = b; };
      toggleRunPropOnRange(prop, getB, setB);
      buildToolbar();
      return;
    }
  }
  const probe = probeRunProps(selElements());
  const on = prop === 'u' ? !probe.u : !probe[prop];
  applyRunProps(prop === 'u' ? { u: on ? 'sng' : null } : prop === 'strike' ? { strike: on ? 'sngStrike' : null } : { [prop]: on ? true : null }, 'Format text');
}
function stepFontSize(dir) {
  const SIZES = [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 54, 60, 72, 88, 96, 120, 144];
  updateSel('Change size', (e) => {
    const bodies = (e.type === 'table' && e.table) ? selectedCells(e).map((c) => c.body) : (e.body ? [e.body] : []);
    for (const b of bodies) {
      for (const p of b.paragraphs || []) {
        const bump = (r) => {
          const cur = r.sz || 18;
          let i = SIZES.findIndex((s) => s >= cur - 0.01);
          if (i < 0) i = SIZES.length - 1;
          if (dir > 0 && SIZES[i] <= cur) i += 1;
          if (dir < 0) i -= 1;
          r.sz = SIZES[clamp(i, 0, SIZES.length - 1)];
        };
        if (p.defRPr && p.defRPr.sz) bump(p.defRPr);
        for (const r of p.runs || []) if (!r.br) bump(r);
      }
    }
  });
}
function toggleBullet(kind) {
  const pp = probeParaProps(selElements());
  const already = pp.bullet && pp.bullet.type === kind;
  if (already) applyParaProps({ bullet: { type: 'none' }, marL: 0, indent: 0 }, 'Remove list');
  else applyParaProps({
    bullet: kind === 'num' ? { type: 'num', scheme: 'arabicPeriod', start: 1 } : { type: 'char', char: '•' },
    marL: 21.6, indent: -21.6
  }, kind === 'num' ? 'Numbered list' : 'Bulleted list');
}
function indentSel(delta) {
  updateSel('Indent', (e) => {
    const bodies = (e.type === 'table' && e.table) ? selectedCells(e).map((c) => c.body) : (e.body ? [e.body] : []);
    for (const b of bodies) for (const p of b.paragraphs || []) {
      const lvl = clamp((p.lvl || 0) + delta, 0, 7);
      p.lvl = lvl;
      if (p.bullet && p.bullet.type !== 'none') {
        p.marL = 21.6 * (lvl + 1); p.indent = -21.6;
        if (p.bullet.type === 'char') p.bullet.char = bulletChar(lvl);
      } else { p.marL = 21.6 * lvl; p.indent = 0; }
    }
  });
}

/* ==========================================================================
   SIDEBAR
   ========================================================================== */

function buildSidebar() {
  const sb = UI.sidebar;
  if (!sb || !App.deck) return;
  const scroll = sb.scrollTop;
  sb.textContent = '';
  sb.appendChild(el('div', { class: 'side-head' }, [
    el('span', { text: 'Slides' }),
    el('span', { class: 'side-count', text: String(App.deck.slides.length) })
  ]));
  const list = el('div', { class: 'thumbs', id: 'thumbs' });
  App.deck.slides.forEach((s, i) => list.appendChild(buildThumb(s, i)));
  sb.appendChild(list);
  sb.appendChild(el('button', {
    class: 'side-add', onclick: () => addSlide('titleContent')
  }, [icon('plus'), el('span', { text: 'New slide' })]));
  sb.scrollTop = scroll;
  initThumbDrag(list);
}

function buildThumb(slide, i) {
  const wrap = el('div', {
    class: 'thumb' + (i === App.cur ? ' cur' : ''), dataset: { i: String(i) }, draggable: 'true',
    onclick: () => gotoSlide(i),
    oncontextmenu: (ev) => { ev.preventDefault(); slideContextMenu(ev, i); }
  });
  wrap.appendChild(el('span', { class: 'thumb-n', text: String(i + 1) }));
  const box = el('div', { class: 'thumb-box' });
  const inner = el('div', { class: 'thumb-inner' });
  const node = renderSlideFitted(slide, App.deck, { prompts: false });
  const k = 168 / App.deck.size.w;
  node.style.transformOrigin = 'top left';
  node.style.transform = 'scale(' + k + ')';
  box.style.width = '168px';
  box.style.height = round2(App.deck.size.h * k) + 'px';
  inner.appendChild(node);
  box.appendChild(inner);
  wrap.appendChild(box);
  if (String(slide.notes || '').trim()) wrap.appendChild(el('span', { class: 'thumb-notes', title: 'Has speaker notes' }));
  return wrap;
}
function refreshThumb(i) {
  const list = $('#thumbs');
  if (!list) return;
  const old = list.children[i];
  if (!old) { buildSidebar(); return; }
  const fresh = buildThumb(App.deck.slides[i], i);
  old.replaceWith(fresh);
}
function scheduleThumb() {
  clearTimeout(UI.thumbTimer);
  UI.thumbTimer = setTimeout(() => refreshThumb(App.cur), 280);
}
function scheduleToolbarSync() {
  clearTimeout(UI.toolbarTimer);
  UI.toolbarTimer = setTimeout(buildToolbar, 160);
}

function initThumbDrag(list) {
  let from = -1;
  list.addEventListener('dragstart', (ev) => {
    const t = ev.target.closest('.thumb');
    if (!t) return;
    from = +t.dataset.i;
    ev.dataTransfer.effectAllowed = 'move';
    try { ev.dataTransfer.setData('text/plain', String(from)); } catch (e) { /* Safari */ }
    t.classList.add('dragging');
  });
  list.addEventListener('dragend', () => {
    $$('.thumb', list).forEach((n) => n.classList.remove('dragging', 'over-a', 'over-b'));
  });
  list.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    const t = ev.target.closest('.thumb');
    $$('.thumb', list).forEach((n) => n.classList.remove('over-a', 'over-b'));
    if (!t) return;
    const r = t.getBoundingClientRect();
    t.classList.add(ev.clientY < r.top + r.height / 2 ? 'over-a' : 'over-b');
  });
  list.addEventListener('drop', (ev) => {
    ev.preventDefault();
    const t = ev.target.closest('.thumb');
    $$('.thumb', list).forEach((n) => n.classList.remove('over-a', 'over-b'));
    if (!t || from < 0) return;
    const r = t.getBoundingClientRect();
    let to = +t.dataset.i + (ev.clientY < r.top + r.height / 2 ? 0 : 1);
    if (to > from) to -= 1;
    if (to !== from) reorderSlide(from, to);
    from = -1;
  });
}
function slideContextMenu(ev, i) {
  const anchor = { getBoundingClientRect: () => ({ left: ev.clientX, right: ev.clientX, top: ev.clientY, bottom: ev.clientY, width: 0, height: 0 }) };
  openPopover(anchor, (pop) => {
    pop.appendChild(menuItem('New slide after', () => addSlide('titleContent', i + 1)));
    pop.appendChild(menuItem('Duplicate', () => duplicateSlide(i)));
    pop.appendChild(menuSep());
    pop.appendChild(menuItem('Move up', () => reorderSlide(i, i - 1), { disabled: i === 0 }));
    pop.appendChild(menuItem('Move down', () => reorderSlide(i, i + 1), { disabled: i >= App.deck.slides.length - 1 }));
    pop.appendChild(menuSep());
    pop.appendChild(menuItem('Delete slide', () => deleteSlide(i), { danger: true }));
  });
}

/* ==========================================================================
   CANVAS CONTEXT MENU
   ========================================================================== */

function showContextMenu(x, y, hit) {
  const anchor = { getBoundingClientRect: () => ({ left: x, right: x, top: y, bottom: y, width: 0, height: 0 }) };
  openPopover(anchor, (pop) => {
    if (hit) {
      if (canHaveText(hit)) pop.appendChild(menuItem('Edit text', () => startTextEdit(hit.id)));
      if (hit.type === 'image') pop.appendChild(menuItem('Replace picture…', () => openImageReplace(hit)));
      pop.appendChild(menuItem('Cut', cutSel, { key: '⌘X' }));
      pop.appendChild(menuItem('Copy', copySel, { key: '⌘C' }));
      pop.appendChild(menuItem('Duplicate', () => duplicateSel(), { key: '⌘D' }));
      pop.appendChild(menuSep());
      pop.appendChild(menuItem('Bring to front', () => orderSel('front')));
      pop.appendChild(menuItem('Send to back', () => orderSel('back')));
      if (App.sel.length > 1) pop.appendChild(menuItem('Group', groupSel));
      if (selElements().some((e) => e.groupId)) pop.appendChild(menuItem('Ungroup', ungroupSel));
      pop.appendChild(menuSep());
      pop.appendChild(menuItem(hit.locked ? 'Unlock' : 'Lock position', () => updateSel('Lock', (e) => { e.locked = !hit.locked; })));
      pop.appendChild(menuItem('Delete', deleteSel, { danger: true }));
    } else {
      pop.appendChild(menuItem('Paste', pasteClipboard, { key: '⌘V', disabled: !App.clipboard }));
      pop.appendChild(menuItem('Select all', selectAll, { key: '⌘A' }));
      pop.appendChild(menuSep());
      pop.appendChild(menuItem('New slide', () => addSlide('titleContent')));
      pop.appendChild(menuItem('Duplicate slide', () => duplicateSlide()));
    }
  });
}

/* ==========================================================================
   NOTES AND STATUS
   ========================================================================== */

function buildNotesStrip() {
  const n = UI.notes;
  if (!n || !App.deck) return;
  n.textContent = '';
  n.classList.toggle('closed', !App.notesOpen);
  const head = el('div', { class: 'notes-head' }, [
    el('button', { class: 'notes-toggle', onclick: () => { App.notesOpen = !App.notesOpen; buildNotesStrip(); layoutCanvas(); } }, [icon('notes'), el('span', { text: 'Speaker notes' })])
  ]);
  n.appendChild(head);
  if (!App.notesOpen) return;
  const ta = el('textarea', {
    class: 'notes-text', id: 'notesText', placeholder: 'Notes for this slide — shown in the presenter view, and exported with the .pptx.',
    spellcheck: 'true'
  });
  ta.value = curSlide() ? (curSlide().notes || '') : '';
  ta.addEventListener('keydown', (ev) => ev.stopPropagation());
  ta.addEventListener('input', debounce(() => {
    const s = curSlide();
    if (!s || s.notes === ta.value) return;
    s.notes = ta.value;
    App.dirty = true;
    markDirtyUI();
    scheduleThumb();
  }, 320));
  n.appendChild(ta);
}
function buildStatusBar() {
  const s = $('#statusBar');
  if (!s || !App.deck) return;
  s.textContent = '';
  s.appendChild(el('div', { class: 'st-l' }, [
    el('span', { text: 'Slide ' + (App.cur + 1) + ' of ' + App.deck.slides.length }),
    el('span', { class: 'st-dot' }),
    el('span', { text: SLIDE_SIZES[sizeKeyOf(App.deck.size)] ? SLIDE_SIZES[sizeKeyOf(App.deck.size)].name : round2(App.deck.size.w / PT_PER_IN) + ' × ' + round2(App.deck.size.h / PT_PER_IN) + ' in' })
  ]));
  s.appendChild(el('div', { class: 'st-r' }, [
    btn({ icon: 'magnet', title: 'Snap to guides', cls: 'ghost', small: true, active: App.snap, onclick: () => { App.snap = !App.snap; buildStatusBar(); } }),
    btn({ icon: 'grid', title: 'Show grid', cls: 'ghost', small: true, active: App.grid, onclick: () => { App.grid = !App.grid; renderCanvas(); buildStatusBar(); } }),
    el('span', { class: 'st-dot' }),
    btn({ label: '−', title: 'Zoom out', cls: 'ghost', small: true, onclick: () => { App.zoom = clamp(Canvas.scale / 1.2, 0.1, 8); layoutCanvas(); } }),
    el('button', { class: 'btn btn-s ghost zoomlab', id: 'zoomLabel', title: 'Fit to window', text: Math.round(Canvas.scale * 100) + '%', onclick: () => { App.zoom = 'fit'; layoutCanvas(); } }),
    btn({ label: '+', title: 'Zoom in', cls: 'ghost', small: true, onclick: () => { App.zoom = clamp(Canvas.scale * 1.2, 0.1, 8); layoutCanvas(); } })
  ]));
}
function sizeKeyOf(size) {
  for (const k in SLIDE_SIZES) if (Math.abs(SLIDE_SIZES[k].w - size.w) < 1 && Math.abs(SLIDE_SIZES[k].h - size.h) < 1) return k;
  return null;
}
function markDirtyUI() {
  const d = $('#dirtyDot');
  if (d) d.classList.toggle('on', !!App.dirty);
}

/* ==========================================================================
   REFRESH
   ========================================================================== */

function refresh(full) {
  if (!App.deck) return;
  const ti = $('#deckTitle');
  if (ti && ti.value !== deckTitle()) ti.value = deckTitle();
  renderCanvas();
  buildSidebar();
  buildToolbar();
  buildInspector();
  buildNotesStrip();
  buildStatusBar();
  markDirtyUI();
  if (full) applyThemeToChrome();
}
function refreshSelection() {
  drawOverlay();
  buildToolbar();
  buildInspector();
}
function refreshInspector() { buildInspector(); }

function applyThemeToChrome() {
  const t = uiTokens(theme());
  document.documentElement.style.setProperty('--accent', t.accent);
  document.documentElement.style.setProperty('--accent-ink', t.accentText);
}
