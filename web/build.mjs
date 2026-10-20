// Export the existing site verbatim; do not compile or deploy contracts.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = resolve(root, 'site');
const output = resolve(root, 'dist');
// Catch missing entry points before replacing the last successful export.
await readFile(resolve(source, 'index.html'));
await readFile(resolve(source, 'assets/share.png'));
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true, dereference: false });
const result = spawnSync(process.execPath, ['scripts/package-site.mjs'], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`IPFS packaging failed: ${result.status}`);
await writeFile(resolve(root, 'release/hosting.json'), JSON.stringify({
  ipfs: true,
  label: 'imdbundler',
  url: 'https://imdbundler.sites.imd.fun/',
  cid: (await readFile(resolve(root, 'release/cid.txt'), 'utf8')).trim(),
  note: 'Publication intent only. A locally generated CID does not establish a pin or active label.'
}, null, 2) + '\n');
console.log('Production export: dist/ (identical to site/). CAR and CID: release/.');
