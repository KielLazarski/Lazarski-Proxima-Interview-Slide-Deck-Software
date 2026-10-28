/* ==========================================================================
   25-render.js — slide to DOM.

   One renderer serves the editing canvas, the sidebar thumbnails, present mode
   and the print sheet that becomes the PDF. They differ only in scale and in
   whether interaction hooks are attached, so what you see while editing is
   literally the same drawing you project and export.

   Slides render at 1pt = 1px and are scaled with a CSS transform. Text is
   therefore measured at its true size no matter the zoom, which is what keeps
   autofit stable — measuring inside a scaled box is the usual reason text
   jumps when you zoom.
   ========================================================================== */

function slideBackgroundCss(slide, deck) {
  const theme = deckTheme(deck);
  const bg = slide && slide.bg;
  if (!bg || bg.type === 'none') return theme.bg || '#FFFFFF';
  if (bg.type === 'solid') return cssColorOr(bg.color, theme, theme.bg || '#FFFFFF');
  if (bg.type === 'gradient' && bg.stops && bg.stops.length) {
    const stops = bg.stops.map((s) => cssColorOr(s.color, theme, 'transparent') + ' ' + round2(s.pos / 1000) + '%').join(',');
    return 'linear-gradient(' + ((bg.angle || 0) + 90) + 'deg,' + stops + ')';
  }
  if (bg.type === 'image' && bg.src) return 'center/cover no-repeat url("' + bg.src + '")';
  return theme.bg || '#FFFFFF';
}

/* --------------------------------------------------------------------------
   Fills, lines and effects
   -------------------------------------------------------------------------- */

function fillToSvg(fill, theme, defs, idBase) {
  if (!fill || fill.type === 'none') return 'none';
  if (fill.type === 'solid') return cssColorOr(fill.color, theme, 'none');
  if (fill.type === 'gradient' && fill.stops && fill.stops.length) {
    const id = idBase + '_g';
    const ang = (fill.angle || 0);
    const rad = (ang - 90) * Math.PI / 180;    /* OOXML 0° points right; SVG vector is from the centre */
    const dx = Math.cos(rad) / 2, dy = Math.sin(rad) / 2;
    const lg = svgEl(fill.path === 'circle' ? 'radialGradient' : 'linearGradient', fill.path === 'circle'
      ? { id, cx: '50%', cy: '50%', r: '70%' }
      : { id, x1: round2(50 - dx * 100) + '%', y1: round2(50 - dy * 100) + '%', x2: round2(50 + dx * 100) + '%', y2: round2(50 + dy * 100) + '%' });
    for (const s of fill.stops) {
      lg.appendChild(svgEl('stop', { offset: round2(clamp(s.pos / 1000, 0, 100)) + '%', 'stop-color': resolveColor(s.color, theme) || '#000', 'stop-opacity': round2(colorAlpha(s.color)) }));
    }
    defs.appendChild(lg);
    return 'url(#' + id + ')';
  }
  if (fill.type === 'pattern') {
    /* Pattern fills are approximated by their foreground colour at partial
       strength — closer than dropping the fill, honest about not hatching. */
    const fg = resolveColor(fill.color, theme) || '#888';
    const bgc = resolveColor(fill.bgColor, theme) || '#FFF';
    return mixHex(bgc, fg, 0.5);
  }
  if (fill.type === 'image' && fill.src) {
    const id = idBase + '_p';
    const pat = svgEl('pattern', { id, patternUnits: 'objectBoundingBox', width: 1, height: 1 });
    pat.appendChild(svgEl('image', { href: fill.src, x: 0, y: 0, width: 1, height: 1, preserveAspectRatio: 'xMidYMid slice' }));
    defs.appendChild(pat);
    return 'url(#' + id + ')';
  }
  return 'none';
}

const DASH_ARRAY = {
  solid: null, dot: '1 3', dash: '4 3', lgDash: '8 3', dashDot: '4 3 1 3',
  lgDashDot: '8 3 1 3', lgDashDotDot: '8 3 1 3 1 3', sysDash: '3 3', sysDot: '1 1',
  sysDashDot: '3 3 1 3', sysDashDotDot: '3 3 1 3 1 3'
};

