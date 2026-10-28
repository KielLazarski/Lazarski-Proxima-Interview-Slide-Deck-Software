/* ==========================================================================
   20-model.js — the deck data model, defaults and layouts.

   Everything the app knows about a presentation lives in one plain object that
   serialises to JSON with no custom logic, which is what makes the native save
   format lossless and the undo stack a list of snapshots.

   Coordinates and sizes are points. Text is paragraphs of runs, matching the
   shape of OOXML's <a:p>/<a:r> so neither import nor export has to invent
   structure that is not in the file.
   ========================================================================== */

const SLIDE_SIZES = {
  '16:9': { w: 960, h: 540, name: 'Widescreen 16:9', label: '13.33 × 7.5 in' },
  '4:3': { w: 720, h: 540, name: 'Standard 4:3', label: '10 × 7.5 in' },
  '16:10': { w: 912, h: 570, name: 'Widescreen 16:10', label: '12.67 × 7.92 in' },
  a4l: { w: 842, h: 595, name: 'A4 landscape', label: '297 × 210 mm' },
  a4p: { w: 595, h: 842, name: 'A4 portrait', label: '210 × 297 mm' }
};

/* ---------- text ---------- */

function mkRun(text, props) {
  return Object.assign({ t: String(text === undefined || text === null ? '' : text) }, props || {});
}
function mkPara(runs, props) {
  return Object.assign({ runs: [].concat(runs || []).filter(Boolean) }, props || {});
}
function mkBody(paras, props) {
  return Object.assign({
    paragraphs: [].concat(paras || []).filter(Boolean),
    anchor: 't', wrap: true, autofit: 'none',
    ins: { l: 7.2, t: 3.6, r: 7.2, b: 3.6 }   /* OOXML defaults: 0.1in / 0.05in */
  }, props || {});
}
/* Build a body from plain text, one paragraph per line. Used by paste, by the
   quick-insert paths and by the bundled deck. */
function bodyFromText(text, props, runProps) {
  const lines = String(text === undefined || text === null ? '' : text).split(/\r\n|\r|\n/);
  return mkBody(lines.map((l) => mkPara([mkRun(l, runProps)], props && props.para)), props && props.body);
}
function bodyToText(body) {
  if (!body || !body.paragraphs) return '';
  return body.paragraphs.map((p) =>
    (p.runs || []).map((r) => (r.br ? '\n' : (r.t || ''))).join('')
  ).join('\n');
}
const bodyIsEmpty = (body) => !bodyToText(body).trim();

const BULLET_CHARS = ['•', '–', '▪', '‣', '◦', '»', '·', '○'];
const bulletChar = (lvl) => BULLET_CHARS[clamp(lvl | 0, 0, BULLET_CHARS.length - 1)];
const NUM_SCHEMES = {
  arabicPeriod: (i) => i + '.', arabicParenR: (i) => i + ')',
  alphaLcPeriod: (i) => String.fromCharCode(96 + ((i - 1) % 26) + 1) + '.',
  alphaUcPeriod: (i) => String.fromCharCode(64 + ((i - 1) % 26) + 1) + '.',
  romanLcPeriod: (i) => toRoman(i).toLowerCase() + '.', romanUcPeriod: (i) => toRoman(i) + '.'
};
function toRoman(n) {
  const m = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let s = '';
  for (const [v, r] of m) while (n >= v) { s += r; n -= v; }
  return s || '1';
}

/* ---------- elements ---------- */

const DEFAULT_LINE = () => ({ color: { scheme: 'tx1', alpha: 45000 }, w: 1, dash: 'solid' });

