// Decode the produced CAR rather than trusting the packager's input inventory.
// Verify every block digest, UnixFS link, cumulative size, and exported file.
import assert from 'node:assert/strict';
import { sha256 } from './export-check.mjs';

/** @param {Buffer} bytes @param {number} offset @returns {[number, number]} */
function readVar(bytes, offset) {
  let value = 0, shift = 0, byte;
  do {
    byte = bytes[offset++]; assert.notEqual(byte, undefined, 'Truncated CAR varint');
    value += (byte & 127) * 2 ** shift; shift += 7; assert.ok(shift <= 49);
  } while (byte & 128);
  return [value, offset];
}
/** @param {Buffer} bytes @returns {Map<number, (number | Buffer)[]>} */
function fields(bytes) {
  const result = new Map(); let offset = 0;
  while (offset < bytes.length) {
    let tag; [tag, offset] = readVar(bytes, offset);
    /** @type {number | Buffer} */
    let value;
    if ((tag & 7) === 0) [value, offset] = readVar(bytes, offset);
    else {
      assert.equal(tag & 7, 2); let size; [size, offset] = readVar(bytes, offset);
      value = bytes.subarray(offset, offset + size); offset += size; assert.ok(offset <= bytes.length);
    }
    const values = result.get(tag >> 3) ?? []; values.push(value); result.set(tag >> 3, values);
  }
  return result;
}
/** @param {Map<number, (number | Buffer)[]>} values @param {number} field */
function bufferField(values, field) {
  const value = values.get(field)?.[0]; assert.ok(Buffer.isBuffer(value)); return value;
}

/** @param {Buffer} car @param {Map<string, Buffer>} expected @returns {Buffer} */
export function checkCar(car, expected) {
  const [headerLength, headerStart] = readVar(car, 0);
  const header = car.subarray(headerStart, headerStart + headerLength);
  assert.equal(header.toString('hex', 0, 13), 'a265726f6f747381d82a582500');
  assert.equal(header.subarray(-9).toString('hex'), '6776657273696f6e01');
  const root = header.subarray(13, 49);
  /** @type {Map<string, Buffer>} */
  const blocks = new Map(); let pos = headerStart + headerLength;
  while (pos < car.length) {
    let length; [length, pos] = readVar(car, pos);
    const section = car.subarray(pos, pos + length); assert.equal(section.length, length); pos += length;
    const cid = section.subarray(0, 36), data = section.subarray(36);
    assert.equal(cid[0], 1); assert.ok([0x55, 0x70].includes(cid[1])); assert.equal(cid[2], 0x12); assert.equal(cid[3], 32);
    assert.equal(cid.subarray(4).toString('hex'), sha256(data), 'CAR block digest mismatch');
    assert.ok(!blocks.has(cid.toString('hex'))); blocks.set(cid.toString('hex'), data);
  }
  /** @type {Map<string, Buffer>} */
  const files = new Map();
  const visited = new Set();
  /** @param {Buffer} cid @param {string} prefix @returns {number} */
  function walk(cid, prefix) {
    const key = cid.toString('hex'), data = blocks.get(key); assert.ok(data, `Missing IPFS block: ${prefix}`);
    visited.add(key);
    if (cid[1] === 0x55) { assert.ok(!files.has(prefix)); files.set(prefix, data); return data.length; }
    const values = fields(data);
    assert.deepEqual(fields(bufferField(values, 1)).get(1), [1], 'UnixFS directory type');
    /** @type {string[]} */
    const names = []; let cumulative = data.length;
    for (const linkBytes of values.get(2) ?? []) {
      assert.ok(Buffer.isBuffer(linkBytes)); const link = fields(linkBytes);
      const name = bufferField(link, 2).toString('utf8');
      assert.ok(name && !name.includes('/') && !name.startsWith('.'), 'Invalid IPFS path');
      assert.ok(!names.includes(name), 'Duplicate IPFS link'); names.push(name);
      const size = walk(bufferField(link, 1), prefix ? `${prefix}/${name}` : name);
      assert.equal(link.get(3)?.[0], size); cumulative += size;
    }
    assert.deepEqual(names, [...names].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))));
    return cumulative;
  }
  walk(root, '');
  assert.equal(visited.size, blocks.size, 'Unreachable IPFS blocks');
  assert.equal(files.size, expected.size, 'CAR must contain every dist asset, including vendor/');
  for (const [path, bytes] of expected) {
    const actual = files.get(path);
    assert.ok(actual, `CAR is missing dist/${path}`);
    assert.equal(sha256(actual), sha256(bytes), `CAR bytes differ from dist/${path}`);
  }
  return root;
}
