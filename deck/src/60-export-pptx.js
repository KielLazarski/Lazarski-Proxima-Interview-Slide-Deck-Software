/* ==========================================================================
   60-export-pptx.js — write a .pptx.

   Every element is written as an explicit <p:sp>, <p:pic> or <p:graphicFrame>
   with its own <a:xfrm> and complete run properties. Nothing relies on
   placeholder inheritance, so what PowerPoint shows is what the model says,
   and a deck built here cannot be silently restyled by a master it never saw.

   The file carries a real theme, so the colour picker in PowerPoint works and
   theme-referenced colours stay linked rather than arriving as frozen hexes.

   Child element ORDER matters in OOXML — the schema uses sequences, not
   choices — so the builders below emit in schema order. Getting this wrong is
   the usual reason PowerPoint offers to "repair" a file.
   ========================================================================== */

const NS = {
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
};
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

/* ---------- colour ---------- */

function xColor(c, fallback) {
  if (!c) return xColor(fallback || '#000000');
  if (typeof c === 'string') {
    const h = normHex(c) || '#000000';
    return '<a:srgbClr val="' + h.slice(1) + '"/>';
  }
  const mods =
    (c.lumMod !== undefined ? '<a:lumMod val="' + Math.round(c.lumMod) + '"/>' : '') +
    (c.lumOff !== undefined ? '<a:lumOff val="' + Math.round(c.lumOff) + '"/>' : '') +
    (c.satMod !== undefined ? '<a:satMod val="' + Math.round(c.satMod) + '"/>' : '') +
    (c.tint !== undefined ? '<a:tint val="' + Math.round(c.tint) + '"/>' : '') +
    (c.shade !== undefined ? '<a:shade val="' + Math.round(c.shade) + '"/>' : '') +
    (c.alpha !== undefined ? '<a:alpha val="' + Math.round(c.alpha) + '"/>' : '');
  if (c.scheme) {
    /* phClr is only meaningful inside a theme style definition. */
    const val = c.scheme === 'phClr' ? 'tx1' : c.scheme;
    return '<a:schemeClr val="' + escapeXml(val) + '">' + mods + '</a:schemeClr>';
  }
  const h = normHex(c.hex) || '#000000';
  return '<a:srgbClr val="' + h.slice(1) + '">' + mods + '</a:srgbClr>';
}

function xFill(fill, ctx) {
  if (!fill || fill.type === 'none') return '<a:noFill/>';
  if (fill.type === 'solid') return '<a:solidFill>' + xColor(fill.color) + '</a:solidFill>';
  if (fill.type === 'gradient' && fill.stops && fill.stops.length) {
    const stops = fill.stops.map((s) =>
      '<a:gs pos="' + clamp(Math.round(s.pos), 0, 100000) + '">' + xColor(s.color) + '</a:gs>').join('');
    const lin = fill.path === 'circle'
      ? '<a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path>'
      : '<a:lin ang="' + Math.round(degToAng(fill.angle || 0)) + '" scaled="0"/>';
    return '<a:gradFill rotWithShape="1"><a:gsLst>' + stops + '</a:gsLst>' + lin + '</a:gradFill>';
  }
  if (fill.type === 'image' && fill.src && ctx) {
    const rid = ctx.media(fill.src);
    if (rid) return '<a:blipFill rotWithShape="1"><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>';
    return '<a:noFill/>';
  }
  if (fill.type === 'pattern') {
    return '<a:pattFill prst="' + escapeXml(fill.preset || 'pct50') + '">' +
      '<a:fgClr>' + xColor(fill.color) + '</a:fgClr><a:bgClr>' + xColor(fill.bgColor || '#FFFFFF') + '</a:bgClr></a:pattFill>';
  }
  return '<a:noFill/>';
}

const EXPORT_DASH = {
  solid: 'solid', dot: 'dot', dash: 'dash', lgDash: 'lgDash', dashDot: 'dashDot',
  lgDashDot: 'lgDashDot', lgDashDotDot: 'lgDashDotDot', sysDash: 'sysDash',
  sysDot: 'sysDot', sysDashDot: 'sysDashDot', sysDashDotDot: 'sysDashDotDot'
};
const EXPORT_ARROW = { none: 'none', triangle: 'triangle', stealth: 'stealth', diamond: 'diamond', oval: 'oval', open: 'arrow' };

function xLine(line) {
  if (!line || line.type === 'none') return '<a:ln><a:noFill/></a:ln>';
  const w = Math.max(1, Math.round(ptToEmu(line.w || 1)));
  const cap = line.cap === 'rnd' ? ' cap="rnd"' : line.cap === 'sq' ? ' cap="sq"' : '';
  let s = '<a:ln w="' + w + '"' + cap + '>';
  s += '<a:solidFill>' + xColor(line.color, '#000000') + '</a:solidFill>';
  s += '<a:prstDash val="' + (EXPORT_DASH[line.dash] || 'solid') + '"/>';
  if (line.join === 'round') s += '<a:round/>';
  else if (line.join === 'bevel') s += '<a:bevel/>';
  else s += '<a:miter lim="800000"/>';
  if (line.headEnd && line.headEnd !== 'none') s += '<a:headEnd type="' + (EXPORT_ARROW[line.headEnd] || 'triangle') + '" w="med" len="med"/>';
  if (line.tailEnd && line.tailEnd !== 'none') s += '<a:tailEnd type="' + (EXPORT_ARROW[line.tailEnd] || 'triangle') + '" w="med" len="med"/>';
  s += '</a:ln>';
  return s;
}

