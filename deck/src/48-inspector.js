/* ==========================================================================
   48-inspector.js — the properties panel.

   Two tabs: the selection, and the slide. Sections appear only when they
   apply to what is selected, so the panel is short rather than a wall of
   greyed-out controls.
   ========================================================================== */

let _inspTab = 'sel';

function buildInspector() {
  const ins = UI.inspector;
  if (!ins || !App.deck) return;
  const scroll = ins.scrollTop;
  ins.textContent = '';
  const els = selElements();
  if (!els.length && _inspTab === 'sel') _inspTab = 'slide';

  ins.appendChild(el('div', { class: 'insp-tabs' }, [
    el('button', { class: 'itab' + (_inspTab === 'sel' ? ' on' : ''), text: 'Selection', disabled: !els.length || null, onclick: () => { _inspTab = 'sel'; buildInspector(); } }),
    el('button', { class: 'itab' + (_inspTab === 'slide' ? ' on' : ''), text: 'Slide', onclick: () => { _inspTab = 'slide'; buildInspector(); } })
  ]));
  const body = el('div', { class: 'insp-body' });
  ins.appendChild(body);
  if (_inspTab === 'sel' && els.length) buildSelectionInspector(body, els);
  else buildSlideInspector(body);
  ins.scrollTop = scroll;
}

function section(title, kids, opts) {
  const o = opts || {};
  const s = el('section', { class: 'isec' + (o.cls ? ' ' + o.cls : '') });
  s.appendChild(el('h3', { class: 'isec-h', text: title }));
  const b = el('div', { class: 'isec-b' });
  for (const k of [].concat(kids).filter(Boolean)) b.appendChild(k);
  s.appendChild(b);
  return s;
}

/* ---------- selection ---------- */

