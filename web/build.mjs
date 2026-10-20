// Export the existing site verbatim; do not compile or deploy contracts.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { buildSite, base32 } from '../scripts/package-site.mjs';
import { checkExport, assetManifest } from './export-check.mjs';
import { checkCar } from './car-check.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = resolve(root, 'site');
const output = resolve(root, 'dist');
// Validate imports and the complete vendor tree before replacing a working export.
const sourceFiles = await checkExport(source);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true, dereference: false });
assert.deepEqual(await checkExport(output), sourceFiles, 'Full site tree must survive export, including nested vendor files');
await writeFile(resolve(output, 'asset-manifest.json'), JSON.stringify(assetManifest(sourceFiles), null, 2) + '\n');
const exported = await checkExport(output);
// Package the exact published directory, rather than a separate source directory.
const result = await buildSite(output, resolve(root, 'release'));
const rootCid = checkCar(await readFile(resolve(root, 'release/imdbundler.car')), exported);
assert.equal(`b${base32(rootCid)}`, result.cid);
await writeFile(resolve(root, 'release/hosting.json'), JSON.stringify({
  ipfs: true,
  label: 'imdb',
  name: 'imdb.site.identitymd.eth',
  url: 'https://imdb.sites.imd.fun/',
  cid: result.cid,
  entry: 'dist/index.html',
  assetManifest: 'dist/asset-manifest.json',
  note: 'Prepared release for the existing site. Pin and name activation are performed by the submission publisher; this file is not a publication receipt.'
}, null, 2) + '\n');
console.log(`Production export: dist/ (${exported.size} files, all imports and vendor checksums verified).`);
console.log(`IPFS: ${result.cid} / ${result.car.length} bytes. CAR independently reconstructed and matched to dist/.`);
