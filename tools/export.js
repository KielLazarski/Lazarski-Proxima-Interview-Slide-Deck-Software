/* Drives the app's own export path in a real browser and writes the files, so
   what ships is what the editor produces rather than a second code path. */
const fs = require('fs'), path = require('path');
function req(n) { for (const b of ['', '/opt/npm-tools/node_modules/']) { try { return require(b + n); } catch (e) {} } throw new Error('cannot load ' + n); }
const { chromium } = req('playwright');

(async () => {
  const file = path.resolve(process.argv[2] || 'Deck.html');
  const outDir = path.resolve(process.argv[3] || 'out');
  const stem = process.argv[4] || 'Lazarski-Proxima-technical-exercise';
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch();
  const pg = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const errs = [];
  pg.on('pageerror', (e) => errs.push(String(e)));
  pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto('file://' + file, { waitUntil: 'load', timeout: 60000 });
  await pg.waitForFunction(() => !!window.DECK, { timeout: 20000 });
  await pg.waitForTimeout(600);

  /* .pptx and the lossless project file, straight out of the app */
  for (const [ext, fn] of [['pptx', 'exportPptx']]) {
    const b64 = await pg.evaluate(async (f) => {
      const blob = await window.DECK.io[f](window.DECK.app.deck);
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = ''; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
      return btoa(s);
    }, fn);
    const p = path.join(outDir, stem + '.' + ext);
    fs.writeFileSync(p, Buffer.from(b64, 'base64'));
    console.log('wrote ' + p + '  (' + Math.round(fs.statSync(p).size / 1024) + ' KB)');
  }
  const proj = await pg.evaluate(() => JSON.stringify(window.DECK.app.deck));
  fs.writeFileSync(path.join(outDir, stem + '.deck.json'), proj);
  console.log('wrote ' + path.join(outDir, stem + '.deck.json') + '  (' + Math.round(proj.length / 1024) + ' KB)');

  /* PDF through the same print stylesheet the browser's own Save-as-PDF uses */
  await pg.evaluate(() => {
    const real = window.print; window.print = () => {};
    window.DECK.io.exportPdf(); window.print = real;
  });
  await pg.waitForTimeout(900);
  const pdf = path.join(outDir, stem + '.pdf');
  await pg.pdf({ path: pdf, width: '13.333in', height: '7.5in', printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } });
  console.log('wrote ' + pdf + '  (' + Math.round(fs.statSync(pdf).size / 1024) + ' KB)');

  await browser.close();
  if (errs.length) { console.error('PAGE ERRORS:\n' + errs.join('\n')); process.exit(1); }
})();
