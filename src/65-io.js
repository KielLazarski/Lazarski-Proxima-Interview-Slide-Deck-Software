/* ==========================================================================
   65-io.js — opening files, saving, and the PDF path.

   PDF is produced by printing: the slides are laid out at their exact physical
   size in a print-only sheet and handed to the browser's own PDF writer. That
   keeps text as text — selectable, searchable, and sharp at any zoom — which
   rasterising to canvas would not. The trade is that the browser shows its
   print dialog, so the UI says so rather than appearing to hang.
   ========================================================================== */

const PROJECT_EXT = '.deck.json';

/* ---------- opening ---------- */

async function openFiles(fileList) {
  const files = Array.prototype.slice.call(fileList || []);
  if (!files.length) return;
  const images = files.filter((f) => /^image\//.test(f.type));
  const decks = files.filter((f) => /\.pptx$/i.test(f.name) || /\.(deck\.)?json$/i.test(f.name) || /\.ppt$/i.test(f.name));
  if (images.length && !decks.length) { insertImageFiles(images); return; }
  const f = decks[0] || files[0];
  await openDeckFile(f);
}

async function openDeckFile(file) {
  if (App.dirty && !(await confirmDialog('Open ' + file.name + '?', 'The current presentation has unsaved changes. Opening a file will discard them.', 'Discard and open'))) return;
  const busy = showBusy('Opening ' + file.name + '…');
  try {
    if (/\.pptx$/i.test(file.name)) {
      const buf = await readFileAs(file, 'buffer');
      const { deck, report } = await importPptx(buf, file.name);
      loadDeck(deck, file.name.replace(/\.pptx$/i, ''));
      const d = describeImport(report);
      toast('Opened ' + file.name + ' — ' + d.summary);
      if (d.warnings.length) showImportNotes(file.name, d);
    } else if (/\.ppt$/i.test(file.name)) {
      throw new Error('This is the old binary .ppt format, which cannot be read here. Open it in PowerPoint and use Save As to make a .pptx, then try again.');
    } else {
      const text = await readFileAs(file, 'text');
      let obj;
      try { obj = JSON.parse(text); }
      catch (e) { throw new Error('This file is not valid JSON.'); }
      if (!obj || !Array.isArray(obj.slides)) throw new Error('This JSON file does not contain a presentation.');
      loadDeck(obj, file.name.replace(/\.(deck\.)?json$/i, ''));
      toast('Opened ' + file.name + ' — ' + App.deck.slides.length + ' slides');
    }
  } catch (err) {
    console.error(err);
    await alertDialog('Could not open ' + file.name, err && err.message ? err.message : String(err));
  } finally { busy(); }
}

/* Images dropped or pasted onto the canvas. Each is placed at its natural
   aspect ratio, scaled to fit comfortably, and cascaded so several do not
   land on top of each other. */
async function insertImageFiles(fileArr) {
  const files = Array.prototype.slice.call(fileArr || []).filter((f) => /^image\//.test(f.type));
  if (!files.length) return;
  const added = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    try {
      const src = await readFileAs(f, 'dataURL');
      const dim = await imageSize(src);
      const W = App.deck.size.w, H = App.deck.size.h;
      const maxW = W * 0.62, maxH = H * 0.62;
      let w = dim.w, h = dim.h;
      const k = Math.min(maxW / w, maxH / h, 1);
      w = round2(w * k); h = round2(h * k);
      added.push(mkElement('image', {
        src, srcName: f.name, alt: '',
        x: round2((W - w) / 2 + i * 14), y: round2((H - h) / 2 + i * 14),
        w, h
      }));
    } catch (e) { toast('Could not read ' + f.name, 'error'); }
  }
  if (!added.length) return;
  commit('Insert image', () => {
    const s = curSlide();
    for (const e of added) s.elements.push(e);
    App.sel = added.map((e) => e.id);
  });
}
function imageSize(src) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res({ w: img.naturalWidth || 320, h: img.naturalHeight || 240 });
    img.onerror = () => res({ w: 320, h: 240 });
    img.src = src;
  });
}
function openImageReplace(e) {
  pickFiles('image/*', false, async (files) => {
    if (!files.length) return;
    const src = await readFileAs(files[0], 'dataURL');
    commit('Replace image', () => { e.src = src; e.srcName = files[0].name; e.crop = null; });
  });
}
function pickFiles(accept, multiple, cb) {
  const inp = el('input', { type: 'file', accept: accept || '', style: { display: 'none' } });
  if (multiple) inp.multiple = true;
  inp.addEventListener('change', () => { cb(Array.prototype.slice.call(inp.files || [])); inp.remove(); });
  document.body.appendChild(inp);
  inp.click();
}

/* ---------- saving ---------- */

