/* ==========================================================================
   99-main.js — start up.
   ========================================================================== */

function boot() {
  try {
    buildShell();
  } catch (err) {
    document.body.textContent = '';
    document.body.appendChild(el('pre', {
      style: { padding: '24px', color: '#F2685C', font: '13px ui-monospace, monospace', whiteSpace: 'pre-wrap' },
      text: 'Could not start.\n\n' + (err && err.stack ? err.stack : String(err))
    }));
    return;
  }

  let deck = null;
  try { deck = buildDefaultDeck(); }
  catch (err) {
    /* A broken bundled deck must not take the editor down with it. */
    console.error('[' + APP_NAME + '] bundled deck failed to build', err);
    deck = mkDeck();
    deck.slides = [newSlideFor(deck, 'title')];
  }
  loadDeck(deck, sanitizeFilename(deck.title, 'presentation'));
  App.dirty = false;
  markDirtyUI();

  initShortcuts();
  initDropTarget();
  initPaste();
  initUnloadGuard();
  applyThemeToChrome();

  /* Keep the fit-to-window zoom honest when panels open or the window moves
     between displays. */
  if (window.ResizeObserver && Canvas.wrap) {
    new ResizeObserver(debounce(() => { if (App.zoom === 'fit') layoutCanvas(); }, 60)).observe(Canvas.wrap);
  }
  requestAnimationFrame(() => { layoutCanvas(); Canvas.wrap.focus({ preventScroll: true }); });

  /* A handle for driving the app from the console or from a test harness.
     Nothing in the application reads it. */
  window.DECK = {
    app: App, model: { mkDeck, mkSlide, mkElement, mkBody, mkPara, mkRun, bodyFromText, normalizeDeck, SLIDE_SIZES, LAYOUTS },
    render: { renderSlide, renderSlideFitted, applyAutofit, geomPath, custGeomPath, presets: Object.keys(PRESETS), shapeMenu: SHAPE_MENU },
    io: { importPptx, exportPptx, unzip, zipFiles, saveProject, exportPdf, openDeckFile },
    cmd: {
      commit, undo, redo, select, selectAll, clearSelection, gotoSlide, addSlide, duplicateSlide,
      deleteSlide, applyLayout, addElement, deleteSel, duplicateSel, orderSel, alignSel, distributeSel,
      groupSel, ungroupSel, applyRunProps, applyParaProps, applyBodyProps, setDeckTheme, setSlideSize,
      startTextEdit, endTextEdit, startPresent, endPresent, loadDeck, buildDefaultDeck, refresh, toast
    },
    ui: { Canvas, Present, UI, buildToolbar, buildInspector, renderPresent },
    figures: FIGURES,
    version: APP_VERSION
  };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
