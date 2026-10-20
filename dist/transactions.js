import { Interface, getAddress, parseUnits, toQuantity, ZeroAddress } from './vendor/ethers.js';
import { chainById } from './chains.js';
export const v2 = new Interface([
  'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin,address[] path,address to,uint256 deadline) payable',
  'function getAmountsOut(uint256 amountIn,address[] path) view returns(uint256[] amounts)',
  'function WETH() view returns(address)'
]);
export const erc20 = new Interface(['function balanceOf(address) view returns(uint256)', 'function decimals() view returns(uint8)',
  'function symbol() view returns(string)', 'function totalSupply() view returns(uint256)']);
export function address(value) {
  let result;
  try { result = getAddress(value.trim()); } catch { throw new Error('Enter a valid address with a valid checksum.'); }
  if (result === ZeroAddress) throw new Error('The zero address is not a destination.');
  return result;
}
export function amount(value, decimals = 18, zeroAllowed = false) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)(\.\d+)?$/.test(value) || value.length > 100) throw new Error('Enter an ordinary decimal amount (no exponent or sign).');
  let result;
  try { result = parseUnits(value, decimals); } catch { throw new Error(`Amount supports at most ${decimals} decimal places.`); }
  if (result < 0n || (!zeroAllowed && result === 0n) || result >= 2n ** 256n) throw new Error('Amount must be positive and within uint256.');
  return result;
}
function accounts(wallets) {
  if (!Array.isArray(wallets) || wallets.length < 1 || wallets.length > 50) throw new Error('Select 1–50 wallets.');
  const result = wallets.map(address);
  if (new Set(result).size !== result.length) throw new Error('Duplicate wallet addresses.');
  return result;
}
function tx(chainId, from, to, value, data = '0x') {
  chainById(chainId);
  return { chainId: toQuantity(chainId), from: address(from), to: address(to), value: toQuantity(value), data };
}
export function fundingPlan({ wallets, from, value, chainId }) {
  const targets = accounts(wallets), sender = address(from), wei = amount(value);
  if (targets.includes(sender)) throw new Error('The funding wallet must differ from every receiving wallet.');
  return targets.map(target => tx(chainId, sender, target, wei));
}
export function tokenPlan({ wallets, token, value, minimum, decimals, chainId, deadline, now = Date.now() }) {
  const chain = chainById(chainId);
  if (!chain.router) throw new Error('The built-in Uniswap v2 route is available on Ethereum. Use reviewed contract calldata on this chain.');
  const target = address(token), wei = amount(value);
  if (target === address(chain.wrapped)) throw new Error('Choose a token other than WETH for this swap route.');
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error('Token decimals must be between 0 and 36.');
  const minimumOut = amount(minimum, decimals);
  const seconds = Math.floor(now / 1000);
  if (!Number.isSafeInteger(deadline) || deadline <= seconds || deadline > seconds + 3600) throw new Error('Set a deadline within the next hour.');
  return accounts(wallets).map(from => tx(chainId, from, chain.router, wei,
    v2.encodeFunctionData('swapExactETHForTokensSupportingFeeOnTransferTokens', [minimumOut, [chain.wrapped, target], from, deadline])));
}
export function contractPlan({ wallets, target, value, data, chainId }) {
  if (typeof data !== 'string' || data.length > 131_074 || !/^0x([0-9a-fA-F]{2}){4,}$/.test(data)) throw new Error('Paste full even-length contract calldata, including its 4-byte function selector.');
  return accounts(wallets).map(from => tx(chainId, from, target, amount(value, 18, true), data));
}
export function nftMintPlan({ wallets, target, value, quantity, chainId, signature }) {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) throw new Error('Mint quantity must be 1–100.');
  if (!['mint(uint256)', 'mint(address,uint256)'].includes(signature)) throw new Error('Unsupported mint signature.');
  const iface = new Interface([`function ${signature} payable`]);
  return accounts(wallets).map(from => tx(chainId, from, target, amount(value, 18, true),
    iface.encodeFunctionData('mint', signature === 'mint(uint256)' ? [quantity] : [from, quantity])));
}
export function publicBundle(transactions, kind, createdAt = new Date().toISOString(), expiresAt = null) {
  if (!transactions.length) throw new Error('Prepare transactions first.');
  return { format: 'imdbundler-unsigned-transactions', version: 1, kind, createdAt, expiresAt,
    atomic: false, note: 'Each sender signs separately. Recheck chain, recipient, amounts, nonce, gas, deadline and simulation before signing.', transactions };
}
export function profitLoss({ entry, exit, quantity, percent }) {
  const initial = Number(entry), units = Number(quantity);
  if (!Number.isFinite(initial) || initial <= 0 || !Number.isFinite(units) || units <= 0) throw new Error('Entry price and amount must be positive.');
  if ((percent === '' || percent == null) && (typeof exit !== 'string' || !exit.trim())) throw new Error('Enter an exit price or gain/loss percentage.');
  const final = percent !== '' && percent != null ? initial * (1 + Number(percent) / 100) : Number(exit);
  if (!Number.isFinite(final) || final < 0 || (percent !== '' && percent != null && !Number.isFinite(Number(percent)))) throw new Error('Enter a valid exit price or a percentage of at least −100%.');
  const pnl = (final - initial) * units, gain = (final / initial - 1) * 100;
  if (![pnl, gain, initial * units].every(Number.isFinite)) throw new Error('Numbers are too large.');
  return { entry: initial, exit: final, quantity: units, pnl, gain, pose: pnl > 0 ? 'happy' : pnl < 0 ? 'sad' : 'thinking' };
}
