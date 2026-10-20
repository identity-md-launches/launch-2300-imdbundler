import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderDirectory } from '../../site/providers.js';
import { sendWithProvider, simulate } from '../../site/rpc.js';
import { fundingPlan } from '../../site/transactions.js';
const from = '0x1111111111111111111111111111111111111111';
const recipient = '0x2222222222222222222222222222222222222222';
const tx = fundingPlan({ from, wallets: [recipient], value: '0.01', chainId: 1 })[0];
const announced = (uuid, provider, name = uuid) => ({ info: { uuid, name }, provider });

test('discovery is opt-in, never auto-selects, and cannot replace a chosen provider by UUID', () => {
  const directory = new ProviderDirectory();
  let requests = 0;
  const first = { request() { requests++; } }, second = { request() { requests++; } };
  assert.equal(directory.accept(announced('first', first)), false);
  directory.discover();
  assert.equal(directory.accept(announced('first', first)), true);
  assert.equal(directory.accept(announced('second', second)), true);
  assert.equal(directory.get(''), undefined);
  assert.equal(directory.accept(announced('first', second, 'Hijack')), false);
  assert.equal(directory.get('first').provider, first);
  assert.equal(directory.get('second').provider, second);
  assert.equal(requests, 0, 'discovery does not request accounts');
  directory.clear();
  assert.deepEqual(directory.entries(), []);
  assert.equal(directory.accept(announced('first', first)), false);
});

test('provider metadata is bounded and malformed announcements are ignored', () => {
  const directory = new ProviderDirectory(); directory.discover();
  for (const value of [null, {}, announced('', { request() {} }), announced('a', {}), announced('a'.repeat(101), { request() {} }), announced('a', { request() {} }, '')]) {
    assert.equal(directory.accept(value), false);
  }
  for (let i = 0; i < 21; i++) directory.accept(announced(String(i), { request() {} }, 'n'.repeat(80)));
  assert.equal(directory.entries().length, 20);
  assert.equal(directory.get('0').name.length, 60);
});

test('a plan that expires during an account prompt never reaches eth_sendTransaction', async () => {
  const calls = []; let valid = true, attempted = false;
  const provider = { async request(request) {
    calls.push(request.method);
    if (request.method === 'eth_chainId') return '0x1';
    if (request.method === 'eth_requestAccounts') { valid = false; return [from]; }
    if (request.method === 'eth_accounts') return [from];
    throw new Error('Unexpected signature request');
  } };
  await assert.rejects(sendWithProvider(provider, tx, {
    beforeSend() { if (!valid) throw new Error('Plan expired'); },
    onRequest() { attempted = true; }
  }), /expired/);
  assert.equal(attempted, false);
  assert.ok(!calls.includes('eth_sendTransaction'));
});

test('only the explicitly chosen provider receives an exact sender request', async () => {
  const mainCalls = [], selectedCalls = [];
  const main = { request(request) { mainCalls.push(request); throw new Error('Main wallet must stay idle'); } };
  const chosen = { async request(request) {
    selectedCalls.push(request);
    if (request.method === 'eth_chainId') return '0x1';
    if (['eth_requestAccounts', 'eth_accounts'].includes(request.method)) return [from];
    if (request.method === 'eth_sendTransaction') return `0x${'ab'.repeat(32)}`;
    throw new Error('Unexpected wallet request');
  } };
  const directory = new ProviderDirectory(); directory.discover();
  directory.accept(announced('main', main)); directory.accept(announced('chosen', chosen));
  let checks = 0, attempts = 0;
  await sendWithProvider(directory.get('chosen').provider, tx, { beforeSend() { checks++; }, onRequest() { attempts++; } });
  assert.equal(mainCalls.length, 0); assert.equal(checks, 2); assert.equal(attempts, 1);
  assert.deepEqual(selectedCalls.at(-1), { method: 'eth_sendTransaction', params: [tx] });
  assert.ok(!selectedCalls.some(call => call.method.includes('switch') || call.method.includes('addEthereumChain')));
});

test('unusable RPC gas estimates are failures, never successful simulations', async () => {
  for (const gas of ['0x0', '0x', '0xgarbage', '21000', null]) {
    await assert.rejects(simulate('https://rpc.example.invalid', tx, async (_, options) => {
      const p = JSON.parse(options.body);
      const result = p.method === 'eth_chainId' ? '0x1' : p.method === 'eth_estimateGas' ? gas : '0x';
      return { ok: true, json: async () => ({ jsonrpc: '2.0', id: p.id, result }) };
    }), /Invalid gas/);
  }
});
