import test from 'node:test';
import assert from 'node:assert/strict';
import { Vault } from '../../site/vault.js';
import { fundingPlan, tokenPlan, contractPlan, nftMintPlan, publicBundle, profitLoss, amount, address, v2 } from '../../site/transactions.js';
import { rpc, rpcEndpoint, verifyChain, requireCode, simulate, sendWithProvider } from '../../site/rpc.js';
import { Interface, Wallet } from '../../site/vendor/ethers.js';
import { CHAINS } from '../../site/chains.js';
const a = '0x1111111111111111111111111111111111111111';
const b = '0x2222222222222222222222222222222222222222';
const target = '0x3333333333333333333333333333333333333333';
const password = 'A very long local test passphrase!';
const now = 1800000000000, deadline = now / 1000 + 600;
const tokenArgs = { wallets: [a, b], token: target, value: '0.001', minimum: '123.456', decimals: 6, chainId: 1, deadline, now };
const endpoint = 'https://rpc.example.invalid';
function transport(result, observer = () => {}) {
  return async (url, options) => {
    const payload = JSON.parse(options.body); observer(payload, options);
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: payload.id, result: typeof result === 'function' ? result(payload) : result }) };
  };
}

test('vault generates independent wallets, encrypted round-trip, wrong passwords and tampering fail', async () => {
  const vault = new Vault(), restored = new Vault();
  const wallets = vault.generate(5);
  assert.equal(new Set(wallets).size, 5);
  assert.ok(wallets.every(a => /^0x[0-9a-fA-F]{40}$/.test(a)));
  assert.equal(vault.privateKey, undefined); assert.deepEqual(JSON.parse(JSON.stringify(vault)), {});
  const file = await vault.encrypt(password);
  assert.ok(wallets.every(a => !file.includes(a)));
  const metadata = JSON.parse(file);
  assert.equal(metadata.iterations, 600000); assert.equal(metadata.cipher, 'AES-256-GCM');
  await assert.rejects(restored.restore(file, 'Incorrect password!'));
  assert.equal(restored.count, 0);
  const damaged = { ...metadata, ciphertext: (metadata.ciphertext[0] === 'A' ? 'B' : 'A') + metadata.ciphertext.slice(1) };
  await assert.rejects(restored.restore(JSON.stringify(damaged), password));
  assert.deepEqual(await restored.restore(file, password), wallets);
  await assert.rejects(restored.restore(file, password));
  vault.clear(); assert.equal(vault.count, 0); assert.deepEqual(vault.addresses, []);
  await assert.rejects(vault.encrypt(password));
});
test('vault validation, randomized encryption, clear-during-export and unsupported KDF', async () => {
  const vault = new Vault();
  for (const count of [0, 51, 1.5, NaN, -1]) assert.throws(() => vault.generate(count));
  vault.generate(1); assert.throws(() => vault.generate(1));
  await assert.rejects(vault.encrypt('short'));
  const first = await vault.encrypt(password), second = await vault.encrypt(password);
  assert.notEqual(first, second);
  const invalid = JSON.parse(first); invalid.iterations = 999999999;
  await assert.rejects(new Vault().restore(JSON.stringify(invalid), password));
  await assert.rejects(new Vault().restore('x'.repeat(100001), password));
  const exportPromise = vault.encrypt(password); vault.clear(); await assert.rejects(exportPromise, /changed/);
});
test('an individual exported Web3 keystore is compatible with ethers and contains no plaintext key', async () => {
  const vault = new Vault(); vault.generate(1);
  const file = await vault.keystore(0, password);
  const wallet = await Wallet.fromEncryptedJson(file, password);
  assert.equal(wallet.address, vault.addresses[0]);
  assert.ok(!file.includes(wallet.privateKey));
  await assert.rejects(vault.keystore(-1, password));
});
test('the maximum 50-wallet fleet backs up and restores without truncation, and clear cancels a pending restore', async () => {
  const original = new Vault(), restored = new Vault();
  const addresses = original.generate(50);
  assert.equal(new Set(addresses).size, 50);
  const file = await original.encrypt(password);
  assert.ok(file.length < 100_000);
  assert.deepEqual(await restored.restore(file, password), addresses);
  restored.clear();
  const restoring = restored.restore(file, password);
  restored.clear();
  await assert.rejects(restoring, /Cannot restore/);
  assert.equal(restored.count, 0);
  assert.deepEqual(await restored.restore(file, password), addresses);
});
test('funding plans are exact, sender-specific and public', () => {
  const txs = fundingPlan({ wallets: [a, b], from: target, value: '0.1', chainId: 8453 });
  assert.equal(txs.length, 2); assert.equal(txs[1].from, target); assert.equal(txs[1].to, b);
  assert.equal(BigInt(txs[0].value), 100000000000000000n); assert.equal(txs[0].chainId, '0x2105');
  assert.equal(txs[0].data, '0x');
  const bundle = publicBundle(txs, 'funding');
  assert.equal(bundle.atomic, false); assert.ok(!JSON.stringify(bundle).includes('privateKey'));
  assert.throws(() => fundingPlan({ wallets: [a], from: a, value: '1', chainId: 1 }));
  assert.throws(() => fundingPlan({ wallets: [a, a], from: b, value: '1', chainId: 1 }));
  assert.throws(() => fundingPlan({ wallets: [], from: b, value: '1', chainId: 1 }));
});
test('v2 buys encode each wallet recipient, minimum output, exact ETH and deadline', () => {
  const txs = tokenPlan(tokenArgs);
  txs.forEach((tx, i) => {
    assert.equal(tx.to, CHAINS[0].router);
    const decoded = v2.decodeFunctionData('swapExactETHForTokensSupportingFeeOnTransferTokens', tx.data);
    assert.equal(decoded[0], 123456000n); assert.equal(decoded[2], [a, b][i]); assert.equal(decoded[3], BigInt(deadline));
    assert.equal(decoded[1][1], target); assert.equal(BigInt(tx.value), 1000000000000000n);
  });
  for (const patch of [{ minimum: '0' }, { deadline: now / 1000 - 1 }, { chainId: 8453 }, { decimals: 37 }, { token: CHAINS[0].wrapped }]) {
    assert.throws(() => tokenPlan({ ...tokenArgs, ...patch }));
  }
});
test('NFT templates encode correct function and wallet-specific recipient', () => {
  for (const signature of ['mint(uint256)', 'mint(address,uint256)']) {
    const txs = nftMintPlan({ wallets: [a, b], target, value: '0.02', quantity: 2, chainId: 10, signature });
    const iface = new Interface([`function ${signature} payable`]);
    const decoded = iface.decodeFunctionData('mint', txs[1].data);
    assert.equal(decoded[decoded.length - 1], 2n);
    if (signature.includes('address')) assert.equal(decoded[0], b);
    assert.equal(txs[1].chainId, '0xa');
  }
  assert.throws(() => nftMintPlan({ wallets: [a], target, value: '0', quantity: 1, chainId: 1, signature: 'guess()' }));
});
test('calldata mode refuses malformed, missing selectors, invalid targets and excessive data', () => {
  const args = { wallets: [a], target, value: '0', data: '0x12345678', chainId: 42161 };
  assert.equal(contractPlan(args)[0].data, args.data);
  for (const data of ['0x', '0x123', '12345678', '0xgggggggg', `0x${'ab'.repeat(70000)}`]) assert.throws(() => contractPlan({ ...args, data }));
  assert.throws(() => contractPlan({ ...args, target: '0x0000000000000000000000000000000000000000' }));
  assert.throws(() => contractPlan({ ...args, chainId: 999 }));
});
test('amounts reject dangerous formats and preserve wei precision', () => {
  assert.equal(amount('0.000000000000000001'), 1n);
  assert.equal(amount('1.000001', 6), 1000001n);
  for (const v of ['', '-1', '+1', '1e18', '0', '1.0000001', ' 1', 'Infinity', '00.1']) assert.throws(() => amount(v, 6));
  assert.throws(() => address('0xD34a99BC0f67Ae1bbd63C660e6d0b0Dd03e263b7'));
});
test('P&L handles gains, losses, zero, percentage override and invalid data', () => {
  const gain = profitLoss({ entry: '10', exit: '15', quantity: '4', percent: '' });
  assert.equal(gain.pnl, 20); assert.equal(gain.gain, 50); assert.equal(gain.pose, 'happy');
  assert.equal(profitLoss({ entry: '10', exit: '5', quantity: '4', percent: '' }).pose, 'sad');
  assert.equal(profitLoss({ entry: '10', exit: '10', quantity: '4', percent: '' }).pose, 'thinking');
  assert.equal(profitLoss({ entry: '10', exit: '99', quantity: '4', percent: '-100' }).pnl, -40);
  for (const patch of [{ entry: '0' }, { exit: '' }, { exit: '-1' }, { quantity: '0' }, { percent: '-101' }, { percent: 'NaN' }, { entry: '1e308', quantity: '1e308' }]) {
    assert.throws(() => profitLoss({ entry: '10', exit: '15', quantity: '4', percent: '', ...patch }));
  }
});
test('RPC accepts HTTPS or local HTTP, excludes credentials and never sends signing methods', async () => {
  assert.equal(rpcEndpoint('http://localhost:8545'), 'http://localhost:8545/');
  for (const url of ['javascript:alert(1)', 'http://untrusted.example', 'https://user:secret@example.org', 'https://example.org/#key']) assert.throws(() => rpcEndpoint(url));
  for (const method of ['eth_sendRawTransaction', 'eth_sendTransaction', 'personal_sign', 'eth_sign']) await assert.rejects(rpc(endpoint, method, [], transport('0x1')));
  let observed;
  await verifyChain(endpoint, 1, transport('0x1', (payload, options) => { observed = payload; assert.equal(options.credentials, 'omit'); assert.equal(options.referrerPolicy, 'no-referrer'); }));
  assert.deepEqual(observed.params, []);
  await assert.rejects(verifyChain(endpoint, 1, transport('0xa')), /does not match/);
});
test('RPC failures and invalid or empty contract code fail closed', async () => {
  await assert.rejects(rpc(endpoint, 'eth_chainId', [], async () => ({ ok: false, status: 429 })), /429/);
  await assert.rejects(rpc(endpoint, 'eth_chainId', [], async () => ({ ok: true, json: async () => ({ jsonrpc: '2.0', id: 0, result: '0x1' }) })), /Invalid RPC/);
  await assert.rejects(requireCode(endpoint, target, transport('0x')), /No contract/);
  await assert.rejects(requireCode(endpoint, target, transport('0x0')), /No contract/);
  await requireCode(endpoint, target, transport('0x60006000'));
});
test('simulation transmits only the selected public transaction', async () => {
  const tx = fundingPlan({ wallets: [a], from: target, value: '0.1', chainId: 1 })[0], calls = [];
  const result = await simulate(endpoint, tx, transport(p => p.method === 'eth_chainId' ? '0x1' : p.method === 'eth_estimateGas' ? '0x5208' : '0x', p => calls.push(p)));
  assert.equal(result.gas, '0x5208');
  assert.deepEqual(calls.map(c => c.method), ['eth_chainId', 'eth_call', 'eth_estimateGas']);
  assert.equal(calls[1].params[0].from, target);
  assert.ok(!JSON.stringify(calls).includes('privateKey'));
});
function provider({ chain = '0x1', requested = [a], current = [a], secondChain = chain, reject = false } = {}) {
  const calls = []; let chainReads = 0;
  return { calls, request: async request => {
    calls.push(request);
    if (reject) throw new Error('User rejected request');
    if (request.method === 'eth_chainId') return chainReads++ ? secondChain : chain;
    if (request.method === 'eth_requestAccounts') return requested;
    if (request.method === 'eth_accounts') return current;
    if (request.method === 'eth_sendTransaction') return `0x${'ab'.repeat(32)}`;
    throw new Error('Unexpected request');
  } };
}
test('external signing is explicit, sender-bound, chain-bound and independently rechecked', async () => {
  const tx = contractPlan({ wallets: [a], target, data: '0x12345678', value: '0', chainId: 1 })[0];
  const good = provider(); assert.equal(good.calls.length, 0);
  await sendWithProvider(good, tx);
  assert.equal(good.calls.at(-1).method, 'eth_sendTransaction'); assert.equal(good.calls.at(-1).params[0].from, a);
  for (const args of [{ chain: '0xa' }, { requested: [b] }, { current: [b] }, { secondChain: '0xa' }, { reject: true }]) {
    const bad = provider(args); await assert.rejects(sendWithProvider(bad, tx));
    assert.ok(!bad.calls.some(c => c.method === 'eth_sendTransaction'));
    assert.ok(!bad.calls.some(c => c.method === 'wallet_switchEthereumChain'));
  }
});
