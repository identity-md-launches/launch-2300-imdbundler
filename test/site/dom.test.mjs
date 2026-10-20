// Application DOM integration using the vendored DOM implementation; no external browser or RPC.
// Canvas calls are recorded, so rasterization still needs a browser smoke check before release.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from '../vendor/linkedom.js';
const html = await readFile(new URL('../../site/index.html', import.meta.url), 'utf8');
const { window, document } = parseHTML(html);
Object.assign(globalThis, { window, document, location: { hash: '' }, Image: class { decode() { return Promise.resolve(); } } });
Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async text => { copied = text; } } }, configurable: true });
// DOM implementation does not emulate browser select/form or dialog state.
Object.defineProperty(window.HTMLSelectElement.prototype, 'value', {
  get() { return this.querySelector('option[selected]')?.value ?? this.querySelector('option')?.value ?? ''; },
  set(value) { for (const option of this.querySelectorAll('option')) option.toggleAttribute('selected', option.value === String(value)); }
});
let copied = '', blobs = [], canvasCalls = [], requests = [];
window.HTMLElement.prototype.scrollIntoView = () => {};
window.HTMLElement.prototype.showModal = function () { this.open = true; };
window.HTMLElement.prototype.close = function () { this.open = false; };
$('pnl-canvas').getContext = () => new Proxy({}, { get: (_, name) => (...args) => canvasCalls.push([name, ...args]), set: () => true });
$('pnl-canvas').toBlob = callback => callback(new Blob(['png test surface'], { type: 'image/png' }));
URL.createObjectURL = blob => { blobs.push(blob); return 'blob:local-test'; };
URL.revokeObjectURL = () => {};
globalThis.fetch = async (url, options) => {
  requests.push({ url, body: options?.body });
  if (url === './deployment.json') return { ok: true, json: async () => ({ chainId: 1, status: 'awaiting-verified-launch' }) };
  const p = JSON.parse(options.body);
  return { ok: true, json: async () => ({ jsonrpc: '2.0', id: p.id,
    result: p.method === 'eth_chainId' ? '0x1' : p.method === 'eth_getBalance' ? '0xde0b6b3a7640000' : p.method === 'eth_estimateGas' ? '0x5208' : '0x' }) };
};
function $(id) { return document.getElementById(id); }
function event(id, name) { $(id).dispatchEvent(new window.Event(name, { bubbles: true })); }
async function idle() {
  for (let i = 0; i < 1000; i++) {
    if (document.body.getAttribute('aria-busy') !== 'true') return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('UI did not finish its action');
}
async function click(id) { event(id, 'click'); await idle(); }
await import('../../site/app.js');
await new Promise(resolve => setTimeout(resolve, 0));

test('the complete browser flow keeps secrets local and renders usable plans', async () => {
  assert.equal(requests.length, 1); assert.equal(requests[0].url, './deployment.json');
  assert.ok(canvasCalls.some(c => c[0] === 'drawImage'));
  $('wallet-count').value = '3'; await click('generate');
  assert.equal($('nav-count').textContent, '3');
  assert.equal(document.querySelectorAll('.wallet').length, 3);
  assert.equal(requests.length, 1, 'wallet generation must not send requests');
  const addresses = [...document.querySelectorAll('.wallet-address')].map(el => el.firstChild.textContent);
  assert.equal(new Set(addresses).size, 3);
  assert.ok(addresses.every(a => /^0x[0-9a-fA-F]{40}$/.test(a)));
  assert.ok(!document.body.textContent.includes('privateKey'));
  $('export-password').value = 'An excellent test passphrase'; $('export-confirm').value = $('export-password').value;
  await click('export');
  assert.equal(blobs.length, 1);
  const encrypted = await blobs[0].text();
  assert.equal(JSON.parse(encrypted).format, 'imdbundler-vault');
  assert.ok(addresses.every(a => !encrypted.includes(a)));
  assert.equal($('export-password').value, ''); assert.equal($('export-confirm').value, '');
  assert.equal(requests.length, 1, 'export must not send keys or ciphertext to any server');
  $('fund-from').value = '0x1111111111111111111111111111111111111111'; $('fund-amount').value = '0.01';
  await click('prepare-funding');
  assert.equal(document.querySelectorAll('.transaction').length, 3);
  await click('copy-plan');
  const plan = JSON.parse(copied);
  assert.equal(plan.transactions.length, 3);
  assert.deepEqual(plan.transactions.map(t => t.to), addresses);
  assert.equal(plan.atomic, false); assert.ok(!copied.includes('privateKey'));
  await click('refresh-balances');
  assert.ok(document.querySelector('.balance').textContent.includes('1.0 ETH'));
  assert.ok(requests.every(r => !r.body?.includes('passphrase') && !r.body?.includes('privateKey')));
  await click('select-none');
  assert.equal(document.querySelectorAll('.transaction').length, 0);
  assert.match($('selected-count').textContent, /^0 selected/);
  await click('prepare-funding');
  assert.match($('notice').textContent, /Select at least/);
  await click('select-all');
  $('pnl-exit').value = '0.005'; event('pnl-exit', 'input'); await click('render-pnl');
  assert.match($('pnl-description').textContent, /sad frog/);
  await click('download-pnl'); assert.equal(blobs.at(-1).type, 'image/png');
  event('clear', 'click'); await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok($('review-dialog').open); event('dialog-confirm', 'click'); await idle();
  assert.equal($('nav-count').textContent, '0'); assert.equal(document.querySelectorAll('.wallet').length, 0);
  assert.equal(document.querySelectorAll('.transaction').length, 0);
});

test('static resources and privacy controls are present and use no remote scripts', async () => {
  for (const element of document.querySelectorAll('script[src], link[href], img[src]')) {
    const resource = element.getAttribute('src') ?? element.getAttribute('href');
    assert.ok(resource.startsWith('./'), resource);
    await readFile(new URL(`../../site/${resource.slice(2)}`, import.meta.url));
  }
  assert.ok(document.querySelector('meta[http-equiv="Content-Security-Policy"]').content.includes("script-src 'self'"));
  const app = await readFile(new URL('../../site/app.js', import.meta.url), 'utf8');
  for (const unsafe of ['innerHTML', 'localStorage', 'sessionStorage', 'window.ethereum', 'eval(']) assert.ok(!app.includes(unsafe));
  const ids = [...app.matchAll(/\$\('([^']+)'\)/g)].map(match => match[1]);
  for (const id of ids) assert.ok($(id), `missing ${id}`);
});