function applyLineToSvg(node, line, theme, strokeW) {
  if (!line || line.type === 'none') { node.setAttribute('stroke', 'none'); return; }
  node.setAttribute('stroke', cssColorOr(line.color, theme, theme.fg || '#000000'));
  node.setAttribute('stroke-width', strokeW === undefined ? (line.w || 1) : strokeW);
  const da = DASH_ARRAY[line.dash || 'solid'];
  if (da) {
    const w = Math.max(0.5, line.w || 1);
    node.setAttribute('stroke-dasharray', da.split(' ').map((v) => round2(+v * w)).join(' '));
  }
  if (line.cap) node.setAttribute('stroke-linecap', line.cap === 'rnd' ? 'round' : line.cap === 'sq' ? 'square' : 'butt');
  if (line.join) node.setAttribute('stroke-linejoin', line.join === 'round' ? 'round' : line.join === 'bevel' ? 'bevel' : 'miter');
}

/* Arrowheads. Markers are defined per element so each can take the line's own
   colour; `context-stroke` is not reliable enough across engines to lean on. */
function arrowMarker(defs, id, kind, size, color, atEnd) {
  if (!kind || kind === 'none') return null;
  const s = clamp(size || 4, 2, 12);
  const m = svgEl('marker', {
    id, markerWidth: s * 2.5, markerHeight: s * 2.5, refX: atEnd ? s * 2 : s * 0.5, refY: s,
    orient: 'auto-start-reverse', markerUnits: 'strokeWidth'
  });
  let d;
  if (kind === 'triangle' || kind === 'arrow') d = 'M0,0L' + (s * 2) + ',' + s + 'L0,' + (s * 2) + 'Z';
  else if (kind === 'stealth') d = 'M0,0L' + (s * 2) + ',' + s + 'L0,' + (s * 2) + 'L' + (s * 0.7) + ',' + s + 'Z';
  else if (kind === 'diamond') d = 'M0,' + s + 'L' + s + ',0L' + (s * 2) + ',' + s + 'L' + s + ',' + (s * 2) + 'Z';
  else if (kind === 'oval') d = 'M' + s + ',0A' + s + ',' + s + ' 0 1 0 ' + s + ',' + (s * 2) + 'A' + s + ',' + s + ' 0 1 0 ' + s + ',0Z';
  else d = 'M0,0L' + (s * 2) + ',' + s + 'L0,' + (s * 2);
  const p = svgEl('path', { d, fill: kind === 'open' ? 'none' : color, stroke: kind === 'open' ? color : 'none', 'stroke-width': 1 });
  m.appendChild(p);
  defs.appendChild(m);
  return id;
}

function shadowFilterCss(sh, theme) {
  if (!sh || sh.type === 'none') return '';
  const col = cssColorOr(sh.color || { hex: '#000000', alpha: 40000 }, theme, 'rgba(0,0,0,.4)');
  const dist = sh.dist || 3, dir = (sh.dir || 45) * Math.PI / 180;
  const dx = round2(Math.cos(dir) * dist), dy = round2(Math.sin(dir) * dist);
  return 'drop-shadow(' + dx + 'px ' + dy + 'px ' + round2((sh.blur || 4) / 2) + 'px ' + col + ')';
}

/* --------------------------------------------------------------------------
   Text
   -------------------------------------------------------------------------- */

function runStyle(r, theme, inherit) {
  const s = {};
  const base = inherit || {};
  const sz = r.sz !== undefined ? r.sz : base.sz;
  s.fontSize = (sz || 18) + 'px';
  const fam = r.font !== undefined ? r.font : base.font;
  s.fontFamily = fontStack(fam, theme);
  const b = r.b !== undefined ? r.b : base.b;
  const i = r.i !== undefined ? r.i : base.i;
  if (b) s.fontWeight = '700';
  if (i) s.fontStyle = 'italic';
  const dec = [];
  const u = r.u !== undefined ? r.u : base.u;
  const st = r.strike !== undefined ? r.strike : base.strike;
  if (u && u !== 'none') dec.push('underline');
  if (st && st !== 'noStrike') dec.push('line-through');
  if (dec.length) s.textDecoration = dec.join(' ');
  const col = r.color !== undefined ? r.color : base.color;
  /* Text with no colour of its own takes the theme's text colour. An imported
     deck very often leaves run colour to be inherited, so this fallback is the
     normal path, not an edge case. */
  s.color = cssColorOr(col, theme, theme.fg || '#000000');
  const caps = r.caps !== undefined ? r.caps : base.caps;
  if (caps === 'all') s.textTransform = 'uppercase';
  else if (caps === 'small') s.fontVariantCaps = 'small-caps';
  const spc = r.spc !== undefined ? r.spc : base.spc;
  if (spc) s.letterSpacing = round2(spc / 100) + 'px';
  if (r.baseline) {
    s.verticalAlign = r.baseline > 0 ? 'super' : 'sub';
    s.fontSize = round2((sz || 18) * 0.62) + 'px';
  }
  const hl = r.highlight !== undefined ? r.highlight : base.highlight;
  if (hl) { const h = cssColor(hl, theme); if (h) s.background = h; }
  return s;
}

