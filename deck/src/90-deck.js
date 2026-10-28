/* ==========================================================================
   90-deck.js — the presentation that opens by default.

   Twenty-one slides in five movements:

     1–2    who is speaking, and what the exercise asks
     3–11   Task 1: the published pan-mutant RET degrader programme
     12–16  Task 2: four tools built for this exercise, and the workflow
     17–18  what the exercise taught, and the conclusions
     19–21  supplemental: the SMARCA2 ternary-complex work

   The title is the description. Every slide reads as one sentence that states
   the claim before anything else loads, and the body underneath supports it
   rather than repeating it.

   Audience: scientists who know targeted protein degradation but are not
   medicinal chemists. Degron, ternary complex, cooperativity and CRBN are used
   plainly; exit vectors, linker span and energetic frustration are described
   rather than named.

   The speaker notes are deliberately flat: measurements, counts, constants
   and limits. Nothing in them argues a case.

   Figures come from src/88-figures.js. Nothing is redrawn — the renders are
   the originals and the line art is re-treated, not re-plotted.
   ========================================================================== */

const DECK_THEME = {
  name: 'Proxima',
  colors: {
    dk1: '#E9EEF2', lt1: '#0E151B', dk2: '#A9B7C2', lt2: '#16202A',
    accent1: '#3FB8A0',   /* teal — the workflow spine */
    accent2: '#6FA8E8',
    accent3: '#E0A33C',   /* amber — specified but unwritten */
    accent4: '#D1715E',
    accent5: '#A88CE0',
    accent6: '#8FBF63',
    hlink: '#6FA8E8', folHlink: '#A88CE0'
  },
  fonts: { major: 'Inter', minor: 'Inter' }
};

const DECK_HEADER = 'Lazarski — Proxima Interview';
const DECK_SLIDES = 20;

/* Three tools, not four. Choosing the ligase is not a separate piece of
   software — it falls out of the nomination tool, which already has the
   expression data and the structures for both partners. */
const STAGES = [
  { n: '01', name: 'Nominate target & ligase', tool: 'Target Nomination' },
  { n: '02', name: 'Measure the interface', tool: 'Omni Tool' },
  { n: '03', name: 'Design the compounds', tool: 'Glue Forge' }
];

const RET_CITE = 'Orsi, Lazarski, Fitzgerald, Henderson et al.  RSC Med. Chem. 2025, 16, 4781–4795';
const SM2_CITE = 'Nasveschuk, Lazarski, Park et al.  WO2023244764A1  ·  ternary complex models: Hongwei Huang, Andy Good  ·  HDX: Scott Eron';

/* ---------- palette and small builders ---------- */

const W0 = 960, H0 = 540, M0 = 56;
const CW = W0 - M0 * 2;
const INK = { scheme: 'tx1' };
/* Muted text comes from the tx2 slot rather than a lumMod/lumOff transform of
   tx1: Office's "Lighter 60%" family assumes tx1 is dark, and on a dark theme
   it makes text brighter than the body copy. tx2 is a mid-tone in every theme
   here, so it reads as muted whichever way round the deck is. */
const DIM = { scheme: 'tx2' };
const FAINT = { scheme: 'tx2', alpha: 66000 };
const TEAL = { scheme: 'accent1' };
const AMBER = { scheme: 'accent3' };
/* Surfaces are a wash of the text colour at low alpha, for the same reason. */
const PANEL = { scheme: 'tx1', alpha: 10000 };
const PANEL_2 = { scheme: 'tx1', alpha: 13000 };
const HAIRLINE = { scheme: 'tx1', alpha: 16000 };
const BAND = { scheme: 'tx1', alpha: 6000 };

function dText(x, y, w, h, paras, opts) {
  return mkElement('text', Object.assign({
    x, y, w, h,
    body: mkBody(paras, Object.assign({ anchor: 't', autofit: 'none', ins: { l: 0, t: 0, r: 0, b: 0 } }, (opts && opts.body) || {}))
  }, (opts && opts.el) || {}));
}
function dRect(x, y, w, h, fill, opts) {
  return mkElement('shape', Object.assign({
    x, y, w, h, geom: (opts && opts.geom) || 'rect',
    adj: (opts && opts.adj) || {},
    fill: fill ? { type: 'solid', color: fill } : { type: 'none' },
    line: (opts && opts.line) || null,
    body: null
  }, (opts && opts.el) || {}));
}

/* A figure is placed by width and takes its height from the source pixels. A
   frame that disagrees with its picture is letterboxed here and stretched by
   PowerPoint on the way out, so the aspect ratio is never guessed. */
function dFig(name, x, y, w, opts) {
  const f = FIGURES[name];
  return mkElement('image', Object.assign({
    x, y, w, h: Math.round(w * f.h / f.w * 100) / 100,
    src: f.src, srcName: name, name: name,
    alt: (opts && opts.alt) || name
  }, (opts && opts.el) || {}));
}
function dFigH(name, x, y, h, opts) {
  const f = FIGURES[name];
  return dFig(name, x, y, Math.round(h * f.w / f.h * 100) / 100, opts);
}
/* Captions and citations are set small, so their boxes are sized for the text
   rather than shrunk to fit it: an 8.5pt line in a 14pt box autofits down to
   1pt, which is present in the DOM and invisible on the screen. */
function dCaption(x, y, w, text) {
  return dText(x, y, w, 34, [
    mkPara([mkRun(text, { sz: 9.5, color: FAINT, font: '+mn-lt' })], { lnSpc: 1.35 })
  ], { body: { autofit: 'none' } });
}
function dSource(text) {
  return dText(M0, 510, CW, 24, [
    mkPara([mkRun(text, { sz: 8.5, color: FAINT, font: '+mn-lt' })], { lnSpc: 1.3 })
  ], { body: { autofit: 'none' } });
}

/* A data table with no chrome: no header fill, no borders, a hairline under
   the head and the faintest wash on alternate rows. Numbers centre, labels
   stay left. Cell text sits below the reading-budget threshold on purpose —
   a table is consulted, not read aloud. */
function dTable(x, y, cols, rowH, rows, opts) {
  const o = opts || {};
  const w = cols.reduce((a, b) => a + b, 0);
  const t = mkTable(rows.length, cols.length, w, rowH * rows.length);
  t.cols = cols.slice();
  rows.forEach((row, ri) => {
    t.rows[ri].h = ri === 0 ? (o.headH || rowH + 8) : rowH;
    row.forEach((cell, ci) => {
      const c = (cell && typeof cell === 'object') ? cell : { t: String(cell == null ? '' : cell) };
      const head = ri === 0;
      const runProps = {
        sz: c.sz || (head ? 8.5 : 10.5),
        b: c.b !== undefined ? c.b : (head || ci === 0),
        color: c.color || (head ? FAINT : (ci === 0 ? INK : DIM)),
        font: '+mn-lt'
      };
      if (head) { runProps.caps = 'all'; runProps.spc = 70; }
      const tc = t.rows[ri].cells[ci];
      tc.body = mkBody(
        [mkPara([mkRun(c.t, runProps)], { align: c.align || (ci === 0 ? 'l' : 'ctr'), lnSpc: 1.2 })],
        { anchor: head ? 'b' : 'ctr', ins: { l: 7, t: 2, r: 7, b: head ? 5 : 2 } }
      );
      tc.fill = (!head && ri % 2 === 0) ? BAND : null;
    });
  });
  const els = [mkElement('table', Object.assign({
    x, y, w, h: 0, table: t, firstRow: false, bandRow: false, borderW: 0,
    name: o.name || 'Data table'
  }, o.el || {}))];
  els.push(dRect(x, y + (o.headH || rowH + 8), w, 1, HAIRLINE));
  return els;
}

