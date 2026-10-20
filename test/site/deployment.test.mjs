import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseDeployment, readTokenStats, INITIAL_SUPPLY, hookRead } from '../../site/deployment.js';
import { erc20 } from '../../site/transactions.js';
const metadata = JSON.parse(await readFile(new URL('../../site/deployment.json', import.meta.url), 'utf8'));
const deployment = parseDeployment(metadata);
const endpoint = 'https://rpc.example.invalid';

function chainTransport(overrides = {}) {
  const calls = [];
  const values = { symbol: 'IMDB', decimals: 18n, token: deployment.token, totalSupply: INITIAL_SUPPLY - 9n * 10n ** 18n,
    totalBurned: 7n * 10n ** 18n, totalFeesIMD: 15n * 10n ** 18n, totalBuybackIMD: 12n * 10n ** 18n,
    pendingIMD: 3n * 10n ** 18n, pendingIMDB: 2n * 10n ** 18n, ...overrides };
  return { calls, transport: async (url, options) => {
    assert.equal(url, `${endpoint}/`);
    assert.equal(options.credentials, 'omit');
    const request = JSON.parse(options.body); calls.push(request);
    let result;
    if (request.method === 'eth_chainId') result = overrides.chain ?? '0x1';
    else if (request.method === 'eth_blockNumber') result = overrides.block ?? '0x1905100';
    else if (request.method === 'eth_getCode') result = overrides.code ?? '0x60006000';
    else if (request.method === 'eth_call') {
      const iface = request.params[0].to === deployment.token ? erc20 : hookRead;
      const method = iface.parseTransaction({ data: request.params[0].data }).name;
      if (overrides.fail === method) return { ok: true, json: async () => ({ jsonrpc: '2.0', id: request.id, error: { message: 'RPC unavailable' } }) };
      result = iface.encodeFunctionResult(method, [values[method]]);
    } else throw new Error(`Unexpected RPC method ${request.method}`);
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: request.id, result }) };
  } };
}

test('site publishes the attested launch addresses and exact source commit, with no guessed settings', () => {
  assert.equal(deployment.token.toLowerCase(), '0x9a26dcb2bbd88d4c964043f2611d6cb0031c1ee8');
  assert.equal(deployment.hook.toLowerCase(), '0x736361f1ffa0f2407724589addcde144f047a0cc');
  assert.equal(deployment.sourceUrl, 'https://github.com/identity-md-launches/launch-2300-imdbundler/tree/864305f630ca6ea7d49f3a7f6120f299386f94aa');
  assert.equal(deployment.chainId, 1);
  assert.ok(Object.isFrozen(deployment));
  assert.equal(parseDeployment({ ...metadata, privateKey: 'must not propagate' }).privateKey, undefined);
});

test('invalid chain, hook flags, zero address and unsafe or unpinned source URLs fail closed', () => {
  for (const patch of [
    { chainId: 8453 }, { status: 'awaiting-verified-launch' }, { token: metadata.hook },
    { token: '0x0000000000000000000000000000000000000000' }, { hook: metadata.token },
    { token: '<script>' }, { sourceUrl: 'javascript:alert(1)' },
    { sourceUrl: metadata.sourceUrl.replace('github.com', 'github.com.evil.invalid') },
    { sourceUrl: metadata.sourceUrl.replace('github.com', 'user:password@github.com') },
    { sourceUrl: metadata.sourceUrl.replace(/tree\/.*/, 'tree/main') },
    { sourceUrl: `${metadata.sourceUrl}?redirect=evil` },
    { sourceUrl: metadata.sourceUrl.replace('github.com', 'github.com:8080') }
  ]) assert.throws(() => parseDeployment({ ...metadata, ...patch }));
  assert.throws(() => parseDeployment(null));
});

test('token stats use a single block and distinguish all-holder burns from hook burns', async () => {
  const { calls, transport } = chainTransport();
  const stats = await readTokenStats(endpoint, metadata, transport);
  assert.equal(stats.burned, 9n * 10n ** 18n);
  assert.equal(stats.totalBurned, 7n * 10n ** 18n);
  assert.equal(stats.supply + stats.burned, INITIAL_SUPPLY);
  assert.equal(stats.totalFeesIMD, 15n * 10n ** 18n);
  assert.equal(stats.pendingIMDB, 2n * 10n ** 18n);
  for (const call of calls.filter(call => ['eth_getCode', 'eth_call'].includes(call.method))) {
    assert.equal(call.params[1], stats.block);
  }
  assert.ok(calls.every(call => !call.method.includes('send') && !call.method.includes('sign')));
});

test('stats reject wrong networks, identities, missing contracts, impossible supply and partial RPC failure', async () => {
  for (const overrides of [
    { chain: '0xa' }, { code: '0x' }, { code: '0x0' }, { code: '0x600' }, { block: 'latest' },
    { token: deployment.hook }, { symbol: 'FAKE' }, { decimals: 6n },
    { totalSupply: INITIAL_SUPPLY + 1n }, { totalBurned: INITIAL_SUPPLY }, { fail: 'totalBuybackIMD' }
  ]) {
    const { transport } = chainTransport(overrides);
    await assert.rejects(readTokenStats(endpoint, metadata, transport));
  }
});