function mkElement(type, props) {
  const base = {
    id: uid(type), type, name: '',
    x: 60, y: 60, w: 240, h: 120,
    rot: 0, flipH: false, flipV: false
  };
  if (type === 'text') {
    Object.assign(base, {
      fill: { type: 'none' }, line: null, h: 48,
      body: mkBody([mkPara([mkRun('')])], { wrap: true, autofit: 'resize', anchor: 't' })
    });
  } else if (type === 'shape') {
    Object.assign(base, {
      geom: 'rect', adj: {},
      fill: { type: 'solid', color: { scheme: 'accent1' } },
      line: null,
      body: mkBody([mkPara([mkRun('')], { align: 'ctr' })], { anchor: 'ctr', wrap: true })
    });
  } else if (type === 'line') {
    Object.assign(base, { geom: 'line', adj: {}, fill: { type: 'none' }, line: { color: { scheme: 'tx1' }, w: 2, dash: 'solid' }, h: 0 });
  } else if (type === 'image') {
    Object.assign(base, { src: '', srcName: '', fill: { type: 'none' }, line: null, crop: null });
  } else if (type === 'table') {
    Object.assign(base, { w: 480, h: 180, firstRow: true, bandRow: true });
  }
  const out = Object.assign(base, props || {});
  /* A table's grid has to be built from the FINAL box, not the default one:
     building it first and then overriding w/h leaves the column widths and the
     element disagreeing, which shows up as a table drawn past its own border. */
  if (type === 'table' && !out.table) out.table = mkTable(3, 3, out.w, out.h);
  if (type === 'table') syncTableSize(out);
  return out;
}

function mkTable(rows, cols, w, h) {
  const colW = w / cols, rowH = h / rows;
  return {
    cols: Array.from({ length: cols }, () => colW),
    rows: Array.from({ length: rows }, (_, r) => ({
      h: rowH,
      cells: Array.from({ length: cols }, () => ({
        body: mkBody([mkPara([mkRun('')])], { anchor: 'ctr', ins: { l: 7.2, t: 3.6, r: 7.2, b: 3.6 } }),
        fill: null, span: 1, rowSpan: 1, merged: false
      }))
    }))
  };
}

/* ---------- slides and deck ---------- */

function mkSlide(props) {
  return Object.assign({ id: uid('sld'), bg: null, elements: [], notes: '', layout: 'blank' }, props || {});
}

function mkDeck(props) {
  const size = SLIDE_SIZES['16:9'];
  return Object.assign({
    app: APP_NAME, version: APP_VERSION, format: 1,
    title: 'Untitled presentation',
    size: { w: size.w, h: size.h },
    themeId: 'graphite', theme: null,     /* theme set means an imported scheme */
    slides: [mkSlide({ layout: 'title' })],
    created: new Date().toISOString()
  }, props || {});
}

const deckTheme = (deck) => (deck && deck.theme) || themeById(deck && deck.themeId);

/* --------------------------------------------------------------------------
   LAYOUTS
   A layout is a function of the slide size returning real elements. Nothing
   inherits from a master at render time: a layout stamps concrete elements
   that the user can then move or delete. That costs the "change the master,
   change every slide" trick, and buys a model where what you see on the
   canvas is exactly what is in the file — which is the right trade for an app
   whose job is to be predictable.

   Elements carry a `ph` tag so empty ones can show a prompt and so export can
   mark the title as a title (which is what makes the outline view and
   accessibility checkers in PowerPoint work).
   -------------------------------------------------------------------------- */

