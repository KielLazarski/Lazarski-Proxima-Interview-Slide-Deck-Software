/* ==========================================================================
   55-import-pptx.js — read a .pptx into the model.

   Shapes, text runs with their formatting, pictures and tables arrive at their
   real coordinates and stay editable afterwards.

   THE CENTRAL DECISION: inheritance is flattened on the way in. In OOXML a
   placeholder's position and its text sizes may live in the slide, or the
   layout, or the master's txStyles, or the theme. This reader resolves that
   chain once and writes concrete values into the model. The cost is that
   editing a master later cannot cascade; the gain is that every later
   operation — rendering, editing, export, PDF — sees one unambiguous value,
   and a deck cannot change appearance because of a rule nobody can see.

   SmartArt is read through the `dsp:` fallback drawing that PowerPoint stores
   alongside every diagram, so it arrives as ordinary editable shapes rather
   than being dropped. Charts have no such fallback and are imported as a
   labelled frame; the import report says which slides they were on.
   ========================================================================== */

/* ---------- small XML helpers (namespace-agnostic by local name) ---------- */
const xml = {
  parse(text) {
    const d = new DOMParser().parseFromString(text, 'application/xml');
    const err = d.querySelector('parsererror');
    if (err) throw new Error('Malformed XML: ' + (err.textContent || '').slice(0, 120));
    return d;
  },
  ch(node, name) {
    if (!node) return null;
    for (let c = node.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name) return c;
    return null;
  },
  chAll(node, name) {
    const out = [];
    if (!node) return out;
    for (let c = node.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name) out.push(c);
    return out;
  },
  /* Path of local names, e.g. path(sp,'spPr','xfrm','off') */
  path(node) {
    let n = node;
    for (let i = 1; i < arguments.length && n; i++) n = xml.ch(n, arguments[i]);
    return n;
  },
  desc(node, name) {
    if (!node) return null;
    const list = node.getElementsByTagName('*');
    for (let i = 0; i < list.length; i++) if (list[i].localName === name) return list[i];
    return null;
  },
  descAll(node, name) {
    const out = [];
    if (!node) return out;
    const list = node.getElementsByTagName('*');
    for (let i = 0; i < list.length; i++) if (list[i].localName === name) out.push(list[i]);
    return out;
  },
  att(node, name) {
    if (!node) return null;
    if (node.hasAttribute(name)) return node.getAttribute(name);
    /* Namespaced attributes arrive as r:embed and the like; match the local part. */
    const at = node.attributes;
    for (let i = 0; i < at.length; i++) if (at[i].localName === name) return at[i].value;
    return null;
  },
  /* The relationship id specifically. This cannot go through att('id'):
     <p:sldId id="256" r:id="rId2"/> carries BOTH, and the unprefixed one is
     the slide's own number, not a relationship. Reading the wrong one is a
     silent failure that loses every slide. */
  rid(node) {
    if (!node) return null;
    const at = node.attributes;
    for (let i = 0; i < at.length; i++) {
      if (at[i].localName === 'id' && at[i].name !== 'id') return at[i].value;
    }
    return null;
  },
  num(node, name, dflt) {
    const v = xml.att(node, name);
    const n = v === null ? NaN : parseFloat(v);
    return isFinite(n) ? n : (dflt === undefined ? null : dflt);
  },
  bool(node, name, dflt) {
    const v = xml.att(node, name);
    if (v === null || v === undefined) return dflt;
    return v === '1' || v === 'true' || v === 'on';
  }
};

/* ---------- package plumbing ---------- */