function saveProject() {
  const name = sanitizeFilename(App.fileName || deckTitle()) + PROJECT_EXT;
  const json = JSON.stringify(Object.assign({}, App.deck, { app: APP_NAME, version: APP_VERSION, saved: new Date().toISOString() }), null, 1);
  downloadBlob(new Blob([json], { type: 'application/json' }), name);
  App.dirty = false;
  markDirtyUI();
  toast('Saved ' + name);
}

async function savePptx() {
  const busy = showBusy('Building PowerPoint file…');
  try {
    const blob = await exportPptx(App.deck);
    const name = sanitizeFilename(App.fileName || deckTitle()) + '.pptx';
    downloadBlob(blob, name);
    toast('Exported ' + name);
  } catch (err) {
    console.error(err);
    await alertDialog('Could not export', (err && err.message) || String(err));
  } finally { busy(); }
}

/* ---------- PDF via print ---------- */

let _printHost = null;
async function exportPdf() {
  const busy = showBusy('Laying out ' + App.deck.slides.length + ' slides for print…');
  try {
    if (App.editing) endTextEdit();
    if (_printHost) { _printHost.remove(); _printHost = null; }
    const W = App.deck.size.w, H = App.deck.size.h;
    /* The page box is set in inches from the deck's own point size, so a
       16:9 deck prints edge to edge with no margin and no scaling. */
    const style = el('style', {
      id: 'printSizeRule',
      text: '@page { size: ' + round2(W / PT_PER_IN) + 'in ' + round2(H / PT_PER_IN) + 'in; margin: 0 }'
    });
    const host = el('div', { class: 'print-host', id: 'printHost' });
    for (const s of App.deck.slides) {
      const page = el('div', { class: 'print-page' });
      page.style.width = W + 'px';
      page.style.height = H + 'px';
      const node = renderSlideFitted(s, App.deck, { prompts: false });
      page.appendChild(node);
      host.appendChild(page);
    }
    document.head.appendChild(style);
    document.body.appendChild(host);
    _printHost = host;
    document.documentElement.classList.add('printing');
    /* Let layout and any images settle before handing over to the printer. */
    await nextPaint();
    await nextPaint();
    busy();
    window.print();
    /* Tidy up after the dialog closes; the exact timing is not observable, so
       hook afterprint with a timeout fallback. */
    const cleanup = () => {
      document.documentElement.classList.remove('printing');
      if (_printHost) { _printHost.remove(); _printHost = null; }
      const st = $('#printSizeRule');
      if (st) st.remove();
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(cleanup, 60000);
  } catch (err) {
    busy();
    console.error(err);
    await alertDialog('Could not prepare the PDF', (err && err.message) || String(err));
  }
}
const nextPaint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

/* ---------- drag and drop onto the window ---------- */

function initDropTarget() {
  let depth = 0;
  const show = (on) => document.documentElement.classList.toggle('dropping', on);
  window.addEventListener('dragenter', (ev) => { ev.preventDefault(); depth += 1; show(true); });
  window.addEventListener('dragover', (ev) => { ev.preventDefault(); });
  window.addEventListener('dragleave', (ev) => { ev.preventDefault(); depth = Math.max(0, depth - 1); if (!depth) show(false); });
  window.addEventListener('drop', (ev) => {
    ev.preventDefault(); depth = 0; show(false);
    const dt = ev.dataTransfer;
    if (!dt) return;
    if (dt.files && dt.files.length) openFiles(dt.files);
  });
}

/* ---------- paste at the window level ---------- */

function initPaste() {
  window.addEventListener('paste', (ev) => {
    if (App.editing) return;                       /* the text editor owns it */
    if (Present.active) return;
    const dt = ev.clipboardData;
    if (!dt) return;
    const imgs = Array.prototype.filter.call(dt.files || [], (f) => /^image\//.test(f.type));
    if (imgs.length) { ev.preventDefault(); insertImageFiles(imgs); return; }
    if (App.clipboard) { ev.preventDefault(); pasteClipboard(); return; }
    const text = dt.getData('text/plain');
    if (text && text.trim()) {
      ev.preventDefault();
      /* Pasted text with no element selected becomes a new text box, which is
         the quickest way to get an outline onto a slide. */
      const W = App.deck.size.w;
      const e = mkElement('text', {
        x: round2(W * 0.0667), y: round2(App.deck.size.h * 0.3), w: round2(W * 0.8666), h: 80,
        body: bodyFromText(text.trim(), { body: { autofit: 'resize' } }, { sz: 18 })
      });
      addElement(e);
    }
  });
}

/* ---------- before unload ---------- */
function initUnloadGuard() {
  window.addEventListener('beforeunload', (ev) => {
    if (!App.dirty) return;
    ev.preventDefault();
    ev.returnValue = '';
    return '';
  });
}
