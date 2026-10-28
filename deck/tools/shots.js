/* shots.js — render each slide on its own, with no editor chrome, plus the
   imported fixture, so the output can be judged as a deck rather than as a UI. */
const path = require('path'), fs = require('fs');
function req(n){for(const b of ['','/opt/npm-tools/node_modules/']){try{return require(b+n)}catch(e){}}throw new Error(n)}
const { chromium } = req('playwright');
const FILE = path.resolve(process.argv[2] || 'Deck.html');
const OUT = path.resolve(process.argv[3] || 'test/slides');
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const pg = await (await b.newContext({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 2 })).newPage();
  await pg.goto('file://' + FILE, { waitUntil: 'load' });
  await pg.waitForFunction(() => !!window.DECK);
  await pg.waitForTimeout(400);

  async function shoot(prefix, loader) {
    const n = await pg.evaluate(loader);
    for (let i = 0; i < n; i++) {
      await pg.evaluate((k) => {
        const d = window.DECK;
        document.querySelectorAll('.__sheet').forEach((x) => x.remove());
        const host = document.createElement('div');
        host.className = '__sheet';
        host.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#2A2F35;display:grid;place-items:center';
        const node = d.render.renderSlideFitted(d.app.deck.slides[k], d.app.deck, { prompts: false });
        const s = Math.min(1180 / d.app.deck.size.w, 700 / d.app.deck.size.h);
        node.style.transformOrigin = 'top left';
        node.style.transform = 'scale(' + s + ')';
        const box = document.createElement('div');
        box.style.cssText = 'width:' + (d.app.deck.size.w * s) + 'px;height:' + (d.app.deck.size.h * s) + 'px;position:relative;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.6)';
        box.appendChild(node); host.appendChild(box); document.body.appendChild(host);
      }, i);
      await pg.waitForTimeout(170);
      await pg.screenshot({ path: path.join(OUT, prefix + (i + 1) + '.png') });
    }
    await pg.evaluate(() => document.querySelectorAll('.__sheet').forEach((x) => x.remove()));
  }

  await shoot('deck-', () => { window.DECK.cmd.loadDeck(window.DECK.cmd.buildDefaultDeck(), 'd'); return window.DECK.app.deck.slides.length; });

  const b64 = fs.readFileSync('test/fixture.pptx').toString('base64');
  await pg.evaluate(async (s) => {
    const bin = atob(s); const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const { deck } = await window.DECK.io.importPptx(u8.buffer, 'fixture.pptx');
    window.DECK.cmd.loadDeck(deck, 'fixture');
  }, b64);
  await pg.waitForTimeout(400);
  await shoot('import-', () => window.DECK.app.deck.slides.length);

  await b.close();
  console.log('wrote ' + fs.readdirSync(OUT).length + ' images to ' + OUT);
})();
