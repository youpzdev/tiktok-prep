const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const base = process.env.TT_TEST_URL || 'http://127.0.0.1:8767';
const failures = [];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const scenarios = {
    async 'server restart does not replay an unknown start'(page) {
      let instance = 'a'.repeat(32), starts = 0;
      await page.route('**/api/status', async route => {
        const data = await (await route.fetch()).json();
        await route.fulfill({ json: { ...data, instance_id: instance } });
      });
      await page.evaluate(() => checkEngine());
      await page.route('**/api/process', route => { starts++; return route.abort(); });
      await page.evaluate(() => { state.queue = [{ path: '/test/restart.mp4', name: 'restart.mp4', status: 'queued' }]; render(); });
      await page.locator('#btn-start').click();
      await page.waitForFunction(() => !state.starting);
      instance = 'b'.repeat(32);
      await page.locator('#btn-start').click();
      await page.waitForFunction(() => !state.starting);
      assert.equal(starts, 1, 'retry must stop when its engine check discovers a restarted server');
      assert.equal(await page.evaluate(() => state.queue[0].status), 'error');
      assert(await page.locator('#notice').isVisible());
      await page.locator('#btn-start').click();
      await page.waitForFunction(() => !state.starting);
      assert.equal(starts, 2, 'a separate explicit action may start a fresh request');
      instance = 'c'.repeat(32);
      await page.reload();
      await page.locator('#engine.ok').waitFor();
      assert.equal(await page.evaluate(() => state.pending), null, 'unknown request from another server instance must require an explicit fresh decision');
      assert.equal(await page.evaluate(() => state.queue[0].status), 'error');
      assert.equal(starts, 2, 'reopening must not replay the request');
      assert(await page.locator('#notice').isVisible());
    },
    async 'lost start response retains the same request across reload'(page) {
      const requests = [];
      await page.route('**/api/process', route => {
        requests.push(route.request().postDataJSON());
        return requests.length === 1 ? route.abort() : route.fulfill({ json: { job: 'recovered-job' } });
      });
      await page.route('**/api/job/recovered-job', route => route.fulfill({ json: { status: 'done', files: [{ src: '/test/retry.mp4', status: 'done', progress: 1 }] } }));
      await page.evaluate(() => { state.queue = [{ path: '/test/retry.mp4', name: 'retry.mp4', status: 'queued' }]; render(); });
      await page.locator('#btn-start').click();
      await page.waitForFunction(() => !state.starting);
      assert.match(requests[0].request_id || '', /^[a-f0-9]{32}$/, 'request id must exist before the first POST');
      await page.reload();
      await page.locator('#engine.ok').waitFor();
      assert.equal(await page.locator('.row').count(), 1, 'pending queue must survive reload');
      await page.locator('#btn-start').click();
      await page.locator('.row.done').waitFor();
      assert.deepEqual(requests[1], requests[0], 'retry must repeat the exact payload and id');
      assert.equal(await page.evaluate(() => sessionStorage.getItem('pending-job')), null);
    },
    async 'queued uploads keep processing locked'(page) {
      let releaseSecond;
      const secondGate = new Promise(resolve => { releaseSecond = resolve; });
      let uploads = 0;
      await page.route('**/api/upload', async route => {
        uploads++;
        if (uploads === 2) await secondGate;
        await route.fulfill({ json: { path: `/test/${uploads}.mp4` } });
      });
      await page.route('**/api/probe', route => route.fulfill({ json: { files: [{ width: 128, height: 96, fps: 60, size: 1000 }] } }));
      await page.evaluate(() => {
        uploadFiles([new File(['first'], 'first.mp4')]);
        uploadFiles([new File(['second'], 'second.mp4')]);
      });
      try {
        await page.waitForFunction(() => state.queue.length === 1 && state.queue[0].status === 'queued');
        await page.waitForTimeout(100);
        assert.equal(uploads, 2, 'second upload must have started');
        assert.equal(await page.locator('#btn-start').isDisabled(), true, 'processing must stay locked while the second upload is pending');
      } finally { releaseSecond(); }
      await page.waitForFunction(() => state.queue.length === 2 && !state.uploading);
      assert(await page.locator('#btn-start').isEnabled());
    },
    async 'missing restored job allows explicit recovery'(page) {
      await page.route('**/api/process', route => route.fulfill({ json: { job: 'missing-job' } }));
      await page.route('**/api/job/missing-job', route => route.fulfill({ status: 404, json: { error: 'job not found' } }));
      await page.evaluate(() => {
        state.queue = [{ path: '/test/missing.mp4', name: 'missing.mp4', status: 'queued' }];
        render();
      });
      await page.locator('#btn-start').click();
      await page.waitForFunction(() => !state.running && state.queue[0].status === 'error', null, { timeout: 1500 });
      assert(await page.locator('#btn-start').isEnabled(), 'missing job must permit explicit retry');
      assert.equal(await page.evaluate(() => sessionStorage.getItem('active-job')), null);
      assert(await page.locator('#notice').isVisible());
      await page.locator('#btn-clear').click();
      assert.equal(await page.locator('.row').count(), 0);
    },
  };
  try {
    for (const [name, scenario] of Object.entries(scenarios)) {
      const context = await browser.newContext({ locale: 'ru-RU', reducedMotion: 'reduce' });
      const page = await context.newPage();
      try {
        await page.goto(base);
        await page.locator('#engine.ok').waitFor();
        await scenario(page);
        console.log(`PASS ${name}`);
      } catch (error) { failures.push(`${name}: ${error.message}`); }
      finally { await context.close(); }
    }
  } finally { await browser.close(); }
  assert.deepEqual(failures, [], failures.join('\n'));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
