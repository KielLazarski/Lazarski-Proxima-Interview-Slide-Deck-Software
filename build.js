#!/usr/bin/env node
/* build.js — concatenate src/ into one self-contained HTML file.

   The modules are plain scripts sharing one top-level scope rather than ES
   modules, so order matters and is declared here. Each file is checked for
   syntax before it goes in, which catches a typo at build time instead of as
   a blank page.
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, 'src');
const ORDER = [
  '00-util.js',
  '05-zip.js',
  '10-geom.js',
  '15-theme.js',
  '20-model.js',
  '25-render.js',
  '30-state.js',
  '35-canvas.js',
  '40-text.js',
  '45-ui.js',
  '48-inspector.js',
  '55-import-pptx.js',
  '60-export-pptx.js',
  '65-io.js',
  '70-present.js',
  '75-shortcuts.js',
  '88-figures.js',
  '90-deck.js',
  '99-main.js'
];

const OUT = process.argv[2] || path.join(__dirname, 'Deck.html');
const APP_TITLE = 'Custom Lazarski - Proxima Interview Slide Software';

function read(f) { return fs.readFileSync(path.join(SRC, f), 'utf8'); }

let js = '';
let errors = 0;
for (const f of ORDER) {
  const code = read(f);
  try { new vm.Script(code, { filename: f }); }
  catch (e) {
    console.error('SYNTAX  ' + f + ': ' + e.message);
    errors += 1;
  }
  js += '\n/* ===== src/' + f + ' ===== */\n' + code;
}
if (errors) { console.error('\n' + errors + ' file(s) failed to parse; not writing output.'); process.exit(1); }

/* The whole bundle must also parse as one unit — duplicate top-level `const`
   across two files is legal in separate scripts and fatal in one. */
try { new vm.Script(js, { filename: 'bundle.js' }); }
catch (e) {
  console.error('SYNTAX  bundle: ' + e.message);
  process.exit(1);
}

const css = read('app.css');

/* The deck's own fonts resolve to locally installed faces, so the file needs
   no network at all. */
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${APP_TITLE}</title>
<meta name="description" content="A presentation editor that runs entirely in this page. Opens and writes PowerPoint files, exports PDF.">
<meta name="color-scheme" content="dark">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#15181B"/><rect x="6" y="8.5" width="20" height="13" rx="1.6" fill="#3FB8A0"/><rect x="13.4" y="22.6" width="5.2" height="1.6" rx=".8" fill="#3FB8A0"/></svg>')}">
<style>
${css}
</style>
</head>
<body>
<noscript><p style="padding:28px;font:15px system-ui;color:#E6EAEE">This presentation editor needs JavaScript. Everything runs locally in your browser; nothing is sent anywhere.</p></noscript>
<script>
"use strict";
${js}
</script>
</body>
</html>
`;

fs.writeFileSync(OUT, html, 'utf8');
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log('wrote ' + path.relative(process.cwd(), OUT) + '  (' + kb + ' KB, ' + ORDER.length + ' modules)');