function layoutElements(layoutId, W, H, theme) {
  const M = Math.round(W * 0.0667);            /* side margin: 64pt at 960 */
  const CW = W - M * 2;
  const big = Math.round(H * 0.0815);          /* 44pt at 540 */
  const mid = Math.round(H * 0.0593);          /* 32pt */
  const body = Math.round(H * 0.0333);         /* 18pt */
  const titleRun = { sz: big, font: '+mj-lt', b: false };
  const bodyRun = { sz: body, font: '+mn-lt' };

  const titleEl = (y, h, text, run, align) => mkElement('text', {
    x: M, y, w: CW, h, name: 'Title',
    ph: { type: 'title', idx: 0 },
    body: mkBody([mkPara([mkRun(text || '', run || titleRun)], { align: align || 'l' })],
      { anchor: 'b', autofit: 'shrink' })
  });
  const bulletList = (x, y, w, h, idx, name) => mkElement('text', {
    x, y, w, h, name: name || 'Content',
    ph: { type: 'body', idx: idx === undefined ? 1 : idx },
    body: mkBody([mkPara([mkRun('', bodyRun)], { bullet: { type: 'char', char: '•' }, lvl: 0, marL: 21.6, indent: -21.6 })],
      { anchor: 't', autofit: 'shrink' })
  });

  switch (layoutId) {
    case 'title': {
      const ty = Math.round(H * 0.33);
      return [
        titleEl(ty, Math.round(H * 0.19), '', { sz: Math.round(H * 0.1037), font: '+mj-lt' }),
        mkElement('text', {
          x: M, y: ty + Math.round(H * 0.2), w: CW, h: Math.round(H * 0.1), name: 'Subtitle',
          ph: { type: 'subTitle', idx: 1 },
          body: mkBody([mkPara([mkRun('', { sz: Math.round(H * 0.0444), font: '+mn-lt', color: { scheme: 'tx2' } })])], { anchor: 't' })
        })
      ];
    }
    case 'titleContent':
      return [titleEl(M, Math.round(H * 0.13), '', { sz: mid, font: '+mj-lt' }),
        bulletList(M, Math.round(H * 0.25), CW, H - Math.round(H * 0.25) - M, 1)];
    case 'sectionHeader': {
      const ty = Math.round(H * 0.4);
      return [
        mkElement('shape', {
          x: M, y: ty - Math.round(H * 0.055), w: Math.round(W * 0.075), h: 4, name: 'Rule',
          geom: 'rect', fill: { type: 'solid', color: { scheme: 'accent1' } }, line: null, body: null
        }),
        titleEl(ty, Math.round(H * 0.15), '', { sz: Math.round(H * 0.0815), font: '+mj-lt' }),
        mkElement('text', {
          x: M, y: ty + Math.round(H * 0.17), w: CW, h: Math.round(H * 0.09), name: 'Text',
          ph: { type: 'body', idx: 1 },
          body: mkBody([mkPara([mkRun('', { sz: Math.round(H * 0.037), color: { scheme: 'tx2' } })])])
        })
      ];
    }
    case 'twoContent': {
      const y = Math.round(H * 0.25), gap = Math.round(W * 0.033), cw = (CW - gap) / 2;
      return [titleEl(M, Math.round(H * 0.13), '', { sz: mid, font: '+mj-lt' }),
        bulletList(M, y, cw, H - y - M, 1, 'Content left'),
        bulletList(M + cw + gap, y, cw, H - y - M, 2, 'Content right')];
    }
    case 'comparison': {
      const hy = Math.round(H * 0.24), by = Math.round(H * 0.33), gap = Math.round(W * 0.033), cw = (CW - gap) / 2;
      const head = (x, idx) => mkElement('text', {
        x, y: hy, w: cw, h: Math.round(H * 0.07), name: 'Heading',
        ph: { type: 'body', idx },
        body: mkBody([mkPara([mkRun('', { sz: Math.round(H * 0.0407), b: true, font: '+mj-lt' })])], { anchor: 'b' })
      });
      return [titleEl(M, Math.round(H * 0.13), '', { sz: mid, font: '+mj-lt' }),
        head(M, 1), bulletList(M, by, cw, H - by - M, 2, 'Content left'),
        head(M + cw + gap, 3), bulletList(M + cw + gap, by, cw, H - by - M, 4, 'Content right')];
    }
    case 'titleOnly':
      return [titleEl(M, Math.round(H * 0.13), '', { sz: mid, font: '+mj-lt' })];
    case 'captionContent': {
      const y = Math.round(H * 0.25), gap = Math.round(W * 0.033), lw = Math.round(CW * 0.36), rw = CW - lw - gap;
      return [titleEl(M, Math.round(H * 0.13), '', { sz: mid, font: '+mj-lt' }),
        mkElement('text', {
          x: M, y, w: lw, h: H - y - M, name: 'Caption',
          ph: { type: 'body', idx: 1 },
          body: mkBody([mkPara([mkRun('', { sz: Math.round(H * 0.0296), color: { scheme: 'tx2' } })])])
        }),
        bulletList(M + lw + gap, y, rw, H - y - M, 2)];
    }
    case 'pictureCaption': {
      const y = Math.round(H * 0.25), ih = Math.round(H * 0.5);
      return [titleEl(M, Math.round(H * 0.13), '', { sz: mid, font: '+mj-lt' }),
        mkElement('shape', {
          x: M, y, w: CW, h: ih, name: 'Picture placeholder', geom: 'rect',
          ph: { type: 'pic', idx: 1 },
          fill: { type: 'solid', color: { scheme: 'tx1', alpha: 7000 } },
          line: { color: { scheme: 'tx1', alpha: 26000 }, w: 1, dash: 'dash' },
          body: mkBody([mkPara([mkRun('', { sz: 14, color: { scheme: 'tx2', alpha: 80000 } })], { align: 'ctr' })], { anchor: 'ctr' })
        }),
        mkElement('text', {
          x: M, y: y + ih + Math.round(H * 0.03), w: CW, h: Math.round(H * 0.08), name: 'Caption',
          ph: { type: 'body', idx: 2 },
          body: mkBody([mkPara([mkRun('', { sz: Math.round(H * 0.0259), color: { scheme: 'tx2' } })])])
        })];
    }
    case 'blank':
    default:
      return [];
  }
}

