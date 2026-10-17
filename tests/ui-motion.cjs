const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const base = process.env.TT_TEST_URL || 'http://127.0.0.1:8767';
const shots = path.resolve(__dirname, '..', 'shots');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU', recordVideo: { dir: path.join(shots, 'motion'), size: { width: 1440, height: 900 } } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.route('**/api/browse', route => route.fulfill({ json: { paths: ['/motion/edit.mp4'] } }));
    const info = { width: 1080, height: 1920, fps: 60, size: 24000000 };
    await page.route('**/api/probe', route => route.fulfill({ json: { files: [info] } }));
    await page.route('**/api/process', route => route.fulfill({ json: { job: 'motion-check' } }));
    let polls = 0;
    await page.route('**/api/job/motion-check', route => {
      const progress = Math.min(++polls * .15, 1);
      return route.fulfill({ json: { status: progress === 1 ? 'done' : 'running', files: [{ src: '/motion/edit.mp4', status: progress === 1 ? 'done' : 'processing', progress, before: info, after: progress === 1 ? info : null, dst: '/motion/tiktok_ready/edit_tiktok.mp4' }] } });
    });
    await page.goto(base);
    await page.locator('#engine.ok').waitFor();
    await page.locator('#workspace').scrollIntoViewIfNeeded();
    await page.locator('#empty').hover();
    await page.waitForTimeout(600);
    const dropTransform = await page.locator('.drop-icon').evaluate(node => getComputedStyle(node).transform);
    assert.notEqual(dropTransform, 'none');
    await page.screenshot({ path: path.join(shots, '12-desktop-workspace-hover.png') });
    await page.locator('[data-mode="max"]').click();
    await page.waitForTimeout(180);
    const middle = await page.locator('#modes').evaluate(node => getComputedStyle(node, '::before').transform);
    await page.locator('[data-mode="stealth"]').click();
    await page.locator('[data-mode="max"]').click();
    await page.waitForTimeout(650);
    const final = await page.locator('#modes').evaluate(node => getComputedStyle(node, '::before').transform);
    assert.notEqual(middle, final, 'mode highlight must travel and settle after interruption');
    assert.equal(await page.locator('[data-mode="max"]').getAttribute('aria-checked'), 'true');
    await page.locator('#empty').click();
    await page.locator('.row.queued').waitFor();
    await page.locator('#btn-start').click();
    await page.locator('.row.processing').waitFor();
    const progressMotion = await page.locator('.row-bar-fill').evaluate(node => getComputedStyle(node, '::after').animationName);
    assert.equal(progressMotion, 'progress-sweep');
    await page.screenshot({ path: path.join(shots, '13-desktop-workspace-processing.png') });
    await page.locator('.row.done').waitFor();
    await page.waitForTimeout(650);
    await page.screenshot({ path: path.join(shots, '14-desktop-workspace-result.png') });
    const frameTimes = await page.evaluate(() => new Promise(resolve => {
      const deltas = []; let previous;
      function sample(time) { if (previous) deltas.push(time - previous); previous = time; if (deltas.length < 60) requestAnimationFrame(sample); else resolve(deltas); }
      requestAnimationFrame(sample);
    }));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const still = await page.screenshot();
    await page.waitForTimeout(300);
    assert(still.equals(await page.screenshot()), 'reduced motion must stop decorative motion');
    await page.locator('[data-mode="stealth"]').click();
    assert.equal(await page.locator('[data-mode="stealth"]').getAttribute('aria-checked'), 'true');
    assert.equal(await page.locator('#modes').evaluate(node => getComputedStyle(node, '::before').transitionDuration), '0s');
    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU', hasTouch: true });
    try {
      const mobile = await mobileContext.newPage();
      mobile.on('pageerror', error => errors.push(error.message));
      await mobile.route('**/api/probe', route => route.fulfill({ json: { files: [info] } }));
      await mobile.goto(base);
      await mobile.locator('#engine.ok').waitFor();
      await mobile.evaluate(() => addPaths(['/motion/a long video filename for the final TikTok export.mp4']));
      await mobile.locator('[data-mode="max"]').click();
      await mobile.waitForTimeout(650);
      assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const cta = await mobile.locator('#btn-start').boundingBox();
      assert(cta.y >= 0 && cta.y + cta.height <= 844);
      await mobile.screenshot({ path: path.join(shots, '15-mobile-motion-workspace.png'), fullPage: true });
      await mobile.locator('.row .icon-btn').click();
      await mobile.waitForFunction(() => document.querySelectorAll('.row').length === 0);
      await mobile.emulateMedia({ reducedMotion: 'reduce' });
      await mobile.locator('[data-mode="stealth"]').click();
      assert.equal(await mobile.locator('[data-mode="stealth"]').getAttribute('aria-checked'), 'true');
    } finally { await mobileContext.close(); }
    assert.deepEqual(errors, []);
    const sorted = frameTimes.toSorted((a, b) => a - b);
    console.log(JSON.stringify({ checks: ['drop hover', 'mode transition interruption', 'queue entry', 'progress sweep', 'result reveal', 'reduced motion change during use'], frames: { medianMs: sorted[30], p95Ms: sorted[57] }, browserErrors: errors }, null, 2));
  } finally {
    const video = page.video();
    await context.close();
    if (video) { const recorded = await video.path(); fs.copyFileSync(recorded, path.join(shots, 'workspace-motion.webm')); }
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