function xEffects(e) {
  if (!e.shadow || e.shadow.type === 'none') return '';
  const sh = e.shadow;
  return '<a:effectLst><a:outerShdw blurRad="' + Math.round(ptToEmu(sh.blur || 4)) +
    '" dist="' + Math.round(ptToEmu(sh.dist || 3)) +
    '" dir="' + Math.round(degToAng(sh.dir || 45)) + '" rotWithShape="0">' +
    xColor(sh.color || { hex: '#000000', alpha: 40000 }) + '</a:outerShdw></a:effectLst>';
}

/* ---------- geometry ---------- */

function xGeom(e) {
  if (e.custPath && e.custPath.length) {
    const paths = e.custPath.map((p) => {
      const cmds = (p.cmds || []).map((c) => {
        if (c.t === 'close') return '<a:close/>';
        if (c.t === 'arcTo') return '<a:arcTo wR="' + Math.round(c.wR || 0) + '" hR="' + Math.round(c.hR || 0) + '" stAng="' + Math.round(c.stAng || 0) + '" swAng="' + Math.round(c.swAng || 0) + '"/>';
        const pts = (c.pts || []).map((pt) => '<a:pt x="' + Math.round(pt.x) + '" y="' + Math.round(pt.y) + '"/>').join('');
        return '<a:' + c.t + '>' + pts + '</a:' + c.t + '>';
      }).join('');
      return '<a:path w="' + Math.round(p.w || 0) + '" h="' + Math.round(p.h || 0) + '">' + cmds + '</a:path>';
    }).join('');
    return '<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst>' + paths + '</a:pathLst></a:custGeom>';
  }
  const geom = (e.geom && hasPreset(e.geom)) ? e.geom : 'rect';
  const adj = e.adj || {};
  const keys = Object.keys(adj);
  const av = keys.length
    ? '<a:avLst>' + keys.map((k) => '<a:gd name="' + escapeXml(k) + '" fmla="val ' + Math.round(adj[k]) + '"/>').join('') + '</a:avLst>'
    : '<a:avLst/>';
  return '<a:prstGeom prst="' + escapeXml(geom) + '">' + av + '</a:prstGeom>';
}

function xXfrm(e) {
  const rot = e.rot ? ' rot="' + Math.round(degToAng(e.rot)) + '"' : '';
  const fh = e.flipH ? ' flipH="1"' : '';
  const fv = e.flipV ? ' flipV="1"' : '';
  return '<a:xfrm' + rot + fh + fv + '>' +
    '<a:off x="' + ptToEmu(e.x) + '" y="' + ptToEmu(e.y) + '"/>' +
    '<a:ext cx="' + Math.max(1, ptToEmu(e.w)) + '" cy="' + Math.max(1, ptToEmu(e.h)) + '"/></a:xfrm>';
}

/* ---------- text ---------- */

function xRunProps(r, tag, ctx) {
  const t = tag || 'a:rPr';
  const at = [];
  at.push('lang="en-US"');
  if (r.sz !== undefined) at.push('sz="' + clamp(Math.round(ptToSz(r.sz)), 100, 40000) + '"');
  if (r.b !== undefined) at.push('b="' + (r.b ? 1 : 0) + '"');
  if (r.i !== undefined) at.push('i="' + (r.i ? 1 : 0) + '"');
  if (r.u) at.push('u="' + escapeXml(r.u === true ? 'sng' : r.u) + '"');
  if (r.strike) at.push('strike="' + escapeXml(r.strike === true ? 'sngStrike' : r.strike) + '"');
  if (r.spc) at.push('spc="' + Math.round(r.spc) + '"');
  if (r.caps) at.push('cap="' + escapeXml(r.caps) + '"');
  if (r.baseline) at.push('baseline="' + (r.baseline > 0 ? 30000 : -25000) + '"');
  /* Children, in schema order: fill, highlight, latin, hlinkClick. */
  let kids = '';
  if (r.color !== undefined) kids += '<a:solidFill>' + xColor(r.color) + '</a:solidFill>';
  if (r.highlight) kids += '<a:highlight>' + xColor(r.highlight) + '</a:highlight>';
  if (r.font) {
    const f = r.font === '+mj-lt' ? '+mj-lt' : r.font === '+mn-lt' ? '+mn-lt' : r.font;
    kids += '<a:latin typeface="' + escapeXml(f) + '"/><a:cs typeface="' + escapeXml(f) + '"/>';
  }
  if (r.link && ctx) {
    const rid = ctx.hyperlink(r.link);
    if (rid) kids += '<a:hlinkClick r:id="' + rid + '"/>';
  }
  if (!kids) return '<' + t + ' ' + at.join(' ') + '/>';
  return '<' + t + ' ' + at.join(' ') + '>' + kids + '</' + t + '>';
}