const LAYOUTS = [
  { id: 'title', name: 'Title slide' },
  { id: 'titleContent', name: 'Title and content' },
  { id: 'sectionHeader', name: 'Section header' },
  { id: 'twoContent', name: 'Two content' },
  { id: 'comparison', name: 'Comparison' },
  { id: 'titleOnly', name: 'Title only' },
  { id: 'captionContent', name: 'Content with caption' },
  { id: 'pictureCaption', name: 'Picture with caption' },
  { id: 'blank', name: 'Blank' }
];

const PH_PROMPT = {
  title: 'Click to add title', subTitle: 'Click to add subtitle',
  body: 'Click to add text', pic: 'Picture', ctrTitle: 'Click to add title'
};
const phPrompt = (e) => (e && e.ph && PH_PROMPT[e.ph.type]) || 'Click to add text';

function newSlideFor(deck, layoutId) {
  const t = deckTheme(deck);
  return mkSlide({ layout: layoutId || 'titleContent', elements: layoutElements(layoutId || 'titleContent', deck.size.w, deck.size.h, t) });
}

/* --------------------------------------------------------------------------
   Queries and small operations used across the app
   -------------------------------------------------------------------------- */

const elementBox = (e) => ({ x: e.x, y: e.y, w: e.w, h: e.h, rot: e.rot || 0 });
const isTextish = (e) => e && (e.type === 'text' || e.type === 'shape') && e.body;
const canHaveText = (e) => e && (e.type === 'text' || e.type === 'shape');

function findElement(slide, id) { return (slide.elements || []).find((e) => e.id === id) || null; }

/* A group is a shared tag rather than a container: selecting any member
   selects the set, and each shape still exports as itself. Nested transforms
   are the usual source of drift between an editor and PowerPoint, and this
   sidesteps them entirely. */
function groupMembers(slide, ids) {
  const gids = new Set();
  for (const id of ids) { const e = findElement(slide, id); if (e && e.groupId) gids.add(e.groupId); }
  if (!gids.size) return ids.slice();
  const out = new Set(ids);
  for (const e of slide.elements) if (e.groupId && gids.has(e.groupId)) out.add(e.id);
  return Array.from(out);
}