const ALIGN_CSS = { l: 'left', ctr: 'center', r: 'right', just: 'justify', dist: 'justify' };

function renderParagraph(p, body, theme, numState, scale, pi) {
  const k = scale === undefined ? 1 : scale;
  const first = (p.runs || []).find((r) => !r.br) || {};
  const defSz = ((first.sz || (p.defRPr && p.defRPr.sz) || 18));
  /* data-pi / data-ri tag every block and run with its index in the model.
     The text editor reads them back to tell which run a character came from,
     which is how a colour stored as a theme reference survives an edit that
     did not touch the colour. */
  const div = el('div', { class: 'sp-para', dataset: pi === undefined ? null : { pi: String(pi) } });
  div.style.textAlign = ALIGN_CSS[p.align || 'l'] || 'left';
  /* data-b* records the unscaled value of anything autofit will shrink. The
     shrink pass rewrites the inline style from it, which is the only way to
     win against the inline sizes set below — a stylesheet multiplier loses to
     an inline declaration, and that mistake makes autofit silently do nothing. */
  if (p.lnSpc !== undefined && p.lnSpc !== null) {
    if (typeof p.lnSpc === 'object' && p.lnSpc.pts) {
      div.style.lineHeight = round2(p.lnSpc.pts * k) + 'px';
      div.dataset.blh = String(p.lnSpc.pts * k);
    } else div.style.lineHeight = round2(p.lnSpc);
  } else div.style.lineHeight = '1.22';
  if (p.spcBef) { div.style.marginTop = round2(p.spcBef * k) + 'px'; div.dataset.bmt = String(p.spcBef * k); }
  if (p.spcAft) { div.style.marginBottom = round2(p.spcAft * k) + 'px'; div.dataset.bmb = String(p.spcAft * k); }

  const marL = (p.marL || 0) * k;
  const indent = (p.indent || 0) * k;
  const bullet = p.bullet && p.bullet.type !== 'none' ? p.bullet : null;

  const runsFrag = document.createDocumentFragment();
  let any = false;
  (p.runs || []).forEach((r, ri) => {
    if (r.br) { runsFrag.appendChild(el('br')); return; }
    if (r.t === '') return;
    any = true;
    const sty = runStyle(r, theme, p.defRPr);
    const basePx = parseFloat(sty.fontSize) * k;
    sty.fontSize = round2(basePx) + 'px';
    const sp = el(r.link ? 'a' : 'span', { class: 'sp-run', text: r.t, style: sty, dataset: { ri: String(ri), bsz: String(basePx) } });
    if (r.link) { sp.setAttribute('href', r.link); sp.setAttribute('target', '_blank'); sp.setAttribute('rel', 'noopener'); }
    runsFrag.appendChild(sp);
  });
  /* An empty paragraph still occupies a line, and losing it would reflow
     everything below when the user presses Return twice. */
  if (!any && !(p.runs || []).some((r) => r.br)) {
    const sty = runStyle(first, theme, p.defRPr);
    const basePx = parseFloat(sty.fontSize) * k;
    sty.fontSize = round2(basePx) + 'px';
    runsFrag.appendChild(el('span', { class: 'sp-run', html: '&#8203;', style: sty, dataset: { ri: '0', bsz: String(basePx) } }));
  }

  if (bullet) {
    /* Hanging indent: the bullet sits at marL+indent and the text at marL, so
       the block is offset by marL+indent and the bullet cell is -indent wide. */
    div.style.paddingLeft = round2(Math.max(0, marL + indent)) + 'px';
    div.style.display = 'flex';
    div.style.alignItems = 'baseline';
    const gutter = Math.max(indent < 0 ? -indent : defSz * k * 0.8, 6);
    let txt = bullet.char || '•';
    if (bullet.type === 'num') {
      const key = (p.lvl || 0) + '|' + (bullet.scheme || 'arabicPeriod');
      numState[key] = (numState[key] === undefined ? (bullet.start || 1) : numState[key] + 1);
      txt = (NUM_SCHEMES[bullet.scheme] || NUM_SCHEMES.arabicPeriod)(numState[key]);
    }
    const bsty = runStyle({ sz: defSz * (bullet.sizePct ? bullet.sizePct / 100000 : 1), color: bullet.color || first.color, font: bullet.font }, theme, p.defRPr);
    const bBase = parseFloat(bsty.fontSize) * k;
    bsty.fontSize = round2(bBase) + 'px';
    bsty.width = round2(gutter) + 'px';
    bsty.flex = '0 0 ' + round2(gutter) + 'px';
    bsty.textAlign = 'left';
    /* The bullet is generated, not typed, so it is inert to the caret. */
    div.appendChild(el('span', {
      class: 'sp-bullet', text: txt, style: bsty, contenteditable: 'false',
      dataset: { bsz: String(bBase), bgw: String(gutter) }
    }));
    const tw = el('span', { class: 'sp-ptext', style: { flex: '1 1 auto', minWidth: '0' } });
    tw.appendChild(runsFrag);
    div.appendChild(tw);
  } else {
    if (marL) div.style.paddingLeft = round2(marL) + 'px';
    if (indent) div.style.textIndent = round2(indent) + 'px';
    div.appendChild(runsFrag);
  }
  /* Reset numbering when a non-numbered paragraph breaks the run, which is
     what PowerPoint does. */
  if (!bullet || bullet.type !== 'num') for (const key in numState) if (key.startsWith((p.lvl || 0) + '|')) delete numState[key];
  return div;
}

