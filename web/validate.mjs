// Bounded browser validation: starts and closes its own production preview.
// RPC is mocked only for unsigned-plan preparation; nothing is signed or sent.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { createPreview } from './preview.mjs';
import { Interface } from '../site/vendor/ethers.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const evidence = resolve(root, 'test/scratch/browser-check');
await mkdir(evidence, { recursive: true });
const deployment = JSON.parse(await readFile(resolve(root, 'dist/deployment.json'), 'utf8'));
const server = await createPreview();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/preview/`;
const selector = new Interface(['function processFees()']).encodeFunctionData('processFees');

try {
  const engines = process.argv.includes('--chromium') ? [['chromium', chromium]] : [['chromium', chromium], ['webkit', webkit]];
  for (const [name, engine] of engines) {
    const browser = await engine.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
      if (name === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      const page = await context.newPage();
      const errors = [], failed = [], rpcCalls = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('response', response => { if (response.url().startsWith(url) && response.status() >= 400) failed.push(response.url()); });
      page.on('requestfailed', request => { if (request.url().startsWith(url)) failed.push(request.url()); });
      await page.route('https://**/*', async route => {
        const request = route.request().postDataJSON();
        rpcCalls.push(request);
        assert.ok(['eth_chainId', 'eth_getCode'].includes(request.method), `Unexpected RPC: ${request.method}`);
        await route.fulfill({ json: { jsonrpc: '2.0', id: request.id, result: request.method === 'eth_chainId' ? '0x1' : '0x6000' } });
      });
      const idle = () => page.waitForFunction(() => document.body.getAttribute('aria-busy') !== 'true');
      const click = async id => { await page.locator(`#${id}`).click(); await idle(); };
      const navigate = async hash => { await page.locator(`nav a[href="#${hash}"]`).click(); await page.locator(`#${hash}`).waitFor({ state: 'visible' }); };
      await page.goto(url);
      await page.locator('#launch-status').filter({ hasText: 'LIVE' }).waitFor({ state: 'attached' });
      const bounds = await page.locator('#generate').boundingBox();
      assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 844, 'Generate must be on the first 390px screen');
      assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).color), 'rgb(0, 255, 0)');
      assert.equal(await page.locator('html').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(0, 0, 0)');
      await page.screenshot({ path: resolve(evidence, `${name}-390-home.png`), fullPage: false });
      assert.equal(rpcCalls.length, 0, 'No RPC or wallet connection on load');

      await page.locator('#wallet-count').fill('0');
      await click('generate');
      assert.match(await page.locator('#notice').innerText(), /1|50/);
      assert.equal(await page.locator('.wallet').count(), 0);
      await page.locator('#wallet-count').fill('3');
      await page.locator('#generate').focus();
      await page.keyboard.press('Enter');
      await idle();
      await page.locator('#manage').waitFor({ state: 'visible' });
      assert.equal(await page.locator('.wallet').count(), 3);
      const addresses = await page.locator('.wallet-address').evaluateAll(els => els.map(el => el.firstChild.textContent));
      assert.equal(new Set(addresses).size, 3);
      assert.ok(addresses.every(address => /^0x[0-9a-fA-F]{40}$/.test(address)));
      assert.equal(rpcCalls.length, 0, 'Generation sends no RPC');
      if (name === 'chromium') {
        await click('copy-addresses');
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), addresses.join('\n'));
      }

      const passphrase = 'Browser validation temporary backup';
      await page.locator('#export-password').fill(passphrase);
      await page.locator('#export-confirm').fill(passphrase);
      const [backup] = await Promise.all([page.waitForEvent('download'), click('export')]);
      const encrypted = await readFile(await backup.path(), 'utf8');
      assert.equal(JSON.parse(encrypted).format, 'imdbundler-vault');
      assert.ok(addresses.every(address => !encrypted.includes(address)));
      assert.equal(await page.locator('#export-password').inputValue(), '');

      await navigate('snipe');
      await page.locator('#buy-mode').selectOption('raw');
      await page.locator('#target').fill(deployment.hook);
      await page.locator('#buy-value').fill('0');
      await page.locator('#calldata').fill(selector);
      await click('prepare-buy');
      assert.match(await page.locator('#notice').innerText(), /Confirm/);
      await page.locator('#review-target').check();
      await click('prepare-buy');
      assert.equal(await page.locator('.transaction').count(), 3);
      const [planDownload] = await Promise.all([page.waitForEvent('download'), click('download-plan')]);
      const plan = JSON.parse(await readFile(await planDownload.path(), 'utf8'));
      assert.equal(plan.kind, 'reviewed-contract-call');
      assert.equal(plan.atomic, false);
      assert.equal(plan.transactions.length, 3);
      assert.ok(plan.transactions.every(tx => tx.to.toLowerCase() === deployment.hook.toLowerCase() && tx.data === selector));
      assert.ok(!JSON.stringify(plan).includes('privateKey'));
      await page.locator('#calldata').fill(selector + '00');
      assert.equal(await page.locator('.transaction').count(), 0, 'Editing clears a stale plan');

      await navigate('pnl');
      for (const [exit, pose] of [['0.015', 'happy'], ['0.005', 'sad'], ['0.01', 'thinking']]) {
        await page.locator('#pnl-exit').fill(exit);
        await click('render-pnl');
        assert.match(await page.locator('#pnl-description').innerText(), new RegExp(pose));
      }
      const [pngDownload] = await Promise.all([page.waitForEvent('download'), click('download-pnl')]);
      const png = await readFile(await pngDownload.path());
      assert.equal(png.subarray(1, 4).toString(), 'PNG');
      assert.equal(png.readUInt32BE(16), 1200);
      assert.equal(png.readUInt32BE(20), 800);
      await page.screenshot({ path: resolve(evidence, `${name}-390-pnl.png`), fullPage: true });
      await navigate('token');
      const contracts = await page.locator('#deployment-details').innerText();
      assert.ok(contracts.toLowerCase().includes(deployment.token.toLowerCase()));
      assert.ok(contracts.toLowerCase().includes(deployment.hook.toLowerCase()));

      for (const width of [320, 390, 750, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const section of ['home', 'manage', 'snipe', 'pnl', 'token']) {
          await navigate(section);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
          assert.equal(overflow, false, `${name} ${section}: horizontal overflow at ${width}px`);
        }
      }
      await navigate('home');
      await page.screenshot({ path: resolve(evidence, `${name}-1440-home.png`), fullPage: true });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length), 0);
      await navigate('manage');
      await page.locator('#clear').focus();
      await page.keyboard.press('Enter');
      await page.locator('#review-dialog').waitFor({ state: 'visible' });
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.wallet').count(), 3, 'Escape cancels reset');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'clear', 'Dialog restores focus');
      await page.screenshot({ path: resolve(evidence, `${name}-reset-focus.png`), fullPage: false });
      await page.locator('#clear').click();
      await page.locator('#dialog-confirm').click();
      await idle();
      assert.equal(await page.locator('.wallet').count(), 0);
      await navigate('home');
      await page.locator('#restore-file').setInputFiles({ name: 'validation-fleet.json', mimeType: 'application/json', buffer: Buffer.from(encrypted) });
      await page.locator('#restore-password').fill(passphrase);
      await click('restore');
      assert.equal(await page.locator('.wallet').count(), 3);
      assert.deepEqual(await page.locator('.wallet-address').evaluateAll(els => els.map(el => el.firstChild.textContent)), addresses);
      assert.deepEqual(errors, [], 'No browser console/script errors');
      assert.deepEqual(failed, [], 'No failed export resources');
      console.log(`${name}: PASS — first screen; keyboard generation; encrypted backup/restore; unsigned snipe JSON; 1200×800 PNG; addresses; five pages at 320/390/750/1024/1440; reset focus; reduced motion; zero console/resource failures. RPC mocked, no signatures.`);
      await context.close();
    } finally { await browser.close(); }
  }
} finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
