import { Interface } from './vendor/ethers.js';
import { address, erc20 } from './transactions.js';
import { rpc, verifyChain, requireCode } from './rpc.js';

export const INITIAL_SUPPLY = 1_000_000_000n * 10n ** 18n;
export const hookRead = new Interface([
  'function token() view returns(address)',
  'function totalFeesIMD() view returns(uint256)',
  'function totalBuybackIMD() view returns(uint256)',
  'function totalBurned() view returns(uint256)',
  'function pendingIMD() view returns(uint256)',
  'function pendingIMDB() view returns(uint256)'
]);

// Treat the downloaded metadata as data. Only validated fields enter the UI.
export function parseDeployment(file) {
  if (!file || file.status !== 'deployed' || file.chainId !== 1) throw new Error('Ethereum deployment metadata is unavailable.');
  const token = address(file.token), hook = address(file.hook);
  if (token === hook || (BigInt(hook) & 0x3fffn) !== 0x20ccn) throw new Error('Invalid token or hook permission flags.');
  let source;
  try { source = new URL(file.sourceUrl); } catch { throw new Error('Missing reviewed source URL.'); }
  if (source.protocol !== 'https:' || source.hostname !== 'github.com' || source.port || source.username || source.password
    || source.search || source.hash || !/^\/[^/]+\/[^/]+\/tree\/[0-9a-f]{40}\/?$/i.test(source.pathname)) {
    throw new Error('Use an exact GitHub source commit URL.');
  }
  return Object.freeze({ chainId: 1, status: 'deployed', token, hook, sourceUrl: source.href });
}

export async function readTokenStats(url, metadata, transport) {
  const deployment = parseDeployment(metadata);
  await verifyChain(url, deployment.chainId, transport);
  const block = await rpc(url, 'eth_blockNumber', [], transport);
  if (typeof block !== 'string' || !/^0x[1-9a-f][0-9a-f]*$/i.test(block)) throw new Error('Invalid block number from RPC.');
  // All calls use one block, so a burn during the read cannot mix old/new counters.
  await Promise.all([
    requireCode(url, deployment.token, transport, block),
    requireCode(url, deployment.hook, transport, block)
  ]);
  const read = async (target, iface, method) => iface.decodeFunctionResult(method,
    await rpc(url, 'eth_call', [{ to: target, data: iface.encodeFunctionData(method) }, block], transport))[0];
  const [symbol, decimals, linkedToken] = await Promise.all([
    read(deployment.token, erc20, 'symbol'),
    read(deployment.token, erc20, 'decimals'),
    read(deployment.hook, hookRead, 'token')
  ]);
  if (symbol !== 'IMDB' || decimals !== 18n || address(linkedToken) !== deployment.token) {
    throw new Error('On-chain token identity does not match the IMDB deployment.');
  }
  const methods = ['totalFeesIMD', 'totalBuybackIMD', 'totalBurned', 'pendingIMD', 'pendingIMDB'];
  const values = await Promise.all(methods.map(method => read(deployment.hook, hookRead, method)));
  const supply = await read(deployment.token, erc20, 'totalSupply');
  if (supply > INITIAL_SUPPLY || values[2] > INITIAL_SUPPLY - supply) throw new Error('Inconsistent supply or burn totals from RPC.');
  return Object.freeze({ ...Object.fromEntries(methods.map((method, i) => [method, values[i]])),
    supply, burned: INITIAL_SUPPLY - supply, block, checkedAt: new Date().toISOString() });
}