function buildSelectionInspector(body, els) {
  const one = els.length === 1 ? els[0] : null;
  const kind = one ? one.type : 'multiple';

  body.appendChild(el('div', { class: 'insp-name' }, [
    el('span', { class: 'insp-kind', text: one ? (one.type === 'shape' ? shapeLabel(one.geom) : one.type === 'text' ? 'Text box' : one.type === 'image' ? 'Picture' : one.type === 'table' ? 'Table' : one.type === 'line' ? 'Line' : one.type) : els.length + ' items' }),
    one && one.locked ? el('span', { class: 'pill', text: 'locked' }) : null,
    one && one.groupId ? el('span', { class: 'pill', text: 'grouped' }) : null
  ].filter(Boolean)));

  /* Position and size */
  const b = one || unionRect(els.map((e) => rotatedBounds(elementBox(e))));
  body.appendChild(section('Position and size', [
    el('div', { class: 'fgrid2' }, [
      labeledRow('X', [numInput(b.x, (v) => moveSelTo(v, null))]),
      labeledRow('Y', [numInput(b.y, (v) => moveSelTo(null, v))]),
      labeledRow('W', [numInput(b.w, (v) => sizeSelTo(v, null))]),
      labeledRow('H', [numInput(b.h, (v) => sizeSelTo(null, v))])
    ]),
    one ? labeledRow('Rotation', [
      numInput(one.rot || 0, (v) => updateSel('Rotate', (e) => { e.rot = ((v % 360) + 360) % 360; }), { min: -360, max: 360 }),
      el('span', { class: 'unit', text: '°' }),
      btn({ label: '0°', small: true, cls: 'ghost', title: 'Reset rotation', onclick: () => updateSel('Rotate', (e) => { e.rot = 0; }) })
    ]) : null,
    el('div', { class: 'brow' }, [
      btn({ label: 'Centre on slide', small: true, cls: 'ghost', onclick: () => { alignSel('hcenter'); alignSel('vcenter'); } }),
      btn({ label: one && one.locked ? 'Unlock' : 'Lock', small: true, cls: 'ghost', onclick: () => updateSel('Lock', (e) => { e.locked = !(one && one.locked); }) })
    ])
  ]));

  /* Fill and outline */
  if (els.some((e) => e.type === 'shape' || e.type === 'text' || e.type === 'line' || e.type === 'image')) {
    const ref = one || els[0];
    const f = ref.fill || { type: 'none' };
    const fillKinds = [{ value: 'none', label: 'None' }, { value: 'solid', label: 'Solid' }, { value: 'gradient', label: 'Gradient' }];
    const kids = [];
    if (ref.type !== 'line' && ref.type !== 'image') {
      kids.push(labeledRow('Fill', [
        selectEl(fillKinds, f.type === 'image' ? 'none' : f.type, (v) => updateSel('Change fill', (e) => {
          if (v === 'none') e.fill = { type: 'none' };
          else if (v === 'solid') e.fill = { type: 'solid', color: (e.fill && e.fill.color) || { scheme: 'accent1' } };
          else e.fill = {
            type: 'gradient', angle: 90,
            stops: [{ pos: 0, color: (e.fill && e.fill.color) || { scheme: 'accent1' } }, { pos: 100000, color: { scheme: 'accent1', lumMod: 60000, lumOff: 40000 } }]
          };
        }), 'w8'),
        f.type === 'solid' ? colorSwatch(f.color, (c) => updateSel('Change fill', (e) => { e.fill = { type: 'solid', color: c }; }), { small: true, allowAlpha: true }) : null
      ].filter(Boolean)));
      if (f.type === 'gradient' && f.stops) {
        kids.push(labeledRow('Stops', f.stops.map((st, i) =>
          colorSwatch(st.color, (c) => updateSel('Change gradient', (e) => { e.fill.stops[i].color = c; }), { small: true }))));
        kids.push(labeledRow('Angle', [numInput(f.angle || 0, (v) => updateSel('Change gradient', (e) => { e.fill.angle = v; }), { min: 0, max: 360 }), el('span', { class: 'unit', text: '°' })]));
      }
    }
    const ln = ref.line;
    const has = ln && ln.type !== 'none';
    kids.push(labeledRow('Outline', [
      colorSwatch(has ? ln.color : null, (c) => updateSel('Change outline', (e) => {
        if (!c) e.line = { type: 'none' };
        else e.line = Object.assign({ w: 1, dash: 'solid' }, has ? e.line : {}, { color: c, type: undefined });
      }), { small: true, allowNone: true }),
      numInput(has ? ln.w : null, (v) => updateSel('Outline width', (e) => {
        if (!e.line || e.line.type === 'none') e.line = { color: { scheme: 'tx1' }, dash: 'solid' };
        e.line.w = v; delete e.line.type;
      }), { min: 0.25, max: 64, cls: 'w3' }),
      selectEl([
        { value: 'solid', label: 'Solid' }, { value: 'dash', label: 'Dashed' }, { value: 'dot', label: 'Dotted' },
        { value: 'lgDash', label: 'Long dash' }, { value: 'dashDot', label: 'Dash-dot' }
      ], has ? (ln.dash || 'solid') : 'solid', (v) => updateSel('Outline style', (e) => {
        if (!e.line || e.line.type === 'none') e.line = { color: { scheme: 'tx1' }, w: 1 };
        e.line.dash = v; delete e.line.type;
      }), 'w8')
    ]));
    if (ref.type === 'line') {
      kids.push(labeledRow('Ends', [
        selectEl([{ value: 'none', label: 'Plain' }, { value: 'triangle', label: 'Arrow' }, { value: 'stealth', label: 'Stealth' }, { value: 'oval', label: 'Dot' }, { value: 'diamond', label: 'Diamond' }],
          (ln && ln.headEnd) || 'none', (v) => updateSel('Line ends', (e) => { e.line = Object.assign({ color: { scheme: 'tx1' }, w: 2 }, e.line, { headEnd: v }); delete e.line.type; }), 'w8'),
        selectEl([{ value: 'none', label: 'Plain' }, { value: 'triangle', label: 'Arrow' }, { value: 'stealth', label: 'Stealth' }, { value: 'oval', label: 'Dot' }, { value: 'diamond', label: 'Diamond' }],
          (ln && ln.tailEnd) || 'none', (v) => updateSel('Line ends', (e) => { e.line = Object.assign({ color: { scheme: 'tx1' }, w: 2 }, e.line, { tailEnd: v }); delete e.line.type; }), 'w8')
      ]));
    }
    const sh = ref.shadow;
    kids.push(labeledRow('Shadow', [
      el('label', { class: 'chk' }, [
        (() => {
          const c = el('input', { type: 'checkbox' });
          c.checked = !!(sh && sh.type !== 'none');
          c.addEventListener('change', () => updateSel('Shadow', (e) => {
            e.shadow = c.checked ? { type: 'outer', blur: 6, dist: 3, dir: 45, color: { hex: '#000000', alpha: 35000 } } : null;
          }));
          return c;
        })(),
        el('span', { text: 'Drop shadow' })
      ])
    ]));
    if (sh && sh.type !== 'none') {
      kids.push(labeledRow('Offset', [
        numInput(sh.dist, (v) => updateSel('Shadow', (e) => { e.shadow.dist = v; }), { min: 0, max: 60, cls: 'w3' }),
        numInput(sh.blur, (v) => updateSel('Shadow', (e) => { e.shadow.blur = v; }), { min: 0, max: 80, cls: 'w3' }),
        colorSwatch(sh.color, (c) => updateSel('Shadow', (e) => { e.shadow.color = c; }), { small: true, allowAlpha: true })
      ]));
    }
    body.appendChild(section(ref.type === 'image' ? 'Border' : 'Fill and outline', kids));
  }

  /* Shape geometry */
  if (one && (one.type === 'shape' || one.type === 'line') && !one.custPath) {
    body.appendChild(section('Shape', [
      labeledRow('Type', [btn({ label: shapeLabel(one.geom), small: true, cls: 'ghost wide', caret: true, onclick: (ev) => changeGeomMenu(ev.currentTarget, one) })]),
      ADJUSTABLE[one.geom] ? labeledRow('Adjust', [(() => {
        const cfg = ADJUSTABLE[one.geom], key = cfg.key || 'adj';
        const v = (one.adj && one.adj[key] !== undefined) ? one.adj[key] : defaultAdj(one.geom, key);
        const sl = el('input', { class: 'rng', type: 'range', min: '0', max: String(cfg.max), value: String(v) });
        sl.addEventListener('input', () => updateSel('Adjust shape', (e) => { e.adj = Object.assign({}, e.adj, { [key]: +sl.value }); }));
        return sl;
      })()]) : null,
      labeledRow('Flip', [
        btn({ label: 'Horizontal', small: true, cls: 'ghost', active: !!one.flipH, onclick: () => flipSel('h') }),
        btn({ label: 'Vertical', small: true, cls: 'ghost', active: !!one.flipV, onclick: () => flipSel('v') })
      ])
    ]));
  }

  /* Text box behaviour */
  if (els.some((e) => canHaveText(e) && e.body)) {
    const ref = (one && one.body) ? one : els.find((e) => e.body);
    const bd = ref.body;
    body.appendChild(section('Text box', [
      labeledRow('Vertical', [selectEl([{ value: 't', label: 'Top' }, { value: 'ctr', label: 'Middle' }, { value: 'b', label: 'Bottom' }],
        bd.anchor || 't', (v) => applyBodyProps({ anchor: v }, 'Vertical align'), 'w8')]),
      labeledRow('Autofit', [selectEl([
        { value: 'none', label: 'Off' }, { value: 'shrink', label: 'Shrink text to fit' }, { value: 'resize', label: 'Grow box to text' }
      ], bd.autofit || 'none', (v) => { applyBodyProps({ autofit: v }, 'Autofit'); renderCanvas(); }, 'w12')]),
      labeledRow('Wrap', [el('label', { class: 'chk' }, [(() => {
        const c = el('input', { type: 'checkbox' });
        c.checked = bd.wrap !== false;
        c.addEventListener('change', () => applyBodyProps({ wrap: c.checked }, 'Wrap'));
        return c;
      })(), el('span', { text: 'Wrap text in shape' })])]),
      labeledRow('Inset', [
        numInput(bd.ins ? bd.ins.l : 7.2, (v) => applyBodyProps({ ins: Object.assign({}, bd.ins, { l: v, r: v }) }, 'Inset'), { min: 0, max: 80, cls: 'w3', title: 'Left and right' }),
        numInput(bd.ins ? bd.ins.t : 3.6, (v) => applyBodyProps({ ins: Object.assign({}, bd.ins, { t: v, b: v }) }, 'Inset'), { min: 0, max: 80, cls: 'w3', title: 'Top and bottom' })
      ]),
      labeledRow('Line spacing', [
        numInput(typeof (bd.paragraphs[0] || {}).lnSpc === 'number' ? bd.paragraphs[0].lnSpc : 1.22,
          (v) => applyParaProps({ lnSpc: v }, 'Line spacing'), { min: 0.5, max: 4, cls: 'w3' }),
        el('span', { class: 'unit', text: '×' }),
        numInput((bd.paragraphs[0] || {}).spcAft || 0, (v) => applyParaProps({ spcAft: v }, 'Space after'), { min: 0, max: 120, cls: 'w3', title: 'Space after paragraph (pt)' }),
        el('span', { class: 'unit', text: 'pt after' })
      ])
    ]));
  }

  /* Picture */
  if (one && one.type === 'image') {
    body.appendChild(section('Picture', [
      labeledRow('Corner', [numInput(one.round || 0, (v) => updateSel('Round corners', (e) => { e.round = v; }), { min: 0, max: 200, cls: 'w3' }), el('span', { class: 'unit', text: 'pt' })]),
      one.crop ? labeledRow('Crop', [el('span', { class: 'dim small', text: [one.crop.l, one.crop.t, one.crop.r, one.crop.b].map((v) => Math.round((v || 0) * 100) + '%').join(' / ') }),
        btn({ label: 'Clear', small: true, cls: 'ghost', onclick: () => updateSel('Clear crop', (e) => { e.crop = null; }) })]) : null,
      labeledRow('', [
        btn({ label: 'Replace…', small: true, cls: 'ghost', onclick: () => openImageReplace(one) }),
        btn({ label: 'Reset aspect', small: true, cls: 'ghost', onclick: () => resetAspect(one) })
      ]),
      labeledRow('Alt text', [(() => {
        const i = el('input', { class: 'inp wide', type: 'text', value: one.alt || '', placeholder: 'Describe the picture' });
        i.addEventListener('keydown', (ev) => ev.stopPropagation());
        i.addEventListener('change', () => updateSel('Alt text', (e) => { e.alt = i.value; }));
        return i;
      })()])
    ]));
  }

  /* Table */
  if (one && one.type === 'table') {
    const t = one.table;
    const sel = one._cellSel;
    body.appendChild(section('Table', [
      el('div', { class: 'dim small', text: t.rows.length + ' rows × ' + t.cols.length + ' columns' }),
      el('div', { class: 'brow' }, [
        btn({ label: '+ Row', small: true, cls: 'ghost', onclick: () => tableAddRow(one, sel ? Math.max(sel.r0, sel.r1) + 1 : t.rows.length) }),
        btn({ label: '+ Column', small: true, cls: 'ghost', onclick: () => tableAddCol(one, sel ? Math.max(sel.c0, sel.c1) + 1 : t.cols.length) })
      ]),
      el('div', { class: 'brow' }, [
        btn({ label: '− Row', small: true, cls: 'ghost', disabled: t.rows.length < 2, onclick: () => tableDelRow(one, sel ? sel.r0 : t.rows.length - 1) }),
        btn({ label: '− Column', small: true, cls: 'ghost', disabled: t.cols.length < 2, onclick: () => tableDelCol(one, sel ? sel.c0 : t.cols.length - 1) })
      ]),
      labeledRow('Header row', [el('label', { class: 'chk' }, [(() => {
        const c = el('input', { type: 'checkbox' });
        c.checked = !!one.firstRow;
        c.addEventListener('change', () => updateSel('Header row', (e) => { e.firstRow = c.checked; }));
        return c;
      })(), el('span', { text: 'Emphasise' })])]),
      labeledRow('Banding', [el('label', { class: 'chk' }, [(() => {
        const c = el('input', { type: 'checkbox' });
        c.checked = !!one.bandRow;
        c.addEventListener('change', () => updateSel('Banding', (e) => { e.bandRow = c.checked; }));
        return c;
      })(), el('span', { text: 'Alternate rows' })])]),
      labeledRow('Borders', [
        numInput(one.borderW === undefined ? 0.75 : one.borderW, (v) => updateSel('Borders', (e) => { e.borderW = v; }), { min: 0, max: 8, cls: 'w3' }),
        colorSwatch(one.borderColor || null, (c) => updateSel('Borders', (e) => { e.borderColor = c; }), { small: true, allowNone: true })
      ]),
      labeledRow('Distribute', [
        btn({ label: 'Columns', small: true, cls: 'ghost', onclick: () => commit('Even columns', () => { const w = one.w / t.cols.length; one.table.cols = t.cols.map(() => w); syncTableSize(one); }) }),
        btn({ label: 'Rows', small: true, cls: 'ghost', onclick: () => commit('Even rows', () => { const h = one.h / t.rows.length; for (const r of one.table.rows) r.h = h; syncTableSize(one); }) })
      ]),
      sel ? labeledRow('Cell fill', [colorSwatch(
        (t.rows[sel.r0] && t.rows[sel.r0].cells[sel.c0] && t.rows[sel.r0].cells[sel.c0].fill) || null,
        (c) => commit('Cell fill', () => { for (const cell of selectedCells(one)) cell.fill = c; }),
        { small: true, allowNone: true })]) : null
    ]));
  }
}