const EXPORT_ALIGN = { l: 'l', ctr: 'ctr', r: 'r', just: 'just', dist: 'dist' };

function xParagraph(p, ctx) {
  const at = [];
  if (p.lvl) at.push('lvl="' + clamp(p.lvl | 0, 0, 8) + '"');
  if (p.marL !== undefined) at.push('marL="' + Math.max(0, ptToEmu(p.marL)) + '"');
  if (p.indent !== undefined) at.push('indent="' + ptToEmu(p.indent) + '"');
  if (p.align) at.push('algn="' + (EXPORT_ALIGN[p.align] || 'l') + '"');

  /* pPr children, in schema order. */
  let pk = '';
  if (p.lnSpc !== undefined && p.lnSpc !== null) {
    pk += '<a:lnSpc>' + (typeof p.lnSpc === 'object' && p.lnSpc.pts
      ? '<a:spcPts val="' + Math.round(ptToSz(p.lnSpc.pts)) + '"/>'
      : '<a:spcPct val="' + Math.round((p.lnSpc || 1) * 100000) + '"/>') + '</a:lnSpc>';
  }
  if (p.spcBef) pk += '<a:spcBef><a:spcPts val="' + Math.round(ptToSz(p.spcBef)) + '"/></a:spcBef>';
  if (p.spcAft) pk += '<a:spcAft><a:spcPts val="' + Math.round(ptToSz(p.spcAft)) + '"/></a:spcAft>';
  const b = p.bullet;
  if (b && b.type !== 'none') {
    if (b.color) pk += '<a:buClr>' + xColor(b.color) + '</a:buClr>';
    if (b.sizePct) pk += '<a:buSzPct val="' + Math.round(b.sizePct) + '"/>';
    if (b.type === 'num') {
      pk += '<a:buFont typeface="+mj-lt"/>';
      pk += '<a:buAutoNum type="' + escapeXml(b.scheme || 'arabicPeriod') + '"' + (b.start && b.start !== 1 ? ' startAt="' + (b.start | 0) + '"' : '') + '/>';
    } else {
      pk += '<a:buFont typeface="' + escapeXml(b.font || 'Arial') + '"/>';
      pk += '<a:buChar char="' + escapeXml(b.char || '•') + '"/>';
    }
  } else if (b && b.type === 'none') {
    pk += '<a:buNone/>';
  }
  if (p.defRPr && Object.keys(p.defRPr).length) pk += xRunProps(p.defRPr, 'a:defRPr', ctx);

  const pPr = (at.length || pk) ? '<a:pPr' + (at.length ? ' ' + at.join(' ') : '') + (pk ? '>' + pk + '</a:pPr>' : '/>') : '';

  let runs = '';
  let hasRun = false;
  for (const r of p.runs || []) {
    if (r.br) { runs += '<a:br>' + xRunProps({}, 'a:rPr', ctx) + '</a:br>'; continue; }
    if (!r.t) continue;
    hasRun = true;
    /* xml:space="preserve" keeps leading and trailing spaces, which carry
       meaning in a slide ("Q1 " + "2026"). */
    runs += '<a:r>' + xRunProps(r, 'a:rPr', ctx) + '<a:t xml:space="preserve">' + escapeXml(r.t) + '</a:t></a:r>';
  }
  /* An empty paragraph is a deliberate blank line; endParaRPr preserves the
     size so the gap it leaves is the right height. */
  if (!hasRun) {
    const first = (p.runs || []).find((r) => !r.br) || {};
    runs += xRunProps(first, 'a:endParaRPr', ctx);
  }
  return '<a:p>' + pPr + runs + '</a:p>';
}

function xTxBody(body, e, ctx) {
  if (!body) return '';
  const ins = body.ins || { l: 7.2, t: 3.6, r: 7.2, b: 3.6 };
  const at = [
    'lIns="' + ptToEmu(ins.l) + '"', 'tIns="' + ptToEmu(ins.t) + '"',
    'rIns="' + ptToEmu(ins.r) + '"', 'bIns="' + ptToEmu(ins.b) + '"',
    'rtlCol="0"', 'anchor="' + (body.anchor || 't') + '"'
  ];
  if (body.wrap === false) at.push('wrap="none"');
  if (body.vert) at.push('vert="' + escapeXml(body.vert) + '"');
  let fit = '';
  if (body.autofit === 'resize') fit = '<a:spAutoFit/>';
  else if (body.autofit === 'shrink') fit = '<a:normAutofit/>';
  else fit = '<a:noAutofit/>';
  const paras = (body.paragraphs || []).map((p) => xParagraph(p, ctx)).join('');
  return '<p:txBody><a:bodyPr ' + at.join(' ') + '>' + fit + '</a:bodyPr><a:lstStyle/>' +
    (paras || '<a:p/>') + '</p:txBody>';
}

