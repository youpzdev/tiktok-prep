const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.TT_TEST_URL || 'http://127.0.0.1:8767';
const root = path.resolve(__dirname, '..');

async function main() {
  const browser = await chromium.launch();
  const cases = [
    {
      name: 'empty primary action changed from browse to process', file: 'app.js', type: 'application/javascript',
      from: 'dataset.action = adding ? "add" : "process"', to: 'dataset.action = adding ? "process" : "add"',
      async verify(page) {
        let calls = 0;
        await page.route('**/api/browse', route => { calls++; return route.fulfill({ json: { paths: [], cancelled: true } }); });
        await page.locator('#btn-start').click();
        await page.waitForTimeout(500);
        assert.equal(calls, 1, 'empty primary must open the file picker exactly once');
      },
    },
    {
      name: 'intermediate control wrapping removed', file: 'style.css', type: 'text/css',
      from: '@media(min-width:701px) and (max-width:850px)', to: '@media(min-width:701px) and (max-width:700px)',
      async verify(page) {
        await page.evaluate(() => { state.queue = [{ path: '/mutation/video.mp4', name: 'video.mp4', status: 'queued' }]; render(); });
        const geometry = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
        assert(geometry.scroll <= geometry.width, `horizontal overflow: ${JSON.stringify(geometry)}`);
      },
    },
  ];
  try {
    for (const test of cases) {
      const source = fs.readFileSync(path.join(root, 'static', test.file), 'utf8');
      assert(source.includes(test.from), `${test.file}: mutation target is missing`);
      for (const mutated of [false, true]) {
        const page = await browser.newPage({ viewport: { width: 701, height: 900 }, locale: 'ru-RU', reducedMotion: 'reduce' });
        let failure;
        try {
          await page.route(`**/${test.file}`, route => route.fulfill({ contentType: test.type, body: mutated ? source.replace(test.from, test.to) : source }));
          await page.goto(base);
          await page.locator('#engine.ok').waitFor({ state: 'attached' });
          await page.evaluate(() => document.fonts.ready);
          try { await test.verify(page); } catch (error) { failure = error; }
          if (!mutated && failure) throw failure;
          if (mutated) assert(failure instanceof assert.AssertionError, `${test.name}: mutation was not caught by the behavioral assertion`);
        } finally { await page.close(); }
      }
      console.log(`CAUGHT ${test.name}; baseline passed; workspace source unchanged`);
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
