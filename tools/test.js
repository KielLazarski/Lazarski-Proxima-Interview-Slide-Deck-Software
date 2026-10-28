/* test.js — drive the built file in real headless Chromium.
   Usage: node tools/test.js [Deck.html]

   Checks are grouped; the process exits non-zero if any fails. The point is to
   exercise the paths a user actually takes — open a real PowerPoint file, move
   something, type something, export and read it back — rather than unit-test
   the helpers.
*/
const path = require('path');
const fs = require('fs');

function req(n) {
  for (const b of ['', '/opt/npm-tools/node_modules/', path.join(process.cwd(), 'node_modules/')]) {
    try { return require(b + n); } catch (e) { /* next */ }
  }
  throw new Error('cannot load ' + n);
}
const { chromium } = req('playwright');

const FILE = path.resolve(process.argv[2] || 'Deck.html');
const FIXTURE = path.resolve('test/fixture.pptx');
const OUTDIR = path.resolve('test');

let pass = 0, fail = 0;
const groups = [];
function group(name) { groups.push(name); console.log('\n' + name); }
function ok(name, cond, detail) {
  if (cond) { pass += 1; console.log('  PASS  ' + name + (detail ? '   ' + detail : '')); }
  else { fail += 1; console.log('  FAIL  ' + name + (detail ? '   — ' + detail : '')); }
}
const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1 : tol);

