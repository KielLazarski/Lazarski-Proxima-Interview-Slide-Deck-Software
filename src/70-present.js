/* ==========================================================================
   70-present.js — presenting.

   The same renderer draws the slide, so nothing can look different on the
   projector from how it looked while editing. Two extras earn their place:
   a presenter view (notes, the next slide, a timer) on a key you can find in
   the dark, and a slide jump list, because the thing that actually goes wrong
   in a talk is being asked to go back to slide four.
   ========================================================================== */

const Present = {
  active: false, index: 0, root: null, stageHost: null, notesPane: null,
  startedAt: 0, timer: null, showNotes: false, blank: false, cursorTimer: 0,
  pointer: false, jump: null
};

function startPresent(fromIndex) {
  if (Present.active) return;
  if (App.editing) endTextEdit();
  Present.active = true;
  Present.index = clamp(fromIndex === undefined ? App.cur : fromIndex, 0, App.deck.slides.length - 1);
  Present.startedAt = Date.now();
  Present.blank = false;

  const root = el('div', { class: 'pv', tabindex: '0' });
  const stageHost = el('div', { class: 'pv-stage' });
  const screen = el('div', { class: 'pv-screen' }, [stageHost]);
  const notes = el('aside', { class: 'pv-notes' });
  root.appendChild(screen);
  root.appendChild(notes);
  root.appendChild(el('div', { class: 'pv-hint', html: '<b>← →</b> move &nbsp; <b>N</b> notes &nbsp; <b>B</b> blank &nbsp; <b>G</b> go to &nbsp; <b>Esc</b> exit' }));
  document.body.appendChild(root);
  Present.root = root; Present.stageHost = stageHost; Present.notesPane = notes;
  document.documentElement.classList.add('presenting');

  root.addEventListener('keydown', presentKey);
  root.addEventListener('click', presentClick);
  root.addEventListener('contextmenu', (ev) => { ev.preventDefault(); presentGo(-1); });
  root.addEventListener('wheel', debounce((ev) => presentGo(ev.deltaY > 0 ? 1 : -1), 60), { passive: true });
  root.addEventListener('pointermove', onPresentPointerMove);
  window.addEventListener('resize', presentLayout);

  /* Fullscreen is a request, not a guarantee — a denied request must still
     leave a working presenter view. */
  const fs = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
  if (fs && fs.catch) fs.catch(() => {});

  Present.timer = setInterval(updatePresentClock, 500);
  root.focus({ preventScroll: true });
  renderPresent();
}

function endPresent() {
  if (!Present.active) return;
  Present.active = false;
  clearInterval(Present.timer);
  window.removeEventListener('resize', presentLayout);
  if (Present.root) Present.root.remove();
  Present.root = null; Present.stageHost = null; Present.notesPane = null; Present.jump = null;
  document.documentElement.classList.remove('presenting');
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  gotoSlide(Present.index);
  if (Canvas.wrap) Canvas.wrap.focus({ preventScroll: true });
}

function renderPresent() {
  if (!Present.active) return;
  const deck = App.deck;
  const slide = deck.slides[Present.index];
  Present.stageHost.textContent = '';
  const node = renderSlide(slide, deck, { prompts: false });
  Present.stageHost.appendChild(node);
  try { applyAutofit(node, slide, deck); } catch (e) { /* show the slide anyway */ }
  /* The presenter pane has to be in place BEFORE the slide is scaled: it takes
     300px off the width, and sizing the slide first leaves it running off the
     edge of the screen the moment the pane opens. */
  renderPresenterPane();
  Present.root.classList.toggle('pv-blank', Present.blank);
  presentLayout();
}

function presentLayout() {
  if (!Present.active) return;
  const node = Present.stageHost.firstElementChild;
  if (!node) return;
  const W = App.deck.size.w, H = App.deck.size.h;
  const host = Present.stageHost.getBoundingClientRect();
  const k = Math.min(host.width / W, host.height / H);
  node.style.transformOrigin = 'top left';
  node.style.transform = 'scale(' + k + ')';
  Present.stageHost.style.setProperty('--sw', (W * k) + 'px');
  Present.stageHost.style.setProperty('--sh', (H * k) + 'px');
}