/* ---------- elements ---------- */

function xElement(e, id, ctx) {
  const name = escapeXml(e.name || (e.type === 'table' ? 'Table' : e.type === 'image' ? 'Picture' : e.type === 'line' ? 'Line' : 'Shape'));

  if (e.type === 'image') {
    const rid = ctx.media(e.src);
    if (!rid) return '';
    const crop = e.crop
      ? '<a:srcRect l="' + Math.round((e.crop.l || 0) * 100000) + '" t="' + Math.round((e.crop.t || 0) * 100000) +
        '" r="' + Math.round((e.crop.r || 0) * 100000) + '" b="' + Math.round((e.crop.b || 0) * 100000) + '"/>'
      : '';
    return '<p:pic><p:nvPicPr><p:cNvPr id="' + id + '" name="' + name + '"' + (e.alt ? ' descr="' + escapeXml(e.alt) + '"' : '') + '/>' +
      '<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>' +
      '<p:blipFill><a:blip r:embed="' + rid + '"/>' + crop + '<a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
      '<p:spPr>' + xXfrm(e) + xGeom({ geom: 'rect' }) +
      (e.line && e.line.type !== 'none' ? xLine(e.line) : '') + xEffects(e) + '</p:spPr></p:pic>';
  }

  if (e.type === 'table') return xTable(e, id, ctx);

  const isLine = e.type === 'line' || isOpenGeom(e.geom);
  const ph = e.ph
    ? '<p:ph type="' + escapeXml(e.ph.type === 'subTitle' ? 'subTitle' : e.ph.type) + '"' +
      (e.ph.idx ? ' idx="' + (e.ph.idx | 0) + '"' : '') + '/>'
    : '';
  /* spPr children in schema order: xfrm, geometry, fill, ln, effectLst. */
  const spPr = '<p:spPr>' + xXfrm(e) + xGeom(e) +
    xFill(isLine ? { type: 'none' } : e.fill, ctx) +
    xLine(e.line) + xEffects(e) + '</p:spPr>';
  const txt = e.body ? xTxBody(e.body, e, ctx) : '<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody>';
  const cNvSp = e.type === 'text' ? '<p:cNvSpPr txBox="1"/>' : '<p:cNvSpPr/>';
  return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="' + name + '"/>' + cNvSp +
    '<p:nvPr>' + ph + '</p:nvPr></p:nvSpPr>' + spPr + txt + '</p:sp>';
}

function xTable(e, id, ctx) {
  const t = e.table;
  const grid = t.cols.map((w) => '<a:gridCol w="' + Math.max(1, ptToEmu(w)) + '"/>').join('');
  const rows = t.rows.map((row) => {
    const cells = row.cells.map((c) => {
      if (c.merged) return '<a:tc hMerge="1"><a:txBody><a:bodyPr/><a:lstStyle/><a:p/></a:txBody><a:tcPr/></a:tc>';
      const at = [];
      if (c.span > 1) at.push('gridSpan="' + (c.span | 0) + '"');
      if (c.rowSpan > 1) at.push('rowSpan="' + (c.rowSpan | 0) + '"');
      const ins = (c.body && c.body.ins) || { l: 7.2, t: 3.6, r: 7.2, b: 3.6 };
      const tcPrAt = [
        'marL="' + ptToEmu(ins.l) + '"', 'marR="' + ptToEmu(ins.r) + '"',
        'marT="' + ptToEmu(ins.t) + '"', 'marB="' + ptToEmu(ins.b) + '"',
        'anchor="' + ((c.body && c.body.anchor) || 'ctr') + '"'
      ];
      const fill = c.fill ? '<a:solidFill>' + xColor(c.fill) + '</a:solidFill>' : '';
      const body = xTxBody(c.body, e, ctx).replace(/^<p:txBody>/, '<a:txBody>').replace(/<\/p:txBody>$/, '</a:txBody>');
      return '<a:tc' + (at.length ? ' ' + at.join(' ') : '') + '>' + body +
        '<a:tcPr ' + tcPrAt.join(' ') + '>' + fill + '</a:tcPr></a:tc>';
    }).join('');
    return '<a:tr h="' + Math.max(1, ptToEmu(row.h)) + '">' + cells + '</a:tr>';
  }).join('');
  /* A table style id is required for PowerPoint to render banding; this is
     the built-in "Medium Style 2 - Accent 1" GUID. */
  const tblPr = '<a:tblPr' + (e.firstRow ? ' firstRow="1"' : '') + (e.bandRow ? ' bandRow="1"' : '') + '>' +
    '<a:tableStyleId>{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}</a:tableStyleId></a:tblPr>';
  return '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="' + id + '" name="' + escapeXml(e.name || 'Table') + '"/>' +
    '<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>' +
    '<p:xfrm><a:off x="' + ptToEmu(e.x) + '" y="' + ptToEmu(e.y) + '"/>' +
    '<a:ext cx="' + Math.max(1, ptToEmu(e.w)) + '" cy="' + Math.max(1, ptToEmu(e.h)) + '"/></p:xfrm>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">' +
    '<a:tbl>' + tblPr + '<a:tblGrid>' + grid + '</a:tblGrid>' + rows + '</a:tbl>' +
    '</a:graphicData></a:graphic></p:graphicFrame>';
}

