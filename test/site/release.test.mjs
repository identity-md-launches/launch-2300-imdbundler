import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, writeFile, mkdir, symlink, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { packageDirectory, base32 } from '../../scripts/package-site.mjs';
import { initCode, mine } from '../../scripts/mine-hook.mjs';
import { AbiCoder, getCreate2Address, keccak256 } from '../../site/vendor/ethers.js';

// Independent reader: validate CAR block hashes, decode UnixFS links, reconstruct every file.
function readVar(bytes, offset) {
  let value = 0, shift = 0, byte;
  do { byte = bytes[offset++]; assert.notEqual(byte, undefined); value += (byte & 127) * 2 ** shift; shift += 7; assert.ok(shift <= 49); } while (byte & 128);
  return [value, offset];
}
function fields(bytes) {
  const result = []; let offset = 0;
  while (offset < bytes.length) {
    let tag; [tag, offset] = readVar(bytes, offset);
    let value;
    if ((tag & 7) === 0) [value, offset] = readVar(bytes, offset);
    else {
      assert.equal(tag & 7, 2); let size; [size, offset] = readVar(bytes, offset);
      value = bytes.subarray(offset, offset + size); offset += size; assert.ok(offset <= bytes.length);
    }
    result.push([tag >> 3, value]);
  }
  return result;
}
function reconstruct(car) {
  const [headerLength, headerStart] = readVar(car, 0);
  const header = car.subarray(headerStart, headerStart + headerLength);
  assert.equal(header.subarray(0, 13).toString('hex'), 'a265726f6f747381d82a582500');
  assert.equal(header.subarray(-9).toString('hex'), '6776657273696f6e01');
  const root = header.subarray(13, 49);
  const blocks = new Map(); let pos = headerStart + headerLength;
  while (pos < car.length) {
    let length; [length, pos] = readVar(car, pos);
    const section = car.subarray(pos, pos + length); assert.equal(section.length, length); pos += length;
    const cid = section.subarray(0, 36), data = section.subarray(36);
    assert.equal(cid[0], 1); assert.ok([0x55, 0x70].includes(cid[1])); assert.equal(cid[2], 0x12); assert.equal(cid[3], 32);
    assert.deepEqual(cid.subarray(4), createHash('sha256').update(data).digest());
    assert.ok(!blocks.has(cid.toString('hex'))); blocks.set(cid.toString('hex'), data);
  }
  const files = new Map();
  function walk(cid, prefix) {
    const data = blocks.get(cid.toString('hex')); assert.ok(data);
    if (cid[1] === 0x55) { files.set(prefix, data); return data.length; }
    const values = fields(data);
    assert.deepEqual(fields(values.find(([tag]) => tag === 1)[1]), [[1, 1]], 'UnixFS Directory type');
    const names = []; let cumulative = data.length;
    for (const [tag, value] of values) {
      if (tag !== 2) continue;
      const link = new Map(fields(value)), name = link.get(2).toString('utf8');
      names.push(name); const size = walk(link.get(1), prefix ? `${prefix}/${name}` : name);
      assert.equal(link.get(3), size); cumulative += size;
    }
    assert.deepEqual(names, names.toSorted((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))));
    return cumulative;
  }
  walk(root, ''); return { files, cid: `b${base32(root)}` };
}
async function realFiles(root, prefix = '') {
  const files = new Map();
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) for (const pair of await realFiles(root, path)) files.set(...pair);
    else files.set(path, await readFile(join(root, path)));
  }
  return files;
}
test('IPFS CAR is deterministic, hashes correctly and reconstructs the entire static site', async () => {
  const first = await packageDirectory(resolve('site')), second = await packageDirectory(resolve('site'));
  assert.equal(first.cid, second.cid); assert.deepEqual(first.car, second.car);
  const decoded = reconstruct(first.car);
  assert.equal(decoded.cid, first.cid); assert.deepEqual(decoded.files, await realFiles('site'));
  assert.ok(decoded.files.has('index.html')); assert.ok(decoded.files.has('vendor/ethers.js'));
});
test('IPFS release refuses hidden, symlink and oversized files', async () => {
  await mkdir('test/scratch', { recursive: true });
  const dir = await mkdtemp('test/scratch/ipfs-');
  try {
    await writeFile(join(dir, '.private'), 'no'); await assert.rejects(packageDirectory(dir), /hidden/);
    await rm(join(dir, '.private')); await writeFile(join(dir, 'large'), Buffer.alloc(1_048_577)); await assert.rejects(packageDirectory(dir), /1 MiB/);
    await rm(join(dir, 'large')); await symlink(resolve('site/index.html'), join(dir, 'link')); await assert.rejects(packageDirectory(dir), /symlinks/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('hook mining uses the factory and exact constructor arguments, without deployment', () => {
  const factory = '0x1111111111111111111111111111111111111111', manager = '0x2222222222222222222222222222222222222222', token = '0x3333333333333333333333333333333333333333';
  const code = initCode('0x60006000', manager, token);
  const args = AbiCoder.defaultAbiCoder().decode(['address', 'address'], '0x' + code.slice(10));
  assert.equal(args[0], manager); assert.equal(args[1], token);
  const result = mine(factory, code);
  assert.equal(result.address, getCreate2Address(factory, result.salt, keccak256(code)));
  assert.equal(BigInt(result.address) & 0x3fffn, 0x20ccn);
});
