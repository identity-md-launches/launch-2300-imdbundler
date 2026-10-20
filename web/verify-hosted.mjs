// Run once after the submission publisher activates the new IPFS version.
// No polling, wallet connection, signing, or RPC calls.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { checkExport, sha256 } from './export-check.mjs';

const base = new URL(process.argv[2] ?? 'https://imdb.sites.imd.fun/');
if (!base.pathname.endsWith('/') || base.search || base.hash
  || !['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
  throw new Error('Use the site base URL with a trailing slash and no credentials, query, or fragment.');
}
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const files = [...await checkExport(resolve(root))];
let passed = 0, failed = 0;
for (let start = 0; start < files.length; start += 4) {
  const results = await Promise.allSettled(files.slice(start, start + 4).map(async ([path, bytes]) => {
    const response = await fetch(new URL(path, base), { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    if (path.endsWith('.js') && !/(?:text|application)\/javascript/i.test(response.headers.get('content-type') ?? '')) {
      throw new Error(`${path}: incorrect JavaScript MIME type`);
    }
    if (sha256(new Uint8Array(await response.arrayBuffer())) !== sha256(bytes)) throw new Error(`${path}: differs from the prepared release`);
    return path;
  }));
  for (const result of results) {
    if (result.status === 'fulfilled') passed++;
    else { failed++; console.error(result.reason instanceof Error ? result.reason.message : String(result.reason)); }
  }
}
console.log(`${base.href}: ${passed}/${files.length} assets match the prepared release; ${failed} failures.`);
process.exitCode = failed ? 1 : 0;
