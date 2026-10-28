/* ==========================================================================
   15-theme.js — colour schemes, fonts, and colour resolution.

   A colour in the model is one of:
     '#1B2A3F'                                  a literal
     { scheme:'accent1', lumMod:60000, ... }    a theme reference + transforms
     null                                       none
   Keeping theme references rather than flattening to hex is what lets a deck
   be re-themed after the fact, and it is also how PowerPoint stores them, so
   imported colours survive a round trip instead of being frozen on the way in.
   ========================================================================== */

/* Slide-level colour names map onto the theme's own slots. The dk/lt swap is
   the part that catches people out: in a theme, dk1 is the dark colour, and on
   a slide it is addressed as tx1 (text) while lt1 is addressed as bg1. */
const SCHEME_ALIAS = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' };

function resolveColor(c, theme, phClr) {
  if (!c) return null;
  if (typeof c === 'string') return normHex(c) || null;
  let base = null;
  if (c.hex) base = normHex(c.hex);
  else if (c.scheme) {
    if (c.scheme === 'phClr') base = normHex(phClr) || null;
    else {
      const slot = SCHEME_ALIAS[c.scheme] || c.scheme;
      const cols = (theme && theme.colors) || THEMES[0].colors;
      base = normHex(cols[slot]) || normHex(cols[c.scheme]) || null;
    }
  }
  if (!base) return null;
  /* Order matters and follows the schema: luminance, then saturation, then
     tint/shade. Office writes lumMod/lumOff for every picker variant. */
  if (c.lumMod !== undefined || c.lumOff !== undefined) base = applyLumMod(base, c.lumMod, c.lumOff);
  if (c.satMod !== undefined) base = applySatMod(base, c.satMod);
  if (c.tint !== undefined) base = applyTint(base, c.tint);
  if (c.shade !== undefined) base = applyShade(base, c.shade);
  return base;
}
/* Alpha travels separately because CSS wants it on the colour and OOXML keeps
   it as a child transform. */
const colorAlpha = (c) => (c && typeof c === 'object' && c.alpha !== undefined ? clamp(c.alpha / 100000, 0, 1) : 1);

/* Returns a CSS colour, or null when there is nothing to resolve.
   It deliberately does NOT return the string 'transparent' for an absent
   colour: 'transparent' is truthy, so `cssColor(x) || fallback` would never
   reach its fallback and text with no explicit colour would render invisible.
   Callers that want a transparent paint ask for it themselves. */
function cssColor(c, theme, phClr) {
  const hex = resolveColor(c, theme, phClr);
  if (!hex) return null;
  const a = colorAlpha(c);
  if (a >= 1) return hex;
  const rgb = hexToRgb(hex);
  return 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + round2(a) + ')';
}
const cssColorOr = (c, theme, fallback, phClr) => cssColor(c, theme, phClr) || fallback;

/* --------------------------------------------------------------------------
   Built-in themes.

   Each is a full OOXML-shaped colour scheme so that exporting writes a real
   theme1.xml and the deck arrives in PowerPoint with a working colour picker
   rather than a wall of literal hexes. The accent sets are built to stay
   distinguishable next to each other and to hold up when projected, which
   mostly means avoiding two accents of similar lightness.
   -------------------------------------------------------------------------- */
const THEMES = [
  {
    id: 'graphite', name: 'Graphite',
    colors: {
      dk1: '#16191D', lt1: '#FFFFFF', dk2: '#2B313A', lt2: '#F2F3F5',
      accent1: '#2E6BE6', accent2: '#13A3A3', accent3: '#E0A126',
      accent4: '#C7493B', accent5: '#6A4FD8', accent6: '#4E9A3F',
      hlink: '#2E6BE6', folHlink: '#6A4FD8'
    },
    fonts: { major: 'Inter', minor: 'Inter' },
    bg: '#FFFFFF', fg: '#16191D'
  },
  {
    id: 'midnight', name: 'Midnight',
    colors: {
      dk1: '#F4F6F8', lt1: '#0E1218', dk2: '#C9D2DC', lt2: '#1A212B',
      accent1: '#5AA0FF', accent2: '#2FD4C4', accent3: '#F0B429',
      accent4: '#FF7A66', accent5: '#A68BFF', accent6: '#72D572',
      hlink: '#5AA0FF', folHlink: '#A68BFF'
    },
    fonts: { major: 'Inter', minor: 'Inter' },
    bg: '#0E1218', fg: '#F4F6F8', dark: true
  },
  {
    id: 'paper', name: 'Paper',
    colors: {
      dk1: '#241F1A', lt1: '#FBF8F3', dk2: '#4A423A', lt2: '#F1EBE1',
      accent1: '#0F6C62', accent2: '#B5541F', accent3: '#8A6D2F',
      accent4: '#8C3A4A', accent5: '#3B5A7A', accent6: '#5F7034',
      hlink: '#0F6C62', folHlink: '#8C3A4A'
    },
    fonts: { major: 'Georgia', minor: 'Inter' },
    bg: '#FBF8F3', fg: '#241F1A'
  },
  {
    id: 'slate', name: 'Slate',
    colors: {
      dk1: '#EDF1F5', lt1: '#1B2733', dk2: '#B8C4D0', lt2: '#243444',
      accent1: '#E8B64C', accent2: '#4FB8D8', accent3: '#E07A5F',
      accent4: '#8FC98A', accent5: '#B8A0E8', accent6: '#D9E0E6',
      hlink: '#4FB8D8', folHlink: '#B8A0E8'
    },
    fonts: { major: 'Inter', minor: 'Inter' },
    bg: '#1B2733', fg: '#EDF1F5', dark: true
  },
  {
    id: 'clinic', name: 'Clinic',
    colors: {
      dk1: '#10242E', lt1: '#FFFFFF', dk2: '#33505C', lt2: '#EDF4F6',
      accent1: '#00707F', accent2: '#5BA4A0', accent3: '#D98324',
      accent4: '#A63D40', accent5: '#39558C', accent6: '#7E9B45',
      hlink: '#00707F', folHlink: '#A63D40'
    },
    fonts: { major: 'Inter', minor: 'Inter' },
    bg: '#FFFFFF', fg: '#10242E'
  },
  {
    id: 'crimson', name: 'Crimson',
    colors: {
      dk1: '#1C1517', lt1: '#FFFBFA', dk2: '#453236', lt2: '#F7EDEC',
      accent1: '#A8203A', accent2: '#2F6F8F', accent3: '#C98B1E',
      accent4: '#5C7A3A', accent5: '#6B4A8A', accent6: '#9A5A3C',
      hlink: '#A8203A', folHlink: '#6B4A8A'
    },
    fonts: { major: 'Inter', minor: 'Inter' },
    bg: '#FFFBFA', fg: '#1C1517'
  }
];
const themeById = (id) => THEMES.find((t) => t.id === id) || THEMES[0];