/* The running header, on every slide. */
function dHeader(num) {
  return [
    dText(M0, 20, 420, 14, [
      mkPara([mkRun(DECK_HEADER, { sz: 9, caps: 'all', spc: 100, color: FAINT, font: '+mn-lt' })])
    ]),
    dText(W0 - M0 - 120, 20, 120, 14, [
      mkPara([mkRun(String(num) + ' / ' + DECK_SLIDES, { sz: 9, spc: 60, color: FAINT, font: '+mn-lt' })], { align: 'r' })
    ])
  ];
}
/* The progress strip: four cells, the active one filled. */
function dChain(y, active) {
  const gap = 8, h = 22, cw = (CW - gap * (STAGES.length - 1)) / STAGES.length;
  const out = [];
  STAGES.forEach((s, i) => {
    const x = M0 + i * (cw + gap);
    const on = i === active;
    out.push(dRect(x, y, cw, h, on ? TEAL : PANEL_2, { geom: 'rect', el: { name: 'Chain ' + s.n } }));
    const lab = on ? { scheme: 'bg1' } : FAINT;
    out.push(dText(x + 9, y + 5, cw - 18, 14, [
      mkPara([
        mkRun(s.n + '  ', { sz: 9.5, b: true, color: lab, spc: 60, font: '+mn-lt' }),
        mkRun(s.name, { sz: 9.5, b: on, color: lab, spc: 40, caps: 'all', font: '+mn-lt' })
      ])
    ]));
  });
  return out;
}

/* ---------- slide skeletons ----------
   Two shapes share one grammar: kicker, title-as-sentence, hairline. A
   statement slide puts three short columns under it; a figure slide puts a
   point list and the originals. */

function dHead(num, kicker, title, titleSz) {
  const els = dHeader(num);
  els.push(dText(M0, 52, 700, 16, [
    mkPara([mkRun(kicker, { sz: 10, b: true, caps: 'all', spc: 120, color: TEAL, font: '+mn-lt' })])
  ]));
  els.push(dText(M0, 74, CW, 56, [
    mkPara(title.map((seg) => mkRun(seg[0], {
      sz: titleSz || 25, b: !!seg[1], color: seg[1] ? INK : DIM, font: '+mj-lt'
    })), { lnSpc: 1.2 })
  ], { body: { autofit: 'shrink' } }));
  els.push(dRect(M0, 138, CW, 1, HAIRLINE));
  return els;
}

/* Three columns, each a label and one short paragraph. */
function dColumns(els, y, cols, accentLast) {
  const gap = 24, cw = (CW - gap * 2) / 3;
  cols.forEach((c, i) => {
    const lit = accentLast ? i === 2 : false;
    const x = M0 + i * (cw + gap);
    els.push(dRect(x, y, 22, 2, lit ? TEAL : HAIRLINE));
    els.push(dText(x, y + 14, cw, 26, [
      mkPara([mkRun(c.label, { sz: 9, b: true, caps: 'all', spc: 100, color: lit ? TEAL : FAINT, font: '+mn-lt' })], { lnSpc: 1.25 })
    ], { body: { autofit: 'shrink' } }));
    els.push(dText(x, y + 46, cw, 150, [
      mkPara([mkRun(c.text, { sz: 15, color: lit ? INK : DIM, font: '+mn-lt' })], { lnSpc: 1.5 })
    ], { body: { autofit: 'shrink' } }));
  });
  return els;
}

/* A short stack of points: the reading matter on a figure slide. */
function dPoints(els, x, y, w, points, sz) {
  let cy = y;
  points.forEach((p) => {
    const h = Math.max(26, Math.ceil(p.length / (w / ((sz || 15) * 0.5))) * (sz || 15) * 1.5 + 8);
    els.push(dText(x, cy, w, h, [
      mkPara([mkRun(p, { sz: sz || 15, color: DIM, font: '+mn-lt' })], { lnSpc: 1.5 })
    ], { body: { autofit: 'shrink' } }));
    cy += h + 10;
  });
  return cy;
}

/* ---------- a tool slide ----------
   Name, title-as-description, what it is built from, three short columns. */
function dToolSlide(num, idx, title, builtFrom, cols, notes) {
  const els = dHeader(num).concat(dChain(44, idx));

  els.push(dText(M0, 86, 700, 16, [
    mkPara([mkRun('Task 2 · ' + STAGES[idx].tool, { sz: 10.5, b: true, caps: 'all', spc: 120, color: TEAL, font: '+mn-lt' })])
  ]));
  /* The title carries the whole claim, so it is set as a sentence rather than
     a label and given two lines to land in. */
  els.push(dText(M0, 106, CW, 90, [
    mkPara(title.map((seg) => mkRun(seg[0], {
      sz: 30, b: !!seg[1], color: seg[1] ? INK : DIM, font: '+mj-lt'
    })), { lnSpc: 1.2 })
  ], { body: { autofit: 'shrink' } }));
  els.push(dText(M0, 206, CW, 16, [
    mkPara([
      mkRun('Built as  ', { sz: 10, b: true, caps: 'all', spc: 90, color: FAINT, font: '+mn-lt' }),
      mkRun(builtFrom, { sz: 11, color: DIM, font: '+mn-lt' })
    ])
  ], { body: { autofit: 'shrink' } }));
  els.push(dRect(M0, 242, CW, 1, HAIRLINE));
  dColumns(els, 300, cols, true);
  return mkSlide({ layout: 'blank', tag: 'tool-' + (idx + 1), elements: els, notes });
}

/* ---------- the slides ---------- */

