import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { checkExport, readTree } from '../../web/export-check.mjs';
import { checkCar } from '../../web/car-check.mjs';
import { packageDirectory, base32 } from '../../scripts/package-site.mjs';

test('committed dist and published CAR include all source files and the entire vendor directory', async () => {
  const source = await checkExport(resolve('site')), output = await checkExport(resolve('dist'));
  for (const [path, bytes] of source) assert.deepEqual(output.get(path), bytes, path);
  const car = await readFile('release/imdbundler.car');
  const cid = `b${base32(checkCar(car, output))}`;
  assert.equal((await readFile('release/cid.txt', 'utf8')).trim(), cid);
  const hosting = JSON.parse(await readFile('release/hosting.json', 'utf8'));
  assert.equal(hosting.cid, cid);
  assert.equal(hosting.url, 'https://imdb.sites.imd.fun/');
  assert.equal(hosting.name, 'imdb.site.identitymd.eth');
  assert.equal(hosting.label, 'imdb');
});

test('release checks reject missing vendor, missing imported modules, and corrupt Ethers', async () => {
  await mkdir('test/scratch', { recursive: true });
  const dir = await mkdtemp('test/scratch/export-');
  try {
    await cp('site', dir, { recursive: true });
    await rm(join(dir, 'vendor'), { recursive: true });
    await assert.rejects(checkExport(dir), /Missing required export file: vendor\/ethers.js/);
    await cp('site/vendor', join(dir, 'vendor'), { recursive: true });
    await writeFile(join(dir, 'app.js'), (await readFile('site/app.js', 'utf8')) + "\nimport './missing-module.js';\n");
    await assert.rejects(checkExport(dir), /missing local dependency .\/missing-module.js/);
    await cp('site/app.js', join(dir, 'app.js'));
    await writeFile(join(dir, 'vendor/ethers.js'), 'Not found');
    await assert.rejects(checkExport(dir), /Ethers runtime checksum mismatch/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('CAR validation rejects an omitted vendor directory and tampered blocks', async () => {
  await mkdir('test/scratch', { recursive: true });
  const dir = await mkdtemp('test/scratch/car-');
  try {
    await cp('dist', dir, { recursive: true });
    await rm(join(dir, 'vendor'), { recursive: true });
    const incomplete = await packageDirectory(resolve(dir));
    assert.throws(() => checkCar(incomplete.car, expectedFiles), /CAR must contain every dist asset/);
  } finally { await rm(dir, { recursive: true, force: true }); }
  const car = await readFile('release/imdbundler.car');
  car[car.length - 1] ^= 1;
  assert.throws(() => checkCar(car, expectedFiles), /CAR block digest mismatch/);
});
const expectedFiles = await readTree(resolve('dist'));