/* A theme read out of a .pptx becomes a theme object of the same shape, so the
   rest of the app cannot tell an imported scheme from a built-in one. */
function themeFromScheme(name, colors, fonts) {
  const c = Object.assign({}, THEMES[0].colors, colors || {});
  const bg = normHex(c.lt1) || '#FFFFFF';
  return {
    id: 'imported', name: name || 'From file', imported: true,
    colors: c,
    fonts: { major: (fonts && fonts.major) || 'Inter', minor: (fonts && fonts.minor) || 'Inter' },
    bg, fg: normHex(c.dk1) || '#000000',
    dark: luminance(bg) < 0.4
  };
}

/* The accent cycle used when the app needs "the next colour" — new chart
   series, the accent swatch row, the default shape fill. */
const accentCycle = (theme, i) => ({ scheme: 'accent' + (((i | 0) % 6) + 1) });

/* Font stacks. Everything resolves to fonts present on a normal machine, so
   the file needs no network and nothing reflows on a different computer. */
const FONT_STACKS = {
  Inter: '"Inter","Segoe UI",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif',
  Arial: 'Arial,"Helvetica Neue",Helvetica,sans-serif',
  Helvetica: '"Helvetica Neue",Helvetica,Arial,sans-serif',
  'Segoe UI': '"Segoe UI",system-ui,"Helvetica Neue",Arial,sans-serif',
  Calibri: 'Calibri,Carlito,"Segoe UI",system-ui,sans-serif',
  Verdana: 'Verdana,Geneva,"DejaVu Sans",sans-serif',
  Tahoma: 'Tahoma,Geneva,"DejaVu Sans",sans-serif',
  'Trebuchet MS': '"Trebuchet MS",Tahoma,sans-serif',
  Georgia: 'Georgia,"Times New Roman",Times,serif',
  'Times New Roman': '"Times New Roman",Times,Georgia,serif',
  Garamond: 'Garamond,Georgia,"Times New Roman",serif',
  Cambria: 'Cambria,Caladea,Georgia,serif',
  'Courier New': '"Courier New",Courier,monospace',
  Consolas: 'Consolas,"SF Mono",Menlo,"DejaVu Sans Mono",monospace',
  Menlo: 'Menlo,Consolas,"DejaVu Sans Mono",monospace',
  Impact: 'Impact,"Haettenschweiler","Arial Narrow Bold",sans-serif',
  'Comic Sans MS': '"Comic Sans MS","Comic Sans",cursive'
};
const FONT_MENU = ['Inter', 'Arial', 'Helvetica', 'Segoe UI', 'Calibri', 'Verdana', 'Tahoma', 'Trebuchet MS',
  'Georgia', 'Times New Roman', 'Garamond', 'Cambria', 'Courier New', 'Consolas', 'Menlo', 'Impact', 'Comic Sans MS'];

function fontStack(name, theme) {
  if (!name) return FONT_STACKS[(theme && theme.fonts && theme.fonts.minor) || 'Inter'] || FONT_STACKS.Inter;
  /* +mj-lt / +mn-lt are the theme's major and minor latin fonts. */
  if (name === '+mj-lt') return fontStack((theme && theme.fonts && theme.fonts.major) || 'Inter', theme);
  if (name === '+mn-lt') return fontStack((theme && theme.fonts && theme.fonts.minor) || 'Inter', theme);
  if (FONT_STACKS[name]) return FONT_STACKS[name];
  /* An unknown face from an imported deck is still named first, so it is used
     where it happens to be installed and falls back cleanly where it is not. */
  return '"' + String(name).replace(/"/g, '') + '",' + FONT_STACKS.Inter;
}

/* UI chrome tokens derived from a theme, so the editor shell can tint itself
   to the deck being edited without a second palette to maintain. */
function uiTokens(theme) {
  const t = theme || THEMES[0];
  const acc = resolveColor({ scheme: 'accent1' }, t) || '#2E6BE6';
  return { accent: acc, accentText: readableOn(acc) };
}
