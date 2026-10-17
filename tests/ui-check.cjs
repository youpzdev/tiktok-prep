const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const base = process.env.TT_TEST_URL || 'http://127.0.0.1:8766';
const source = process.env.TT_TEST_VIDEO;
const root = path.resolve(__dirname, '..');
const shots = path.join(root, 'shots');

async function main() {
  assert(source && fs.existsSync(source), 'TT_TEST_VIDEO must point to a local video');
  fs.mkdirSync(shots, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'prep-ui-check-'));
  const testVideo = path.join(scratch, 'video.mp4');
  fs.copyFileSync(source, testVideo);
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const checks = [];
  try {
    for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
      const context = await browser.newContext({ viewport: { width, height }, locale: 'ru-RU', reducedMotion: 'reduce', hasTouch: name === 'mobile' });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error' && !message.text().includes('net::ERR_FAILED')) errors.push(message.text()); });
      let chosen = testVideo;
      const browseModes = [];
      await page.route('**/api/browse', route => {
        browseModes.push(route.request().postDataJSON().mode);
        return route.fulfill({ json: { paths: Array.isArray(chosen) ? chosen : [chosen] } });
      });
      await page.goto(base);
      await page.locator('#engine.ok').waitFor({ state: 'attached' });
      await page.locator('#modes button').first().waitFor();
      assert(await page.locator('#btn-start').isDisabled());
      await page.screenshot({ path: path.join(shots, `01-${name}-empty.png`), fullPage: true });
      await page.locator('[data-mode="max"]').click();
      assert.equal(await page.locator('[data-mode="max"]').getAttribute('aria-checked'), 'true');
      await page.locator('[data-mode="max"]').press('ArrowLeft');
      assert.equal(await page.locator('[data-mode="stealth"]').getAttribute('aria-checked'), 'true');
      await page.locator('[data-lang="en"]').click();
      assert.equal(await page.locator('#btn-files').innerText(), 'Add files');
      await page.locator('[data-lang="ru"]').click();
      await page.locator('#ghost').uncheck();
      await page.reload();
      await page.locator('#engine.ok').waitFor({ state: 'attached' });
      assert(!(await page.locator('#ghost').isChecked()));
      await page.locator('#ghost').check();
      assert.equal(await page.locator('#empty').evaluate(element => element.tagName), 'BUTTON');
      await page.locator('#empty').press('Enter');
      await page.locator('.row.queued').waitFor();
      assert(await page.locator('#btn-start').isEnabled());
      await page.locator('#btn-folder').click();
      assert.equal(await page.locator('.row').count(), 1);
      assert.deepEqual(browseModes, ['files', 'folder']);
      await page.screenshot({ path: path.join(shots, `02-${name}-queued.png`), fullPage: true });
      let bounds = await page.locator('#btn-start').boundingBox();
      assert(bounds && bounds.y >= 0 && bounds.y + bounds.height <= height, `${name}: primary action outside viewport`);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: horizontal overflow`);
      await page.locator('.method-details summary').click();
      assert(await page.locator('#mode-note').isVisible());
      await page.screenshot({ path: path.join(shots, `03-${name}-details.png`), fullPage: true });
      await page.locator('.method-details summary').click();
      await page.locator('.row .icon-btn').click();
      await page.waitForFunction(() => document.querySelectorAll('.row').length === 0);
      const longName = 'A very long video filename with spaces and several descriptive words for the final export version 2026.mp4';
      const longPath = path.join(scratch, longName);
      fs.copyFileSync(source, longPath);
      chosen = longPath;
      await page.locator('#btn-files').click();
      await page.locator('.row.queued').waitFor();
      await page.evaluate(() => window.scrollTo(0, 0));
      bounds = await page.locator('#btn-start').boundingBox();
      assert(bounds.y + bounds.height <= height, `${name}: long filename hides primary action`);
      await page.screenshot({ path: path.join(shots, `04-${name}-long-name.png`), fullPage: true });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.locator('#btn-clear').click();
      await page.waitForFunction(() => document.querySelectorAll('.row').length === 0);
      chosen = path.join(scratch, 'missing.mp4');
      await page.locator('#btn-files').click();
      await page.locator('.row.error').waitFor();
      await page.locator('.row-err summary').click();
      await page.screenshot({ path: path.join(shots, `05-${name}-error.png`), fullPage: true });
      assert(await page.locator('.row-err pre').isVisible());
      await page.locator('#btn-clear').click();
      await page.waitForFunction(() => document.querySelectorAll('.row').length === 0);
      chosen = testVideo;
      await page.locator('#btn-files').click();
      await page.locator('.row.queued').waitFor();
      if (name === 'desktop') {
        await page.locator('#btn-start').click();
        await page.locator('.row.done').waitFor({ timeout: 120000 });
        assert(await page.locator('#btn-open').isVisible());
        assert(fs.existsSync(path.join(scratch, 'tiktok_ready', 'video_tiktok.mp4')));
        await page.screenshot({ path: path.join(shots, '06-desktop-result.png'), fullPage: true });
        checks.push('real processing and result');
        await page.locator('#btn-clear').click();
        await page.locator('[data-mode="max"]').click();
        await page.locator('#btn-files').click();
        await page.locator('.row.queued').waitFor();
        const maxRequest = page.waitForRequest(request => request.url().endsWith('/api/process'));
        await page.locator('#btn-start').click();
        assert.equal((await maxRequest).postDataJSON().mode, 'max');
        await page.locator('.row.done').waitFor({ timeout: 120000 });
        const maxItem = await page.evaluate(() => state.queue[0]);
        assert.equal(maxItem.copied, false);
        assert(maxItem.patch.ghost_samples > 0);
        assert(maxItem.after.fps <= 60);
        await page.screenshot({ path: path.join(shots, '11-desktop-max-result.png'), fullPage: true });
        await page.locator('[data-mode="stealth"]').click();
        checks.push('real Max processing from the new interface');
      } else {
        let processBody;
        let cancelled = false;
        await page.route('**/api/process', route => {
          processBody = route.request().postDataJSON();
          return route.fulfill({ json: { job: 'ui-cancel-check' } });
        });
        await page.route('**/api/job/ui-cancel-check', route => route.fulfill({ json: {
          status: cancelled ? 'cancelled' : 'running',
          files: [{ src: testVideo, status: cancelled ? 'cancelled' : 'processing', progress: 0.42 }]
        } }));
        await page.route('**/api/cancel', route => {
          assert.equal(route.request().postDataJSON().job, 'ui-cancel-check');
          cancelled = true;
          return route.fulfill({ json: { ok: true } });
        });
        await page.locator('#btn-start').click();
        await page.locator('.row.processing').waitFor();
        assert.equal(processBody.mode, 'stealth');
        assert.equal(processBody.ghost, 10);
        assert(await page.locator('#ghost').isDisabled());
        await page.screenshot({ path: path.join(shots, '07-mobile-processing.png'), fullPage: true });
        await page.locator('#btn-clear').click();
        await page.locator('.row.cancelled').waitFor();
        assert(await page.locator('#btn-start').isEnabled());
        checks.push('controlled progress and cancellation UI');
      }
      checks.push(`${name}: empty, queue, modes, keyboard, language, persistence, details, remove, clear, long filename, error, viewport`);
      await page.locator('#btn-clear').click();
      await page.waitForFunction(() => document.querySelectorAll('.row').length === 0);
      chosen = Array.from({ length: 12 }, (_, index) => {
        const file = path.join(scratch, `batch-${index}.mp4`);
        fs.copyFileSync(source, file);
        return file;
      });
      await page.locator('#btn-files').click();
      await page.waitForFunction(() => document.querySelectorAll('.row.queued').length === 12);
      await page.evaluate(() => window.scrollTo(0, 0));
      bounds = await page.locator('#btn-start').boundingBox();
      assert(bounds.y >= 0 && bounds.y + bounds.height <= height, `${name}: batch hides primary action`);
      await page.screenshot({ path: path.join(shots, `09-${name}-batch.png`) });
      await page.locator('#btn-clear').click();
      await page.waitForFunction(() => document.querySelectorAll('.row').length === 0);
      await page.evaluate(() => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(['text'], 'notes.txt', { type: 'text/plain' }));
        window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer }));
      });
      assert(await page.locator('#notice').isVisible());
      await page.keyboard.press('Escape');
      let uploadedBytes = 0;
      await page.route('**/api/upload', route => {
        uploadedBytes = route.request().postDataBuffer().length;
        return route.fulfill({ json: { path: testVideo } });
      });
      await page.evaluate(() => window.dispatchEvent(new DragEvent('dragenter')));
      assert(await page.locator('#drop-veil').isVisible());
      await page.screenshot({ path: path.join(shots, `10-${name}-drop.png`) });
      await page.evaluate(base64 => {
        const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
        const transfer = new DataTransfer();
        transfer.items.add(new File([bytes], 'video.mp4', { type: 'video/mp4' }));
        window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer }));
      }, fs.readFileSync(source).toString('base64'));
      await page.locator('.row.queued').waitFor();
      assert.equal(uploadedBytes, fs.statSync(source).size);
      assert(!(await page.locator('#drop-veil').isVisible()));
      checks.push(`${name}: batch scrolling, unsupported file, drag and drop`);
      await page.route('**/api/status', route => route.abort());
      await page.evaluate(() => checkEngine());
      assert(await page.locator('#engine.bad').isVisible());
      assert(await page.locator('#btn-start').isDisabled());
      await page.screenshot({ path: path.join(shots, `08-${name}-offline.png`), fullPage: true });
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ checks, browserErrors: errors }, null, 2));
  } finally {
    await browser.close();
    const safeRoot = path.resolve(os.tmpdir()) + path.sep;
    assert(scratch.startsWith(safeRoot) && path.basename(scratch).startsWith('prep-ui-check-'));
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
