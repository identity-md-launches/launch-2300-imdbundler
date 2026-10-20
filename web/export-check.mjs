// Release gate for the entire static export, including nested runtime dependencies.
// No network or development packages are needed to build the site.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, posix, resolve } from 'node:path';

export const REQUIRED_FILES = Object.freeze([
  'index.html', 'bootstrap.js', 'app.js', 'vault.js', 'chains.js', 'transactions.js',
  'rpc.js', 'deployment.js', 'deployment.json', 'providers.js', 'style.css',
  'vendor/ethers.js', 'vendor/ethers.LICENSE.md', 'vendor/ethers.NOTICES.txt',
  'assets/share.png', ...['happy', 'sad', 'thinking', 'smug', 'sleepy', 'dancing', 'focused', 'sunglasses']
    .map(pose => `assets/pepe-${pose}.svg`)
]);

/** @param {string} root @param {string} [prefix] @returns {Promise<Map<string, Buffer>>} */
export async function readTree(root, prefix = '') {
  const files = new Map();
  for (const entry of (await readdir(resolve(root, prefix), { withFileTypes: true }))
    .sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)))) {
    assert.ok(!entry.name.startsWith('.') && !['node_modules', 'cache'].includes(entry.name), `Not a site asset: ${entry.name}`);
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) for (const pair of await readTree(root, path)) files.set(...pair);
    else {
      assert.ok(entry.isFile(), `Export refuses symlinks and special files: ${path}`);
      files.set(path, await readFile(resolve(root, path)));
    }
  }
  return files;
}

/** @param {Uint8Array} data */
export function sha256(data) { return createHash('sha256').update(data).digest('hex'); }

/** @param {Map<string, Buffer>} files */
export function assetManifest(files) {
  return { format: 'imdbundler-static-assets', version: 1, entry: './index.html',
    files: [...files].filter(([path]) => path !== 'asset-manifest.json')
      .map(([path, bytes]) => ({ path: `./${path}`, bytes: bytes.length, sha256: sha256(bytes) })) };
}

/** @param {string} root */
export async function checkExport(root) {
  const files = await readTree(root);
  for (const path of REQUIRED_FILES) assert.ok(files.get(path)?.length, `Missing required export file: ${path}`);
  // Keep the existing, audited runtime version; an HTML fallback is not a JS dependency.
  const dependencies = JSON.parse(await readFile(new URL('../docs/dependencies.json', import.meta.url), 'utf8'));
  const ethers = dependencies.find(/** @param {{package?: string}} item */ item => item.package === 'ethers');
  assert.equal(sha256(files.get('vendor/ethers.js') ?? Buffer.alloc(0)), ethers.sha256, 'Ethers runtime checksum mismatch');

  /** @param {string} owner @param {string} ref */
  const requireLocal = (owner, ref) => {
    if (ref.startsWith('#')) return;
    assert.ok(ref.startsWith('./') || ref.startsWith('../'), `${owner}: asset URL must be relative: ${ref}`);
    const path = posix.normalize(posix.join(dirname(owner), ref.split(/[?#]/)[0]));
    assert.ok(!path.startsWith('../') && files.has(path), `${owner}: missing local dependency ${ref}`);
  };
  for (const [path, bytes] of files) {
    const text = bytes.toString('utf8');
    if (path.endsWith('.js')) {
      // Static imports/re-exports and string-literal dynamic imports in this ES-module application.
      for (const match of text.matchAll(/(?:^[ \t]*(?:import|export)[ \t]+(?:[^'"\n;]*?\bfrom[ \t]*)?|\bimport\s*\(\s*)["']([^"']+)["']/gm)) requireLocal(path, match[1]);
    } else if (path.endsWith('.html')) {
      for (const match of text.matchAll(/<(?:script|link|img)\b[^>]*?\b(?:src|href)=["']([^"']+)["']/g)) requireLocal(path, match[1]);
    } else if (path.endsWith('.css')) {
      for (const match of text.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)) requireLocal(path, match[1]);
    }
  }
  if (files.has('asset-manifest.json')) {
    const manifest = JSON.parse(files.get('asset-manifest.json')?.toString() ?? '');
    assert.deepEqual(manifest, assetManifest(files), 'Asset manifest does not match the complete export');
  }
  return files;
}