/* Tables own their row heights, so the element height has to follow them or
   the border and the content disagree. */
function syncTableSize(e) {
  if (e.type !== 'table' || !e.table) return;
  e.w = e.table.cols.reduce((a, b) => a + b, 0);
  e.h = e.table.rows.reduce((a, r) => a + r.h, 0);
}

/* Slide ordering helpers */
function moveInArray(arr, from, to) {
  if (from === to || from < 0 || from >= arr.length) return arr;
  const item = arr.splice(from, 1)[0];
  arr.splice(clamp(to, 0, arr.length), 0, item);
  return arr;
}

/* --------------------------------------------------------------------------
   Normalisation — run on every deck that enters the app, from a file, from the
   bundled deck or from a project JSON written by an older build. A model that
   is guaranteed well-formed here is a renderer that needs no defensive checks.
   -------------------------------------------------------------------------- */
function normalizeDeck(d) {
  const deck = Object.assign(mkDeck(), d || {});
  if (!deck.size || !(deck.size.w > 0) || !(deck.size.h > 0)) deck.size = { w: 960, h: 540 };
  deck.size.w = +deck.size.w; deck.size.h = +deck.size.h;
  if (deck.theme) deck.theme = themeFromScheme(deck.theme.name, deck.theme.colors, deck.theme.fonts);
  if (!Array.isArray(deck.slides) || !deck.slides.length) deck.slides = [newSlideFor(deck, 'title')];
  deck.slides = deck.slides.map((s) => {
    const sl = Object.assign(mkSlide(), s);
    sl.elements = (Array.isArray(sl.elements) ? sl.elements : []).map(normalizeElement).filter(Boolean);
    sl.notes = typeof sl.notes === 'string' ? sl.notes : '';
    return sl;
  });
  return deck;
}
function normalizeElement(e) {
  if (!e || !e.type) return null;
  const out = Object.assign({}, e);
  out.id = out.id || uid(out.type);
  for (const k of ['x', 'y', 'w', 'h']) out[k] = isFinite(+out[k]) ? +out[k] : 0;
  out.rot = isFinite(+out.rot) ? +out.rot : 0;
  if (out.type === 'image' && !out.src) return null;
  if (canHaveText(out) && out.body) {
    out.body = Object.assign(mkBody([]), out.body);
    out.body.paragraphs = (Array.isArray(out.body.paragraphs) ? out.body.paragraphs : []).map((p) => {
      const pp = Object.assign({}, p);
      pp.runs = (Array.isArray(pp.runs) ? pp.runs : []).filter((r) => r && (r.br || typeof r.t === 'string'));
      return pp;
    });
    if (!out.body.paragraphs.length) out.body.paragraphs = [mkPara([mkRun('')])];
  }
  if (out.type === 'table') {
    if (!out.table || !Array.isArray(out.table.rows) || !Array.isArray(out.table.cols)) out.table = mkTable(2, 2, out.w || 240, out.h || 80);
    for (const r of out.table.rows) {
      r.h = isFinite(+r.h) ? +r.h : 24;
      r.cells = (Array.isArray(r.cells) ? r.cells : []);
      while (r.cells.length < out.table.cols.length) r.cells.push({ body: mkBody([mkPara([mkRun('')])]), fill: null, span: 1, rowSpan: 1 });
      for (const c of r.cells) { if (!c.body) c.body = mkBody([mkPara([mkRun('')])]); c.span = c.span || 1; c.rowSpan = c.rowSpan || 1; }
    }
    syncTableSize(out);
  }
  /* A shape whose geometry this build does not know still has to render; fall
     back rather than drop the element and lose the user's content. */
  if ((out.type === 'shape' || out.type === 'line') && out.geom && !hasPreset(out.geom) && !out.custPath) out.geom = 'rect';
  return out;
}
