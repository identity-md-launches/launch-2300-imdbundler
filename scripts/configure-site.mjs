// Run only after the launch has returned real, verified addresses. No signer or credentials used.
import { writeFile } from 'node:fs/promises';
import { address } from '../site/transactions.js';
const [tokenArg, hookArg, sourceArg] = process.argv.slice(2);
if (!tokenArg || !hookArg || !sourceArg) throw new Error('Usage: node scripts/configure-site.mjs TOKEN_ADDRESS HOOK_ADDRESS https://github.com/ORG/REPO/tree/COMMIT');
const token = address(tokenArg), hook = address(hookArg), source = new URL(sourceArg);
if (token === hook || (BigInt(hook) & 0x3fffn) !== 0x20ccn) throw new Error('Token/hook mismatch or hook permission flags are wrong.');
if (source.protocol !== 'https:' || source.hostname !== 'github.com' || source.username || source.password || source.search || source.hash || !/^\/[^/]+\/[^/]+\/tree\/[0-9a-fA-F]{40}\/?$/.test(source.pathname)) throw new Error('Use the exact reviewed GitHub source commit URL.');
await writeFile('site/deployment.json', JSON.stringify({ chainId: 1, status: 'deployed', token, hook, sourceUrl: source.href }, null, 2) + '\n');
console.log('Public deployment metadata updated. Verify bytecode separately, then rebuild the IPFS release.');