/* ---------- parts ---------- */

function xSlideBg(slide, deck) {
  const bg = slide.bg;
  const th = deckTheme(deck);
  if (!bg || bg.type === 'none') {
    /* Write the theme background explicitly so a deck authored on a dark
       theme does not open white in PowerPoint. */
    return '<p:bg><p:bgPr>' + xFill({ type: 'solid', color: { hex: th.bg || '#FFFFFF' } }) + '<a:effectLst/></p:bgPr></p:bg>';
  }
  if (bg.type === 'image' && !bg.src) return '';
  return '<p:bg><p:bgPr>' + xFill(bg, null) + '<a:effectLst/></p:bgPr></p:bg>';
}

function buildSlideXml(slide, deck, ctx) {
  let id = 2;
  const shapes = (slide.elements || []).map((e) => xElement(e, id++, ctx)).filter(Boolean).join('');
  return XML_DECL +
    '<p:sld xmlns:p="' + NS.p + '" xmlns:a="' + NS.a + '" xmlns:r="' + NS.r + '">' +
    '<p:cSld>' + xSlideBg(slide, deck) +
    '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>' +
    '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
    shapes + '</p:spTree></p:cSld>' +
    '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
}

function buildNotesXml(slide, index) {
  const lines = String(slide.notes || '').split(/\r?\n/);
  const paras = lines.map((l) =>
    '<a:p><a:r><a:rPr lang="en-US" sz="1200"/><a:t xml:space="preserve">' + escapeXml(l) + '</a:t></a:r></a:p>').join('');
  return XML_DECL +
    '<p:notes xmlns:p="' + NS.p + '" xmlns:a="' + NS.a + '" xmlns:r="' + NS.r + '">' +
    '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>' +
    '<p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>' +
    '<p:spPr><a:xfrm><a:off x="685800" y="4343400"/><a:ext cx="5486400" cy="4114800"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>' +
    '<p:txBody><a:bodyPr/><a:lstStyle/>' + (paras || '<a:p/>') + '</p:txBody></p:sp>' +
    '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Slide Number Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>' +
    '<p:nvPr><p:ph type="sldNum" sz="quarter" idx="10"/></p:nvPr></p:nvSpPr><p:spPr/>' +
    '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:fld id="{B9E8A9A1-0000-0000-0000-000000000001}" type="slidenum">' +
    '<a:rPr lang="en-US" sz="1200"/><a:t>' + (index + 1) + '</a:t></a:fld></a:p></p:txBody></p:sp>' +
    '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>';
}

function buildThemeXml(th) {
  const c = th.colors;
  const hex = (k, dflt) => (normHex(c[k]) || dflt).slice(1);
  const major = th.fonts.major || 'Inter';
  const minor = th.fonts.minor || 'Inter';
  const clr =
    '<a:dk1><a:srgbClr val="' + hex('dk1', '#000000') + '"/></a:dk1>' +
    '<a:lt1><a:srgbClr val="' + hex('lt1', '#FFFFFF') + '"/></a:lt1>' +
    '<a:dk2><a:srgbClr val="' + hex('dk2', '#44546A') + '"/></a:dk2>' +
    '<a:lt2><a:srgbClr val="' + hex('lt2', '#E7E6E6') + '"/></a:lt2>' +
    [1, 2, 3, 4, 5, 6].map((i) => '<a:accent' + i + '><a:srgbClr val="' + hex('accent' + i, '#4472C4') + '"/></a:accent' + i + '>').join('') +
    '<a:hlink><a:srgbClr val="' + hex('hlink', '#0563C1') + '"/></a:hlink>' +
    '<a:folHlink><a:srgbClr val="' + hex('folHlink', '#954F72') + '"/></a:folHlink>';
  const fontList = (face) =>
    '<a:latin typeface="' + escapeXml(face) + '" panose="020B0604020202020204" pitchFamily="34" charset="0"/>' +
    '<a:ea typeface=""/><a:cs typeface=""/>';
  /* fmtScheme must carry exactly three fills, three lines, three effect
     styles and three background fills — PowerPoint rejects fewer. */
  const solid = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const grad =
    '<a:gradFill rotWithShape="1"><a:gsLst>' +
    '<a:gs pos="0"><a:schemeClr val="phClr"><a:lumMod val="110000"/><a:satMod val="105000"/><a:tint val="67000"/></a:schemeClr></a:gs>' +
    '<a:gs pos="50000"><a:schemeClr val="phClr"><a:lumMod val="105000"/><a:satMod val="103000"/><a:tint val="73000"/></a:schemeClr></a:gs>' +
    '<a:gs pos="100000"><a:schemeClr val="phClr"><a:lumMod val="105000"/><a:satMod val="109000"/><a:tint val="81000"/></a:schemeClr></a:gs>' +
    '</a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>';
  const ln = (w) => '<a:ln w="' + w + '" cap="flat" cmpd="sng" algn="ctr">' + solid +
    '<a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>';
  return XML_DECL +
    '<a:theme xmlns:a="' + NS.a + '" name="' + escapeXml(th.name || 'Theme') + '"><a:themeElements>' +
    '<a:clrScheme name="' + escapeXml(th.name || 'Theme') + '">' + clr + '</a:clrScheme>' +
    '<a:fontScheme name="' + escapeXml(th.name || 'Theme') + '">' +
    '<a:majorFont>' + fontList(major) + '</a:majorFont><a:minorFont>' + fontList(minor) + '</a:minorFont></a:fontScheme>' +
    '<a:fmtScheme name="' + escapeXml(th.name || 'Theme') + '">' +
    '<a:fillStyleLst>' + solid + grad + grad + '</a:fillStyleLst>' +
    '<a:lnStyleLst>' + ln(6350) + ln(12700) + ln(19050) + '</a:lnStyleLst>' +
    '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle>' +
    '<a:effectStyle><a:effectLst/></a:effectStyle>' +
    '<a:effectStyle><a:effectLst><a:outerShdw blurRad="57150" dist="19050" dir="5400000" algn="ctr" rotWithShape="0">' +
    '<a:srgbClr val="000000"><a:alpha val="63000"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle></a:effectStyleLst>' +
    '<a:bgFillStyleLst>' + solid + solid + grad + '</a:bgFillStyleLst>' +
    '</a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>';
}

