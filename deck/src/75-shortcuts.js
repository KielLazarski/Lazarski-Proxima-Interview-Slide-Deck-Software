/* ==========================================================================
   75-shortcuts.js — global keyboard handling.

   The text editor and present mode both take keys first, so this handler bails
   out whenever focus is inside an editable field. Without that check, typing
   the letter "s" into a title would arm the shape tool.
   ========================================================================== */

function initShortcuts() {
  document.addEventListener('keydown', (ev) => {
    if (Present.active) return;                      /* present mode has its own */
    const t = ev.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (UI.popover && ev.key === 'Escape') { closePopover(); ev.preventDefault(); return; }
    if ($('.dlg-wrap')) return;

    const mod = ev.metaKey || ev.ctrlKey;
    const k = ev.key;
    const lower = typeof k === 'string' ? k.toLowerCase() : '';

    if (mod && !ev.altKey) {
      switch (lower) {
        case 'z': ev.preventDefault(); ev.shiftKey ? redo() : undo(); return;
        case 'y': ev.preventDefault(); redo(); return;
        case 'c': ev.preventDefault(); copySel(); return;
        case 'x': ev.preventDefault(); cutSel(); return;
        case 'v': return;                            /* the paste listener handles it */
        case 'd': ev.preventDefault(); duplicateSel(); return;
        case 'a': ev.preventDefault(); selectAll(); return;
        case 's': ev.preventDefault(); saveProject(); return;
        case 'o': ev.preventDefault(); pickFiles('.pptx,.json', false, (f) => f.length && openDeckFile(f[0])); return;
        case 'p': ev.preventDefault(); exportPdf(); return;
        case 'm': ev.preventDefault(); addSlide('titleContent'); return;
        case 'n': ev.preventDefault(); newDeckGuarded(); return;
        case 'g': ev.preventDefault(); ev.shiftKey ? ungroupSel() : groupSel(); return;
        case 'b': ev.preventDefault(); toggleRun('b'); return;
        case 'i': ev.preventDefault(); toggleRun('i'); return;
        case 'u': ev.preventDefault(); toggleRun('u'); return;
        case '0': ev.preventDefault(); App.zoom = 'fit'; layoutCanvas(); return;
        case '=': case '+': ev.preventDefault(); App.zoom = clamp(Canvas.scale * 1.2, 0.1, 8); layoutCanvas(); return;
        case '-': ev.preventDefault(); App.zoom = clamp(Canvas.scale / 1.2, 0.1, 8); layoutCanvas(); return;
        case 'enter': ev.preventDefault(); startPresent(App.cur); return;
        default: break;
      }
      if (k === ']') { ev.preventDefault(); orderSel(ev.shiftKey ? 'front' : 'forward'); return; }
      if (k === '[') { ev.preventDefault(); orderSel(ev.shiftKey ? 'back' : 'backward'); return; }
      return;
    }

    switch (k) {
      case 'Escape':
        ev.preventDefault();
        if (App.editing) endTextEdit(); else clearSelection();
        return;
      case 'Delete': case 'Backspace':
        if (App.sel.length) { ev.preventDefault(); deleteSel(); }
        return;
      case 'Enter':
        if (App.sel.length === 1) {
          const e = selOne();
          if (e && canHaveText(e)) { ev.preventDefault(); startTextEdit(e.id); }
        }
        return;
      case 'Tab': {
        /* Tab walks the slide's elements, which is how you reach something
           sitting underneath something else. */
        ev.preventDefault();
        const list = (curSlide().elements || []).filter((e) => !e.hidden);
        if (!list.length) return;
        const cur = list.findIndex((e) => e.id === App.sel[0]);
        const next = list[(cur + (ev.shiftKey ? -1 : 1) + list.length) % list.length];
        select([next.id]);
        return;
      }
      case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
        if (!App.sel.length) {
          if (k === 'ArrowLeft' || k === 'ArrowUp') { ev.preventDefault(); gotoSlide(App.cur - 1); }
          if (k === 'ArrowRight' || k === 'ArrowDown') { ev.preventDefault(); gotoSlide(App.cur + 1); }
          return;
        }
        ev.preventDefault();
        const step = ev.shiftKey ? 10 : 1;
        nudgeSel(k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0, k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0);
        return;
      }
      case 'PageDown': ev.preventDefault(); gotoSlide(App.cur + 1); return;
      case 'PageUp': ev.preventDefault(); gotoSlide(App.cur - 1); return;
      case 'Home': ev.preventDefault(); gotoSlide(0); return;
      case 'End': ev.preventDefault(); gotoSlide(App.deck.slides.length - 1); return;
      case '?': ev.preventDefault(); showShortcuts(); return;
      case 'F5': ev.preventDefault(); startPresent(0); return;
      default: break;
    }
    /* Single-letter tools, only with nothing selected for editing. */
    if (!ev.shiftKey && !ev.altKey) {
      if (lower === 't') { ev.preventDefault(); armInsert('text'); return; }
      if (lower === 's') { ev.preventDefault(); armInsert('shape', App.lastShapeGeom || 'rect'); return; }
      if (lower === 'l') { ev.preventDefault(); armInsert('line', 'line'); return; }
      if (lower === 'r') { ev.preventDefault(); armInsert('shape', 'rect'); return; }
      if (lower === 'o') { ev.preventDefault(); armInsert('shape', 'ellipse'); return; }
    }
  }, false);
}