function renderBody(body, theme, scale) {
  const k = scale === undefined ? 1 : scale;
  const wrap = el('div', { class: 'sp-body' });
  wrap.style.justifyContent = body.anchor === 'ctr' ? 'center' : body.anchor === 'b' ? 'flex-end' : 'flex-start';
  const ins = body.ins || { l: 7.2, t: 3.6, r: 7.2, b: 3.6 };
  wrap.style.padding = round2(ins.t * k) + 'px ' + round2(ins.r * k) + 'px ' + round2(ins.b * k) + 'px ' + round2(ins.l * k) + 'px';
  if (body.wrap === false) wrap.style.whiteSpace = 'pre';
  if (body.vert === 'vert' || body.vert === 'vert270') {
    wrap.style.writingMode = 'vertical-rl';
    if (body.vert === 'vert270') wrap.style.transform = 'rotate(180deg)';
  }
  const inner = el('div', { class: 'sp-body-inner' });
  const numState = {};
  (body.paragraphs || []).forEach((p, pi) => inner.appendChild(renderParagraph(p, body, theme, numState, k, pi)));
  wrap.appendChild(inner);
  return wrap;
}

/* --------------------------------------------------------------------------
   Elements
   -------------------------------------------------------------------------- */

function renderElement(e, deck, opts) {
  const theme = deckTheme(deck);
  const o = opts || {};
  const node = el('div', { class: 'sp-el sp-el-' + e.type, dataset: { id: e.id } });
  node.style.left = round2(e.x) + 'px';
  node.style.top = round2(e.y) + 'px';
  node.style.width = round2(Math.max(0, e.w)) + 'px';
  node.style.height = round2(Math.max(0, e.h)) + 'px';
  if (e.rot) node.style.transform = 'rotate(' + round2(e.rot) + 'deg)';
  if (e.hidden) node.style.display = 'none';
  if (e.opacity !== undefined && e.opacity < 1) node.style.opacity = e.opacity;
  const shadow = shadowFilterCss(e.shadow, theme);
  if (shadow) node.style.filter = shadow;

  if (e.type === 'image') {
    const box = el('div', { class: 'sp-img-box' });
    const img = el('img', { src: e.src, alt: e.alt || e.name || '', draggable: 'false' });
    if (e.crop) {
      /* srcRect crops by fractions of each edge; scale the image up so the
         kept region fills the frame, then clip. */
      const c = e.crop, kx = 1 - (c.l || 0) - (c.r || 0), ky = 1 - (c.t || 0) - (c.b || 0);
      if (kx > 0 && ky > 0) {
        img.style.width = round2(100 / kx) + '%';
        img.style.height = round2(100 / ky) + '%';
        img.style.marginLeft = round2(-(c.l || 0) * 100 / kx) + '%';
        img.style.marginTop = round2(-(c.t || 0) * 100 / ky) + '%';
        img.style.objectFit = 'fill';
      }
    }
    if (e.round) box.style.borderRadius = round2(e.round) + 'px';
    box.appendChild(img);
    node.appendChild(box);
    if (e.line && e.line.type !== 'none') {
      box.style.boxSizing = 'border-box';
      box.style.border = round2(e.line.w || 1) + 'px solid ' + cssColorOr(e.line.color, theme, theme.fg || '#000');
    }
    return node;
  }

  if (e.type === 'table') return renderTable(node, e, deck, theme, o);

  /* shape / line / text — all drawn as an SVG outline with text on top */
  const w = Math.max(0.01, e.w), h = Math.max(0.01, e.h);
  const strokeW = (e.line && e.line.w) || 0;
  const open = e.type === 'line' || isOpenGeom(e.geom);
  const needsSvg = e.type !== 'text' || (e.fill && e.fill.type !== 'none') || (e.line && e.line.type !== 'none');

  if (needsSvg) {
    /* A stroke is centred on the path, so half of it falls outside the box.
       Pad the viewBox by that half-width to stop thick outlines being clipped. */
    const pad = strokeW / 2 + 0.5;
    const svg = svgEl('svg', {
      class: 'sp-svg', width: round2(w + pad * 2), height: round2(h + pad * 2),
      viewBox: round2(-pad) + ' ' + round2(-pad) + ' ' + round2(w + pad * 2) + ' ' + round2(h + pad * 2),
      preserveAspectRatio: 'none', 'aria-hidden': 'true'
    });
    svg.style.left = round2(-pad) + 'px';
    svg.style.top = round2(-pad) + 'px';
    const defs = svgEl('defs');
    svg.appendChild(defs);
    const idBase = 'd' + String(e.id).replace(/[^A-Za-z0-9_]/g, '');
    const d = e.custPath ? custGeomPath(e.custPath, w, h) : geomPath(e.geom || 'rect', w, h, e.adj);
    const path = svgEl('path', { d, 'vector-effect': 'non-scaling-stroke' });
    path.setAttribute('fill', open ? 'none' : fillToSvg(e.fill, theme, defs, idBase));
    if (!open && e.fill && e.fill.type === 'solid' && colorAlpha(e.fill.color) < 1) path.setAttribute('fill-opacity', round2(colorAlpha(e.fill.color)));
    path.setAttribute('fill-rule', 'evenodd');
    applyLineToSvg(path, e.line, theme, strokeW);
    if (e.line && (e.line.headEnd || e.line.tailEnd)) {
      const col = resolveColor(e.line.color, theme) || '#000';
      const hid = arrowMarker(defs, idBase + '_h', e.line.headEnd, e.line.headSize, col, false);
      const tid = arrowMarker(defs, idBase + '_t', e.line.tailEnd, e.line.tailSize, col, true);
      if (hid) path.setAttribute('marker-start', 'url(#' + hid + ')');
      if (tid) path.setAttribute('marker-end', 'url(#' + tid + ')');
    }
    /* flipH/flipV mirror the geometry, not the text. */
    if (e.flipH || e.flipV) {
      path.setAttribute('transform',
        'translate(' + (e.flipH ? w : 0) + ',' + (e.flipV ? h : 0) + ') scale(' + (e.flipH ? -1 : 1) + ',' + (e.flipV ? -1 : 1) + ')');
    }
    svg.appendChild(path);
    node.appendChild(svg);
  }

  if (e.body) {
    const tr = (e.type === 'shape' && e.geom) ? geomTextRect(e.geom, w, h) : { x: 0, y: 0, w, h };
    const holder = el('div', { class: 'sp-text' });
    holder.style.left = round2(tr.x) + 'px'; holder.style.top = round2(tr.y) + 'px';
    holder.style.width = round2(tr.w) + 'px'; holder.style.height = round2(tr.h) + 'px';
    holder.appendChild(renderBody(e.body, theme, 1));
    node.appendChild(holder);

    if (o.prompts && bodyIsEmpty(e.body) && e.ph) {
      const first = ((e.body.paragraphs[0] || {}).runs || [])[0] || {};
      node.appendChild(el('div', {
        class: 'sp-ph-prompt', text: phPrompt(e),
        style: {
          left: round2(tr.x + (e.body.ins ? e.body.ins.l : 7)) + 'px',
          top: round2(tr.y + (e.body.ins ? e.body.ins.t : 4)) + 'px',
          width: round2(tr.w - 14) + 'px',
          fontSize: (first.sz || 18) + 'px',
          fontFamily: fontStack(first.font, theme),
          textAlign: ALIGN_CSS[(e.body.paragraphs[0] || {}).align || 'l'],
          lineHeight: '1.22'
        }
      }));
    }
  }
  return node;
}