function pkgText(files, path) {
  const b = files.get(path) || files.get(path.replace(/^\//, ''));
  if (!b) return null;
  return new TextDecoder('utf-8').decode(b);
}
function relsPathFor(partPath) {
  const i = partPath.lastIndexOf('/');
  return partPath.slice(0, i) + '/_rels' + partPath.slice(i) + '.rels';
}
function readRels(files, partPath) {
  const map = new Map();
  const t = pkgText(files, relsPathFor(partPath));
  if (!t) return map;
  let doc;
  try { doc = xml.parse(t); } catch (e) { return map; }
  for (const r of xml.chAll(doc.documentElement, 'Relationship')) {
    const id = xml.att(r, 'Id');
    const target = xml.att(r, 'Target') || '';
    const mode = xml.att(r, 'TargetMode');
    const type = xml.att(r, 'Type') || '';
    map.set(id, { target, mode, type, abs: mode === 'External' ? target : resolvePart(partPath, target) });
  }
  return map;
}
/* Relationship targets are relative to the part that declares them, and often
   climb with ../ — resolve them the way a URL would. */
function resolvePart(fromPart, target) {
  if (!target) return '';
  if (target.charAt(0) === '/') return target.slice(1);
  const base = fromPart.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') base.pop();
    else base.push(seg);
  }
  return base.join('/');
}

/* ---------- colour and fill ---------- */

function parseColorEl(node) {
  if (!node) return null;
  let c = null;
  const srgb = xml.ch(node, 'srgbClr');
  const scheme = xml.ch(node, 'schemeClr');
  const sys = xml.ch(node, 'sysClr');
  const prst = xml.ch(node, 'prstClr');
  const scrgb = xml.ch(node, 'scrgbClr');
  const hsl = xml.ch(node, 'hslClr');
  let host = null;
  if (srgb) { c = { hex: normHex(xml.att(srgb, 'val')) }; host = srgb; }
  else if (scheme) { c = { scheme: xml.att(scheme, 'val') }; host = scheme; }
  else if (sys) {
    /* sysClr carries lastClr, the value Office last resolved it to. */
    c = { hex: normHex(xml.att(sys, 'lastClr')) || (xml.att(sys, 'val') === 'window' ? '#FFFFFF' : '#000000') };
    host = sys;
  } else if (prst) { c = { hex: PRESET_COLORS[xml.att(prst, 'val')] || '#000000' }; host = prst; }
  else if (scrgb) {
    const f = (k) => clamp((xml.num(scrgb, k, 0) / 100000) * 255, 0, 255);
    c = { hex: rgbToHex(f('r'), f('g'), f('b')) }; host = scrgb;
  } else if (hsl) {
    const o = hslToRgb(xml.num(hsl, 'hue', 0) / 60000, clamp(xml.num(hsl, 'sat', 0) / 100000, 0, 1), clamp(xml.num(hsl, 'lum', 0) / 100000, 0, 1));
    c = { hex: rgbToHex(o.r, o.g, o.b) }; host = hsl;
  }
  if (!c || (!c.hex && !c.scheme)) return null;
  if (host) {
    const grab = (n, key) => { const t = xml.ch(host, n); if (t) { const v = xml.num(t, 'val', null); if (v !== null) c[key] = v; } };
    grab('lumMod', 'lumMod'); grab('lumOff', 'lumOff'); grab('tint', 'tint');
    grab('shade', 'shade'); grab('satMod', 'satMod'); grab('alpha', 'alpha');
  }
  return c;
}
const PRESET_COLORS = {
  black: '#000000', white: '#FFFFFF', red: '#FF0000', green: '#008000', blue: '#0000FF',
  yellow: '#FFFF00', cyan: '#00FFFF', magenta: '#FF00FF', gray: '#808080', grey: '#808080',
  darkGray: '#A9A9A9', lightGray: '#D3D3D3', orange: '#FFA500', purple: '#800080',
  brown: '#A52A2A', pink: '#FFC0CB', navy: '#000080', teal: '#008080', olive: '#808000',
  maroon: '#800000', lime: '#00FF00', silver: '#C0C0C0', aqua: '#00FFFF', fuchsia: '#FF00FF'
};

function parseFill(sp, ctx) {
  if (!sp) return null;
  if (xml.ch(sp, 'noFill')) return { type: 'none' };
  const solid = xml.ch(sp, 'solidFill');
  if (solid) { const c = parseColorEl(solid); return c ? { type: 'solid', color: c } : { type: 'none' }; }
  const grad = xml.ch(sp, 'gradFill');
  if (grad) {
    const stops = xml.chAll(xml.ch(grad, 'gsLst'), 'gs').map((gs) => ({
      pos: xml.num(gs, 'pos', 0), color: parseColorEl(gs) || { hex: '#FFFFFF' }
    })).sort((a, b) => a.pos - b.pos);
    const lin = xml.ch(grad, 'lin');
    const path = xml.ch(grad, 'path');
    return {
      type: 'gradient',
      stops: stops.length ? stops : [{ pos: 0, color: { hex: '#FFFFFF' } }, { pos: 100000, color: { hex: '#CCCCCC' } }],
      angle: lin ? angToDeg(xml.num(lin, 'ang', 0)) : 0,
      path: path ? (xml.att(path, 'path') === 'circle' ? 'circle' : 'rect') : null
    };
  }
  const blip = xml.ch(sp, 'blipFill');
  if (blip && ctx) {
    const src = blipToDataUrl(blip, ctx);
    if (src) return { type: 'image', src };
    return { type: 'none' };
  }
  const patt = xml.ch(sp, 'pattFill');
  if (patt) {
    return {
      type: 'pattern',
      color: parseColorEl(xml.ch(patt, 'fgClr')) || { hex: '#808080' },
      bgColor: parseColorEl(xml.ch(patt, 'bgClr')) || { hex: '#FFFFFF' },
      preset: xml.att(patt, 'prst') || 'pct50'
    };
  }
  return null;
}

function blipToDataUrl(blipFill, ctx) {
  const blip = xml.ch(blipFill, 'blip');
  if (!blip) return null;
  const rid = xml.att(blip, 'embed') || xml.att(blip, 'link') || xml.rid(blip);
  if (!rid) return null;
  const rel = ctx.rels.get(rid);
  if (!rel || rel.mode === 'External') return null;
  const bytes = ctx.files.get(rel.abs);
  if (!bytes) return null;
  const ext = (rel.abs.split('.').pop() || 'png').toLowerCase();
  if (ext === 'emf' || ext === 'wmf') {
    /* Vector metafiles cannot be shown by a browser. Report rather than
       silently leaving a hole where a logo was. */
    ctx.report.metafiles += 1;
    return null;
  }
  const key = rel.abs;
  if (ctx.mediaCache.has(key)) return ctx.mediaCache.get(key);
  const url = bytesToDataUrl(bytes, mimeForExt(ext));
  ctx.mediaCache.set(key, url);
  return url;
}

const DASH_MAP = {
  solid: 'solid', dot: 'dot', sysDot: 'sysDot', dash: 'dash', sysDash: 'sysDash',
  lgDash: 'lgDash', dashDot: 'dashDot', sysDashDot: 'sysDashDot', lgDashDot: 'lgDashDot',
  sysDashDotDot: 'sysDashDotDot', lgDashDotDot: 'lgDashDotDot'
};
const ARROW_MAP = { none: 'none', triangle: 'triangle', stealth: 'stealth', diamond: 'diamond', oval: 'oval', arrow: 'open' };

function parseLine(spPr, ctx) {
  const ln = xml.ch(spPr, 'ln');
  if (!ln) return null;
  if (xml.ch(ln, 'noFill')) return { type: 'none' };
  const solid = xml.ch(ln, 'solidFill');
  const grad = xml.ch(ln, 'gradFill');
  const color = solid ? parseColorEl(solid) : (grad ? parseColorEl(xml.ch(xml.ch(grad, 'gsLst'), 'gs')) : null);
  const wEmu = xml.num(ln, 'w', null);
  const out = {
    color: color || { scheme: 'tx1' },
    w: wEmu === null ? 1 : Math.max(0.25, round2(emuToPt(wEmu))),
    dash: DASH_MAP[xml.att(xml.ch(ln, 'prstDash'), 'val')] || 'solid'
  };
  const cap = xml.att(ln, 'cap');
  if (cap) out.cap = cap;
  if (xml.ch(ln, 'round')) out.join = 'round';
  else if (xml.ch(ln, 'bevel')) out.join = 'bevel';
  const he = xml.ch(ln, 'headEnd'), te = xml.ch(ln, 'tailEnd');
  if (he) { out.headEnd = ARROW_MAP[xml.att(he, 'type')] || 'none'; out.headSize = arrowSize(xml.att(he, 'w')); }
  if (te) { out.tailEnd = ARROW_MAP[xml.att(te, 'type')] || 'none'; out.tailSize = arrowSize(xml.att(te, 'w')); }
  if (!color && !solid && !grad) return null;   /* an <a:ln> with only a width inherits its colour */
  return out;
}
const arrowSize = (w) => (w === 'sm' ? 3 : w === 'lg' ? 6 : 4.5);

function parseShadow(spPr) {
  const eff = xml.ch(spPr, 'effectLst');
  const sh = eff && xml.ch(eff, 'outerShdw');
  if (!sh) return null;
  return {
    type: 'outer',
    blur: round2(emuToPt(xml.num(sh, 'blurRad', 0))),
    dist: round2(emuToPt(xml.num(sh, 'dist', 0))),
    dir: round2(angToDeg(xml.num(sh, 'dir', 0))),
    color: parseColorEl(sh) || { hex: '#000000', alpha: 40000 }
  };
}

/* ---------- transforms ---------- */

function parseXfrm(xf) {
  if (!xf) return null;
  const off = xml.ch(xf, 'off'), ext = xml.ch(xf, 'ext');
  if (!off && !ext) return null;
  return {
    x: round2(emuToPt(xml.num(off, 'x', 0))),
    y: round2(emuToPt(xml.num(off, 'y', 0))),
    w: round2(emuToPt(xml.num(ext, 'cx', 0))),
    h: round2(emuToPt(xml.num(ext, 'cy', 0))),
    rot: round2(angToDeg(xml.num(xf, 'rot', 0))),
    flipH: xml.bool(xf, 'flipH', false),
    flipV: xml.bool(xf, 'flipV', false)
  };
}

/* ---------- text ---------- */

const ALIGN_MAP = { l: 'l', ctr: 'ctr', r: 'r', just: 'just', justLow: 'just', dist: 'dist', thaiDist: 'dist' };

function parseRunProps(rPr, ctx) {
  const o = {};
  if (!rPr) return o;
  const sz = xml.num(rPr, 'sz', null);
  if (sz !== null) o.sz = round2(szToPt(sz));
  const b = xml.att(rPr, 'b'), i = xml.att(rPr, 'i'), u = xml.att(rPr, 'u'), st = xml.att(rPr, 'strike');
  if (b !== null) o.b = (b === '1' || b === 'true');
  if (i !== null) o.i = (i === '1' || i === 'true');
  if (u && u !== 'none') o.u = u;
  if (st && st !== 'noStrike') o.strike = st;
  const spc = xml.num(rPr, 'spc', null);
  if (spc !== null) o.spc = spc;
  const caps = xml.att(rPr, 'cap');
  if (caps && caps !== 'none') o.caps = caps;
  const base = xml.num(rPr, 'baseline', null);
  if (base) o.baseline = base > 0 ? 1 : -1;
  const solid = xml.ch(rPr, 'solidFill');
  if (solid) { const c = parseColorEl(solid); if (c) o.color = c; }
  const latin = xml.ch(rPr, 'latin');
  if (latin) {
    const tf = xml.att(latin, 'typeface');
    if (tf) o.font = tf;
  }
  const hl = xml.ch(rPr, 'highlight');
  if (hl) { const c = parseColorEl(hl); if (c) o.highlight = c; }
  const link = xml.ch(rPr, 'hlinkClick');
  if (link && ctx) {
    const rid = xml.rid(link);
    const rel = rid && ctx.rels.get(rid);
    if (rel) o.link = rel.mode === 'External' ? rel.target : null;
    if (!o.link) delete o.link;
  }
  return o;
}

function parseParaProps(pPr, ctx) {
  const o = {};
  if (!pPr) return o;
  const al = xml.att(pPr, 'algn');
  if (al) o.align = ALIGN_MAP[al] || 'l';
  const lvl = xml.num(pPr, 'lvl', null);
  if (lvl !== null) o.lvl = clamp(lvl | 0, 0, 8);
  const marL = xml.num(pPr, 'marL', null);
  if (marL !== null) o.marL = round2(emuToPt(marL));
  const ind = xml.num(pPr, 'indent', null);
  if (ind !== null) o.indent = round2(emuToPt(ind));
  const ln = xml.ch(pPr, 'lnSpc');
  if (ln) {
    const pct = xml.ch(ln, 'spcPct'), pts = xml.ch(ln, 'spcPts');
    if (pct) o.lnSpc = round2(xml.num(pct, 'val', 100000) / 100000);
    else if (pts) o.lnSpc = { pts: round2(szToPt(xml.num(pts, 'val', 1800))) };
  }
  const bef = xml.ch(pPr, 'spcBef'), aft = xml.ch(pPr, 'spcAft');
  const spcOf = (n) => {
    if (!n) return null;
    const pts = xml.ch(n, 'spcPts');
    if (pts) return round2(szToPt(xml.num(pts, 'val', 0)));
    const pct = xml.ch(n, 'spcPct');
    /* A percentage here is of the line height; 100000 is one line. Resolving
       it needs the font size, which the caller folds in later. */
    if (pct) return { pct: xml.num(pct, 'val', 0) / 100000 };
    return null;
  };
  const sb = spcOf(bef), sa = spcOf(aft);
  if (sb !== null) o.spcBef = sb;
  if (sa !== null) o.spcAft = sa;

  if (xml.ch(pPr, 'buNone')) o.bullet = { type: 'none' };
  else {
    const bc = xml.ch(pPr, 'buChar'), bn = xml.ch(pPr, 'buAutoNum');
    if (bc) o.bullet = { type: 'char', char: xml.att(bc, 'char') || '•' };
    else if (bn) o.bullet = { type: 'num', scheme: xml.att(bn, 'type') || 'arabicPeriod', start: xml.num(bn, 'startAt', 1) };
    if (o.bullet) {
      const bf = xml.ch(pPr, 'buFont');
      /* Wingdings and Symbol bullets render as the wrong glyph in a browser,
         so map the handful that actually appear to Unicode equivalents. */
      if (bf && o.bullet.type === 'char') {
        const tf = xml.att(bf, 'typeface') || '';
        const mapped = WINGDING_BULLETS[o.bullet.char];
        if (/wingdings|symbol|webdings/i.test(tf) && mapped) o.bullet.char = mapped;
        else if (!/wingdings|symbol|webdings/i.test(tf)) o.bullet.font = tf;
      }
      const bclr = xml.ch(pPr, 'buClr');
      if (bclr) { const c = parseColorEl(bclr); if (c) o.bullet.color = c; }
      const bsz = xml.ch(pPr, 'buSzPct');
      if (bsz) o.bullet.sizePct = xml.num(bsz, 'val', 100000);
    }
  }
  const dr = xml.ch(pPr, 'defRPr');
  if (dr) o.defRPr = parseRunProps(dr, ctx);
  return o;
}
const WINGDING_BULLETS = {
  '': '▪', '': '•', '': '❖', '': '◆',
  '': '●', '': '○', '': '➤', '': '⇒',
  '': '✔', '': '■', '': '❖', '': '❑'
};

function parseTxBody(txb, ctx, inherit) {
  if (!txb) return null;
  const bodyPr = xml.ch(txb, 'bodyPr');
  const body = mkBody([]);
  if (bodyPr) {
    const an = xml.att(bodyPr, 'anchor');
    if (an === 'ctr' || an === 'b' || an === 't') body.anchor = an;
    const wrap = xml.att(bodyPr, 'wrap');
    if (wrap === 'none') body.wrap = false;
    const ins = {
      l: round2(emuToPt(xml.num(bodyPr, 'lIns', 91440))),
      t: round2(emuToPt(xml.num(bodyPr, 'tIns', 45720))),
      r: round2(emuToPt(xml.num(bodyPr, 'rIns', 91440))),
      b: round2(emuToPt(xml.num(bodyPr, 'bIns', 45720)))
    };
    body.ins = ins;
    if (xml.ch(bodyPr, 'spAutoFit')) body.autofit = 'resize';
    else if (xml.ch(bodyPr, 'normAutofit')) body.autofit = 'shrink';
    else body.autofit = 'none';
    const vert = xml.att(bodyPr, 'vert');
    if (vert === 'vert' || vert === 'vert270') body.vert = vert;
  }
  /* The shape's own lstStyle, which overrides the placeholder chain. */
  const ownLst = parseLstStyle(xml.ch(txb, 'lstStyle'), ctx);

  const paras = [];
  for (const p of xml.chAll(txb, 'p')) {
    const pp = parseParaProps(xml.ch(p, 'pPr'), ctx);
    const lvl = pp.lvl || 0;
    /* Resolve the inheritance chain for this level, nearest wins:
       shape lstStyle > layout placeholder lstStyle > master txStyles. */
    const base = Object.assign({}, (inherit && inherit[lvl]) || {}, ownLst[lvl] || {});
    const para = Object.assign({}, base, pp);
    para.defRPr = Object.assign({}, base.defRPr || {}, pp.defRPr || {});

    const runs = [];
    for (let c = p.firstElementChild; c; c = c.nextElementSibling) {
      if (c.localName === 'r') {
        const t = xml.ch(c, 't');
        const props = Object.assign({}, para.defRPr, parseRunProps(xml.ch(c, 'rPr'), ctx));
        runs.push(Object.assign({ t: t ? (t.textContent || '') : '' }, props));
      } else if (c.localName === 'br') {
        runs.push({ br: true });
      } else if (c.localName === 'fld') {
        /* Slide numbers and dates are stored with their last-rendered text,
           which is the honest thing to show in a static deck. */
        const t = xml.ch(c, 't');
        const props = Object.assign({}, para.defRPr, parseRunProps(xml.ch(c, 'rPr'), ctx));
        const txt = t ? (t.textContent || '') : '';
        if (txt) runs.push(Object.assign({ t: txt }, props));
      }
    }
    /* An empty <a:p> is a blank line and must survive. */
    if (!runs.length) {
      const endPr = xml.ch(p, 'endParaRPr');
      runs.push(Object.assign({ t: '' }, para.defRPr, parseRunProps(endPr, ctx)));
    }
    para.runs = runs;
    /* Percentage paragraph spacing needs a font size to become points. */
    const sz = (runs.find((r) => r.sz) || {}).sz || (para.defRPr && para.defRPr.sz) || 18;
    if (para.spcBef && para.spcBef.pct !== undefined) para.spcBef = round2(para.spcBef.pct * sz);
    if (para.spcAft && para.spcAft.pct !== undefined) para.spcAft = round2(para.spcAft.pct * sz);
    delete para.lvl2;
    paras.push(para);
  }
  body.paragraphs = paras.length ? paras : [mkPara([mkRun('')])];
  return body;
}

/* A <a:lstStyle> or master <p:titleStyle> etc. becomes an array indexed by
   level, each entry a set of paragraph defaults. */
function parseLstStyle(lst, ctx) {
  const out = [];
  if (!lst) return out;
  for (let i = 0; i < 9; i++) {
    const node = xml.ch(lst, 'lvl' + (i + 1) + 'pPr');
    if (node) out[i] = parseParaProps(node, ctx);
  }
  return out;
}
/* Merge two level arrays, the second winning. */
function mergeLst(a, b) {
  const out = [];
  for (let i = 0; i < 9; i++) {
    const x = (a && a[i]) || null, y = (b && b[i]) || null;
    if (!x && !y) continue;
    out[i] = Object.assign({}, x || {}, y || {});
    out[i].defRPr = Object.assign({}, (x && x.defRPr) || {}, (y && y.defRPr) || {});
  }
  return out;
}

/* ---------- placeholders ---------- */

function phOf(node) {
  const ph = xml.desc(xml.desc(node, 'nvPr') || node, 'ph');
  if (!ph) return null;
  const type = xml.att(ph, 'type') || 'body';
  const idx = xml.num(ph, 'idx', null);
  return { type, idx: idx === null ? null : (idx | 0) };
}
/* Find the placeholder on a layout or master that a slide placeholder
   inherits from. PowerPoint matches on idx when present, otherwise on type,
   and treats title/ctrTitle as interchangeable. */
function findPhShape(tree, ph) {
  if (!tree || !ph) return null;
  const cands = [];
  collectShapes(tree, cands);
  const titleish = (t) => t === 'title' || t === 'ctrTitle';
  let best = null;
  for (const sp of cands) {
    const p = phOf(sp);
    if (!p) continue;
    if (ph.idx !== null && p.idx !== null && p.idx === ph.idx) return sp;
    if (titleish(ph.type) && titleish(p.type)) best = best || sp;
    else if (p.type === ph.type && (ph.idx === null || p.idx === null)) best = best || sp;
  }
  return best;
}
function collectShapes(node, out) {
  for (let c = node.firstElementChild; c; c = c.nextElementSibling) {
    if (c.localName === 'sp' || c.localName === 'pic' || c.localName === 'graphicFrame' || c.localName === 'cxnSp') out.push(c);
    else if (c.localName === 'grpSp') collectShapes(c, out);
  }
}

/* ---------- geometry ---------- */

function parseGeom(spPr) {
  const prst = xml.ch(spPr, 'prstGeom');
  if (prst) {
    const name = xml.att(prst, 'prst') || 'rect';
    const adj = {};
    for (const gd of xml.chAll(xml.ch(prst, 'avLst'), 'gd')) {
      const n = xml.att(gd, 'name');
      const f = xml.att(gd, 'fmla') || '';
      const m = f.match(/^val\s+(-?\d+)/);
      if (n && m) adj[n] = parseInt(m[1], 10);
    }
    return { geom: hasPreset(name) ? name : 'rect', adj, unknown: hasPreset(name) ? null : name };
  }
  const cust = xml.ch(spPr, 'custGeom');
  if (cust) {
    const paths = [];
    for (const path of xml.chAll(xml.ch(cust, 'pathLst'), 'path')) {
      const cmds = [];
      for (let c = path.firstElementChild; c; c = c.nextElementSibling) {
        const t = c.localName;
        if (t === 'close') { cmds.push({ t: 'close' }); continue; }
        if (t === 'arcTo') {
          cmds.push({ t: 'arcTo', wR: xml.num(c, 'wR', 0), hR: xml.num(c, 'hR', 0), stAng: xml.num(c, 'stAng', 0), swAng: xml.num(c, 'swAng', 0) });
          continue;
        }
        if (t === 'moveTo' || t === 'lnTo' || t === 'cubicBezTo' || t === 'quadBezTo') {
          const pts = xml.chAll(c, 'pt').map((p) => ({ x: xml.num(p, 'x', 0), y: xml.num(p, 'y', 0) }));
          cmds.push({ t, pts });
        }
      }
      paths.push({ w: xml.num(path, 'w', 0), h: xml.num(path, 'h', 0), cmds });
    }
    /* arcTo radii and custGeom point coordinates share the path's own space;
       scaling happens at draw time in custGeomPath. */
    return { geom: 'custom', adj: {}, custPath: paths.length ? paths : null };
  }
  return { geom: null, adj: {} };
}

/* ---------- the shape tree ---------- */

function importShape(node, ctx, acc, xform, groupId) {
  const kind = node.localName;
  if (kind === 'grpSp') return importGroup(node, ctx, acc, xform);

  const nv = xml.ch(node, kind === 'pic' ? 'nvPicPr' : kind === 'graphicFrame' ? 'nvGraphicFramePr' : kind === 'cxnSp' ? 'nvCxnSpPr' : 'nvSpPr');
  const cNv = xml.ch(nv, 'cNvPr');
  const name = (cNv && xml.att(cNv, 'name')) || '';
  if (cNv && (xml.att(cNv, 'hidden') === '1')) return;

  const spPr = xml.ch(node, kind === 'pic' ? 'spPr' : kind === 'graphicFrame' ? null : 'spPr');
  const ph = phOf(node);

  /* Position: the shape's own xfrm, else the matching placeholder on the
     layout, else on the master. */
  let xf = parseXfrm(spPr ? xml.ch(spPr, 'xfrm') : null);
  if (kind === 'graphicFrame') xf = parseXfrm(xml.ch(node, 'xfrm'));
  let inheritLst = null;
  if (ph) {
    const lSp = findPhShape(ctx.layoutTree, ph);
    const mSp = findPhShape(ctx.masterTree, ph);
    if (!xf) xf = parseXfrm(xml.path(lSp, 'spPr', 'xfrm')) || parseXfrm(xml.path(mSp, 'spPr', 'xfrm'));
    /* Text defaults: master txStyles for the placeholder's family, then the
       layout placeholder's own lstStyle, then the master placeholder's. */
    const fam = (ph.type === 'title' || ph.type === 'ctrTitle') ? ctx.titleStyle
      : (ph.type === 'body' || ph.type === 'subTitle' || ph.type === 'obj') ? ctx.bodyStyle : ctx.otherStyle;
    inheritLst = mergeLst(fam, mergeLst(parseLstStyle(xml.path(mSp, 'txBody', 'lstStyle'), ctx), parseLstStyle(xml.path(lSp, 'txBody', 'lstStyle'), ctx)));
  }
  if (!xf) xf = { x: 0, y: 0, w: 0, h: 0, rot: 0, flipH: false, flipV: false };
  const box = applyXform(xf, xform);

  if (kind === 'pic') {
    const src = blipToDataUrl(xml.ch(node, 'blipFill'), ctx);
    if (!src) { ctx.report.droppedImages += 1; return; }
    const e = mkElement('image', {
      name: name || 'Picture', src,
      x: box.x, y: box.y, w: box.w, h: box.h, rot: box.rot, flipH: box.flipH, flipV: box.flipV,
      line: parseLine(spPr, ctx), shadow: parseShadow(spPr)
    });
    const sr = xml.desc(xml.ch(node, 'blipFill'), 'srcRect');
    if (sr) {
      const c = {
        l: (xml.num(sr, 'l', 0) || 0) / 100000, t: (xml.num(sr, 't', 0) || 0) / 100000,
        r: (xml.num(sr, 'r', 0) || 0) / 100000, b: (xml.num(sr, 'b', 0) || 0) / 100000
      };
      if (c.l || c.t || c.r || c.b) e.crop = c;
    }
    const g = parseGeom(spPr);
    if (g.geom === 'roundRect') e.round = Math.min(box.w, box.h) * 0.1;
    if (groupId) e.groupId = groupId;
    acc.push(e);
    return;
  }

  if (kind === 'graphicFrame') {
    const data = xml.path(node, 'graphic', 'graphicData');
    const uri = xml.att(data, 'uri') || '';
    const tbl = xml.ch(data, 'tbl');
    if (tbl) { importTable(tbl, box, name, ctx, acc, groupId); return; }
    if (/diagram/i.test(uri)) { importDiagram(data, box, ctx, acc); return; }
    if (/chart/i.test(uri)) {
      ctx.report.charts += 1;
      acc.push(chartPlaceholder(box, data, ctx, groupId));
      return;
    }
    if (/oleObject|media/i.test(uri)) { ctx.report.embedded += 1; return; }
    return;
  }

  /* sp and cxnSp */
  const g = parseGeom(spPr);
  if (g.unknown) ctx.report.unknownGeoms.add(g.unknown);
  const txb = xml.ch(node, 'txBody');
  const body = parseTxBody(txb, ctx, inheritLst);
  const fill = parseFill(spPr, ctx);
  const line = parseLine(spPr, ctx);
  const openish = kind === 'cxnSp' || isOpenGeom(g.geom);

  /* A placeholder with no text contributes nothing but an empty frame; keep
     it only if it carries a visible fill or outline. */
  const empty = !body || bodyIsEmpty(body);
  const invisible = (!fill || fill.type === 'none') && (!line || line.type === 'none');
  if (ph && empty && invisible) return;
  if (!ph && empty && invisible && !g.custPath && kind === 'sp' && (!g.geom || g.geom === 'rect')) return;

  /* Inherit a fill and outline from the theme's shape style when the shape
     declares none — <p:style> is how Office stores "default accent shape". */
  let effFill = fill, effLine = line;
  const style = xml.ch(node, 'style');
  if (style) {
    if (!effFill) {
      const ref = xml.ch(style, 'fillRef');
      const c = parseColorEl(ref);
      const idx = xml.num(ref, 'idx', 0);
      if (c && idx > 0) effFill = { type: 'solid', color: c };
    }
    if (!effLine) {
      const ref = xml.ch(style, 'lnRef');
      const c = parseColorEl(ref);
      if (c) effLine = { color: c, w: 1, dash: 'solid' };
    }
    if (body) {
      const fr = xml.ch(style, 'fontRef');
      const c = parseColorEl(fr);
      if (c) for (const p of body.paragraphs) {
        p.defRPr = Object.assign({ color: c }, p.defRPr);
        for (const r of p.runs) if (r.color === undefined) r.color = deepCopy(c);
      }
    }
  }

  /* Text box or shape? PowerPoint marks a real text box with txBox="1", and
     anything that is a plain rectangle with neither fill nor outline is one in
     effect. Getting this right is what makes a round trip stable: a text box
     exported with txBox="1" has to come back as a text box, not as an
     invisible rectangle. */
  const isTxBox = xml.bool(xml.ch(node, 'cNvSpPr'), 'txBox', false);
  const plainRect = (!g.geom || g.geom === 'rect') && !g.custPath
    && (!effFill || effFill.type === 'none') && (!effLine || effLine.type === 'none');
  const type = openish ? 'line' : ((isTxBox || plainRect) ? 'text' : 'shape');
  const e = mkElement(type === 'line' ? 'line' : type, {
    name: name || undefined,
    x: box.x, y: box.y, w: box.w, h: box.h, rot: box.rot, flipH: box.flipH, flipV: box.flipV,
    geom: g.geom === 'custom' ? 'rect' : (g.geom || 'rect'),
    adj: g.adj,
    custPath: g.custPath || null,
    fill: openish ? { type: 'none' } : (effFill || { type: 'none' }),
    line: effLine,
    shadow: parseShadow(spPr),
    body: body || null
  });
  if (ph) e.ph = { type: ph.type, idx: ph.idx === null ? 0 : ph.idx };
  if (groupId) e.groupId = groupId;
  /* Flatten run sizes so nothing depends on an inheritance chain later. */
  if (e.body) fillDefaultSizes(e.body, ph ? ph.type : null, ctx);
  acc.push(e);
}

/* Every run gets an explicit size, font and colour, taken from the resolved
   chain or from the format's documented defaults. */
function fillDefaultSizes(body, phType, ctx) {
  const dfltSz = (phType === 'title' || phType === 'ctrTitle') ? 44 : 18;
  for (const p of body.paragraphs || []) {
    const d = p.defRPr || {};
    for (const r of p.runs || []) {
      if (r.br) continue;
      if (r.sz === undefined) r.sz = d.sz !== undefined ? d.sz : dfltSz;
      if (r.font === undefined && d.font !== undefined) r.font = d.font;
      if (r.color === undefined && d.color !== undefined) r.color = deepCopy(d.color);
      if (r.b === undefined && d.b !== undefined) r.b = d.b;
      if (r.i === undefined && d.i !== undefined) r.i = d.i;
    }
  }
}

function importGroup(node, ctx, acc, xform) {
  const gsp = xml.ch(node, 'grpSpPr');
  const xf = xml.ch(gsp, 'xfrm');
  const off = xml.ch(xf, 'off'), ext = xml.ch(xf, 'ext');
  const chOff = xml.ch(xf, 'chOff'), chExt = xml.ch(xf, 'chExt');
  /* Child coordinates live in the group's child space; map them into the
     parent's space once, here, so the model stays flat. */
  const next = composeXform(xform, {
    ox: emuToPt(xml.num(off, 'x', 0)), oy: emuToPt(xml.num(off, 'y', 0)),
    cx: emuToPt(xml.num(chOff, 'x', 0)), cy: emuToPt(xml.num(chOff, 'y', 0)),
    sx: (xml.num(chExt, 'cx', 0) ? xml.num(ext, 'cx', 0) / xml.num(chExt, 'cx', 1) : 1),
    sy: (xml.num(chExt, 'cy', 0) ? xml.num(ext, 'cy', 0) / xml.num(chExt, 'cy', 1) : 1),
    rot: angToDeg(xml.num(xf, 'rot', 0))
  });
  const gid = uid('grp');
  const before = acc.length;
  for (let c = node.firstElementChild; c; c = c.nextElementSibling) {
    if (['sp', 'pic', 'graphicFrame', 'cxnSp', 'grpSp'].indexOf(c.localName) >= 0) importShape(c, ctx, acc, next, gid);
  }
  /* A group of one is not a group. */
  if (acc.length - before === 1) delete acc[before].groupId;
}
function composeXform(outer, inner) {
  if (!outer) return inner;
  return {
    ox: outer.ox + (inner.ox - outer.cx) * outer.sx,
    oy: outer.oy + (inner.oy - outer.cy) * outer.sy,
    cx: inner.cx, cy: inner.cy,
    sx: outer.sx * inner.sx, sy: outer.sy * inner.sy,
    rot: (outer.rot || 0) + (inner.rot || 0)
  };
}
function applyXform(xf, xform) {
  if (!xform) return xf;
  return {
    x: round2(xform.ox + (xf.x - xform.cx) * xform.sx),
    y: round2(xform.oy + (xf.y - xform.cy) * xform.sy),
    w: round2(xf.w * xform.sx),
    h: round2(xf.h * xform.sy),
    rot: round2((xf.rot || 0) + (xform.rot || 0)),
    flipH: xf.flipH, flipV: xf.flipV
  };
}

/* ---------- tables ---------- */

function importTable(tbl, box, name, ctx, acc, groupId) {
  const grid = xml.chAll(xml.ch(tbl, 'tblGrid'), 'gridCol').map((g) => round2(emuToPt(xml.num(g, 'w', 914400))));
  const tblPr = xml.ch(tbl, 'tblPr');
  const rows = [];
  for (const tr of xml.chAll(tbl, 'tr')) {
    const cells = [];
    for (const tc of xml.chAll(tr, 'tc')) {
      const tcPr = xml.ch(tc, 'tcPr');
      const body = parseTxBody(xml.ch(tc, 'txBody'), ctx, null) || mkBody([mkPara([mkRun('')])]);
      if (tcPr) {
        const an = xml.att(tcPr, 'anchor');
        if (an === 'ctr' || an === 'b' || an === 't') body.anchor = an;
        body.ins = {
          l: round2(emuToPt(xml.num(tcPr, 'marL', 91440))), t: round2(emuToPt(xml.num(tcPr, 'marT', 45720))),
          r: round2(emuToPt(xml.num(tcPr, 'marR', 91440))), b: round2(emuToPt(xml.num(tcPr, 'marB', 45720)))
        };
      }
      fillDefaultSizes(body, null, ctx);
      const f = parseFill(tcPr, ctx);
      cells.push({
        body,
        fill: f && f.type === 'solid' ? f.color : null,
        span: xml.num(tc, 'gridSpan', 1) | 0,
        rowSpan: xml.num(tc, 'rowSpan', 1) | 0,
        /* hMerge / vMerge mark the cells swallowed by a span. */
        merged: xml.bool(tc, 'hMerge', false) || xml.bool(tc, 'vMerge', false)
      });
    }
    while (cells.length < grid.length) cells.push({ body: mkBody([mkPara([mkRun('')])]), fill: null, span: 1, rowSpan: 1 });
    rows.push({ h: round2(emuToPt(xml.num(tr, 'h', 274320))), cells });
  }
  if (!rows.length || !grid.length) return;
  const e = mkElement('table', {
    name: name || 'Table', x: box.x, y: box.y, rot: box.rot,
    table: { cols: grid, rows },
    firstRow: xml.bool(tblPr, 'firstRow', false),
    bandRow: xml.bool(tblPr, 'bandRow', false),
    borderW: 0.75
  });
  syncTableSize(e);
  /* Honour the frame's declared size over the sum of the grid when they
     disagree, which happens when a table was resized in PowerPoint. */
  if (box.w > 4 && Math.abs(box.w - e.w) > 1) {
    const k = box.w / e.w;
    e.table.cols = e.table.cols.map((c) => round2(c * k));
    syncTableSize(e);
  }
  if (groupId) e.groupId = groupId;
  acc.push(e);
}

/* ---------- SmartArt ----------
   A diagram stores its own data model, but PowerPoint also writes a plain
   drawing of it. That fallback uses the same shape grammar, so reading it
   turns SmartArt into ordinary shapes the user can edit. */
function importDiagram(data, box, ctx, acc) {
  const relIds = xml.desc(data, 'relIds');
  const dmId = relIds && (xml.att(relIds, 'dm') || null);
  /* `dm` is itself namespaced (r:dm) in some producers. */
  const dmAlt = relIds && !dmId ? (function () {
    const at = relIds.attributes;
    for (let i = 0; i < at.length; i++) if (at[i].localName === 'dm') return at[i].value;
    return null;
  })() : dmId;
  let drawingPath = null;
  /* The drawing is related from the slide, usually by the diagramDrawing
     relationship type. */
  for (const [, rel] of ctx.rels) {
    if (/diagramDrawing/i.test(rel.type)) { drawingPath = rel.abs; break; }
  }
  if (!drawingPath && dmAlt) {
    const dm = ctx.rels.get(dmAlt);
    if (dm) drawingPath = dm.abs.replace(/data(\d*)\.xml$/, 'drawing$1.xml');
  }
  const t = drawingPath && pkgText(ctx.files, drawingPath);
  if (!t) { ctx.report.smartArtDropped += 1; return; }
  let doc;
  try { doc = xml.parse(t); } catch (e) { ctx.report.smartArtDropped += 1; return; }
  const spTree = xml.desc(doc.documentElement, 'spTree') || doc.documentElement;
  const gid = uid('grp');
  const before = acc.length;
  /* dsp: shapes carry absolute coordinates already, within the frame. */
  const sub = [];
  for (const sp of xml.descAll(spTree, 'sp')) {
    if (sp.parentNode !== spTree && sp.parentNode.localName !== 'spTree') continue;
    importShape(sp, ctx, sub, null, gid);
  }
  if (!sub.length) { ctx.report.smartArtDropped += 1; return; }
  /* Offset the whole drawing into the frame's position. */
  const b = unionRect(sub.map((e) => ({ x: e.x, y: e.y, w: e.w, h: e.h })));
  const kx = b.w > 1 && box.w > 1 ? box.w / b.w : 1;
  const ky = b.h > 1 && box.h > 1 ? box.h / b.h : 1;
  for (const e of sub) {
    e.x = round2(box.x + (e.x - b.x) * kx);
    e.y = round2(box.y + (e.y - b.y) * ky);
    e.w = round2(e.w * kx); e.h = round2(e.h * ky);
    acc.push(e);
  }
  ctx.report.smartArt += 1;
  if (acc.length - before === 1) delete acc[before].groupId;
}

function chartPlaceholder(box, data, ctx, groupId) {
  let title = 'Chart';
  const rid = xml.rid(xml.ch(data, 'chart'));
  const rel = rid && ctx.rels.get(rid);
  if (rel) {
    const t = pkgText(ctx.files, rel.abs);
    if (t) {
      try {
        const doc = xml.parse(t);
        const ti = xml.desc(xml.desc(doc.documentElement, 'title'), 'rich');
        const txt = ti ? xml.descAll(ti, 't').map((n) => n.textContent).join('') : '';
        if (txt.trim()) title = txt.trim();
      } catch (e) { /* keep the generic label */ }
    }
  }
  const e = mkElement('shape', {
    name: 'Chart (not imported)', x: box.x, y: box.y, w: box.w, h: box.h, geom: 'rect',
    fill: { type: 'solid', color: { scheme: 'tx1', lumMod: 7000, lumOff: 93000 } },
    line: { color: { scheme: 'tx1', lumMod: 30000, lumOff: 70000 }, w: 1, dash: 'dash' },
    body: mkBody([
      mkPara([mkRun(title, { sz: 16, b: true, color: { scheme: 'tx1', lumMod: 70000, lumOff: 30000 } })], { align: 'ctr' }),
      mkPara([mkRun('chart not imported', { sz: 11, color: { scheme: 'tx1', lumMod: 55000, lumOff: 45000 } })], { align: 'ctr' })
    ], { anchor: 'ctr' })
  });
  if (groupId) e.groupId = groupId;
  return e;
}

/* ---------- background ---------- */

function parseBackground(cSld, ctx) {
  const bg = xml.ch(cSld, 'bg');
  if (!bg) return null;
  const bgPr = xml.ch(bg, 'bgPr');
  if (bgPr) {
    const f = parseFill(bgPr, ctx);
    if (f && f.type !== 'none') return f;
    if (f && f.type === 'none') return { type: 'none' };
  }
  const ref = xml.ch(bg, 'bgRef');
  if (ref) {
    /* bgRef points at the theme's background fill list. Resolving the full
       fill is deep; the colour it carries is the part that matters visually. */
    const c = parseColorEl(ref);
    if (c) return { type: 'solid', color: c };
  }
  return null;
}

/* ---------- theme ---------- */

function parseTheme(files, themePath) {
  const t = themePath && pkgText(files, themePath);
  if (!t) return null;
  let doc;
  try { doc = xml.parse(t); } catch (e) { return null; }
  const el0 = xml.ch(doc.documentElement, 'themeElements');
  const cs = xml.ch(el0, 'clrScheme');
  const colors = {};
  if (cs) {
    for (const slot of ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink']) {
      const node = xml.ch(cs, slot);
      const c = parseColorEl(node);
      if (c && c.hex) colors[slot] = c.hex;
      else if (c && c.scheme) colors[slot] = null;
    }
  }
  const fs = xml.ch(el0, 'fontScheme');
  const major = xml.att(xml.ch(xml.ch(fs, 'majorFont'), 'latin'), 'typeface');
  const minor = xml.att(xml.ch(xml.ch(fs, 'minorFont'), 'latin'), 'typeface');
  const name = xml.att(doc.documentElement, 'name') || 'Imported theme';
  return themeFromScheme(name, colors, { major: major || null, minor: minor || null });
}

/* ---------- entry point ---------- */

async function importPptx(arrayBuffer, fileName) {
  const { files } = await unzip(arrayBuffer);

  /* Find the presentation part through the package relationships rather than
     assuming ppt/presentation.xml — the path is conventional, not required. */
  let presPath = 'ppt/presentation.xml';
  const rootT = pkgText(files, '_rels/.rels');
  if (rootT) {
    try {
      const doc = xml.parse(rootT);
      for (const r of xml.chAll(doc.documentElement, 'Relationship')) {
        if (/officeDocument$/i.test(xml.att(r, 'Type') || '')) presPath = resolvePart('x', xml.att(r, 'Target'));
      }
    } catch (e) { /* fall back to the conventional path */ }
  }
  const presT = pkgText(files, presPath) || pkgText(files, 'ppt/presentation.xml');
  if (!presT) {
    throw new Error('This file does not contain a presentation part. If it is a .ppt (the pre-2007 format), open it in PowerPoint once and save it as .pptx.');
  }
  const presDoc = xml.parse(presT);
  const presRels = readRels(files, presPath);

  const sz = xml.ch(presDoc.documentElement, 'sldSz');
  const W = sz ? round2(emuToPt(xml.num(sz, 'cx', 12192000))) : 960;
  const H = sz ? round2(emuToPt(xml.num(sz, 'cy', 6858000))) : 540;

  /* Theme, via the first master. */
  const masterIds = xml.chAll(xml.ch(presDoc.documentElement, 'sldMasterIdLst'), 'sldMasterId');
  let themeObj = null, masterDoc = null, masterPath = null, masterRels = null;
  if (masterIds.length) {
    const mRel = presRels.get(xml.rid(masterIds[0]));
    if (mRel) {
      masterPath = mRel.abs;
      const mt = pkgText(files, masterPath);
      if (mt) {
        try { masterDoc = xml.parse(mt); } catch (e) { masterDoc = null; }
        masterRels = readRels(files, masterPath);
        for (const [, r] of masterRels) if (/theme$/i.test(r.type)) themeObj = parseTheme(files, r.abs);
      }
    }
  }
  if (!themeObj) {
    for (const k of files.keys()) if (/^ppt\/theme\/theme1\.xml$/.test(k)) themeObj = parseTheme(files, k);
  }

  const report = {
    slides: 0, charts: 0, smartArt: 0, smartArtDropped: 0, droppedImages: 0,
    metafiles: 0, embedded: 0, unknownGeoms: new Set(), notes: 0
  };

  const masterTree = masterDoc ? xml.desc(masterDoc.documentElement, 'spTree') : null;
  const txStyles = masterDoc ? xml.ch(masterDoc.documentElement, 'txStyles') : null;

  const deck = mkDeck({
    title: (fileName || 'Imported deck').replace(/\.pptx?$/i, ''),
    size: { w: W, h: H },
    theme: themeObj || null,
    themeId: themeObj ? 'imported' : 'graphite',
    slides: []
  });

  const sldIds = xml.chAll(xml.ch(presDoc.documentElement, 'sldIdLst'), 'sldId');
  const mediaCache = new Map();

  for (const sid of sldIds) {
    const rel = presRels.get(xml.rid(sid));
    if (!rel) continue;
    const st = pkgText(files, rel.abs);
    if (!st) continue;
    let sdoc;
    try { sdoc = xml.parse(st); } catch (e) { report.slides += 0; continue; }
    const slideRels = readRels(files, rel.abs);

    /* The layout this slide uses, and through it the master. */
    let layoutDoc = null, layoutRels = null;
    for (const [, r] of slideRels) if (/slideLayout$/i.test(r.type)) {
      const lt = pkgText(files, r.abs);
      if (lt) { try { layoutDoc = xml.parse(lt); layoutRels = readRels(files, r.abs); } catch (e) { layoutDoc = null; } }
    }
    const layoutTree = layoutDoc ? xml.desc(layoutDoc.documentElement, 'spTree') : null;

    const ctx = {
      files, rels: slideRels, mediaCache, report,
      layoutTree, masterTree,
      titleStyle: parseLstStyle(xml.ch(txStyles, 'titleStyle')),
      bodyStyle: parseLstStyle(xml.ch(txStyles, 'bodyStyle')),
      otherStyle: parseLstStyle(xml.ch(txStyles, 'otherStyle'))
    };

    const cSld = xml.ch(sdoc.documentElement, 'cSld');
    const slide = mkSlide({ layout: 'blank' });
    /* Background: the slide's own, else the layout's, else the master's. */
    slide.bg = parseBackground(cSld, ctx)
      || (layoutDoc ? parseBackground(xml.ch(layoutDoc.documentElement, 'cSld'), Object.assign({}, ctx, { rels: layoutRels || slideRels })) : null)
      || (masterDoc ? parseBackground(xml.ch(masterDoc.documentElement, 'cSld'), Object.assign({}, ctx, { rels: masterRels || slideRels })) : null);

    /* Layout and master shapes that are not placeholders are part of the
       design and have to be drawn, beneath the slide's own content. */
    const acc = [];
    if (masterTree && xml.bool(sdoc.documentElement, 'showMasterSp', true)) {
      const mctx = Object.assign({}, ctx, { rels: masterRels || slideRels });
      for (let c = masterTree.firstElementChild; c; c = c.nextElementSibling) {
        if (['sp', 'pic', 'graphicFrame', 'cxnSp', 'grpSp'].indexOf(c.localName) < 0) continue;
        if (phOf(c)) continue;
        importShape(c, mctx, acc, null, null);
      }
    }
    if (layoutTree) {
      const lctx = Object.assign({}, ctx, { rels: layoutRels || slideRels });
      for (let c = layoutTree.firstElementChild; c; c = c.nextElementSibling) {
        if (['sp', 'pic', 'graphicFrame', 'cxnSp', 'grpSp'].indexOf(c.localName) < 0) continue;
        if (phOf(c)) continue;
        importShape(c, lctx, acc, null, null);
      }
    }
    const spTree = xml.ch(cSld, 'spTree');
    if (spTree) {
      for (let c = spTree.firstElementChild; c; c = c.nextElementSibling) {
        if (['sp', 'pic', 'graphicFrame', 'cxnSp', 'grpSp'].indexOf(c.localName) < 0) continue;
        importShape(c, ctx, acc, null, null);
      }
    }
    slide.elements = acc.map(normalizeElement).filter(Boolean);

    /* Speaker notes. */
    for (const [, r] of slideRels) if (/notesSlide$/i.test(r.type)) {
      const nt = pkgText(files, r.abs);
      if (!nt) continue;
      try {
        const ndoc = xml.parse(nt);
        const trees = xml.desc(ndoc.documentElement, 'spTree');
        let text = '';
        for (const sp of xml.chAll(trees, 'sp')) {
          const ph = phOf(sp);
          if (ph && ph.type !== 'body') continue;
          const tb = xml.ch(sp, 'txBody');
          if (!tb) continue;
          const lines = xml.chAll(tb, 'p').map((p) => xml.descAll(p, 't').map((t) => t.textContent).join(''));
          const joined = lines.join('\n').trim();
          if (joined) text += (text ? '\n' : '') + joined;
        }
        if (text) { slide.notes = text; report.notes += 1; }
      } catch (e) { /* notes are optional */ }
    }

    deck.slides.push(slide);
    report.slides += 1;
  }

  if (!deck.slides.length) throw new Error('No slides were found in this file.');
  /* Title from the document properties when it has one. */
  const core = pkgText(files, 'docProps/core.xml');
  if (core) {
    try {
      const cdoc = xml.parse(core);
      const t = xml.desc(cdoc.documentElement, 'title');
      if (t && t.textContent.trim()) deck.title = t.textContent.trim();
    } catch (e) { /* keep the filename */ }
  }
  return { deck: normalizeDeck(deck), report };
}

function describeImport(report) {
  const bits = [report.slides + (report.slides === 1 ? ' slide' : ' slides')];
  if (report.notes) bits.push(report.notes + ' with notes');
  if (report.smartArt) bits.push(report.smartArt + ' SmartArt converted to shapes');
  const warn = [];
  if (report.charts) warn.push(report.charts + (report.charts === 1 ? ' chart' : ' charts') + ' left as a labelled frame');
  if (report.smartArtDropped) warn.push(report.smartArtDropped + ' SmartArt could not be read');
  if (report.metafiles) warn.push(report.metafiles + ' EMF/WMF image' + (report.metafiles === 1 ? '' : 's') + ' skipped');
  if (report.droppedImages) warn.push(report.droppedImages + ' image' + (report.droppedImages === 1 ? '' : 's') + ' missing from the file');
  if (report.embedded) warn.push(report.embedded + ' embedded object' + (report.embedded === 1 ? '' : 's') + ' skipped');
  if (report.unknownGeoms && report.unknownGeoms.size) {
    const list = Array.from(report.unknownGeoms).slice(0, 3).join(', ');
    warn.push(report.unknownGeoms.size + ' unsupported shape type' + (report.unknownGeoms.size === 1 ? '' : 's') + ' drawn as rectangles (' + list + ')');
  }
  return { summary: bits.join(', '), warnings: warn };
}