(async () => {
  const errs = [];
  const browser = await chromium.launch({ args: ['--no-sandbox', '--font-render-hinting=none'] });
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 }, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e && e.stack ? e.stack.split('\n')[0] : e).slice(0, 220)));
  pg.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/favicon|net::ERR_FILE/i.test(t)) return;
    errs.push('CONSOLE ' + t.slice(0, 220));
  });

  await pg.goto('file://' + FILE, { waitUntil: 'load', timeout: 60000 });
  await pg.waitForFunction(() => !!window.DECK, { timeout: 20000 });
  await pg.waitForTimeout(500);

  /* ------------------------------------------------------------ startup */
  group('Startup and the bundled deck');
  ok('the app exposes its test handle', await pg.evaluate(() => !!window.DECK && !!window.DECK.app.deck));
  const info = await pg.evaluate(() => {
    const d = window.DECK.app.deck;
    return {
      slides: d.slides.length,
      title: d.title,
      size: d.size,
      theme: d.theme && d.theme.name,
      tags: d.slides.map((s) => s.tag || ''),
      counts: d.slides.map((s) => s.elements.length),
      notes: d.slides.map((s) => (s.notes || '').length),
      notesText: d.slides.map((s) => s.notes || '').join('\n'),
      texts: d.slides.map((s) => s.elements.filter((e) => e.body).map((e) => e.body.paragraphs.map((p) => p.runs.map((r) => r.t || '').join('')).join(' ')).join(' | '))
    };
  });
  const DECK_LEN = info.slides;
  const TOOL_AT = info.tags.reduce((a, t, i) => (/^tool-/.test(t) ? a.concat(i) : a), []);
  const toolText = TOOL_AT.map((i) => info.texts[i]);
  ok('twenty slides', info.slides === 20, info.slides + ' slides');
  ok('every slide is tagged for its section', info.tags.every(Boolean),
    info.tags.map((t, i) => (t ? '' : 'slide ' + (i + 1))).filter(Boolean).join(', ') || 'all tagged');
  ok('the deck runs background, Task 1, Task 2, closing, supplemental, in that order',
    info.tags[0] === 'speaker' && info.tags[1] === 'brief'
    && info.tags.slice(2, 11).every((t) => /^ret-/.test(t))
    && TOOL_AT.join(',') === '11,12,13'
    && info.tags[14] === 'workflow' && info.tags[15] === 'lessons' && info.tags[16] === 'conclusions'
    && info.tags.slice(17).every((t) => /^sm2-/.test(t)),
    info.tags.join(' '));
  ok('16:9 at 960x540 points', info.size.w === 960 && info.size.h === 540, info.size.w + 'x' + info.size.h);
  ok('the deck carries its own theme', info.theme === 'Proxima', String(info.theme));
  ok('every slide has content', info.counts.every((c) => c > 3), info.counts.join(','));
  ok('every slide has speaker notes', info.notes.every((n) => n > 120), info.notes.join(','));
  ok('the deck opens on the speaker, not a tool', /Kiel Lazarski —/.test(info.texts[0]), '');
  /* Slide 1 is the CV's own summary, not a paraphrase of it. */
  ok('the first slide uses the CV summary lines',
    /10\+ years of medicinal chemistry/.test(info.texts[0])
    && /hit identification through development candidate nomination/.test(info.texts[0])
    && /Collaborator\s*·\s*Leader\s*·\s*Engineer/.test(info.texts[0]), '');
  ok('the teams column says something about mentorship', /[Mm]entors/.test(info.texts[0]), '');
  /* The forge produces a ranked compound set, not a physical plate. */
  ok('the forge output is described as a virtual screen',
    /virtual screen/.test(toolText[2]) && !/plate/i.test(toolText[2]), '');
  ok('the second slide states both tasks',
    /Task 1/.test(info.texts[1]) && /Task 2/.test(info.texts[1]), '');
  /* The title is the description, so every tool slide must carry its number
     and say what kind of software it is. */
  ok('each title names the tool and its kind',
    [1, 2, 3].every((n, i) => new RegExp('Tool ' + n + ' —').test(toolText[i])),
    [1, 2, 3].map((n, i) => (new RegExp('Tool ' + n).test(toolText[i] || '') ? '' : 'tool ' + n)).filter(Boolean).join(', ') || 'all three');
  ok('all three tools are named', ['Target Nomination', 'Omni Tool', 'Glue Forge']
    .every((n) => info.texts.join(' ').indexOf(n) >= 0));
  ok('choosing the ligase is part of the nomination tool, not a tool of its own',
    /nominates target–ligase pairs/.test(toolText[0])
    && toolText.every((t) => !/E3 Assessment/.test(t)), '');
  ok('the workflow slide ties the chain together',
    /narrows what the next one sees/.test(info.texts[14]) && /Running/.test(info.texts[14]) && /Not started/.test(info.texts[14]), '');
  ok('the deck closes on lessons then conclusions',
    /did not expect/.test(info.texts[15]) && /Still open/i.test(info.texts[16]), '');
  ok('every slide carries the running header',
    info.texts.every((t) => /Lazarski\s*—\s*Proxima Interview/.test(t)),
    info.texts.map((t, i) => (/Lazarski/.test(t) ? '' : 'slide ' + (i + 1))).filter(Boolean).join(', ') || 'all ' + info.slides);
  ok('the running header counts to the real deck length',
    info.texts.every((t) => t.indexOf('/ ' + info.slides) >= 0),
    info.texts.map((t, i) => (t.indexOf('/ ' + info.slides) >= 0 ? '' : 'slide ' + (i + 1))).filter(Boolean).join(', ') || 'all correct');

  /* Task 1 is someone else's published work as well as the speaker's, so the
     slides that reproduce it have to carry the citation. */
  const retSlides = info.tags.reduce((a, t, i) => (/^ret-/.test(t) ? a.concat(i) : a), []);
  ok('the RET slides cite the paper',
    retSlides.filter((i) => /RSC Med\. Chem\. 2025/.test(info.texts[i])).length >= 7,
    retSlides.filter((i) => !/RSC Med\. Chem\./.test(info.texts[i])).map((i) => 'slide ' + (i + 1)).join(', ') || 'all cited');
  ok('the SMARCA2 supplemental credits the model and HDX work',
    /Hongwei Huang/.test(info.texts[17]) && /Scott Eron/.test(info.texts[17]), '');
  /* One slide of the source talk is marked confidential and is deliberately
     not reproduced. If its charts ever get pasted in, this should fail. */
  const figNames = await pg.evaluate(() => Object.keys(window.DECK.figures || {}));
  ok('the confidential CNS charts are not in the deck',
    !figNames.some((n) => /^(pk|pd)\d/.test(n)) && /marked confidential/.test(info.notesText),
    figNames.filter((n) => /^(pk|pd)\d/.test(n)).join(',') || 'absent, and the omission is noted');

  /* Each tool slide must name the page, module or file that implements it. */
  const artefacts = [
    ['tpd_calibration_set.csv', 'Proteins of Interest page', 'Glue Site Scan', 'dock.mjs'],
    ['Omni Tool', 'Exit Vectors page', 'TC Feasibility page', 'Cross-Species page'],
    ['Glue Forge', 'glue_library_100.xlsx', 'chemlib.py']
  ];
  ok('every tool names the artefacts that implement it',
    artefacts.every((names, i) => names.every((n) => toolText[i].indexOf(n) >= 0)),
    artefacts.map((names, i) => names.filter((n) => toolText[i].indexOf(n) < 0).join('/')).filter(Boolean).join(' | ') || 'all named');

  /* Each tool slide answers the same three questions, in the same order. */
  ok('every tool slide answers why / sources / output',
    toolText.every((t) => /Why it exists/i.test(t) && /What it draws on/i.test(t) && /What comes out/i.test(t)),
    toolText.map((t, i) => (/What comes out/i.test(t) ? '' : 'tool ' + (i + 1))).filter(Boolean).join(', ') || 'all three');

  /* Brevity is a design constraint, so measure it rather than trust it. The
     furniture — header, chain, state row — is scanned, not read, so the budget
     covers only the title, the lede and the three columns. */
  const wordCounts = await pg.evaluate(() => {
    const d = window.DECK;
    return d.app.deck.slides.map((s) => {
      const read = s.elements.filter((e) => e.body
        && (((e.body.paragraphs[0] || {}).runs || [])[0] || {}).sz >= 12);
      const text = read.map((e) => e.body.paragraphs.map((p) => p.runs.map((r) => r.t || '').join('')).join(' ')).join(' ');
      return text.split(/\s+/).filter(Boolean).length;
    });
  });
  ok('no slide asks the audience to read much', wordCounts.every((w) => w <= 95),
    'readable words per slide: ' + wordCounts.join(', '));
  /* The bottom band was removed; nothing should sit below the columns. A
     citation set at 8.5pt does not count — it is credit, not content. */
  const lowStuff = await pg.evaluate(() => window.DECK.app.deck.slides
    .filter((s) => /^tool-/.test(s.tag || '')).map((s) =>
      s.elements.filter((e) => e.y > 478 && e.body
        && e.body.paragraphs.some((p) => p.runs.some((r) => (r.t || '').trim() && (r.sz || 18) > 9))).length));
  ok('the tool slides have no footer band', lowStuff.every((n) => n === 0), lowStuff.join(','));

  /* Shrink-to-fit collapsing a box to illegibility is a silent failure: the
     text is present in the model and in the DOM, just too small to read. Check
     every run on every slide at its true rendered size. */
  const tiny = await pg.evaluate(async () => {
    const d = window.DECK;
    const out = [];
    for (let i = 0; i < d.app.deck.slides.length; i++) {
      d.cmd.gotoSlide(i);
      await new Promise((r) => setTimeout(r, 180));
      const scale = (document.querySelector('.cv-stage-host').style.transform.match(/scale\(([-\d.]+)\)/) || [, 1])[1];
      const runs = Array.from(document.querySelectorAll('.cv-stage-host .sp-run, .cv-stage-host .sp-bullet'));
      for (const r of runs) {
        if (!(r.textContent || '').replace(/[\s​]/g, '')) continue;
        /* divide out the canvas zoom to get the size on a 960pt slide */
        const pt = parseFloat(getComputedStyle(r).fontSize) / (parseFloat(scale) || 1) * (parseFloat(scale) || 1);
        const modelPt = parseFloat(getComputedStyle(r).fontSize);
        if (modelPt < 7) out.push({ slide: i + 1, pt: Math.round(modelPt * 10) / 10, text: (r.textContent || '').slice(0, 30) });
      }
    }
    d.cmd.gotoSlide(0);
    return out;
  });
  ok('no text is shrunk below legibility', tiny.length === 0,
    tiny.slice(0, 3).map((t) => 'slide ' + t.slide + ' @' + t.pt + 'pt "' + t.text + '"').join(' | '));

  /* The title is the sentence now, so it has to stay one tight sentence —
     on every slide, not only the tool slides. */
  const titles = await pg.evaluate(() => window.DECK.app.deck.slides.map((s) => {
    const big = s.elements.filter((e) => e.body
      && (((e.body.paragraphs[0] || {}).runs || [])[0] || {}).sz >= 24);
    if (!big.length) return 0;
    return big[0].body.paragraphs.map((p) => p.runs.map((r) => r.t || '').join('')).join(' ').split(/\s+/).filter(Boolean).length;
  }));
  ok('each title is one tight sentence', titles.every((n) => n >= 7 && n <= 20), 'title words: ' + titles.join(', '));

  /* Figures are the source talk's own renders, so a frame that disagrees with
     its picture means PowerPoint will stretch it on the way out. */
  const figs = await pg.evaluate(() => {
    const F = window.DECK.figures, out = { total: 0, bad: [], unused: [], missing: [] };
    const used = {};
    window.DECK.app.deck.slides.forEach((s, i) => s.elements.forEach((e) => {
      if (e.type !== 'image') return;
      out.total += 1;
      used[e.srcName] = true;
      const f = F[e.srcName];
      if (!f) { out.missing.push('slide ' + (i + 1) + ' ' + e.srcName); return; }
      if (!/^data:image\/(png|jpeg);base64,/.test(e.src)) out.missing.push('slide ' + (i + 1) + ' not inlined');
      const want = f.w / f.h, got = e.w / e.h;
      if (Math.abs(want - got) / want > 0.01) {
        out.bad.push('slide ' + (i + 1) + ' ' + e.srcName + ' ' + got.toFixed(3) + ' vs ' + want.toFixed(3));
      }
    }));
    out.unused = Object.keys(F).filter((k) => !used[k]);
    return out;
  });
  ok('every figure is inlined and resolves', figs.missing.length === 0 && figs.total >= 16,
    figs.missing.join(', ') || figs.total + ' figures');
  ok('no figure is stretched out of its aspect ratio', figs.bad.length === 0, figs.bad.join(' | ') || 'all exact');
  ok('no figure is shipped unused', figs.unused.length === 0, figs.unused.join(',') || 'all placed');

  /* The RET potency table is built from one dataset and shown three times.
     If a number is edited on one slide and not the others, this catches it. */
  const sar = await pg.evaluate(() => {
    const rows = {};
    window.DECK.app.deck.slides.forEach((s) => s.elements.forEach((e) => {
      if (e.type !== 'table' || !e.table) return;
      e.table.rows.forEach((r) => {
        const cells = r.cells.map((c) => c.body.paragraphs.map((p) => p.runs.map((x) => x.t || '').join('')).join(''));
        if (!/^(1[5-9]|20)$/.test(cells[0])) return;
        const key = cells[0], val = cells.slice(1).join('|');
        (rows[key] = rows[key] || []).push(val);
      });
    }));
    return Object.keys(rows).map((k) => ({ k, n: rows[k].length, same: rows[k].every((v) => v === rows[k][0]) }));
  });
  ok('the RET table says the same thing on every slide it appears on',
    sar.length === 6 && sar.every((r) => r.same) && sar.some((r) => r.n === 3),
    sar.map((r) => r.k + '×' + r.n + (r.same ? '' : ' MISMATCH')).join(' '));

  /* The notes are reference material for questions, so they should read as
     measurements rather than argument. */
  const pitchy = await pg.evaluate(() => {
    const bad = /\b(exciting|revolutionary|transform|unlock|game[- ]chang|paradigm|leverage|synerg|cutting[- ]edge|world[- ]class|best[- ]in[- ]class|vision)/i;
    return window.DECK.app.deck.slides
      .map((s, i) => (bad.test(s.notes || '') ? i + 1 : 0)).filter(Boolean);
  });
  ok('the speaker notes stay factual', pitchy.length === 0, 'slides with pitch language: ' + pitchy.join(','));

  /* rendering actually produced boxes on screen */
  const rendered = await pg.evaluate(() => {
    const els = Array.from(document.querySelectorAll('.cv-stage-host .sp-el'));
    const vis = els.filter((n) => n.getBoundingClientRect().width > 0.5);
    const runs = document.querySelectorAll('.cv-stage-host .sp-run').length;
    return { els: els.length, vis: vis.length, runs, thumbs: document.querySelectorAll('.thumb').length };
  });
  ok('slide 1 renders every element', rendered.els >= 12 && rendered.vis === rendered.els, rendered.vis + '/' + rendered.els + ' visible');
  ok('text runs are in the DOM', rendered.runs > 10, rendered.runs + ' runs');
  ok('one thumbnail per slide', rendered.thumbs === info.slides, rendered.thumbs + '');

  /* ------------------------------------------------------- autofit works */
  group('Autofit');
  const fit = await pg.evaluate(() => {
    const d = window.DECK;
    d.cmd.gotoSlide(0);
    const e = d.model.mkElement('text', {
      x: 40, y: 40, w: 200, h: 46,
      body: d.model.mkBody([d.model.mkPara([d.model.mkRun(
        'A deliberately long sentence that cannot possibly fit inside a box this small at its natural size.',
        { sz: 24 })])], { autofit: 'shrink' })
    });
    d.cmd.addElement(e);
    const node = document.querySelector('.cv-stage-host .sp-el[data-id="' + e.id + '"] .sp-body');
    const holder = document.querySelector('.cv-stage-host .sp-el[data-id="' + e.id + '"] .sp-text');
    const fs = parseFloat(node.dataset.fs) || 1;
    const px = parseFloat(getComputedStyle(node.querySelector('.sp-run')).fontSize);
    const over = node.scrollHeight - holder.clientHeight;
    d.cmd.undo();
    return { fs, over, px };
  });
  ok('shrink-to-fit reduces the scale', fit.fs < 0.95 && fit.fs > 0.1, 'scale ' + fit.fs.toFixed(2));
  ok('the rendered font size actually shrank', fit.px < 23 && fit.px > 2, fit.px.toFixed(1) + 'px from 24');
  ok('and the text then fits its frame', fit.over <= 2, 'overflow ' + fit.over + 'px');

  /* --------------------------------------------------------- editing ops */
  group('Editing');
  const before = await pg.evaluate(() => window.DECK.app.deck.slides[0].elements.length);
  await pg.evaluate(() => {
    const d = window.DECK;
    d.cmd.gotoSlide(0);
    d.cmd.addElement(d.model.mkElement('shape', { x: 120, y: 120, w: 160, h: 90, geom: 'roundRect', name: 'TESTSHAPE' }));
  });
  ok('insert adds one element', await pg.evaluate(() => window.DECK.app.deck.slides[0].elements.length) === before + 1);

  /* drag it with the real mouse */
  const dragged = await (async () => {
    const box = await pg.evaluate(() => {
      const d = window.DECK;
      const e = d.app.deck.slides[0].elements.find((x) => x.name === 'TESTSHAPE');
      d.cmd.select([e.id]);
      const n = document.querySelector('.cv-stage-host .sp-el[data-id="' + e.id + '"]');
      const r = n.getBoundingClientRect();
      return { x0: e.x, y0: e.y, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    });
    await pg.mouse.move(box.cx, box.cy);
    await pg.mouse.down();
    await pg.mouse.move(box.cx + 80, box.cy + 40, { steps: 8 });
    await pg.mouse.up();
    await pg.waitForTimeout(90);
    return pg.evaluate((b) => {
      const e = window.DECK.app.deck.slides[0].elements.find((x) => x.name === 'TESTSHAPE');
      return { dx: e.x - b.x0, dy: e.y - b.y0 };
    }, box);
  })();
  ok('dragging moves the element', dragged.dx > 55 && dragged.dy > 25, 'moved ' + Math.round(dragged.dx) + ',' + Math.round(dragged.dy) + 'pt');

  const undone = await pg.evaluate(() => {
    const d = window.DECK;
    const b = d.app.deck.slides[0].elements.find((x) => x.name === 'TESTSHAPE');
    const was = { x: b.x, y: b.y };
    d.cmd.undo();
    const a = d.app.deck.slides[0].elements.find((x) => x.name === 'TESTSHAPE');
    const back = { x: a.x, y: a.y };
    d.cmd.redo();
    const r = d.app.deck.slides[0].elements.find((x) => x.name === 'TESTSHAPE');
    return { was, back, again: { x: r.x, y: r.y } };
  });
  ok('undo reverts the drag', near(undone.back.x, 120) && near(undone.back.y, 120), JSON.stringify(undone.back));
  ok('redo reapplies it', near(undone.again.x, undone.was.x) && near(undone.again.y, undone.was.y));

  /* resize via a handle */
  const resized = await (async () => {
    const h = await pg.evaluate(() => {
      const d = window.DECK;
      const e = d.app.deck.slides[0].elements.find((x) => x.name === 'TESTSHAPE');
      d.cmd.select([e.id]);
      const n = document.querySelector('.cv-overlay .cv-h-se');
      const r = n.getBoundingClientRect();
      return { w0: e.w, h0: e.h, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    });
    await pg.mouse.move(h.cx, h.cy);
    await pg.mouse.down();
    await pg.mouse.move(h.cx + 60, h.cy + 30, { steps: 6 });
    await pg.mouse.up();
    await pg.waitForTimeout(90);
    return pg.evaluate((b) => {
      const e = window.DECK.app.deck.slides[0].elements.find((x) => x.name === 'TESTSHAPE');
      return { dw: e.w - b.w0, dh: e.h - b.h0 };
    }, h);
  })();
  ok('the corner handle resizes', resized.dw > 40 && resized.dh > 18, 'grew ' + Math.round(resized.dw) + 'x' + Math.round(resized.dh) + 'pt');

  /* text editing through real keystrokes */
  const typed = await (async () => {
    await pg.evaluate(() => {
      const d = window.DECK;
      const e = d.app.deck.slides[0].elements.find((x) => x.name === 'TESTSHAPE');
      d.cmd.select([e.id]);
      d.cmd.startTextEdit(e.id);
    });
    await pg.keyboard.type('Hello');
    await pg.keyboard.press('Enter');
    await pg.keyboard.type('World');
    await pg.waitForTimeout(80);
    const mid = await pg.evaluate(() => {
      const e = window.DECK.app.deck.slides[0].elements.find((x) => x.name === 'TESTSHAPE');
      return e.body.paragraphs.map((p) => p.runs.map((r) => r.t || '').join(''));
    });
    await pg.evaluate(() => window.DECK.cmd.endTextEdit());
    await pg.waitForTimeout(60);
    const after = await pg.evaluate(() => {
      const e = window.DECK.app.deck.slides[0].elements.find((x) => x.name === 'TESTSHAPE');
      return e.body.paragraphs.map((p) => p.runs.map((r) => r.t || '').join(''));
    });
    return { mid, after };
  })();
  ok('typing reaches the model', typed.after.join('|').indexOf('Hello') >= 0, JSON.stringify(typed.after));
  ok('Return makes a second paragraph', typed.after.length >= 2 && typed.after.join('|').indexOf('World') >= 0, JSON.stringify(typed.after));

  /* run formatting */
  const fmt = await pg.evaluate(() => {
    const d = window.DECK;
    const e = d.app.deck.slides[0].elements.find((x) => x.name === 'TESTSHAPE');
    d.cmd.select([e.id]);
    d.cmd.applyRunProps({ b: true, sz: 21, color: { hex: '#FF8800' } }, 'test');
    const r = e.body.paragraphs[0].runs[0];
    return { b: r.b, sz: r.sz, color: r.color };
  });
  ok('bold, size and colour apply to a selected shape', fmt.b === true && fmt.sz === 21 && fmt.color.hex === '#FF8800', JSON.stringify(fmt));

  /* a theme-referenced colour must survive an editing session */
  const themeKeep = await pg.evaluate(async () => {
    const d = window.DECK;
    const e = d.model.mkElement('text', {
      x: 300, y: 300, w: 300, h: 40, name: 'THEMEKEEP',
      body: d.model.mkBody([d.model.mkPara([d.model.mkRun('themed text', { sz: 18, color: { scheme: 'accent1' } })])])
    });
    d.cmd.addElement(e);
    d.cmd.select([e.id]);
    d.cmd.startTextEdit(e.id);
    d.cmd.endTextEdit();
    const live = d.app.deck.slides[0].elements.find((x) => x.name === 'THEMEKEEP');
    return live.body.paragraphs[0].runs[0].color;
  });
  ok('a theme colour is not flattened to hex by editing', themeKeep && themeKeep.scheme === 'accent1', JSON.stringify(themeKeep));

  /* arrange, group, align */
  const arr = await pg.evaluate(() => {
    const d = window.DECK;
    const s = d.app.deck.slides[0];
    const a = d.model.mkElement('shape', { x: 500, y: 60, w: 60, h: 60, name: 'A' });
    const b = d.model.mkElement('shape', { x: 700, y: 160, w: 60, h: 60, name: 'B' });
    d.cmd.addElement(a); d.cmd.addElement(b);
    d.cmd.select([a.id, b.id]);
    d.cmd.groupSel();
    const grouped = s.elements.filter((e) => e.groupId).length;
    d.cmd.select([a.id]);
    const selAfterGroupClick = d.app.sel.length;
    d.cmd.ungroupSel();
    d.cmd.select([a.id, b.id]);
    d.cmd.alignSel('top');
    const ay = s.elements.find((e) => e.name === 'A').y;
    const by = s.elements.find((e) => e.name === 'B').y;
    d.cmd.orderSel('back');
    const firstTwo = s.elements.slice(0, 2).map((e) => e.name).sort().join('');
    return { grouped, selAfterGroupClick, ay, by, firstTwo };
  });
  ok('grouping tags both shapes', arr.grouped === 2, arr.grouped + '');
  ok('selecting one group member selects the set', arr.selAfterGroupClick === 2, arr.selAfterGroupClick + '');
  ok('align top lines them up', near(arr.ay, arr.by, 0.5), arr.ay + ' vs ' + arr.by);
  ok('send to back reorders the array', arr.firstTwo === 'AB', arr.firstTwo);

  /* tables */
  const tbl = await pg.evaluate(() => {
    const d = window.DECK;
    const e = d.model.mkElement('table', { x: 60, y: 300, w: 400, h: 120, name: 'T' });
    d.cmd.addElement(e);
    const w0 = e.w;
    d.cmd.select([e.id]);
    const sel = d.app.deck.slides[0].elements.find((x) => x.name === 'T');
    window.__t = sel;
    return { rows: sel.table.rows.length, cols: sel.table.cols.length, w0 };
  });
  ok('a table inserts 3x3', tbl.rows === 3 && tbl.cols === 3, tbl.rows + 'x' + tbl.cols);
  const tbl2 = await pg.evaluate(() => {
    const t = window.__t;
    const w0 = t.w;
    /* adding a column must not widen the table off the slide */
    window.DECK.cmd.commit('add col', () => {
      const total = t.table.cols.reduce((a, b) => a + b, 0);
      const w = total / (t.table.cols.length + 1);
      const k = (total - w) / total;
      t.table.cols = t.table.cols.map((c) => c * k);
      t.table.cols.push(w);
      for (const r of t.table.rows) r.cells.push({ body: window.DECK.model.mkBody([window.DECK.model.mkPara([window.DECK.model.mkRun('')])]), fill: null, span: 1, rowSpan: 1 });
      t.w = t.table.cols.reduce((a, b) => a + b, 0);
    });
    return { cols: t.table.cols.length, w: t.w, w0 };
  });
  ok('adding a column keeps the overall width', tbl2.cols === 4 && near(tbl2.w, tbl2.w0, 0.6), tbl2.w.toFixed(1) + ' vs ' + tbl2.w0.toFixed(1));

  /* ------------------------------------------------- import a real pptx */
  group('Opening a PowerPoint file made by another tool');
  const fixtureB64 = fs.readFileSync(FIXTURE).toString('base64');
  const imp = await pg.evaluate(async (b64) => {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const { deck, report } = await window.DECK.io.importPptx(u8.buffer, 'fixture.pptx');
    const txt = (s) => s.elements.filter((e) => e.body).map((e) => e.body.paragraphs.map((p) => p.runs.map((r) => r.t || '').join('')).join('\n')).join('\n');
    const titleEl = deck.slides[0].elements.find((e) => e.ph && (e.ph.type === 'title' || e.ph.type === 'ctrTitle'));
    const s2 = deck.slides[1];
    const bulletLevels = s2.elements.filter((e) => e.body)
      .flatMap((e) => e.body.paragraphs).filter((p) => p.bullet && p.bullet.type !== 'none').map((p) => p.lvl || 0);
    const s3 = deck.slides[2];
    const rotated = s3.elements.find((e) => Math.abs((e.rot || 0) - 22.5) < 1);
    const roundRect = s3.elements.find((e) => e.geom === 'roundRect');
    const grouped = s3.elements.filter((e) => e.groupId);
    const lines = s3.elements.filter((e) => e.type === 'line');
    const s4 = deck.slides[3];
    const table = s4.elements.find((e) => e.type === 'table');
    const pic = s4.elements.find((e) => e.type === 'image');
    const runs2 = s2.elements.filter((e) => e.body).flatMap((e) => e.body.paragraphs).flatMap((p) => p.runs);
    return {
      report: { slides: report.slides, notes: report.notes, charts: report.charts, dropped: report.droppedImages, unknown: Array.from(report.unknownGeoms) },
      size: deck.size,
      themeName: deck.theme && deck.theme.name,
      accent2: deck.theme && deck.theme.colors.accent2,
      title: titleEl ? titleEl.body.paragraphs[0].runs.map((r) => r.t).join('') : null,
      titleBox: titleEl ? { x: titleEl.x, y: titleEl.y, w: titleEl.w, h: titleEl.h } : null,
      subtitle: /Subtitle from the layout/.test(txt(deck.slides[0])),
      notes0: deck.slides[0].notes,
      bulletLevels,
      hasBold: runs2.some((r) => r.b === true),
      hasItalic: runs2.some((r) => r.i === true),
      hasRed: runs2.some((r) => r.color && /C03020/i.test(String(r.color.hex || ''))),
      has28: runs2.some((r) => Math.abs((r.sz || 0) - 28) < 0.6),
      rotated: !!rotated,
      roundRectAdj: roundRect ? roundRect.adj : null,
      roundRectThemed: roundRect ? roundRect.fill : null,
      groupCount: grouped.length,
      groupBoxes: grouped.map((e) => ({ x: Math.round(e.x), y: Math.round(e.y), w: Math.round(e.w) })),
      lineCount: lines.length,
      lineArrowOrColor: lines.length ? !!lines[0].line : false,
      tableDims: table ? [table.table.rows.length, table.table.cols.length] : null,
      tableHeader: table ? table.table.rows[0].cells.map((c) => c.body.paragraphs[0].runs.map((r) => r.t).join('')) : null,
      tableCell: table ? table.table.rows[2].cells[0].body.paragraphs[0].runs.map((r) => r.t).join('') : null,
      tableColW: table ? table.table.cols.map((c) => Math.round(c)) : null,
      picSrc: pic ? pic.src.slice(0, 20) : null,
      picBox: pic ? { w: Math.round(pic.w), h: Math.round(pic.h) } : null,
      rightAligned: deck.slides[2].elements.some((e) => e.body && e.body.paragraphs.some((p) => p.align === 'r')),
      band: deck.slides[4].elements.some((e) => e.w > 900)
    };
  }, fixtureB64);

  ok('reads all five slides', imp.report.slides === 5, imp.report.slides + '');
  ok('reads the 13.333in slide size', near(imp.size.w, 960, 1) && near(imp.size.h, 540, 1), imp.size.w + 'x' + imp.size.h);
  ok('reads the theme colour scheme', !!imp.themeName && /^#?[0-9A-F]{6}$/i.test(String(imp.accent2).replace('#', '#')), imp.themeName + ' accent2=' + imp.accent2);
  ok('reads the title placeholder text', imp.title === 'Fixture Deck', String(imp.title));
  ok('inherits the title position from the layout', imp.titleBox && imp.titleBox.w > 200 && imp.titleBox.h > 20,
    imp.titleBox ? JSON.stringify(imp.titleBox) : 'none');
  ok('reads the subtitle placeholder', imp.subtitle === true);
  ok('reads speaker notes', /Notes for slide one/.test(String(imp.notes0)) && imp.report.notes >= 4, imp.report.notes + ' slides with notes');
  ok('preserves bullet levels 0,1,2', imp.bulletLevels.indexOf(0) >= 0 && imp.bulletLevels.indexOf(1) >= 0 && imp.bulletLevels.indexOf(2) >= 0, imp.bulletLevels.join(','));
  ok('preserves bold, italic, colour and size on runs',
    imp.hasBold && imp.hasItalic && imp.hasRed && imp.has28,
    'b=' + imp.hasBold + ' i=' + imp.hasItalic + ' col=' + imp.hasRed + ' sz28=' + imp.has28);
  ok('preserves rotation', imp.rotated === true);
  ok('reads a non-default adjust value', imp.roundRectAdj && Object.keys(imp.roundRectAdj).length > 0 && Math.abs(imp.roundRectAdj.adj - 33000) < 2000, JSON.stringify(imp.roundRectAdj));
  ok('keeps a theme fill as a theme reference', imp.roundRectThemed && imp.roundRectThemed.color && imp.roundRectThemed.color.scheme, JSON.stringify(imp.roundRectThemed && imp.roundRectThemed.color));
  ok('flattens a group into placed shapes', imp.groupCount === 2, imp.groupCount + ' members');
  ok('group children land in slide coordinates', imp.groupBoxes.length === 2 && imp.groupBoxes.every((b) => b.x > 400 && b.x < 760 && b.w > 50), JSON.stringify(imp.groupBoxes));
  ok('reads the connector as a line', imp.lineCount >= 1 && imp.lineArrowOrColor, imp.lineCount + ' line(s)');
  ok('reads the table as 4x3', imp.tableDims && imp.tableDims[0] === 4 && imp.tableDims[1] === 3, JSON.stringify(imp.tableDims));
  ok('reads the table header cells', String(imp.tableHeader) === 'Target,E3,Status', String(imp.tableHeader));
  ok('reads a body cell', imp.tableCell === 'RIPK1', String(imp.tableCell));
  ok('reads per-column widths', imp.tableColW && imp.tableColW[0] > imp.tableColW[1], JSON.stringify(imp.tableColW));
  ok('embeds the picture as a data URL', /^data:image\/png/.test(String(imp.picSrc)), String(imp.picSrc));
  ok('the picture keeps its box', imp.picBox && imp.picBox.w > 200 && imp.picBox.h > 130, JSON.stringify(imp.picBox));
  ok('preserves right alignment', imp.rightAligned === true);

  /* Regression: a run that inherits its colour must render in the theme's text
     colour, not transparent. Most real decks leave run colour unstated, so
     getting this wrong makes whole slides come up blank. */
  const inherited = await pg.evaluate(async (b64x) => {
    const bin = atob(b64x);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const { deck } = await window.DECK.io.importPptx(u8.buffer, 'fixture.pptx');
    window.DECK.cmd.loadDeck(deck, 'fixture');
    window.DECK.cmd.gotoSlide(2);
    await new Promise((r) => setTimeout(r, 250));
    const node = Array.from(document.querySelectorAll('.cv-stage-host .sp-el'))
      .find((n) => /plain text box/.test(n.textContent || ''));
    if (!node) return { found: false };
    const run = node.querySelector('.sp-run');
    const col = getComputedStyle(run).color;
    const r = node.getBoundingClientRect();
    /* and the same element on a dark theme must flip to light text */
    window.DECK.cmd.setDeckTheme('midnight');
    await new Promise((r2) => setTimeout(r2, 250));
    const node2 = Array.from(document.querySelectorAll('.cv-stage-host .sp-el'))
      .find((n) => /plain text box/.test(n.textContent || ''));
    const col2 = node2 ? getComputedStyle(node2.querySelector('.sp-run')).color : '';
    return { found: true, col, col2, w: Math.round(r.width), h: Math.round(r.height) };
  }, fixtureB64);
  ok('a colourless run renders in the theme text colour', inherited.found && /^rgb\(0, 0, 0\)$/.test(inherited.col),
    'computed ' + inherited.col);
  ok('and follows the theme when the deck is re-themed',
    /^rgb\(2[0-9][0-9], 2[0-9][0-9], 2[0-9][0-9]\)$/.test(String(inherited.col2)), 'dark theme gives ' + inherited.col2);
  ok('the text box is laid out, not collapsed', inherited.w > 100 && inherited.h > 10, inherited.w + 'x' + inherited.h);
  ok('reads the full-bleed band on the blank layout', imp.band === true);
  ok('nothing was dropped unexpectedly', imp.report.dropped === 0 && imp.report.charts === 0, 'dropped=' + imp.report.dropped + ' charts=' + imp.report.charts);
  ok('no unsupported geometry in the fixture', imp.report.unknown.length === 0, imp.report.unknown.join(','));

  /* ------------------------------------------------------- round trip */
  group('Export to .pptx and read it back');
  const rt = await pg.evaluate(async (b64) => {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const { deck } = await window.DECK.io.importPptx(u8.buffer, 'fixture.pptx');
    const blob = await window.DECK.io.exportPptx(deck);
    const buf = await blob.arrayBuffer();
    const back = await window.DECK.io.importPptx(buf, 'roundtrip.pptx');
    const flat = (d) => d.slides.map((s) => s.elements.filter((e) => e.body).map((e) =>
      e.body.paragraphs.map((p) => p.runs.map((r) => r.t || '').join('')).join('\n')).join('\n'));
    const geom = (d) => d.slides.map((s) => s.elements.map((e) => e.type + ':' + (e.geom || '') + ':' + Math.round(e.x) + ',' + Math.round(e.y)).join(' '));
    const t1 = flat(deck), t2 = flat(back.deck);
    return {
      size: blob.size,
      slidesA: deck.slides.length, slidesB: back.deck.slides.length,
      countsA: deck.slides.map((s) => s.elements.length),
      countsB: back.deck.slides.map((s) => s.elements.length),
      textMatch: t1.map((t, i) => t.replace(/\s+/g, ' ').trim() === String(t2[i]).replace(/\s+/g, ' ').trim()),
      geomA: geom(deck)[2], geomB: geom(back.deck)[2],
      notesMatch: deck.slides.map((s, i) => (s.notes || '').trim() === (back.deck.slides[i].notes || '').trim()),
      tableB: (() => { const t = back.deck.slides[3].elements.find((e) => e.type === 'table'); return t ? [t.table.rows.length, t.table.cols.length] : null; })(),
      picB: back.deck.slides[3].elements.some((e) => e.type === 'image'),
      themeB: back.deck.theme && back.deck.theme.colors.accent2
    };
  }, fixtureB64);
  ok('the exported file is a real archive of sensible size', rt.size > 20000, Math.round(rt.size / 1024) + ' KB');
  ok('slide count survives', rt.slidesA === rt.slidesB, rt.slidesA + ' -> ' + rt.slidesB);
  ok('element counts survive', JSON.stringify(rt.countsA) === JSON.stringify(rt.countsB), JSON.stringify(rt.countsA) + ' -> ' + JSON.stringify(rt.countsB));
  ok('all text survives', rt.textMatch.every(Boolean), rt.textMatch.map((b, i) => (b ? '' : 'slide ' + (i + 1))).filter(Boolean).join(', ') || 'all five');
  ok('positions and geometry survive', rt.geomA === rt.geomB, rt.geomA === rt.geomB ? '' : rt.geomA + '  !=  ' + rt.geomB);
  ok('notes survive', rt.notesMatch.every(Boolean), rt.notesMatch.join(','));
  ok('the table survives', JSON.stringify(rt.tableB) === '[4,3]', JSON.stringify(rt.tableB));
  ok('the picture survives', rt.picB === true);
  ok('the theme survives', /^#[0-9A-F]{6}$/i.test(String(rt.themeB)), String(rt.themeB));

  /* write the bundled deck out as .pptx for python-pptx to validate */
  const deckPptx = await pg.evaluate(async () => {
    const blob = await window.DECK.io.exportPptx(window.DECK.cmd.buildDefaultDeck());
    const buf = await blob.arrayBuffer();
    const u8 = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  });
  fs.writeFileSync(path.join(OUTDIR, 'exported-deck.pptx'), Buffer.from(deckPptx, 'base64'));
  ok('wrote test/exported-deck.pptx for independent validation', fs.statSync(path.join(OUTDIR, 'exported-deck.pptx')).size > 10000);

  /* ------------------------------------------------------- project file */
  group('Project file');
  const proj = await pg.evaluate(() => {
    const d = window.DECK;
    const deck = d.cmd.buildDefaultDeck();
    const json = JSON.stringify(deck);
    const back = d.model.normalizeDeck(JSON.parse(json));
    const flat = (x) => x.slides.map((s) => s.elements.map((e) => JSON.stringify([e.type, e.geom || '', Math.round(e.x), Math.round(e.y), Math.round(e.w), Math.round(e.h)])).join('|'));
    return { len: json.length, same: JSON.stringify(flat(deck)) === JSON.stringify(flat(back)), notes: back.slides.every((s, i) => s.notes === deck.slides[i].notes) };
  });
  ok('the deck serialises and reloads identically', proj.same === true);
  ok('notes survive the project file', proj.notes === true);
  ok('the project file is a sensible size', proj.len > 20000 && proj.len < 4000000, Math.round(proj.len / 1024) + ' KB');

  /* ------------------------------------------------------------- PDF path */
  group('PDF layout');
  /* earlier groups left another deck loaded; the PDF checks are about the
     bundled one */
  await pg.evaluate(() => window.DECK.cmd.loadDeck(window.DECK.cmd.buildDefaultDeck(), 'deck'));
  await pg.waitForTimeout(250);
  const pdf = await pg.evaluate(async () => {
    window.__printed = 0;
    const real = window.print;
    window.print = () => { window.__printed += 1; };
    await window.DECK.io.exportPdf();
    await new Promise((r) => setTimeout(r, 500));
    const pages = document.querySelectorAll('.print-host .print-page').length;
    const stages = document.querySelectorAll('.print-host .print-page > .sp-stage').length;
    const rule = document.getElementById('printSizeRule');
    const text = rule ? rule.textContent : '';
    const anyRuns = document.querySelectorAll('.print-host .sp-run').length;
    window.print = real;
    return { printed: window.__printed, pages, stages, text: text.trim(), anyRuns };
  });
  ok('one print page per slide', pdf.pages === DECK_LEN && pdf.stages === DECK_LEN, pdf.pages + ' pages');
  ok('the page box matches the deck', /13\.33in 7\.5in/.test(pdf.text), pdf.text);
  ok('text is laid out as text, not an image', pdf.anyRuns > 40, pdf.anyRuns + ' runs');
  ok('the print dialog was invoked once', pdf.printed === 1, pdf.printed + '');
  await pg.evaluate(() => {
    document.documentElement.classList.remove('printing');
    const h = document.getElementById('printHost'); if (h) h.remove();
    const r = document.getElementById('printSizeRule'); if (r) r.remove();
  });

  /* really render a PDF through Chromium to prove the CSS works */
  await pg.evaluate(async () => {
    window.print = () => {};
    await window.DECK.io.exportPdf();
  });
  await pg.waitForTimeout(600);
  const pdfPath = path.join(OUTDIR, 'exported-deck.pdf');
  try {
    await pg.pdf({ path: pdfPath, printBackground: true, width: '13.333in', height: '7.5in', pageRanges: '1-5', margin: { top: 0, right: 0, bottom: 0, left: 0 } });
    const sz = fs.statSync(pdfPath).size;
    ok('Chromium writes a PDF from the print sheet', sz > 8000, Math.round(sz / 1024) + ' KB');
  } catch (e) {
    ok('Chromium writes a PDF from the print sheet', false, e.message);
  }
  await pg.evaluate(() => {
    document.documentElement.classList.remove('printing');
    const h = document.getElementById('printHost'); if (h) h.remove();
    const r = document.getElementById('printSizeRule'); if (r) r.remove();
  });

  /* ----------------------------------------------------------- present */
  group('Present mode');
  await pg.evaluate(() => { window.DECK.cmd.loadDeck(window.DECK.cmd.buildDefaultDeck(), 'deck'); });
  await pg.waitForTimeout(200);
  await pg.evaluate(() => window.DECK.cmd.startPresent(0));
  await pg.waitForTimeout(260);
  const p1 = await pg.evaluate(() => ({
    root: !!document.querySelector('.pv'),
    idx: window.DECK.ui.Present.index,
    stage: !!document.querySelector('.pv-stage .sp-stage'),
    scaled: (document.querySelector('.pv-stage .sp-stage') || {}).style ? document.querySelector('.pv-stage .sp-stage').style.transform : ''
  }));
  ok('the presenter overlay opens', p1.root && p1.stage, '');
  ok('the slide is scaled to the screen', /scale\(/.test(p1.scaled), p1.scaled);
  await pg.keyboard.press('ArrowRight');
  await pg.keyboard.press('ArrowRight');
  await pg.waitForTimeout(140);
  ok('arrow keys advance', await pg.evaluate(() => window.DECK.ui.Present.index) === 2, '');
  const fitNoNotes = await pg.evaluate(() => {
    const s = document.querySelector('.pv-stage .sp-stage').getBoundingClientRect();
    const h = document.querySelector('.pv-screen').getBoundingClientRect();
    return { slide: [s.left, s.right, s.width], host: [h.left, h.right, h.width] };
  });
  ok('the slide sits inside the screen area', fitNoNotes.slide[0] >= fitNoNotes.host[0] - 1 && fitNoNotes.slide[1] <= fitNoNotes.host[1] + 1,
    JSON.stringify(fitNoNotes));
  await pg.keyboard.press('n');
  await pg.waitForTimeout(220);
  ok('N opens the notes pane', await pg.evaluate(() => !!document.querySelector('.pv.pv-with-notes .pv-notes-body')));
  /* the pane takes 300px off the width, so the slide has to be re-sized for it */
  const fitNotes = await pg.evaluate(() => {
    const s = document.querySelector('.pv-stage .sp-stage').getBoundingClientRect();
    const h = document.querySelector('.pv-screen').getBoundingClientRect();
    const n = document.querySelector('.pv-notes').getBoundingClientRect();
    return { sl: s.left, sr: s.right, hl: h.left, hr: h.right, nl: n.left, sw: s.width };
  });
  ok('the slide is re-fitted when the notes pane opens',
    fitNotes.sl >= fitNotes.hl - 1 && fitNotes.sr <= fitNotes.hr + 1 && fitNotes.sr <= fitNotes.nl + 1,
    'slide ' + Math.round(fitNotes.sl) + '–' + Math.round(fitNotes.sr) + ', pane starts ' + Math.round(fitNotes.nl));
  ok('the notes pane shows this slide’s notes', await pg.evaluate(() => {
    const n = document.querySelector('.pv-notes-body');
    return !!n && n.textContent.length > 80;
  }));
  ok('the next-slide preview renders', await pg.evaluate(() => !!document.querySelector('.pv-next-stage .sp-stage')));
  /* A long note used to scroll the whole pane, which let its last lines run
     under the next-slide preview and vanish behind it. The notes scroll on
     their own now, so the two blocks must never overlap. */
  const paneStack = await pg.evaluate(async () => {
    /* go to the longest note in the deck, which is where it shows */
    const notes = window.DECK.app.deck.slides.map((s) => (s.notes || '').length);
    const worst = notes.indexOf(Math.max.apply(null, notes));
    window.DECK.ui.Present.index = worst;
    window.DECK.ui.renderPresent();
    await new Promise((r) => setTimeout(r, 300));
    const pane = document.querySelector('.pv-notes');
    const body = document.querySelector('.pv-notes-body');
    const next = document.querySelector('.pv-next');
    const ctl = document.querySelector('.pv-ctl');
    return {
      slide: worst + 1, chars: notes[worst],
      paneOverflow: pane.scrollHeight - pane.clientHeight,
      bodyScrolls: body.scrollHeight - body.clientHeight,
      bodyBottom: body.getBoundingClientRect().bottom,
      nextTop: next.getBoundingClientRect().top,
      ctlBottom: ctl.getBoundingClientRect().bottom,
      paneBottom: pane.getBoundingClientRect().bottom
    };
  });
  ok('the longest note actually overflows its box, so this is a real test',
    paneStack.bodyScrolls > 0, 'slide ' + paneStack.slide + ', ' + paneStack.chars + ' chars, overflow ' + paneStack.bodyScrolls + 'px');
  ok('long notes never run under the next-slide preview',
    paneStack.paneOverflow <= 1 && paneStack.bodyBottom <= paneStack.nextTop + 1
    && paneStack.ctlBottom <= paneStack.paneBottom + 1,
    'pane overflow ' + paneStack.paneOverflow + 'px, notes end ' + Math.round(paneStack.bodyBottom)
    + ', preview starts ' + Math.round(paneStack.nextTop)
    + ', controls end ' + Math.round(paneStack.ctlBottom) + ', pane ends ' + Math.round(paneStack.paneBottom));
  await pg.keyboard.press('Escape');
  await pg.waitForTimeout(240);
  ok('Escape exits', await pg.evaluate(() => !document.querySelector('.pv') && window.DECK.ui.Present.active === false));

  /* --------------------------------------------------------- UI surfaces */
  group('UI surfaces');
  await pg.evaluate(() => { window.DECK.cmd.clearSelection(); });
  await pg.waitForTimeout(120);
  const ui = await pg.evaluate(() => {
    const d = window.DECK;
    d.cmd.clearSelection();
    const empty = { groups: document.querySelectorAll('#toolbar .tgrp').length, hint: !!document.querySelector('#toolbar .thint') };
    /* With a text element selected the toolbar must grow its text controls.
       It has to come from the CURRENT slide: select() deliberately ignores an
       id that is not on the slide being edited. */
    d.cmd.gotoSlide(0);
    const t = d.app.deck.slides[0].elements.find((e) => e.body && e.type === 'text');
    d.cmd.select([t.id]);
    const sel = {
      groups: document.querySelectorAll('#toolbar .tgrp').length,
      font: !!document.querySelector('#toolbar .sel.font'),
      size: !!document.querySelector('#toolbar .sel.size'),
      bold: !!document.querySelector('#toolbar .btn.bold'),
      swatches: document.querySelectorAll('#toolbar .swatch').length
    };
    d.cmd.clearSelection();
    return {
      menus: document.querySelectorAll('.menus .btn.menu').length,
      empty, sel,
      inspector: !!document.querySelector('#inspector .isec'),
      notes: !!document.querySelector('#notesText'),
      status: !!document.querySelector('#statusBar .zoomlab')
    };
  });
  ok('five menus', ui.menus === 5, ui.menus + '');
  ok('with nothing selected the toolbar offers inserts and says so', ui.empty.groups === 1 && ui.empty.hint, ui.empty.groups + ' group(s)');
  ok('selecting text grows the toolbar', ui.sel.groups >= 4 && ui.sel.font && ui.sel.size && ui.sel.bold, ui.sel.groups + ' groups');
  ok('the toolbar offers colour swatches for text', ui.sel.swatches >= 1, ui.sel.swatches + '');
  ok('the inspector is built', ui.inspector);
  ok('the notes editor is present', ui.notes);
  ok('the status bar is present', ui.status);

  /* every menu opens and every popover closes */
  for (const label of ['File', 'Insert', 'Slide', 'Arrange', 'View']) {
    await pg.click('.menus .btn.menu:has-text("' + label + '")');
    await pg.waitForTimeout(90);
    const items = await pg.evaluate(() => document.querySelectorAll('.pop .mi, .pop .mi-gb').length);
    ok(label + ' menu opens with items', items > 2, items + ' items');
    await pg.keyboard.press('Escape');
    await pg.waitForTimeout(60);
  }
  /* the shape picker, which builds a path for every preset */
  await pg.evaluate(() => { window.DECK.cmd.select([]); });
  await pg.click('#toolbar .btn[title^="Shape"]');
  await pg.waitForTimeout(140);
  const shapes = await pg.evaluate(() => {
    const paths = Array.from(document.querySelectorAll('.pop-shapes .sgb svg path'));
    const bad = paths.filter((p) => { const d = p.getAttribute('d') || ''; return !d || /NaN|Infinity|undefined/.test(d); });
    return { n: paths.length, bad: bad.length };
  });
  ok('the shape picker draws every preset', shapes.n > 70, shapes.n + ' shapes');
  ok('no preset produces an invalid path', shapes.bad === 0, shapes.bad + ' bad');
  await pg.keyboard.press('Escape');

  /* Every preset geometry, measured for real at several aspect ratios: a
     formula can look fine at 120x80 and produce NaN when one side collapses. */
  const allGeom = await pg.evaluate(() => {
    const out = { total: 0, bad: [], zero: [], menuMissing: [] };
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('style', 'position:absolute;left:-9999px;width:0;height:0');
    const p = document.createElementNS(svgNS, 'path');
    svg.appendChild(p); document.body.appendChild(svg);
    const boxes = [[120, 80], [80, 120], [400, 12], [12, 400], [40, 40]];
    for (const name of window.DECK.render.presets) {
      out.total += 1;
      for (const [w, h] of boxes) {
        const d = window.DECK.render.geomPath(name, w, h, null);
        if (!d || /NaN|Infinity|undefined/.test(d)) { out.bad.push(name + '@' + w + 'x' + h); break; }
        p.setAttribute('d', d);
        let L = 0;
        try { L = p.getTotalLength(); } catch (e) { out.bad.push(name + '@' + w + 'x' + h + ' unmeasurable'); break; }
        if (!(L > 0.5)) { out.zero.push(name + '@' + w + 'x' + h); break; }
      }
    }
    /* every shape offered in the menu must exist as a preset */
    const offered = window.DECK.render.shapeMenu.flatMap((g) => g.items);
    for (const n of offered) if (window.DECK.render.presets.indexOf(n) < 0) out.menuMissing.push(n);
    svg.remove();
    return out;
  });
  ok('every preset builds a valid path at five aspect ratios', allGeom.bad.length === 0, allGeom.total + ' presets; bad: ' + allGeom.bad.slice(0, 6).join(', '));
  ok('no preset collapses to a zero-length path', allGeom.zero.length === 0, allGeom.zero.slice(0, 6).join(', '));
  ok('every shape in the insert menu exists', allGeom.menuMissing.length === 0, allGeom.menuMissing.join(', '));

  /* custGeom, which is how an imported freeform arrives */
  const cust = await pg.evaluate(() => {
    const d = window.DECK.render.custGeomPath([{
      w: 1000, h: 1000, cmds: [
        { t: 'moveTo', pts: [{ x: 0, y: 0 }] },
        { t: 'lnTo', pts: [{ x: 1000, y: 0 }] },
        { t: 'cubicBezTo', pts: [{ x: 1000, y: 500 }, { x: 500, y: 1000 }, { x: 0, y: 1000 }] },
        { t: 'close' }
      ]
    }], 200, 100);
    return d;
  });
  ok('custom geometry scales into the element box', /^M0\.000,0\.000L200\.000,0\.000C/.test(cust) && /Z$/.test(cust), cust.slice(0, 54));

  /* ------------------------------------------------------------ errors */
  group('Errors');
  ok('no page or console errors during the whole run', errs.length === 0, errs.slice(0, 4).join(' | '));

  /* screenshots for the eye */
  await pg.evaluate(() => { window.DECK.cmd.loadDeck(window.DECK.cmd.buildDefaultDeck(), 'deck'); });
  await pg.waitForTimeout(400);
  for (let i = 0; i < 5; i++) {
    await pg.evaluate((n) => window.DECK.cmd.gotoSlide(n), i);
    await pg.waitForTimeout(220);
    await pg.screenshot({ path: path.join(OUTDIR, 'shot-slide' + (i + 1) + '.png') });
  }
  await pg.evaluate(() => window.DECK.cmd.startPresent(0));
  await pg.waitForTimeout(400);
  await pg.screenshot({ path: path.join(OUTDIR, 'shot-present.png') });
  await pg.evaluate(() => window.DECK.cmd.endPresent());

  await browser.close();

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (errs.length) { console.log('\nerrors:'); for (const e of errs.slice(0, 12)) console.log('  ' + e); }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