function renderTable(node, e, deck, theme, o) {
  const t = e.table;
  const tbl = el('table', { class: 'sp-table' });
  tbl.style.width = round2(e.w) + 'px';
  const cg = el('colgroup');
  for (const cw of t.cols) cg.appendChild(el('col', { style: { width: round2(cw) + 'px' } }));
  tbl.appendChild(cg);
  const tb = el('tbody');
  const accent = resolveColor({ scheme: 'accent1' }, theme) || '#2E6BE6';
  const borderCol = e.borderColor ? (resolveColor(e.borderColor, theme) || '#CCC') : mixHex(theme.bg || '#FFF', theme.fg || '#000', 0.22);

  t.rows.forEach((row, ri) => {
    const tr = el('tr');
    tr.style.height = round2(row.h) + 'px';
    row.cells.forEach((cell, ci) => {
      if (cell.merged) return;
      const td = el('td', { dataset: { r: ri, c: ci } });
      if (cell.span > 1) td.setAttribute('colspan', cell.span);
      if (cell.rowSpan > 1) td.setAttribute('rowspan', cell.rowSpan);
      let bgc = cell.fill ? cssColor(cell.fill, theme) : null;
      if (!bgc) {
        if (e.firstRow && ri === 0) bgc = accent;
        else if (e.bandRow && ri % 2 === 1) bgc = mixHex(theme.bg || '#FFF', theme.fg || '#000', 0.055);
      }
      if (bgc && bgc !== 'transparent') td.style.background = bgc;
      td.style.border = (e.borderW === 0 ? 'none' : round2(e.borderW || 0.75) + 'px solid ' + borderCol);
      td.style.verticalAlign = cell.body && cell.body.anchor === 'ctr' ? 'middle' : cell.body && cell.body.anchor === 'b' ? 'bottom' : 'top';
      /* A header row carries an implicit bold-and-contrasting treatment unless
         the cell says otherwise, so a table dropped on a dark slide stays
         readable without the user styling 20 cells by hand. */
      const inherit = (e.firstRow && ri === 0 && !cell.fill)
        ? { b: true, color: { hex: readableOn(accent) } } : null;
      const b = cell.body || mkBody([mkPara([mkRun('')])]);
      const bodyNode = renderBody(inherit ? applyInheritToBody(b, inherit) : b, theme, 1);
      bodyNode.style.height = 'auto';
      td.appendChild(bodyNode);
      tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
  tbl.appendChild(tb);
  node.appendChild(tbl);
  return node;
}
/* Fold default run properties into a copy of a body without touching the
   model, so header styling is presentation rather than stored data. */
function applyInheritToBody(body, inherit) {
  const b = deepCopy(body);
  for (const p of b.paragraphs) p.defRPr = Object.assign({}, inherit, p.defRPr || {});
  return b;
}

/* --------------------------------------------------------------------------
   Slide
   -------------------------------------------------------------------------- */

function renderSlide(slide, deck, opts) {
  const o = opts || {};
  const stage = el('div', { class: 'sp-stage' + (o.className ? ' ' + o.className : ''), dataset: { slide: slide.id } });
  stage.style.width = round2(deck.size.w) + 'px';
  stage.style.height = round2(deck.size.h) + 'px';
  stage.style.background = slideBackgroundCss(slide, deck);
  for (const e of slide.elements || []) {
    if (o.prompts === false && e.ph && bodyIsEmpty(e.body) && e.ph.type !== 'pic') continue;
    stage.appendChild(renderElement(e, deck, o));
  }
  return stage;
}

/* Autofit. Runs after the stage is in the document, because it needs real
   layout. 'shrink' scales every font in the element down until the text fits;
   'resize' grows the element to the text instead. The scale is applied as a
   CSS variable multiplier rather than by rewriting run sizes, so the model
   keeps the size the user actually chose. */
function applyAutofit(stageNode, slide, deck) {
  for (const e of slide.elements || []) {
    if (!e.body || !e.body.autofit || e.body.autofit === 'none') continue;
    const node = stageNode.querySelector('.sp-el[data-id="' + cssEscape(e.id) + '"]');
    if (!node) continue;
    const holder = node.querySelector('.sp-text');
    const bodyNode = node.querySelector('.sp-body');
    if (!holder || !bodyNode) continue;

    if (e.body.autofit === 'resize' && e.type === 'text') {
      const inner = bodyNode.querySelector('.sp-body-inner');
      const ins = e.body.ins || { t: 3.6, b: 3.6 };
      const need = inner.getBoundingClientRect().height / currentStageScale(stageNode) + ins.t + ins.b;
      if (Math.abs(need - e.h) > 0.6) {
        e.h = Math.max(8, round2(need));
        node.style.height = e.h + 'px';
        holder.style.height = e.h + 'px';
      }
      continue;
    }

    shrinkBodyToFit(bodyNode, holder);
  }
}

/* Rewrite the inline sizes recorded at render time by a multiplier. */
function applyBodyScale(bodyNode, k) {
  bodyNode.dataset.fs = String(round2(k));
  const set = (sel, prop, unit) => {
    const list = bodyNode.querySelectorAll('[data-' + sel + ']');
    for (let i = 0; i < list.length; i++) {
      const base = parseFloat(list[i].dataset[camel(sel)]);
      if (isFinite(base)) list[i].style[prop] = round2(base * k) + (unit || 'px');
    }
  };
  set('bsz', 'fontSize');
  set('blh', 'lineHeight');
  set('bmt', 'marginTop');
  set('bmb', 'marginBottom');
  /* The bullet gutter is a flex basis, so it has to shrink with the glyph or
     a shrunk list keeps a gap sized for the original text. */
  const bl = bodyNode.querySelectorAll('[data-bgw]');
  for (let i = 0; i < bl.length; i++) {
    const base = parseFloat(bl[i].dataset.bgw);
    if (isFinite(base)) {
      const w = round2(Math.max(4, base * k));
      bl[i].style.width = w + 'px';
      bl[i].style.flex = '0 0 ' + w + 'px';
    }
  }
}
const camel = (s) => s.replace(/-([a-z])/g, (m, c) => c.toUpperCase());

/* Binary search the largest multiplier whose text fits. Eight steps lands
   within ~0.3%, well below a visible difference, and the search is cheap
   because it only rewrites inline styles. */
function shrinkBodyToFit(bodyNode, holder) {
  applyBodyScale(bodyNode, 1);
  if (bodyNode.scrollHeight <= holder.clientHeight + 1) return 1;
  let lo = 0.12, hi = 1;
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2;
    applyBodyScale(bodyNode, mid);
    if (bodyNode.scrollHeight <= holder.clientHeight + 1) lo = mid; else hi = mid;
  }
  applyBodyScale(bodyNode, lo);
  return lo;
}
function currentStageScale(stageNode) {
  const m = (stageNode.style.transform || '').match(/scale\(([-\d.]+)\)/);
  return m ? parseFloat(m[1]) || 1 : 1;
}
/* CSS.escape is not in every engine this might run in; ids here are generated
   and alphanumeric, so a conservative quote is enough. */
function cssEscape(s) { return String(s).replace(/["\\]/g, '\\$&'); }

/* A detached, correctly sized slide for thumbnails and print. Autofit needs
   layout, so the node is measured in a hidden mount and then handed back. */
function renderSlideFitted(slide, deck, opts) {
  const node = renderSlide(slide, deck, opts);
  const host = ensureMeasureHost();
  host.appendChild(node);
  try { applyAutofit(node, slide, deck); } catch (err) { /* keep the slide */ }
  host.removeChild(node);
  return node;
}
let _measureHost = null;
function ensureMeasureHost() {
  if (_measureHost && _measureHost.isConnected) return _measureHost;
  _measureHost = el('div', { class: 'sp-measure', 'aria-hidden': 'true' });
  document.body.appendChild(_measureHost);
  return _measureHost;
}