function buildMasterXml(deck) {
  const th = deckTheme(deck);
  const W = ptToEmu(deck.size.w), H = ptToEmu(deck.size.h);
  const lvl = (i, sz, bullet) =>
    '<a:lvl' + i + 'pPr marL="' + (bullet ? 342900 * i : 0) + '" indent="' + (bullet ? -342900 : 0) + '" algn="l">' +
    (bullet ? '<a:buFont typeface="Arial"/><a:buChar char="•"/>' : '<a:buNone/>') +
    '<a:defRPr sz="' + sz + '"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill>' +
    '<a:latin typeface="' + (bullet ? '+mn-lt' : '+mj-lt') + '"/></a:defRPr></a:lvl' + i + 'pPr>';
  const bodyLvls = [2400, 2000, 1800, 1600, 1400, 1200, 1200, 1200, 1200]
    .map((sz, i) => lvl(i + 1, sz, true)).join('');
  return XML_DECL +
    '<p:sldMaster xmlns:p="' + NS.p + '" xmlns:a="' + NS.a + '" xmlns:r="' + NS.r + '">' +
    '<p:cSld><p:bg><p:bgPr>' + xFill({ type: 'solid', color: { hex: th.bg || '#FFFFFF' } }) + '<a:effectLst/></p:bgPr></p:bg>' +
    '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>' +
    '<p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>' +
    '<p:spPr><a:xfrm><a:off x="' + Math.round(W * 0.0667) + '" y="' + Math.round(H * 0.08) + '"/>' +
    '<a:ext cx="' + Math.round(W * 0.8666) + '" cy="' + Math.round(H * 0.14) + '"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>' +
    '<p:txBody><a:bodyPr anchor="b"/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Title</a:t></a:r></a:p></p:txBody></p:sp>' +
    '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Text Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>' +
    '<p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>' +
    '<p:spPr><a:xfrm><a:off x="' + Math.round(W * 0.0667) + '" y="' + Math.round(H * 0.25) + '"/>' +
    '<a:ext cx="' + Math.round(W * 0.8666) + '" cy="' + Math.round(H * 0.66) + '"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>' +
    '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Text</a:t></a:r></a:p></p:txBody></p:sp>' +
    '</p:spTree></p:cSld>' +
    '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
    '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
    '<p:txStyles>' +
    '<p:titleStyle>' + lvl(1, 4400, false) + '</p:titleStyle>' +
    '<p:bodyStyle>' + bodyLvls + '</p:bodyStyle>' +
    '<p:otherStyle>' + [1800, 1800, 1800, 1800, 1800, 1800, 1800, 1800, 1800].map((sz, i) => lvl(i + 1, sz, false)).join('') + '</p:otherStyle>' +
    '</p:txStyles></p:sldMaster>';
}

function buildLayoutXml() {
  return XML_DECL +
    '<p:sldLayout xmlns:p="' + NS.p + '" xmlns:a="' + NS.a + '" xmlns:r="' + NS.r + '" type="blank" preserve="1">' +
    '<p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
    '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';
}