function renderPresenterPane() {
  const pane = Present.notesPane;
  if (!pane) return;
  pane.textContent = '';
  const deck = App.deck;
  const slide = deck.slides[Present.index];
  const next = deck.slides[Present.index + 1];

  pane.appendChild(el('div', { class: 'pv-clock' }, [
    el('span', { class: 'pv-elapsed', id: 'pvElapsed', text: fmtTime((Date.now() - Present.startedAt) / 1000) }),
    el('span', { class: 'pv-pos', text: (Present.index + 1) + ' / ' + deck.slides.length })
  ]));
  pane.appendChild(el('div', { class: 'pv-notes-body', text: String(slide.notes || '').trim() || 'No notes for this slide.' }));
  if (next) {
    const prev = el('div', { class: 'pv-next' });
    prev.appendChild(el('div', { class: 'pv-next-label', text: 'Next' }));
    const holder = el('div', { class: 'pv-next-stage' });
    const n = renderSlideFitted(next, deck, { prompts: false });
    const PW = 196;
    const k = PW / deck.size.w;
    n.style.transformOrigin = 'top left';
    n.style.transform = 'scale(' + k + ')';
    holder.style.width = PW + 'px';
    holder.style.height = round2(deck.size.h * k) + 'px';
    holder.appendChild(n);
    prev.appendChild(holder);
    pane.appendChild(prev);
  }
  pane.appendChild(el('div', { class: 'pv-ctl' }, [
    el('button', { class: 'btn btn-s', text: 'Reset timer', onclick: () => { Present.startedAt = Date.now(); updatePresentClock(); } }),
    el('button', { class: 'btn btn-s', text: 'Exit', onclick: endPresent })
  ]));
  Present.root.classList.toggle('pv-with-notes', Present.showNotes);
}
function updatePresentClock() {
  const n = $('#pvElapsed');
  if (n) n.textContent = fmtTime((Date.now() - Present.startedAt) / 1000);
}

function presentGo(delta) {
  const n = App.deck.slides.length;
  const next = clamp(Present.index + delta, 0, n - 1);
  if (next === Present.index) return;
  Present.index = next;
  Present.blank = false;
  renderPresent();
}
function presentTo(i) {
  Present.index = clamp(i, 0, App.deck.slides.length - 1);
  Present.blank = false;
  renderPresent();
}

function presentClick(ev) {
  if (ev.target.closest('.pv-notes') || ev.target.closest('.pv-jump')) return;
  if (Present.jump) { closeJump(); return; }
  presentGo(1);
}

function presentKey(ev) {
  const k = ev.key;
  if (Present.jump) {
    if (k === 'Escape') { ev.preventDefault(); closeJump(); return; }
    if (k === 'Enter') { ev.preventDefault(); const v = parseInt(Present.jump.input.value, 10); closeJump(); if (isFinite(v)) presentTo(v - 1); return; }
    return;   /* let digits reach the field */
  }
  if (k === 'Escape') { ev.preventDefault(); endPresent(); return; }
  if (k === 'ArrowRight' || k === 'ArrowDown' || k === ' ' || k === 'PageDown' || k === 'Enter') { ev.preventDefault(); presentGo(1); return; }
  if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace') { ev.preventDefault(); presentGo(-1); return; }
  if (k === 'Home') { ev.preventDefault(); presentTo(0); return; }
  if (k === 'End') { ev.preventDefault(); presentTo(App.deck.slides.length - 1); return; }
  const lower = k.toLowerCase();
  if (lower === 'n') { ev.preventDefault(); Present.showNotes = !Present.showNotes; renderPresent(); return; }
  if (lower === 'b' || lower === '.') { ev.preventDefault(); Present.blank = !Present.blank; Present.root.classList.toggle('pv-blank', Present.blank); return; }
  if (lower === 'g') { ev.preventDefault(); openJump(); return; }
  if (lower === 'f') {
    ev.preventDefault();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
    return;
  }
  if (/^[0-9]$/.test(k)) { ev.preventDefault(); openJump(k); return; }
}

function openJump(seed) {
  if (Present.jump) return;
  const input = el('input', { class: 'pv-jump-input', type: 'text', inputmode: 'numeric', value: seed || '', placeholder: '1–' + App.deck.slides.length });
  const box = el('div', { class: 'pv-jump' }, [el('label', { text: 'Go to slide' }), input]);
  Present.root.appendChild(box);
  Present.jump = { box, input };
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}
function closeJump() {
  if (!Present.jump) return;
  Present.jump.box.remove();
  Present.jump = null;
  Present.root.focus({ preventScroll: true });
}

/* The cursor hides itself during a talk and comes back on movement, so a
   stationary pointer does not sit on the screen for an hour. */
function onPresentPointerMove() {
  if (!Present.root) return;
  Present.root.classList.remove('pv-nocursor');
  clearTimeout(Present.cursorTimer);
  Present.cursorTimer = setTimeout(() => {
    if (Present.root) Present.root.classList.add('pv-nocursor');
  }, 2600);
}
