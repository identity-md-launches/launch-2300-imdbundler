import { address } from './transactions.js';
import { chainById } from './chains.js';
const methods = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBalance', 'eth_getCode', 'eth_call', 'eth_estimateGas', 'eth_getTransactionCount', 'eth_gasPrice']);
let requestId = 0;
export function rpcEndpoint(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Enter a valid HTTPS RPC URL.'); }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('RPC must use HTTPS (HTTP is allowed only on localhost).');
  if (url.username || url.password || url.hash) throw new Error('RPC URLs cannot contain credentials or fragments.');
  return url.href;
}
export async function rpc(url, method, params = [], transport = fetch) {
  if (!methods.has(method)) throw new Error('Only read-only RPC requests are supported.');
  const id = ++requestId;
  const response = await transport(rpcEndpoint(url), { method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}. Try another public endpoint.`);
  const result = await response.json();
  if (result.id !== id || result.jsonrpc !== '2.0') throw new Error('Invalid RPC response.');
  if (result.error || result.result === undefined) throw new Error(`RPC request failed: ${String(result.error?.message ?? 'missing result').slice(0, 180)}`);
  return result.result;
}
export async function verifyChain(url, chainId, transport) {
  chainById(chainId);
  const actual = await rpc(url, 'eth_chainId', [], transport);
  if (BigInt(actual) !== BigInt(chainId)) throw new Error('RPC chain does not match the selected network.');
}
export async function requireCode(url, target, transport, block = 'latest') {
  const code = await rpc(url, 'eth_getCode', [address(target), block], transport);
  if (typeof code !== 'string' || !/^0x([0-9a-fA-F]{2})+$/.test(code) || /^0x0+$/.test(code)) throw new Error('No contract code exists at this address on the selected chain.');
}
export async function simulate(url, transaction, transport) {
  await verifyChain(url, Number(BigInt(transaction.chainId)), transport);
  const { from, to, value, data } = transaction;
  const call = { from: address(from), to: address(to), value, data };
  await rpc(url, 'eth_call', [call, 'pending'], transport);
  const gas = await rpc(url, 'eth_estimateGas', [call], transport);
  if (typeof gas !== 'string' || !/^0x[1-9a-f][0-9a-f]*$/i.test(gas)) throw new Error('Invalid gas estimate from RPC.');
  return { gas, checkedAt: new Date().toISOString() };
}

// There is no provider at module load, no default window.ethereum, and no background account session.
export async function sendWithProvider(provider, transaction, { beforeSend = () => {}, onRequest = () => {} } = {}) {
  if (!provider || typeof provider.request !== 'function') throw new Error('Choose an announced wallet extension.');
  beforeSend();
  const chain = await provider.request({ method: 'eth_chainId' });
  if (BigInt(chain) !== BigInt(transaction.chainId)) throw new Error('Change the network in your extension, then try again.');
  const requested = await provider.request({ method: 'eth_requestAccounts' });
  if (!requested.some(a => address(a) === address(transaction.from))) throw new Error('Select the exact sender account in your extension. No transaction was requested.');
  // Recheck immediately before requesting a signature; an extension may change account/network while prompting.
  const current = await provider.request({ method: 'eth_accounts' });
  const currentChain = await provider.request({ method: 'eth_chainId' });
  if (address(current[0] ?? '') !== address(transaction.from) || BigInt(currentChain) !== BigInt(transaction.chainId)) throw new Error('Account or network changed. Review it and try again.');
  const { from, to, value, data } = transaction;
  // Account permission dialogs can remain open beyond the plan deadline.
  beforeSend();
  onRequest();
  return provider.request({ method: 'eth_sendTransaction', params: [{ from, to, value, data, chainId: transaction.chainId }] });
}
