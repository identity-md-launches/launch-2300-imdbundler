// Application DOM integration using the vendored DOM implementation; no external browser or RPC.
// Canvas calls are recorded, so rasterization still needs a browser smoke check before release.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from '../vendor/linkedom.js';
import { Interface } from '../../site/vendor/ethers.js';
import { erc20 } from '../../site/transactions.js';
import { hookRead, INITIAL_SUPPLY } from '../../site/deployment.js';
const html = await readFile(new URL('../../site/index.html', import.meta.url), 'utf8');
const metadata = JSON.parse(await readFile(new URL('../../site/deployment.json', import.meta.url), 'utf8'));
const { window, document } = parseHTML(html);
Object.assign(globalThis, { window, document, Event: window.Event, location: { hash: '' }, Image: class { decode() { return Promise.resolve(); } } });
Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async text => { copied = text; } } }, configurable: true });
// DOM implementation does not emulate browser select/form or dialog state.
Object.defineProperty(window.HTMLSelectElement.prototype, 'value', {
  get() { return this.querySelector('option[selected]')?.value ?? this.querySelector('option')?.value ?? ''; },
  set(value) { for (const option of this.querySelectorAll('option')) option.toggleAttribute('selected', option.value === String(value)); }
});
let copied = '', blobs = [], canvasCalls = [], requests = [], rpcFailure = false, rpcCode = '0x60006000';
window.HTMLElement.prototype.scrollIntoView = () => {};
window.HTMLElement.prototype.showModal = function () { this.open = true; };
window.HTMLElement.prototype.close = function () { this.open = false; };
$('pnl-canvas').getContext = () => new Proxy({}, { get: (_, name) => (...args) => canvasCalls.push([name, ...args]), set: () => true });
$('pnl-canvas').toBlob = callback => callback(new Blob(['png test surface'], { type: 'image/png' }));
URL.createObjectURL = blob => { blobs.push(blob); return 'blob:local-test'; };
URL.revokeObjectURL = () => {};
globalThis.fetch = async (url, options) => {
  requests.push({ url, body: options?.body });
  if (url === './deployment.json') return { ok: true, json: async () => metadata };
  if (rpcFailure) return { ok: false, status: 503 };
  const p = JSON.parse(options.body);
  let result = p.method === 'eth_chainId' ? '0x1' : p.method === 'eth_blockNumber' ? '0x1905100'
    : p.method === 'eth_getCode' ? rpcCode : p.method === 'eth_getBalance' ? '0xde0b6b3a7640000'
    : p.method === 'eth_estimateGas' ? '0x5208' : '0x';
  if (p.method === 'eth_call' && p.params[0].to.toLowerCase() === metadata.token.toLowerCase()) {
    const method = erc20.parseTransaction({ data: p.params[0].data }).name;
    result = erc20.encodeFunctionResult(method, [{ symbol: 'IMDB', decimals: 18n, totalSupply: INITIAL_SUPPLY - 10n ** 18n }[method]]);
  } else if (p.method === 'eth_call' && p.params[0].to.toLowerCase() === metadata.hook.toLowerCase()) {
    const method = hookRead.parseTransaction({ data: p.params[0].data }).name;
    result = hookRead.encodeFunctionResult(method, [method === 'token' ? metadata.token : 10n ** 18n]);
  }
  return { ok: true, json: async () => ({ jsonrpc: '2.0', id: p.id, result }) };
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
  assert.match($('launch-status').textContent, /LIVE/);
  assert.ok($('deployment-details').textContent.includes(metadata.token));
  $('wallet-count').value = '3'; await click('generate');
  assert.equal($('nav-count').textContent, '3');
  assert.equal(document.querySelectorAll('.wallet').length, 3);
  assert.equal(requests.length, 1, 'wallet generation must not send requests');
  const addresses = [...document.querySelectorAll('.wallet-address')].map(el => el.firstChild.textContent);
  assert.equal(new Set(addresses).size, 3);
  assert.ok(addresses.every(a => /^0x[0-9a-fA-F]{40}$/.test(a)));
  assert.ok(!document.body.textContent.includes('privateKey'));
  await click('copy-addresses'); assert.deepEqual(copied.split('\n'), addresses);
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

test('mint preparation, isolated external signing, user rejection and uncertain sends are handled in the UI', async () => {
  $('wallet-count').value = '2'; await click('generate');
  $('buy-mode').value = 'mint'; event('buy-mode', 'change');
  $('target').value = '0x3333333333333333333333333333333333333333';
  $('buy-value').value = '0.02'; $('mint-quantity').value = '2';
  $('mint-signature').value = 'mint(address,uint256)';
  await click('prepare-buy'); assert.match($('notice').textContent, /Confirm/);
  $('review-target').checked = true;
  rpcCode = '0x'; await click('prepare-buy'); assert.match($('notice').textContent, /No contract/);
  assert.equal(document.querySelectorAll('.transaction').length, 0);
  rpcCode = '0x60006000'; await click('prepare-buy');
  await click('copy-plan');
  const plan = JSON.parse(copied), mint = new Interface(['function mint(address,uint256) payable']);
  assert.equal(plan.kind, 'nft-mint'); assert.equal(plan.transactions.length, 2);
  for (const tx of plan.transactions) {
    const decoded = mint.decodeFunctionData('mint', tx.data);
    assert.equal(decoded[0], tx.from); assert.equal(decoded[1], 2n);
  }
  const calls = []; let outcome = 'reject', mainCalls = 0;
  const main = { async request() { mainCalls++; throw new Error('Main extension must not be used'); } };
  const signer = { async request(request) {
    calls.push(request);
    if (request.method === 'eth_chainId') return '0x1';
    if (['eth_requestAccounts', 'eth_accounts'].includes(request.method)) return [plan.transactions[0].from];
    if (request.method === 'eth_sendTransaction') {
      if (outcome === 'reject') throw Object.assign(new Error('User rejected'), { code: 4001 });
      if (outcome === 'unknown') throw new Error('Provider disconnected');
      return `0x${'ab'.repeat(32)}`;
    }
    throw new Error('Unexpected extension method');
  } };
  const announce = (uuid, provider) => window.dispatchEvent(new window.CustomEvent('eip6963:announceProvider', { detail: { info: { uuid, name: uuid }, provider } }));
  announce('main', main); assert.equal($('extension').children.length, 1);
  await click('discover-wallets'); announce('main', main); announce('chosen', signer);
  $('extension').value = 'chosen'; announce('chosen', main);
  assert.equal(calls.length, 0); assert.equal(mainCalls, 0);
  const send = document.querySelector('[data-send="0"]');
  async function sign() {
    send.dispatchEvent(new window.Event('click'));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.ok($('review-dialog').open);
    event('dialog-confirm', 'click'); await idle();
  }
  await sign();
  assert.match($('notice').textContent, /User rejected/);
  assert.equal(send.disabled, false);
  outcome = 'unknown'; await sign();
  assert.match(document.querySelector('.transaction-status').textContent, /status unknown/);
  assert.ok(send.hasAttribute('disabled'));
  assert.equal(mainCalls, 0);
  const count = calls.length; send.dispatchEvent(new window.Event('click')); await idle();
  assert.equal(calls.length, count, 'uncertain submission cannot be retried accidentally');
  assert.ok(calls.every(call => !call.method.includes('switch')));
  $('review-target').checked = false; event('review-target', 'change');
  assert.equal(document.querySelectorAll('.transaction').length, 0);
  event('clear', 'click'); await new Promise(resolve => setTimeout(resolve, 0)); event('dialog-confirm', 'click'); await idle();
});

test('token info renders a checked snapshot and replaces stale stats on RPC failure', async () => {
  await click('burn-stats');
  assert.match($('burn-output').textContent, /Current supply: 999999999.0 IMDB/);
  assert.match($('burn-output').textContent, /Total burned by all holders: 1.0 IMDB/);
  assert.match($('burn-output').textContent, /Ethereum block: /);
  rpcFailure = true;
  await click('burn-stats');
  assert.match($('burn-output').textContent, /Stats unavailable/);
  assert.ok(!$('burn-output').textContent.includes('999999999'));
  rpcFailure = false;
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