function changeGeomMenu(anchor, e) {
  openPopover(anchor, (pop) => {
    pop.classList.add('pop-shapes');
    for (const g of SHAPE_MENU) {
      pop.appendChild(menuHead(g.group));
      const grid = el('div', { class: 'sgrid' });
      for (const name of g.items) {
        const b = el('button', {
          class: 'sgb' + (name === e.geom ? ' on' : ''), title: shapeLabel(name),
          onclick: () => {
            closePopover();
            commit('Change shape', () => {
              e.geom = name; e.adj = {};
              const open = isOpenGeom(name);
              if (open) { e.type = 'line'; e.fill = { type: 'none' }; if (!e.line || e.line.type === 'none') e.line = { color: { scheme: 'tx1' }, w: 2, dash: 'solid' }; }
              else if (e.type === 'line') { e.type = 'shape'; e.fill = { type: 'solid', color: { scheme: 'accent1' } }; }
            });
          }
        });
        const svg = svgEl('svg', { viewBox: '0 0 28 22', 'aria-hidden': 'true' });
        svg.appendChild(svgEl('path', {
          d: geomPath(name, 26, 20, null), transform: 'translate(1,1)',
          fill: isOpenGeom(name) ? 'none' : 'currentColor', stroke: 'currentColor',
          'stroke-width': isOpenGeom(name) ? 1.6 : 0.8, 'fill-rule': 'evenodd'
        }));
        b.appendChild(svg);
        grid.appendChild(b);
      }
      pop.appendChild(grid);
    }
  }, { cls: 'pop-wide' });
}

