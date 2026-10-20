// Run only after the launch has returned real, verified addresses. No signer or credentials used.
import { writeFile } from 'node:fs/promises';
import { parseDeployment } from '../site/deployment.js';
const [tokenArg, hookArg, sourceArg] = process.argv.slice(2);
if (!tokenArg || !hookArg || !sourceArg) throw new Error('Usage: node scripts/configure-site.mjs TOKEN_ADDRESS HOOK_ADDRESS https://github.com/ORG/REPO/tree/COMMIT');
const deployment = parseDeployment({ chainId: 1, status: 'deployed', token: tokenArg, hook: hookArg, sourceUrl: sourceArg });
await writeFile('site/deployment.json', JSON.stringify(deployment, null, 2) + '\n');
console.log('Public deployment metadata updated. Verify bytecode separately, then rebuild the IPFS release.');
