/* docshots.js — the three pictures the README needs: the editor with a deck
   open, the presenter view, and a strip of slides. Written to docs/. */
const path = require('path'), fs = require('fs');
function req(n) { for (const b of ['', '/opt/npm-tools/node_modules/']) { try { return require(b + n); } catch (e) {} } throw new Error(n); }
const { chromium } = req('playwright');
const FILE = path.resolve(process.argv[2] || 'Deck.html');
const OUT = path.resolve(process.argv[3] || 'docs');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const pg = await (await b.newContext({ viewport: { width: 1480, height: 900 }, deviceScaleFactor: 2 })).newPage();
  await pg.goto('file://' + FILE, { waitUntil: 'load' });
  await pg.waitForFunction(() => !!window.DECK);
  await pg.waitForTimeout(500);

  await pg.evaluate(() => { window.DECK.cmd.gotoSlide(5); });
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: path.join(OUT, 'editor.png') });

  await pg.evaluate(() => { window.DECK.cmd.gotoSlide(5); window.DECK.cmd.startPresent(); });
  await pg.waitForTimeout(600);
  await pg.keyboard.press('n');          /* open the presenter pane */
  await pg.waitForTimeout(700);
  await pg.screenshot({ path: path.join(OUT, 'presenter.png') });
  await pg.evaluate(() => window.DECK.cmd.endPresent());
  await pg.waitForTimeout(300);

  await b.close();
  for (const f of ['editor.png', 'presenter.png']) {
    console.log('wrote docs/' + f + '  (' + Math.round(fs.statSync(path.join(OUT, f)).size / 1024) + ' KB)');
  }
})();