function buildDefaultDeck() {
  const slides = [];

  /* ============================================================ 1. Speaker */
  {
    const els = dHead(1, 'Collaborator  ·  Leader  ·  Engineer', [
      ['Kiel Lazarski — ', false],
      ['10+ years of medicinal chemistry', true],
      [', advancing small molecules from hit identification through development candidate nomination', false]
    ]);
    els.push(dText(M0, 158, CW, 16, [
      mkPara([
        mkRun('Now  ', { sz: 10, b: true, caps: 'all', spc: 90, color: FAINT, font: '+mn-lt' }),
        mkRun('Director, Medicinal Chemistry, Flagship Pioneering  ·  35 patents and publications  ·  uses top-end AI models to prompt-engineer bespoke software and automate tasks', { sz: 11, color: DIM, font: '+mn-lt' })
      ])
    ], { body: { autofit: 'shrink' } }));
    dColumns(els, 222, [
      { label: 'Degraders', text: 'Delivered development candidates for PROTAC and non-covalent programmes. Ternary complex models evaluated by conformational analysis and historic SAR, then used to design PROTACs with improved degradation kinetics.' },
      { label: 'Design', text: 'Structure-based, property-driven design: X-ray, MD, FEP, QSAR. Orally bioavailable, CNS-penetrant molecules outside the Rule of 5. Hits progressed from DEL, virtual screens and fragment libraries.' },
      { label: 'Teams', text: 'Leads internal and external chemistry teams across FTE, FFS and CRO models. Mentors scientists and builds high-performing multi-disciplinary teams.' }
    ], true);
    slides.push(mkSlide({
      layout: 'blank', tag: 'speaker', elements: els,
      notes: 'Flagship Pioneering, Director of Medicinal Chemistry, April 2026 to present. Computational chemistry lead for ternary-complex formation and conformational analysis of heterobifunctionals, tying binding kinetics to on-mechanism pharmacodynamics. CRO synthesis efficiency raised tenfold, 0.6 to 5.5 compounds per FTE per week, through a mix of hands-on management and automated heterobifunctional library synthesis.\n\n'
        + 'Teams: four CRO synthesis groups and more than fifty chemists at C4, across FTE, fee-for-service and library-synthesis models. Mentoring is the part that compounds — the people who stay are the ones who were taught how the decisions get made, not just what was decided.\n\n'
        + 'Aleksia Therapeutics, 2022 to 2025, Senior Research Scientist to Associate Director. Chemistry lead on a kinase inhibitor programme: BCS Class I compounds to near development candidate in twelve months, a time-dependent CYP inhibition liability resolved by metabolite identification, spray-dried dispersion formulation. Covalent fragment libraries and mass-spectrometry fragment screening.\n\n'
        + 'C4 Therapeutics, 2016 to 2022. Chemistry lead on two concurrent PROTAC campaigns and, earlier, on a bromodomain degrader campaign that produced highly selective compounds. Nominated a PROTAC development candidate suitable for twice-daily oral dosing. Demonstrated CNS proof of concept for degradation in an intracranial tumour PDX model. Managed four CRO synthesis teams, more than fifty chemists.\n\n'
        + 'Broad Institute, 2015 to 2016, chemistry lead on a covalent oncology inhibitor. Northwestern PhD in organic chemistry with Thomson; NIH postdoctoral fellow with Porco at Boston University; F32 NRSA and T32 awards.\n\n'
        + 'Selected publications: the RET degrader paper used here as Task 1; selective covalent targeting of GPX4, Nature Chemical Biology 2020.'
    }));
  }

  /* =========================================================== 2. The brief */
  {
    const els = dHead(2, 'The exercise', [
      ['Two tasks — ', false],
      ['a past project revisited with Claude', true],
      [', and a programme plan for a target with real unmet need', false]
    ]);
    els.push(dText(M0, 158, CW, 16, [
      mkPara([
        mkRun('Answered with  ', { sz: 10, b: true, caps: 'all', spc: 90, color: FAINT, font: '+mn-lt' }),
        mkRun('the published pan-mutant RET degrader programme, and four tools built for this exercise', { sz: 11, color: DIM, font: '+mn-lt' })
      ])
    ], { body: { autofit: 'shrink' } }));
    dColumns(els, 222, [
      { label: 'Task 1 — the project', text: 'The pan-mutant RET degrader programme. Published in full, so every decision behind it can be shown and questioned.' },
      { label: 'Task 2 — the plan', text: 'Four tools that nominate a target, choose a ligase, measure the interface and propose a compound set.' },
      { label: 'Where they meet', text: 'RET is the worked example. The same decisions, taken by hand then and by the tools now.' }
    ], true);
    slides.push(mkSlide({
      layout: 'blank', tag: 'brief', elements: els,
      notes: 'Task 1 asks for a favourite past public project, revisited: roughly ten minutes on the original work and the remainder on how the landscape has changed and what would be done differently.\n\n'
        + 'Task 2 asks for a project plan against a target in a disease with unmet need, showing the criteria used, the targets eliminated, which proximity modalities fit, how known ligands would be progressed or new ones found, and the path to the clinic with its key assays.\n\n'
        + 'Both are scoped at twenty to thirty minutes with time for questions. The stated evaluation criteria are leadership, creativity, judgement, agency, work ethic and execution.\n\n'
        + 'Disease areas chosen for Task 2: immunology, inflammation and cardiometabolic disease. Oncology was set aside deliberately — it is where degrader precedent is concentrated and where target nomination is easiest, so it tests the tools least.\n\n'
        + 'Everything shown from the RET programme is in the published paper. One slide from the original talk is omitted here because it is marked confidential.'
    }));
  }

  /* ================================================ 3. RET — the exit vector */
  {
    const els = dHead(3, 'Task 1 — RET degrader', [
      ['Choosing where the linker leaves the kinase: ', false],
      ['the shortest path to solvent that avoids the moving parts', true]
    ]);
    dPoints(els, M0, 162, 500, [
      'The hinge joins the two lobes. It is rigid, short, and faces solvent directly.',
      'Distal to the hinge the linker has to cross the P-loop, the C-helix and the activation loop — the motifs that move when the kinase is regulated.',
      'Hypothesis: the shortest exit that avoids those motifs forms the ternary complex faster and costs the least binary affinity.'
    ]);
    els.push(dFigH('kinase', 640, 158, 318, { alt: 'RET kinase domain with N-lobe, P-loop, hinge, C-helix, activation loop and C-lobe labelled' }));
    els.push(dCaption(640, 486, 260, 'Kinase domain, structural features labelled'));
    els.push(dSource(RET_CITE));
    slides.push(mkSlide({
      layout: 'blank', tag: 'ret-exitvector', elements: els,
      notes: 'Kinase anatomy: the N-lobe is mostly beta sheet with the glycine-rich P-loop over the ATP site; the C-lobe is mostly helical and carries the substrate-binding surface. The hinge connects them and lines the adenine pocket, which is why almost every ATP-competitive inhibitor hydrogen bonds to it.\n\n'
        + 'The P-loop, the C-helix and the activation loop are the regulatory elements. They change conformation between active and inactive states and during substrate turnover.\n\n'
        + 'A heterobifunctional has to place a second protein across that surface. A vector leaving beside the hinge reaches solvent in the fewest atoms and passes nothing that moves. A vector leaving distal to the hinge has to traverse the activation loop.\n\n'
        + 'The cost of a linker is paid twice: in binary affinity, because the attachment perturbs the bound conformation, and in the rate of ternary complex formation, because the second protein has to find a productive orientation.\n\n'
        + 'This analysis needs no ternary complex model. It needs the monovalent co-crystal and a reading of which parts of the fold are dynamic.'
    }));
  }

  /* ============================================= 4. RET — the two geometries */
  {
    const els = dHead(4, 'Task 1 — RET degrader', [
      ['Two candidate exit vectors, modelled: ', false],
      ['one leaves beside the hinge, the other through the activation loop', true]
    ]);
    els.push(dText(M0, 160, CW, 40, [
      mkPara([mkRun('The same warhead in the same ATP site, with two places for the linker to leave.', { sz: 15, color: DIM, font: '+mn-lt' })], { lnSpc: 1.45 })
    ], { body: { autofit: 'shrink' } }));
    els.push(dFig('sideview', M0, 212, 420, { alt: 'Side view of the monovalent ligand bound to the kinase, both candidate exit vectors marked' }));
    els.push(dCaption(M0, 424, 420, 'Side view — monovalent ligand in the ATP site, both candidate exit vectors marked'));
    els.push(dFig('tcmodel', 596, 206, 300, { alt: 'Top-down view of the modelled ternary complex: target kinase, PROTAC and E3 ligase' }));
    els.push(dCaption(596, 460, 306, 'Top-down view of the modelled ternary complex'));
    els.push(dSource(RET_CITE));
    slides.push(mkSlide({
      layout: 'blank', tag: 'ret-geometry', elements: els,
      notes: 'Left: the monovalent ligand viewed from the side, with the two candidate attachment points marked. The proximal vector exits beside the hinge; the distal vector exits on the far side of the pocket.\n\n'
        + 'Right: the ternary complex model viewed down onto the interface. Target kinase above, E3 ligase below, degrader between them. The two arrows mark where each linker would have to emerge.\n\n'
        + 'The model was built with structural biology and computational chemistry colleagues rather than taken from a single docking run. It is a hypothesis about relative orientation, not a structure.\n\n'
        + 'What the picture makes concrete: the distal vector has to span a longer path and cross a loop whose position depends on the activation state of the kinase, so the same compound sees a different surface in different states.'
    }));
  }

  /* ================================================== 5. RET — which mutants */
  {
    const els = dHead(5, 'Task 1 — target product profile', [
      ['Choosing which mutants the molecule must cover: ', false],
      ['G810R is the one the inhibitors miss', true]
    ]);
    dPoints(els, M0, 162, 520, [
      'Structural biology, biochemistry, translational biology and in vivo pharmacology read the same literature; biochemical screening and ternary-complex modelling then set the priority.',
      'G810R sits on the exit vector itself — the highest risk and the highest reward in the profile.'
    ]);
    dTable(M0, 300, [150, 130, 130, 110], 24, [
      ['Selpercatinib', 'IC₅₀, ATP = Kₘ', 'IC₅₀, ATP = 30 µM', 'Kₘ (µM)'],
      ['RET wild type', '1 nM', '14 nM', '—'],
      ['V804L  gatekeeper', '2 nM', '—', '0.07'],
      ['V804M  gatekeeper', '2 nM', '24 nM', '0.44'],
      ['A883F  C-lobe', '4 nM', '—', '—'],
      ['M918T  C-lobe', '2 nM', '—', '0.45'],
      [{ t: 'G810R  exit vector', color: TEAL }, '—', { t: '530 nM', color: TEAL, b: true }, '—']
    ]).forEach((e) => els.push(e));
    els.push(dFig('mutmap', 660, 170, 240, { alt: 'Selpercatinib docked into the wild-type RET X-ray structure with mutation sites marked' }));
    els.push(dCaption(660, 442, 240, 'Selpercatinib docked into the wild-type RET structure, mutation sites marked'));
    els.push(dSource(RET_CITE));
    slides.push(mkSlide({
      layout: 'blank', tag: 'ret-mutants', elements: els,
      notes: 'RET is activated by point mutation and by chromosomal fusion. A degrader removes the protein rather than blocking the site, so in principle it covers both without a separate molecule per mutant.\n\n'
        + 'Selpercatinib retains single-digit nanomolar potency against the gatekeeper and C-lobe mutants at ATP equal to Kₘ. At 30 µM ATP, closer to the intracellular concentration, G810R costs roughly forty-fold.\n\n'
        + 'G810R is the solvent-front mutation. It sits where the inhibitor exits the pocket, which is the same place the linker would attach — so it is simultaneously the differentiating opportunity and the hardest constraint on the chemistry.\n\n'
        + 'Choosing it was a cross-functional decision, not a chemistry decision. The mutant with the clearest commercial differentiation was also the one most likely to break the design.\n\n'
        + 'Kₘ values are quoted from the same source: V804L 0.07 µM, V804M 0.44 µM, M918T 0.45 µM. M918T is constitutively active.'
    }));
  }

  /* =============================================== 6. RET — what the cells said */
  {
    const els = dHead(6, 'Task 1 — RET degrader', [
      ['Proximal beat distal in cells: ', false],
      ['21 nM DC₅₀ against no measurable degradation', true]
    ]);
    els.push(dText(M0, 158, 500, 42, [
      mkPara([mkRun('Same warhead, same ligase, same linker chemistry. Only the attachment point moved. Emax is protein remaining, so lower is better.', { sz: 14, color: DIM, font: '+mn-lt' })], { lnSpc: 1.45 })
    ], { body: { autofit: 'shrink' } }));

    els.push(dFigH('distal', M0, 204, 145, { alt: 'PROTAC with the exit vector distal to the hinge' }));
    els.push(dText(330, 248, 210, 52, [
      mkPara([mkRun('Distal to hinge', { sz: 9, b: true, caps: 'all', spc: 90, color: FAINT, font: '+mn-lt' })], { lnSpc: 1.4 }),
      mkPara([mkRun('NA / 185 nM IP / 61% Emax', { sz: 13, b: true, color: DIM, font: '+mn-lt' })], { lnSpc: 1.4 })
    ], { body: { autofit: 'shrink' } }));

    els.push(dFigH('proximal', M0, 362, 145, { alt: 'PROTAC with the exit vector proximal to the hinge' }));
    els.push(dText(330, 406, 210, 52, [
      mkPara([mkRun('Proximal to hinge', { sz: 9, b: true, caps: 'all', spc: 90, color: TEAL, font: '+mn-lt' })], { lnSpc: 1.4 }),
      mkPara([mkRun('21 nM DC₅₀ / 20 nM IP / 24% Emax', { sz: 13, b: true, color: INK, font: '+mn-lt' })], { lnSpc: 1.4 })
    ], { body: { autofit: 'shrink' } }));

    els.push(dFig('tcmodel', 596, 196, 300, { alt: 'Top-down ternary complex model with both exit vectors marked' }));
    els.push(dCaption(596, 452, 300, 'Both candidate vectors on the modelled complex'));
    els.push(dSource(RET_CITE));
    slides.push(mkSlide({
      layout: 'blank', tag: 'ret-result', elements: els,
      notes: 'Measured in a RET G810R HiBiT degradation assay. DC₅₀ is the concentration giving half-maximal degradation; Emax here is the protein remaining at the maximum effect, so a lower number is deeper degradation. IP is reported as in the source.\n\n'
        + 'The distal compound returned no measurable DC₅₀ and 61% protein remaining. The proximal compound degraded with a 21 nM DC₅₀ to 24% remaining.\n\n'
        + 'The two molecules share the warhead, the cereblon ligand and the linker chemistry. The difference is where the linker attaches to the kinase.\n\n'
        + 'This is one series and one target, so it is evidence rather than proof. What it supports is the ordering: exit vector choice before linker optimisation, because no amount of linker work rescued the distal vector.\n\n'
        + 'The practical consequence is that the first synthetic decision is also the most consequential, and it can be made from the monovalent structure alone.'
    }));
  }

  /* ================================================= 7. RET — compound 15 */
  {
    const els = dHead(7, 'Task 1 — published series', [
      ['The published series starts at compound 15: ', false],
      ['potent on RET, with no oral exposure', true]
    ]);
    dPoints(els, M0, 162, 330, [
      'Point mutations and fusions both drive constitutive activation, so degradation offers pan-mutant and pan-fusion pharmacology with better kinome selectivity.',
      'G810R is where second-line inhibitors lose potency.',
      'VEGFR2 is the high-homology anti-target.'
    ], 14);
    els.push(dFig('scaffold', 420, 162, 480, { alt: 'Compound 15 scaffold with the linker shown as a labelled box' }));
    els.push(dText(420, 298, 240, 16, [
      mkPara([mkRun('Linker, compound 15   X = C', { sz: 9, b: true, caps: 'all', spc: 90, color: FAINT, font: '+mn-lt' })])
    ]));
    els.push(dFigH('linker15', 420, 316, 90, { alt: 'Linker of compound 15' }));
    dTable(M0, 432, [86, 122, 132, 104, 136, 96, 96, 76], 22, SAR_HEAD_AND(['15'])).forEach((e) => els.push(e));
    els.push(dSource(RET_CITE));
    slides.push(mkSlide({
      layout: 'blank', tag: 'ret-cpd15', elements: els,
      notes: 'Compound 15 is the starting point of the published series: 5 nM DC₅₀ on the RET kinase domain to 23% remaining, 103 nM on G810R to 37%, and 43.6 nM inhibition of wild-type RET.\n\n'
        + 'The problem is exposure. No measured clearance, no oral AUC, no bioavailability — the molecule does not survive to be dosed.\n\n'
        + 'VEGFR2 matters because it shares high homology with RET in the ATP site. Inhibiting it produces hypertension and proteinuria, so selectivity against it is a profile requirement rather than a nicety. pVEGFR2 is the cellular readout.\n\n'
        + 'The table grows across the next three slides. Reading it left to right: degradation of the kinase domain, degradation of the G810R mutant, inhibition of wild-type RET, the cellular anti-target, then clearance, oral exposure and bioavailability.\n\n'
        + 'Everything that follows is linker and property work against a fixed warhead and a fixed ligase ligand.'
    }));
  }

  /* ================================================ 8. RET — 15 to 16 to 17 */
  {
    const els = dHead(8, 'Task 1 — published series', [
      ['Two changes, two problems: ', false],
      ['the exit-vector angle, then the basicity of the linker', true]
    ]);
    dPoints(els, M0, 162, CW, [
      '15 → 16.  Narrowing the exit-vector angle from 180° to 144° improved binary binding, and degradation with it.',
      '16 → 17.  Lowering basicity and buried surface area cut clearance and raised permeability: bioavailability moved from 0.9% to 18%.'
    ], 14);
    els.push(dFig('linker17', M0, 252, CW, { alt: 'Linker variants for compounds 15, 16 and 17' }));
    els.push(dCaption(M0, 348, 560, 'Linkers of compounds 15, 16 and 17'));
    dTable(M0, 384, [86, 122, 132, 104, 136, 96, 96, 76], 22, SAR_HEAD_AND(['15', '16', '17'])).forEach((e) => els.push(e));
    els.push(dSource(RET_CITE));
    slides.push(mkSlide({
      layout: 'blank', tag: 'ret-opt1', elements: els,
      notes: 'Compound 16 changes the angle at which the linker leaves the warhead, from roughly 180° to 144°. Degradation of the kinase domain improves from 5 nM to 1.9 nM and G810R from 103 nM to 24 nM. The improvement tracks binary binding affinity, which is the mechanism the ternary complex model predicted.\n\n'
        + 'Compound 16 is still not an oral molecule: clearance 31 mL/min/kg, oral AUC 8.09 ng·h/mL, bioavailability 0.88%.\n\n'
        + 'Compound 17 reduces the basicity of the linker amine and lowers solvent-accessible surface area. Clearance falls to 16, oral AUC rises to 181, bioavailability to 18%. Potency is unchanged.\n\n'
        + 'Basicity drives clearance in this series through the usual routes: higher volume of distribution and more metabolic turnover. Reducing it is a property decision that does not touch either binding element.\n\n'
        + 'The pVEGFR2 margin narrows from 1162 nM to 671 nM across the same change, which is the cost side of the ledger.'
    }));
  }

  /* ================================================= 9. RET — chameleonicity */
  {
    const els = dHead(9, 'Task 1 — published series', [
      ['Why the property change worked: ', false],
      ['the molecule folds in on itself once the solvent is gone', true]
    ]);
    els.push(dText(M0, 158, CW, 42, [
      mkPara([mkRun('Conformers from a molecular dynamics ensemble, plotted as solvent-accessible surface area against relative energy. Compound 17 reaches compact conformations that 16 does not.', { sz: 14, color: DIM, font: '+mn-lt' })], { lnSpc: 1.45 })
    ], { body: { autofit: 'shrink' } }));
    els.push(dFig('sasa16', 88, 194, 320, { alt: 'SASA against relative potential energy for compound 16' }));
    els.push(dCaption(88, 472, 320, 'Compound 16'));
    els.push(dFig('sasa17', 496, 194, 318, { alt: 'SASA against relative potential energy for compound 17' }));
    els.push(dCaption(496, 472, 360, 'Compound 17 — a low-SASA population appears'));
    els.push(dSource(RET_CITE));
    slides.push(mkSlide({
      layout: 'blank', tag: 'ret-sasa', elements: els,
      notes: 'Each point is a conformer from a molecular dynamics ensemble. The vertical axis is solvent-accessible surface area; the horizontal axis is relative potential energy under OPLS.\n\n'
        + 'Compound 16 populates a narrow high-SASA band. Compound 17 populates a second, lower band at comparable energy — conformations in which the molecule folds against itself and buries polar surface, typically through intramolecular hydrogen bonds.\n\n'
        + 'That behaviour is chameleonicity: a molecule that presents polar surface in water and hides it in membrane. It is the standard explanation for oral absorption in compounds that sit outside the Rule of 5, which every heterobifunctional does.\n\n'
        + 'The prediction and the measurement agree here: compound 17 has the collapsed population and the higher permeability and bioavailability. One series, so it is consistent rather than validated.\n\n'
        + 'Practically this is a cheap calculation to run before synthesis, and it discriminates between linkers that look equivalent on paper.'
    }));
  }

  /* ============================================ 10. RET — length and rigidity */
  {
    const els = dHead(10, 'Task 1 — published series', [
      ['Linker length and rigidity trade against the anti-target: ', false],
      ['rigidifying recovered VEGFR2 selectivity', true]
    ]);
    dPoints(els, M0, 162, 330, [
      '17 → 18.  Cutting polar surface area raised permeability again, but VEGFR2 selectivity fell.',
      '18 → 20.  A rigid linker recovered it, at 39% oral bioavailability.'
    ], 14);
    els.push(dFig('linker20', 420, 160, 480, { alt: 'Linker variants for compounds 15 to 20' }));
    els.push(dCaption(420, 304, 480, 'Linkers of compounds 15 to 20'));
    dTable(M0, 334, [86, 122, 132, 104, 136, 96, 96, 76], 22, SAR_HEAD_AND(['15', '16', '17', '18', '19', '20'])).forEach((e) => els.push(e));
    els.push(dSource(RET_CITE));
    slides.push(mkSlide({
      layout: 'blank', tag: 'ret-opt2', elements: els,
      notes: 'Compound 18 removes further polar surface area. Permeability and oral exposure improve again — AUC 601 ng·h/mL, bioavailability 53% — but the pVEGFR2 margin falls to 660 nM, which is too close to the RET potency to carry forward.\n\n'
        + 'Compound 19 rigidifies part of the linker and recovers the margin to beyond 2670 nM, at 23% bioavailability.\n\n'
        + 'Compound 20 is the balance point: 1.7 nM on the kinase domain to 8% remaining, 21 nM on G810R, a pVEGFR2 margin of 5141 nM, clearance 18 mL/min/kg and 39% oral bioavailability.\n\n'
        + 'The pattern across six compounds: potency was fixed early by the exit vector; everything after it traded exposure against anti-target selectivity, and rigidity was the lever that moved them in the same direction.\n\n'
        + 'One slide from the original talk is not reproduced here. It carries the CNS exposure and intracranial PDX pharmacodynamic data for compounds 17 and 20 and is marked confidential; it can be added if cleared. The result it reports is that brain concentrations after dosing were sufficient for efficient degradation in that model.'
    }));
  }

  /* ============================================ 11. RET — what it turned on */
  {
    const els = dHead(11, 'Task 1 — what it turned on', [
      ['What the programme actually turned on: ', false],
      ['three decisions taken before any compound was made', true]
    ]);
    els.push(dText(M0, 158, CW, 16, [
      mkPara([
        mkRun('And now  ', { sz: 10, b: true, caps: 'all', spc: 90, color: FAINT, font: '+mn-lt' }),
        mkRun('each of those three decisions is one of the tools in the second half of this deck', { sz: 11, color: DIM, font: '+mn-lt' })
      ])
    ], { body: { autofit: 'shrink' } }));
    dColumns(els, 222, [
      { label: 'Which mutants', text: 'A cross-functional reading of the literature, then biochemistry and ternary-complex modelling, put G810R in the target profile.' },
      { label: 'Where the linker leaves', text: 'Topology and dynamics ranked the exit vectors. The shortest clear path degraded best; 180° to 144° improved it further.' },
      { label: 'What sets exposure', text: 'Linker basicity set clearance. Conformational collapse, predicted by dynamics, set permeability.' }
    ], true);
    slides.push(mkSlide({
      layout: 'blank', tag: 'ret-summary', elements: els,
      notes: 'The three decisions in order of consequence. The mutant choice set the target product profile and could not be revisited cheaply. The exit vector choice set the achievable potency and was made from a monovalent co-crystal. The property work set whether the molecule could be dosed at all.\n\n'
        + 'All three were taken with the structures and the literature available at the time, in meetings across structural biology, computational chemistry, biochemistry, translational biology and pharmacology.\n\n'
        + 'What would be done differently now is not a different conclusion. It is the same analysis made earlier, cheaper and against more candidates: exit vector accessibility computed from structure rather than argued, conformational collapse screened before synthesis rather than after a bioavailability surprise, and the ligase treated as a variable rather than assumed.\n\n'
        + 'That is what the four tools in the next section do.'
    }));
  }

  /* ===================================== 12. Tool 1 — target and ligase */
  slides.push(dToolSlide(12, 0, [
    ['Tool 1 — ', false],
    ['database-mining web tool', true],
    [' that nominates target–ligase pairs in immunology, inflammation and cardiometabolic disease', false]
  ],
    'tpd_calibration_set.csv  ·  Proteins of Interest page  ·  Glue Site Scan  ·  dock.mjs',
    [
      { label: 'Why it exists', text: 'Outside oncology there is no essentiality screen to borrow, and a degrader is a three-body problem — the ligase cannot be chosen late.' },
      { label: 'What it draws on', text: 'Human genetics, Open Targets, GTEx, STRING, UniProt, ChEMBL and the trial registries, plus structures for both partners. All public.' },
      { label: 'What comes out', text: 'A ranked shortlist of target–ligase pairs, each with an evidence tier and a likely modality.' }
    ],
    'Choosing the ligase is not a separate tool. The same page already holds the expression data and the structures for both partners, so it ranks the pair rather than the target alone.\n\n'
    + 'Four entry filters: selectivity-limited, ligand-silent, scaffolding-dependent, compensation-prone.\n\n'
    + 'Evidence is tiered. Clinical failure plus genetic validation is the strongest tier; structural PPI evidence the weakest.\n\n'
    + 'Scaffolding test is “knockout better than inhibitor”, not “knockout differs from inhibitor”. RIPK1 fails it: kinase-dead mice do better than knockouts, so its scaffold is protective.\n\n'
    + 'Calibration set: 37 cases labelled on two axes, target validity and modality fit. Positives include STAT6, IRF5, VAV1, PNPLA3 I148M, HSD17B13. Modality rejects: IL-23, PCSK9, APOC3, ANGPTL3 (secreted), CD20 (surface). Validity traps: p38 in RA, PPARα in MASH. Minimum eight positives and eight negatives per disease area.\n\n'
    + 'Disease-area weights are a parameter. Cardiometabolic has protective loss-of-function variants; I&I largely does not.\n\n'
    + 'Delivery gate is tiered: oral systemic by default, hepatic via first-pass and ASGPR, local for inhaled, gut-restricted and intra-articular.\n\n'
    + 'Ligase side. Of the eight clinical PROTACs with disclosed structures, seven are CRBN-based and oral and the eighth is intravenous. E3 identity is undisclosed for nearly every non-oncology clinical degrader, so the prior is strong and the scan has to beat it.\n\n'
    + 'The structural half is the weakest part of the stack and is reported as such. The scan lands a partner across 600 orientations on a ligand pocket face, about three seconds per pair, scored on buried area, pocket involvement and strained interfacial contacts. Benchmarked against 35 deposited ternary complexes with the warhead and linker truncated away so the answer could not leak in, plus a decoy-pocket null: 0 of 20 near-native poses in the top ten, median best-of-ten 18.7 Å at the true pocket against 64.4 Å at the decoy. A sampling bug was found and fixed and did not change the outcome. The native partner sits a median 9.7 Å off the pocket-normal axis; the heuristic sampled ±4 Å; widening to ±21 Å made both pockets worse. So any strained-contact score computed on those poses is measured on a complex roughly 19 Å from truth.\n\n'
    + 'The scan is restrained to the pocket face by construction, so it cannot return “no interface involves this pocket”, only that nothing scored well.\n\n'
    + 'Limits. All three evidence layers are observational. Scope is nuclear and cytosolic only. The scoring function is specified but not written. Pose ranking and the ligase-against-target co-expression comparison are not built. The inhibitor-versus-knockout discordance corpus is not assembled.'
  ));

  /* ================================================ 13. Tool 2 — Omni Tool */
  slides.push(dToolSlide(13, 1, [
    ['Tool 2 — ', false],
    ['structural workbench', true],
    [' that measures whether a target–ligase interface can host a small molecule', false]
  ],
    'Omni Tool  ·  Exit Vectors page, TC Feasibility page, Cross-Species page',
    [
      { label: 'Why it exists', text: 'Geometric impossibility is usually found after the chemistry. This needs only the two structures.' },
      { label: 'What it draws on', text: 'PDB co-crystals and predicted models. Runs offline in a browser — no server, no queue.' },
      { label: 'What comes out', text: 'Where a linker can attach, the reach it needs, and which compounds are impossible.' }
    ],
    'Exit depth: for an attachment atom, the shortest distance to a point where a foreign protein atom could sit and still have a clear line out to solvent. 320 sampled directions, 1.70 Å probe, Bondi radii.\n\n'
    + 'floor = max(depth A, depth B). This holds for every relative orientation of the two proteins, so it needs no docking and no pose. It is the only number in the stack allowed to delete a compound.\n\n'
    + 'required = depth A + depth B. A model of two pockets facing each other across the interface, not a theorem. It drives the target linker length.\n\n'
    + 'Attachment-point ranking follows Franzini 2026, built on 8,228 cocrystals and 131,431 positions. It classifies about 22 percent of real PROTAC attachment sites as inaccessible, so it ranks rather than filters.\n\n'
    + 'Cross-species: BLOSUM62 alignment with affine gaps, Kabsch superposition fitted on site residues, substitution severity weighted by distance to the site. Triage only; it is not a validated predictor.\n\n'
    + 'Test coverage: 119 unit assertions on the span engine, 57 on the page.\n\n'
    + 'This is the tool that formalises the RET exit-vector decision: what was argued from a co-crystal and a reading of the dynamics is now computed from the two structures.\n\n'
    + 'Not modelled: ubiquitination competence — whether a lysine is positioned and the complex lives long enough. Nothing here is calibrated against measured degradation.'
  ));

  /* =============================================== 14. Tool 3 — Glue Forge */
  slides.push(dToolSlide(14, 2, [
    ['Tool 3 — ', false],
    ['design tool', true],
    [' that turns a modelled interface into a purchasable compound set', false]
  ],
    'Glue Forge  ·  glue_library_100.xlsx  ·  chemlib.py',
    [
      { label: 'Why it exists', text: 'Every molecular glue so far was found by screening, not designed.' },
      { label: 'What it draws on', text: 'The interface map, known ligase-binder series, and make-on-demand catalogues.' },
      { label: 'What comes out', text: 'About a hundred compounds in hypothesis series — a virtual screen against the interface, ranked and ready to order.' }
    ],
    'Thermodynamics. A ternary complex forms through a binary intermediate, so the effective dissociation constant is Kᴅ₁·Kᴅ₃ / α. Binary affinity multiplies; cooperativity only divides. α = 100 is worth about 2.7 kcal/mol. So the compound needs measurable affinity for one partner. Precedents: thalidomide to CRBN, indisulam to DCAF15, CR8 to the CDK12 ATP site.\n\n'
    + 'Site selection uses local energetic frustration computed over an MD ensemble on apo, binary and ternary states. The direction is counter-intuitive: more interface frustration associates with better glue behaviour, so it selects a site rather than being an objective to minimise.\n\n'
    + 'Evidence base: one target–ligase pair, SMARCA2–VHL across 16 PROTACs, reported without a correlation coefficient. Both supporting papers are retrospective.\n\n'
    + 'The frustration port agrees with the reference implementation on 89 percent of pair classifications and reproduces the published 40/50/10 split on proteins it had not seen.\n\n'
    + 'Not generative. Published diffusion models produce physically valid 3D structures between 0.4 and 11 percent of the time, and are out of distribution on shallow interfaces.\n\n'
    + 'Library: 103 compounds, nine chemotype series plus five benchmark glues. Ranked 0.40 property fit, 0.35 synthetic tractability, 0.25 availability. Availability is a structure-based proxy, not a catalogue lookup — expect about half the one-step tier to be make-on-demand with a three-to-six week lead time.\n\n'
    + 'Not done: nothing purchased or screened. The retrospective check across known glue complexes has not been run.'
  ));

  /* ================================================= 15. The workflow */
  {
    const els = dHeader(15);
    els.push(dText(M0, 54, 700, 16, [
      mkPara([mkRun('Task 2 — the workflow', { sz: 10.5, b: true, caps: 'all', spc: 120, color: TEAL, font: '+mn-lt' })])
    ]));
    els.push(dText(M0, 76, CW, 46, [
      mkPara([mkRun('Each tool narrows what the next one sees', { sz: 30, color: INK, font: '+mj-lt' })])
    ]));
    els.push(dRect(M0, 134, CW, 1, HAIRLINE));

    /* The chain drawn as a flow: what each stage consumes, and what it emits. */
    const flow = [
      { in: 'Public databases, expression and structures', out: 'Target–ligase pairs, with an interface' },
      { in: 'Two structures', out: 'What is geometrically possible' },
      { in: 'The interface map', out: 'A virtual screen of ~100 compounds' }
    ];
    const gap = 18, cw = (CW - gap * (STAGES.length - 1)) / STAGES.length, cy = 172, chH = 170;
    STAGES.forEach((s, i) => {
      const x = M0 + i * (cw + gap);
      els.push(dRect(x, cy, cw, chH, PANEL, { geom: 'roundRect', adj: { adj: 1800 } }));
      els.push(dRect(x, cy, cw, 2, TEAL));
      els.push(dText(x + 15, cy + 14, cw - 30, 46, [
        mkPara([mkRun('In', { sz: 8.5, b: true, caps: 'all', spc: 100, color: FAINT, font: '+mn-lt' })]),
        mkPara([mkRun(flow[i].in, { sz: 11, color: DIM, font: '+mn-lt' })], { lnSpc: 1.3 })
      ], { body: { autofit: 'shrink' } }));
      els.push(dText(x + 15, cy + 70, cw - 30, 36, [
        mkPara([mkRun(s.n + '  ' + s.tool, { sz: 14, b: true, color: INK, font: '+mn-lt' })], { lnSpc: 1.25 })
      ], { body: { autofit: 'shrink' } }));
      els.push(dText(x + 15, cy + 112, cw - 30, 48, [
        mkPara([mkRun('Out', { sz: 8.5, b: true, caps: 'all', spc: 100, color: TEAL, font: '+mn-lt' })]),
        mkPara([mkRun(flow[i].out, { sz: 11, color: INK, font: '+mn-lt' })], { lnSpc: 1.3 })
      ], { body: { autofit: 'shrink' } }));
      if (i < STAGES.length - 1) {
        els.push(mkElement('line', {
          name: 'Flow', x: x + cw + 3, y: cy + chH / 2 - 0.5, w: gap - 6, h: 0,
          geom: 'line', fill: { type: 'none' },
          line: { color: TEAL, w: 1.25, dash: 'solid', tailEnd: 'triangle', tailSize: 3.2 }
        }));
      }
    });

    /* One line of build state, not a panel of it. */
    els.push(dText(M0, 378, CW, 76, [
      mkPara([
        mkRun('Running.  ', { sz: 13, b: true, color: TEAL, font: '+mn-lt' }),
        mkRun('Calibration set, ligase scan and benchmark, all three workbench pages, compound library.', { sz: 13, color: DIM, font: '+mn-lt' })
      ], { spcAft: 7, lnSpc: 1.42 }),
      mkPara([
        mkRun('Specified.  ', { sz: 13, b: true, color: AMBER, font: '+mn-lt' }),
        mkRun('Nomination scoring function; simulation triage before ordering.', { sz: 13, color: DIM, font: '+mn-lt' })
      ], { spcAft: 7, lnSpc: 1.42 }),
      mkPara([
        mkRun('Not started.  ', { sz: 13, b: true, color: FAINT, font: '+mn-lt' }),
        mkRun('Pose ranking, co-expression, scaffolding corpus, one pair end to end.', { sz: 13, color: DIM, font: '+mn-lt' })
      ], { lnSpc: 1.42 })
    ], { body: { autofit: 'shrink' } }));

    els.push(dText(M0, 500, 620, 16, [
      mkPara([mkRun('Lazarski  ·  Proxima  ·  October 2026', { sz: 10, color: FAINT, font: '+mn-lt' })])
    ]));

    slides.push(mkSlide({
      layout: 'blank', tag: 'workflow', elements: els,
      notes: 'Cost order: nomination is free, the ligase scan is about three seconds per pair, the geometry is seconds, and only the final step costs money.\n\n'
        + 'Every score in the stack rules a candidate out and never rules one in. The single exception is the linker-reach floor, which is a geometric bound rather than a heuristic.\n\n'
        + 'Running: the 37-case calibration set; the ligase scan with its leakage-controlled benchmark; the Exit Vectors, TC Feasibility and Cross-Species pages; the 103-compound library and the descriptor engine behind it.\n\n'
        + 'Specified and not written: the nomination scoring function, and the simulation triage that picks the final few compounds.\n\n'
        + 'Not started: pose ranking; ligase-against-target co-expression; the inhibitor-versus-knockout discordance corpus; one target–ligase pair run through all four tools.\n\n'
        + 'First candidate for an end-to-end run: a non-catalytic nuclear I&I target, STAT6 or IRF5, against CRBN.\n\n'
        + 'The test that would settle the approach: run frustration across the known glue ternary complexes and check whether glue sites are enriched for strained contacts against matched interface patches that do not bind glues. Roughly one day of work. Not run.'
    }));
  }

  /* ================================================ 16. What it taught me */
  {
    const els = dHead(16, 'What the exercise taught me', [
      ['Three things I did not expect: ', false],
      ['the data, the cost of software, and how the work divides', true]
    ]);
    dColumns(els, 190, [
      {
        label: 'Endpoints do not transfer',
        text: 'Oncology lends an essentiality screen. Inflammation and cardiometabolic disease have none, so evidence was mined by hand — and the weights that rank it are a team decision.'
      },
      {
        label: 'Bespoke software is now cheap',
        text: 'This editor took an hour, at a rounding error of what PowerPoint cost. Software keeps moving toward the single question it is built for.'
      },
      {
        label: 'Agents run in parallel',
        text: 'Work divides across parallel agents: research, implementation, and a check that never saw the work it graded.'
      }
    ], false);
    slides.push(mkSlide({
      layout: 'blank', tag: 'lessons', elements: els,
      notes: 'On endpoints. In oncology a dependency screen gives a defensible shortlist before any reading. Immunology, inflammation and cardiometabolic disease have nothing equivalent, so the target evidence had to be assembled from human genetics, expression, clinical failures and trial registries one case at a time. That makes the ranking function the whole argument, which is a reason to agree it as a team and to run more than one weighting against the same calibration set rather than trusting a single set of numbers.\n\n'
        + 'On software cost. This editor — PowerPoint import, editing, export, presenter view — was specified and built in about an hour of wall-clock time. It does a fraction of what PowerPoint does and it does it for one deck. The trade is now favourable often enough that building the tool for the question is worth considering before adapting the question to the tool.\n\n'
        + 'On agents. Three kinds of work ran concurrently: literature and provenance research, implementation, and verification. The verification agent was given the artefact and not the reasoning that produced it, which caught errors the author would have confirmed. One example: a research pass corrected the assumption that the Omni Tool performed the PPI docking; the docking is a separate component whose benchmark returned no near-native poses.\n\n'
        + 'The limit is coordination, not capacity. Parallel agents multiply throughput only where the work can be stated precisely enough to hand over.'
    }));
  }

  /* ==================================================== 17. Conclusions */
  {
    const els = dHead(17, 'Conclusions', [
      ['What the programme turned on, ', false],
      ['and what the tools now do about it', true]
    ]);
    els.push(dText(M0, 158, CW, 16, [
      mkPara([
        mkRun('In short  ', { sz: 10, b: true, caps: 'all', spc: 90, color: FAINT, font: '+mn-lt' }),
        mkRun('the decisions that set the RET programme were structural and were taken early; the tools take them earlier and against more candidates', { sz: 11, color: DIM, font: '+mn-lt' })
      ])
    ], { body: { autofit: 'shrink' } }));
    dColumns(els, 222, [
      { label: 'From Task 1', text: 'RET turned on three decisions made before any compound: which mutants, where the linker leaves, and what sets exposure.' },
      { label: 'From Task 2', text: 'Each is now a tool that runs on public structures and public data, before chemistry is committed.' },
      { label: 'Still open', text: 'No pair has been run end to end, and the ligase docking benchmark has not yet produced a near-native pose.' }
    ], true);
    slides.push(mkSlide({
      layout: 'blank', tag: 'conclusions', elements: els,
      notes: 'The claim is narrow. The RET programme succeeded because three structural decisions were taken correctly and early, and two of the three were made from a monovalent co-crystal plus a reading of the fold. Those are exactly the decisions that can be computed.\n\n'
        + 'What the tools do: nominate targets where no essentiality screen exists; propose a ligase rather than defaulting to cereblon; compute what a linker can and cannot reach from the two structures alone; and turn an interface into a compound set that can be ordered.\n\n'
        + 'What they do not do: rank poses, confirm ubiquitination competence, or predict degradation. Every score rules candidates out; none rules one in. The only hard bound is geometric.\n\n'
        + 'The honest state of the ligase step: 0 of 20 near-native poses in the top ten against a leakage-controlled benchmark, with the native partner sitting a median 9.7 Å off the sampled axis. That is reported here rather than smoothed over, because a scoring function measured on a pose 19 Å from truth is measuring the wrong complex.\n\n'
        + 'Next, in order: run one target–ligase pair end to end — a nuclear I&I target such as STAT6 or IRF5 against CRBN; then the retrospective frustration check across known glue complexes, which is about a day of work and would either support the site-selection premise or remove it.'
    }));
  }

  /* ========================================== 18. Supplemental — SMARCA2 */
  {
    const els = dHead(18, 'Supplemental — SMARCA2', [
      ['A second degrader programme where selectivity had to come from ', false],
      ['the complex, not the warhead', true]
    ]);
    dPoints(els, M0, 162, 500, [
      'The SMARCA2 and SMARCA4 bromodomain sites are nearly identical, so a selective binder was not available. Synthetic lethality in SMARCA4-deficient cancers makes the distinction essential.',
      'Models were built by mutating both surfaces to alanine, aligning the sites within linker reach, filtering on HDX signal, then restoring side chains and discarding clashes.'
    ]);
    els.push(dFig('sm2crbn', 618, 158, 282, { alt: 'SMARCA2 bromodomain in complex with cereblon' }));
    els.push(dCaption(618, 440, 282, 'SMARCA2 bromodomain with cereblon'));
    els.push(dSource(SM2_CITE));
    slides.push(mkSlide({
      layout: 'blank', tag: 'sm2-intro', elements: els,
      notes: 'SMARCA2 is the SWI/SNF-related, matrix-associated, actin-dependent regulator of chromatin, subfamily A, member 2 — a key ATPase subunit of the SWI/SNF chromatin remodelling complex. SMARCA4-deficient cancers depend on it, which is a synthetic-lethal relationship.\n\n'
        + 'The bromodomain binding sites of SMARCA2 and SMARCA4 are nearly identical, so a warhead cannot discriminate. The hypothesis was that targeted degradation could, because selectivity can be generated at the ternary complex rather than at the binary binding event, giving a wider therapeutic index than inhibition.\n\n'
        + 'Model construction, in order: mutate all surface residues of the X-ray structures to alanine; align the two binding sites so a linker can reach both without disrupting either binding mode; discard models that do not accommodate the hydrogen-deuterium exchange signal in the protein–protein interface; restore side chains and discard models with clashes.\n\n'
        + 'This produced a population of models rather than a structure, which is the normal situation and the reason the next slide exists.\n\n'
        + 'Ternary complex models by Hongwei Huang and Andy Good; HDX data from Scott Eron. Patent application WO2023244764A1.'
    }));
  }

  /* ================================= 19. Supplemental — choosing the model */
  {
    const els = dHead(19, 'Supplemental — SMARCA2', [
      ['Choosing between models by the conformations they imply: ', false],
      ['prior SAR decided it', true]
    ]);
    dPoints(els, M0, 162, 400, [
      'Models were aligned first on the target and then on the ligase, and every point where the proposed bioactive conformations diverged was catalogued.',
      'Three compounds built to favour or block the extended conformation agreed with model 1689.'
    ], 14);
    dTable(M0, 318, [66, 206, 128], 26, [
      ['Cpd', 'What it tests', 'SMARCA2 DC₅₀ / Emax'],
      ['001', 'Steric clash favours extended B', { t: '30 nM / 29%', color: TEAL }],
      ['002', 'Steric clash disfavours extended B', '915 nM / 43%'],
      ['003', 'Electron repulsion favours extended B', { t: '45 nM / 13%', color: TEAL }]
    ]).forEach((e) => els.push(e));
    els.push(dFigH('model1689', 480, 158, 208, { alt: 'SMARCA2–cereblon ternary complex model 1689' }));
    els.push(dCaption(480, 376, 212, 'Model 1689 — the differential Z-helix sits in the interface'));
    els.push(dFigH('model2546', 724, 158, 208, { alt: 'SMARCA2–cereblon ternary complex model 254601' }));
    els.push(dCaption(724, 376, 176, 'Model 254601'));
    els.push(dSource(SM2_CITE));
    slides.push(mkSlide({
      layout: 'blank', tag: 'sm2-models', elements: els,
      notes: 'Ternary complex modelling generates many physically plausible models. Before any of them can be used for design, they have to be reduced to one.\n\n'
        + 'The method: align the surviving models on the targeting ligand, then separately on the ligase ligand, and catalogue the points at which the implied bioactive conformations differ. Examples of such points — the dihedral between the phenyl ring and the ether carbon, whether the aniline ether points up or down, whether the aryl ether turns left, right or orthogonal, whether the benzylic methylene rotates up or down, whether the amide nitrogen sits left of or above the carbonyl.\n\n'
        + 'Each point of divergence is then testable: build a compound whose substitution pattern sterically or electronically favours one conformer, and see whether potency follows.\n\n'
        + 'Compounds 001 and 003 favour the extended conformation and degrade at 30 nM and 45 nM. Compound 002 disfavours it and falls to 915 nM, a roughly thirty-fold loss. Multiple examples from prior SAR agreed, so model 1689 was carried forward.\n\n'
        + 'Model 1689 places the Z-helix, one of the few differentiated regions between SMARCA2 and SMARCA4, inside the protein–protein interface — a structural candidate for the observed selectivity. Residues differing between the two paralogues are highlighted in the renders.'
    }));
  }

  /* ================================== 20. Supplemental — the design it gave */
  {
    const els = dHead(20, 'Supplemental — SMARCA2', [
      ['The model used as a design hypothesis: ', false],
      ['a spirocycle that pre-organises the linker', true]
    ]);
    dPoints(els, M0, 162, CW, [
      'A 6,6-spirocycle was proposed to hold the linker in the modelled conformation without touching either binding site.',
      'Compound 005 kept the potency, improved SMARCA4 selectivity, and cut clearance from 130 to 18 mL/min/kg.'
    ], 14);
    els.push(dFigH('spiro004', M0, 252, 222, { alt: 'Acyclic ethyl ether linker in the SMARCA2–cereblon complex' }));
    els.push(dCaption(M0, 484, 380, '004 — acyclic ethyl ether linker  ·  40 nM / 23%  ·  CL 130 mL/min/kg'));
    els.push(dFigH('spiro005', 520, 252, 222, { alt: 'Rigid spirocyclic linker in the SMARCA2–cereblon complex' }));
    els.push(dCaption(520, 484, 384, '005 — rigid spirocyclic linker  ·  50 nM / 15%  ·  CL 18 mL/min/kg'));
    slides.push(mkSlide({
      layout: 'blank', tag: 'sm2-design', elements: els,
      notes: 'The design question once model 1689 was chosen: how to make the molecule adopt that conformation without paying for it at either binding site.\n\n'
        + 'The answer was a 6,6-spirocycle in the linker, which pre-organises the torsion the model requires and removes rotatable bonds that would otherwise sample unproductive conformations.\n\n'
        + 'Compound 004, the acyclic ethyl ether linker: 40 nM to 23% remaining on SMARCA2, SMARCA4 at 65 nM inflection to 64%, clearance 130 mL/min/kg.\n\n'
        + 'Compound 005, the rigid spirocyclic linker: 50 nM to 15% remaining on SMARCA2, SMARCA4 at 110 nM to 84%, clearance 18 mL/min/kg. Deeper degradation, a wider paralogue margin and a sevenfold reduction in clearance.\n\n'
        + 'The general point this project makes, and the reason it sits behind the tools: a ternary complex model is only useful once it has been reduced to one model and tested against existing SAR. Conformational analysis cross-referenced against historic potency and selectivity data is what does the reducing.'
    }));
  }

  const deck = mkDeck({
    title: 'Lazarski — Proxima technical exercise',
    size: { w: W0, h: H0 },
    theme: themeFromScheme(DECK_THEME.name, DECK_THEME.colors, DECK_THEME.fonts),
    themeId: 'imported',
    slides
  });
  return normalizeDeck(deck);
}