function moveSelTo(x, y) {
  const els = selElements();
  if (!els.length) return;
  const b = els.length === 1 ? els[0] : unionRect(els.map((e) => rotatedBounds(elementBox(e))));
  const dx = x === null ? 0 : x - b.x, dy = y === null ? 0 : y - b.y;
  commit('Move', () => { for (const e of els) { e.x = round2(e.x + dx); e.y = round2(e.y + dy); } });
}
function sizeSelTo(w, h) {
  const els = selElements();
  if (!els.length) return;
  commit('Resize', () => {
    for (const e of els) {
      const kx = w === null ? 1 : w / Math.max(0.01, e.w);
      const ky = h === null ? 1 : h / Math.max(0.01, e.h);
      if (w !== null) e.w = Math.max(4, w);
      if (h !== null) e.h = Math.max(4, h);
      if (e.type === 'table' && e.table) {
        e.table.cols = e.table.cols.map((c) => c * kx);
        for (const r of e.table.rows) r.h *= ky;
        syncTableSize(e);
      }
    }
  });
}
function resetAspect(e) {
  imageSize(e.src).then((d) => {
    if (!d.w || !d.h) return;
    commit('Reset aspect', () => { e.h = round2(e.w * d.h / d.w); });
  });
}
function tableAddRow(e, at) {
  commit('Add row', () => {
    const t = e.table;
    const h = t.rows.length ? t.rows[clamp(at - 1, 0, t.rows.length - 1)].h : 28;
    t.rows.splice(clamp(at, 0, t.rows.length), 0, {
      h, cells: t.cols.map(() => ({ body: mkBody([mkPara([mkRun('')])], { anchor: 'ctr' }), fill: null, span: 1, rowSpan: 1 }))
    });
    syncTableSize(e);
  });
}
function tableAddCol(e, at) {
  commit('Add column', () => {
    const t = e.table;
    /* Take the new column's width from the others so the table keeps its
       overall size rather than growing off the slide. */
    const total = t.cols.reduce((a, b) => a + b, 0);
    const w = total / (t.cols.length + 1);
    const k = (total - w) / total;
    t.cols = t.cols.map((c) => c * k);
    t.cols.splice(clamp(at, 0, t.cols.length), 0, w);
    for (const r of t.rows) r.cells.splice(clamp(at, 0, r.cells.length), 0, { body: mkBody([mkPara([mkRun('')])], { anchor: 'ctr' }), fill: null, span: 1, rowSpan: 1 });
    syncTableSize(e);
  });
}
function tableDelRow(e, at) {
  if (e.table.rows.length < 2) return;
  commit('Delete row', () => { e.table.rows.splice(clamp(at, 0, e.table.rows.length - 1), 1); e._cellSel = null; syncTableSize(e); });
}
function tableDelCol(e, at) {
  if (e.table.cols.length < 2) return;
  commit('Delete column', () => {
    const i = clamp(at, 0, e.table.cols.length - 1);
    const w = e.table.cols[i];
    e.table.cols.splice(i, 1);
    const total = e.table.cols.reduce((a, b) => a + b, 0) || 1;
    e.table.cols = e.table.cols.map((c) => c + w * (c / total));
    for (const r of e.table.rows) r.cells.splice(i, 1);
    e._cellSel = null;
    syncTableSize(e);
  });
}