function buildNotesMasterXml() {
  return XML_DECL +
    '<p:notesMaster xmlns:p="' + NS.p + '" xmlns:a="' + NS.a + '" xmlns:r="' + NS.r + '">' +
    '<p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>' +
    '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>' +
    '<p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>' +
    '<p:spPr><a:xfrm><a:off x="685800" y="4343400"/><a:ext cx="5486400" cy="4114800"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>' +
    '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>' +
    '</p:spTree></p:cSld>' +
    '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
    '<p:notesStyle>' + [1200, 1200, 1200, 1200, 1200, 1200, 1200, 1200, 1200].map((sz, i) =>
      '<a:lvl' + (i + 1) + 'pPr><a:defRPr sz="' + sz + '"/></a:lvl' + (i + 1) + 'pPr>').join('') + '</p:notesStyle></p:notesMaster>';
}

/* ---------- the package ---------- */

async function exportPptx(deck, fileName) {
  const th = deckTheme(deck);
  const parts = [];
  const add = (name, data, store) => parts.push({ name, data, store });

  /* Media, deduplicated by data URL so one image used ten times is stored
     once. */
  const mediaByUrl = new Map();
  const mediaFiles = [];
  function registerMedia(src) {
    if (!src) return null;
    if (mediaByUrl.has(src)) return mediaByUrl.get(src);
    const { bytes, mime } = dataUrlToBytes(src);
    if (!bytes.length) return null;
    const ext = extForMime(mime);
    const name = 'image' + (mediaFiles.length + 1) + '.' + ext;
    const rec = { name, path: 'ppt/media/' + name, bytes, mime, ext };
    mediaByUrl.set(src, rec);
    mediaFiles.push(rec);
    return rec;
  }

  const hasNotes = deck.slides.some((s) => String(s.notes || '').trim());
  const slideParts = [];

  deck.slides.forEach((slide, i) => {
    /* Each slide gets its own relationship set: the layout, then any images
       and hyperlinks it uses. */
    const rels = [{ id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' }];
    let next = 2;
    const usedMedia = new Map();
    const usedLinks = new Map();
    const ctx = {
      media(src) {
        const rec = registerMedia(src);
        if (!rec) return null;
        if (usedMedia.has(rec.path)) return usedMedia.get(rec.path);
        const id = 'rId' + (next++);
        rels.push({ id, type: 'image', target: '../media/' + rec.name });
        usedMedia.set(rec.path, id);
        return id;
      },
      hyperlink(url) {
        if (!url) return null;
        if (usedLinks.has(url)) return usedLinks.get(url);
        const id = 'rId' + (next++);
        rels.push({ id, type: 'hyperlink', target: url, external: true });
        usedLinks.set(url, id);
        return id;
      }
    };
    const xmlText = buildSlideXml(slide, deck, ctx);
    const noteText = String(slide.notes || '').trim() ? buildNotesXml(slide, i) : null;
    if (noteText) rels.push({ id: 'rId' + (next++), type: 'notesSlide', target: '../notesSlides/notesSlide' + (i + 1) + '.xml' });
    slideParts.push({ index: i, xmlText, noteText, rels });
  });

  const REL_TYPE = {
    slideLayout: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout',
    slideMaster: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster',
    notesMaster: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster',
    notesSlide: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide',
    slide: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
    image: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
    theme: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme',
    hyperlink: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
    officeDocument: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
    coreProps: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
    extProps: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties'
  };
  const relsXml = (list) => XML_DECL +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    list.map((r) => '<Relationship Id="' + r.id + '" Type="' + REL_TYPE[r.type] + '" Target="' + escapeXml(r.target) + '"' +
      (r.external ? ' TargetMode="External"' : '') + '/>').join('') +
    '</Relationships>';

  /* presentation.xml */
  const presRels = [{ id: 'rId1', type: 'slideMaster', target: 'slideMasters/slideMaster1.xml' }];
  let pr = 2;
  const notesMasterRid = hasNotes ? 'rId' + (pr++) : null;
  if (notesMasterRid) presRels.push({ id: notesMasterRid, type: 'notesMaster', target: 'notesMasters/notesMaster1.xml' });
  const slideRids = slideParts.map((sp) => {
    const id = 'rId' + (pr++);
    presRels.push({ id, type: 'slide', target: 'slides/slide' + (sp.index + 1) + '.xml' });
    return id;
  });
  presRels.push({ id: 'rId' + (pr++), type: 'theme', target: 'theme/theme1.xml' });

  const presXml = XML_DECL +
    '<p:presentation xmlns:p="' + NS.p + '" xmlns:a="' + NS.a + '" xmlns:r="' + NS.r + '" saveSubsetFonts="1">' +
    '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
    (notesMasterRid ? '<p:notesMasterIdLst><p:notesMasterId r:id="' + notesMasterRid + '"/></p:notesMasterIdLst>' : '') +
    '<p:sldIdLst>' + slideRids.map((rid, i) => '<p:sldId id="' + (256 + i) + '" r:id="' + rid + '"/>').join('') + '</p:sldIdLst>' +
    '<p:sldSz cx="' + ptToEmu(deck.size.w) + '" cy="' + ptToEmu(deck.size.h) + '"/>' +
    '<p:notesSz cx="' + ptToEmu(deck.size.h) + '" cy="' + ptToEmu(deck.size.w) + '"/>' +
    '<p:defaultTextStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr></p:defaultTextStyle>' +
    '</p:presentation>';

  add('ppt/presentation.xml', presXml);
  add('ppt/_rels/presentation.xml.rels', relsXml(presRels));
  add('ppt/slideMasters/slideMaster1.xml', buildMasterXml(deck));
  add('ppt/slideMasters/_rels/slideMaster1.xml.rels', relsXml([
    { id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' },
    { id: 'rId2', type: 'theme', target: '../theme/theme1.xml' }
  ]));
  add('ppt/slideLayouts/slideLayout1.xml', buildLayoutXml());
  add('ppt/slideLayouts/_rels/slideLayout1.xml.rels', relsXml([
    { id: 'rId1', type: 'slideMaster', target: '../slideMasters/slideMaster1.xml' }
  ]));
  add('ppt/theme/theme1.xml', buildThemeXml(th));
  if (hasNotes) {
    add('ppt/notesMasters/notesMaster1.xml', buildNotesMasterXml());
    add('ppt/notesMasters/_rels/notesMaster1.xml.rels', relsXml([{ id: 'rId1', type: 'theme', target: '../theme/theme1.xml' }]));
  }
  for (const sp of slideParts) {
    add('ppt/slides/slide' + (sp.index + 1) + '.xml', sp.xmlText);
    add('ppt/slides/_rels/slide' + (sp.index + 1) + '.xml.rels', relsXml(sp.rels));
    if (sp.noteText) {
      add('ppt/notesSlides/notesSlide' + (sp.index + 1) + '.xml', sp.noteText);
      add('ppt/notesSlides/_rels/notesSlide' + (sp.index + 1) + '.xml.rels', relsXml([
        { id: 'rId1', type: 'notesMaster', target: '../notesMasters/notesMaster1.xml' },
        { id: 'rId2', type: 'slide', target: '../slides/slide' + (sp.index + 1) + '.xml' }
      ]));
    }
  }
  for (const m of mediaFiles) add(m.path, m.bytes, true);

  /* Content types: defaults for every extension present, overrides per part. */
  const exts = new Set(['rels', 'xml']);
  for (const m of mediaFiles) exts.add(m.ext);
  const DEFAULTS = {
    rels: 'application/vnd.openxmlformats-package.relationships+xml',
    xml: 'application/xml'
  };
  const ctXml = XML_DECL +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    Array.from(exts).map((x) => '<Default Extension="' + x + '" ContentType="' + (DEFAULTS[x] || mimeForExt(x)) + '"/>').join('') +
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
    '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
    '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
    '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
    (hasNotes ? '<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>' : '') +
    slideParts.map((sp) =>
      '<Override PartName="/ppt/slides/slide' + (sp.index + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' +
      (sp.noteText ? '<Override PartName="/ppt/notesSlides/notesSlide' + (sp.index + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>' : '')
    ).join('') +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    '</Types>';

  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const titles = deck.slides.map((s) => {
    const t = (s.elements || []).find((e) => e.ph && (e.ph.type === 'title' || e.ph.type === 'ctrTitle'));
    return (t && bodyToText(t.body).split('\n')[0]) || '';
  });
  const coreXml = XML_DECL +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"' +
    ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"' +
    ' xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    '<dc:title>' + escapeXml(deck.title || 'Presentation') + '</dc:title>' +
    '<dc:creator>' + escapeXml(APP_NAME) + '</dc:creator>' +
    '<cp:lastModifiedBy>' + escapeXml(APP_NAME) + '</cp:lastModifiedBy>' +
    '<dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created>' +
    '<dcterms:modified xsi:type="dcterms:W3CDTF">' + now + '</dcterms:modified>' +
    '</cp:coreProperties>';
  const appXml = XML_DECL +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"' +
    ' xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
    '<Application>' + escapeXml(APP_NAME) + '</Application>' +
    '<Slides>' + deck.slides.length + '</Slides><Paragraphs>0</Paragraphs>' +
    '<TitlesOfParts><vt:vector size="' + titles.length + '" baseType="lpstr">' +
    titles.map((t) => '<vt:lpstr>' + escapeXml(t || 'Slide') + '</vt:lpstr>').join('') +
    '</vt:vector></TitlesOfParts>' +
    '<AppVersion>16.0000</AppVersion></Properties>';

  add('[Content_Types].xml', ctXml);
  add('_rels/.rels', relsXml([
    { id: 'rId1', type: 'officeDocument', target: 'ppt/presentation.xml' },
    { id: 'rId2', type: 'coreProps', target: 'docProps/core.xml' },
    { id: 'rId3', type: 'extProps', target: 'docProps/app.xml' }
  ]));
  add('docProps/core.xml', coreXml);
  add('docProps/app.xml', appXml);

  /* [Content_Types].xml must be the first entry in the archive. */
  parts.sort((a, b) => (a.name === '[Content_Types].xml' ? -1 : b.name === '[Content_Types].xml' ? 1 : 0));

  return zipFiles(parts, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
}
