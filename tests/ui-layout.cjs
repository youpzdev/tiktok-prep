const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const base = process.env.TT_TEST_URL || 'http://127.0.0.1:8767';

async function main() {
  const browser = await chromium.launch();
  const failures = [];
  try {
    for (const width of [390, 701, 750, 900, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, locale: 'ru-RU', reducedMotion: 'reduce' });
      try {
        await page.goto(base);
        await page.locator('#engine.ok').waitFor({ state: 'attached' });
        await page.evaluate(() => document.fonts.ready);
        if (width === 390) {
          const session = await page.context().newCDPSession(page);
          await session.send('DOM.enable');
          await session.send('CSS.enable');
          const document = await session.send('DOM.getDocument');
          for (const [selector, family] of [['h1', 'Unbounded'], ['.hero-description', 'Manrope']]) {
            const { nodeId } = await session.send('DOM.querySelector', { nodeId: document.root.nodeId, selector });
            const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId });
            assert(fonts.some(font => font.isCustomFont && font.familyName.startsWith(family) && font.glyphCount > 0), `${selector}: expected rendered ${family}, got ${JSON.stringify(fonts)}`);
          }
          await session.detach();
        }
        await page.evaluate(() => { state.queue = [{ path: '/layout/video.mp4', name: 'video.mp4', status: 'queued' }]; render(); });
        const geometry = await page.evaluate(() => {
          const panel = document.querySelector('#workspace').getBoundingClientRect();
          const button = document.querySelector('#btn-start').getBoundingClientRect();
          return { viewport: innerWidth, scroll: document.documentElement.scrollWidth, buttonRight: button.right, panelRight: panel.right };
        });
        assert(geometry.scroll <= width, `${width}: horizontal overflow ${JSON.stringify(geometry)}`);
        assert(geometry.buttonRight <= geometry.panelRight - 16, `${width}: CTA outside panel padding ${JSON.stringify(geometry)}`);
        await page.locator('#btn-start').evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
        const button = await page.locator('#btn-start').boundingBox();
        assert(button.y >= 0 && button.y + button.height <= 900, `${width}: CTA outside viewport ${JSON.stringify(button)}`);
        console.log(`PASS layout ${width}`);
      } catch (error) { failures.push(error.message); }
      finally { await page.close(); }
    }
  } finally { await browser.close(); }
  assert.deepEqual(failures, [], failures.join('\n'));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
