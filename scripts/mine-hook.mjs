import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AbiCoder, concat, getCreate2Address, keccak256, toBeHex } from '../site/vendor/ethers.js';
import { address } from '../site/transactions.js';
export function initCode(bytecode, manager, token) {
  return concat([bytecode, AbiCoder.defaultAbiCoder().encode(['address', 'address'], [address(manager), address(token)])]);
}
export function mine(factory, code, start = 0n, attempts = 1_000_000) {
  factory = address(factory);
  const hash = keccak256(code);
  for (let i = start; i < start + BigInt(attempts); i++) {
    const salt = toBeHex(i, 32), predicted = getCreate2Address(factory, salt, hash);
    if ((BigInt(predicted) & 0x3fffn) === 0x20ccn) return { salt, address: predicted, flags: '0x20cc', initCodeHash: hash };
  }
  throw new Error('No salt found in this range. Continue with a larger start value.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [factory, manager, token, start = '0'] = process.argv.slice(2);
  if (!factory || !manager || !token) throw new Error('Usage: node scripts/mine-hook.mjs FACTORY POOL_MANAGER TOKEN [START_SALT]');
  const artifact = JSON.parse(await readFile('out/IMDBHook.sol/IMDBHook.json', 'utf8'));
  console.log(JSON.stringify(mine(factory, initCode(artifact.bytecode.object, manager, token), BigInt(start)), null, 2));
}