/* ---------- the published RET series, as data ----------
   One table that grows across three slides, so the numbers cannot drift
   between them. Source: RSC Med. Chem. 2025, 16, 4781–4795. */

const SAR_HEAD = [
  'Cpd', 'RET KD  DC₅₀ / Emax', 'G810R  DC₅₀ / Emax', 'RET-WT  IC₅₀',
  'pVEGFR2  IC₅₀ / Emax', 'CL  mL/min/kg', 'PO AUC  ng·h/mL', 'F'
];
const SAR_ROWS = {
  15: ['5 nM / 23%', '103 nM / 37%', '43.6 nM', '>10 µM / 61%', '—', '—', '—'],
  16: ['1.9 nM / 13%', '24 nM / 24%', '9 nM', '1162 nM / 30%', '31', '8.09', '0.88%'],
  17: ['1.8 nM / 13%', '19 nM / 21%', '3.5 nM', '671 nM / 17%', '16', '181', '18%'],
  18: ['1.4 nM / 11%', '19 nM / 24%', '—', '660 nM / 18%', '15', '601', '53%'],
  19: ['1.6 nM / 8%', '19 nM / 21%', '1.7 nM', '>2670 nM / 43%', '12', '325', '23%'],
  20: ['1.7 nM / 8%', '21 nM / 22%', '4.25 nM', '5141 nM / 42%', '18', '319', '39%']
};
function SAR_HEAD_AND(which) {
  const last = which[which.length - 1];
  return [SAR_HEAD].concat(which.map((n) => {
    const lit = n === last && which.length > 1;
    return [{ t: n, color: lit ? TEAL : INK }].concat(
      SAR_ROWS[n].map((v) => (lit ? { t: v, color: INK } : v))
    );
  }));
}