/* ---------- slide tab ---------- */

function buildSlideInspector(body) {
  const s = curSlide();
  const th = theme();

  body.appendChild(section('Theme', [
    el('div', { class: 'theme-grid' }, THEMES.map((t) => {
      const on = !App.deck.theme && App.deck.themeId === t.id;
      const b = el('button', { class: 'theme-sw' + (on ? ' on' : ''), title: t.name, onclick: () => setDeckTheme(t.id) });
      b.style.background = t.bg;
      const row = el('span', { class: 'theme-dots' });
      for (const k of ['accent1', 'accent2', 'accent3']) {
        const d = el('span', { class: 'theme-dot' });
        d.style.background = t.colors[k];
        row.appendChild(d);
      }
      b.appendChild(row);
      b.appendChild(el('span', { class: 'theme-nm', text: t.name, style: { color: t.fg } }));
      return b;
    })),
    App.deck.theme ? el('div', { class: 'dim small', text: 'Using the colour scheme from the opened file (“' + (App.deck.theme.name || 'imported') + '”). Picking one above replaces it.' }) : null
  ]));

  const bg = s.bg;
  body.appendChild(section('Background', [
    labeledRow('Fill', [
      selectEl([{ value: 'theme', label: 'Theme default' }, { value: 'solid', label: 'Solid' }, { value: 'gradient', label: 'Gradient' }],
        !bg || bg.type === 'none' ? 'theme' : bg.type, (v) => {
          if (v === 'theme') setSlideBackground(null);
          else if (v === 'solid') setSlideBackground({ type: 'solid', color: { scheme: 'bg1' } });
          else setSlideBackground({ type: 'gradient', angle: 90, stops: [{ pos: 0, color: { scheme: 'bg1' } }, { pos: 100000, color: { scheme: 'accent1', lumMod: 20000, lumOff: 80000 } }] });
        }, 'w12'),
      bg && bg.type === 'solid' ? colorSwatch(bg.color, (c) => setSlideBackground({ type: 'solid', color: c }), { small: true }) : null
    ].filter(Boolean)),
    bg && bg.type === 'gradient' ? labeledRow('Stops', (bg.stops || []).map((st, i) =>
      colorSwatch(st.color, (c) => { const nb = deepCopy(bg); nb.stops[i].color = c; setSlideBackground(nb); }, { small: true }))) : null,
    bg && bg.type === 'gradient' ? labeledRow('Angle', [numInput(bg.angle || 0, (v) => { const nb = deepCopy(bg); nb.angle = v; setSlideBackground(nb); }, { min: 0, max: 360 })]) : null,
    el('div', { class: 'brow' }, [
      btn({ label: 'Apply to all slides', small: true, cls: 'ghost', onclick: () => commit('Background on all', () => { for (const sl of App.deck.slides) sl.bg = deepCopy(s.bg); }) })
    ])
  ]));

  body.appendChild(section('Layout', [
    el('div', { class: 'layout-grid' }, LAYOUTS.map((l) =>
      el('button', { class: 'lay' + (s.layout === l.id ? ' on' : ''), text: l.name, onclick: () => applyLayout(l.id) })
    )),
    el('div', { class: 'dim small', text: 'Applying a layout repositions the placeholders and keeps the text that is already in them.' })
  ]));

  body.appendChild(section('Presentation', [
    labeledRow('Slide size', [selectEl(Object.keys(SLIDE_SIZES).map((k) => ({ value: k, label: SLIDE_SIZES[k].name })),
      sizeKeyOf(App.deck.size) || '16:9', (v) => setSlideSize(v), 'w12')]),
    el('div', { class: 'dim small', text: SLIDE_SIZES[sizeKeyOf(App.deck.size)] ? SLIDE_SIZES[sizeKeyOf(App.deck.size)].label : round2(App.deck.size.w / PT_PER_IN) + ' × ' + round2(App.deck.size.h / PT_PER_IN) + ' in' }),
    el('div', { class: 'dim small', text: 'Changing the size rescales everything on every slide.' })
  ]));
}
