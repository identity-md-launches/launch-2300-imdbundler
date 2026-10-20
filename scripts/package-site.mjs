// A small, deterministic UnixFS directory / CARv1 writer. Files are raw IPLD blocks.
// No network, credentials, package install, mtime, or host metadata enters the release.
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const concat = (...parts) => Buffer.concat(parts);
export function varint(value) {
  let n = BigInt(value); const bytes = [];
  if (n < 0n) throw new Error('Negative varint');
  do { const byte = Number(n & 127n); n >>= 7n; bytes.push(byte | (n ? 128 : 0)); } while (n);
  return Buffer.from(bytes);
}
function bytesField(field, bytes) { return concat(varint(field * 8 + 2), varint(bytes.length), bytes); }
function intField(field, value) { return concat(varint(field * 8), varint(value)); }
export function base32(bytes) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567'; let bits = 0, value = 0, out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; out += alphabet[(value >>> bits) & 31]; }
  }
  if (bits) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
function block(data, codec) {
  const cid = concat(varint(1), varint(codec), Buffer.from([0x12, 32]), createHash('sha256').update(data).digest());
  return { cid, data, size: data.length };
}
export async function packageDirectory(directory) {
  const blocks = new Map();
  function add(item) { blocks.set(item.cid.toString('hex'), item); return item; }
  async function visit(path) {
    const entries = (await readdir(path, { withFileTypes: true })).sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)));
    const links = []; let childrenSize = 0;
    for (const entry of entries) {
      if (entry.isSymbolicLink() || !entry.isDirectory() && !entry.isFile()) throw new Error('Release refuses symlinks and special files.');
      if (entry.name.startsWith('.') || entry.name === 'node_modules') throw new Error('Release refuses hidden files and dependency directories.');
      let child;
      if (entry.isDirectory()) child = await visit(join(path, entry.name));
      else {
        const data = await readFile(join(path, entry.name));
        if (data.length > 1_048_576) throw new Error(`${entry.name} exceeds the 1 MiB raw block limit.`);
        child = add(block(data, 0x55));
      }
      childrenSize += child.size;
      const link = concat(bytesField(1, child.cid), bytesField(2, Buffer.from(entry.name)), intField(3, child.size));
      links.push(bytesField(2, link));
    }
    // DAG-PB canonical ordering: sorted Links followed by Data. UnixFS Type=Directory (1).
    const directoryBlock = add(block(concat(...links, bytesField(1, intField(1, 1))), 0x70));
    directoryBlock.size += childrenSize;
    return directoryBlock;
  }
  const root = await visit(directory);
  // DAG-CBOR: { roots: [tag42(bytes(0x00 + rootCID))], version: 1 }.
  const header = concat(Buffer.from('a265726f6f747381d82a582500', 'hex'), root.cid, Buffer.from('6776657273696f6e01', 'hex'));
  const chunks = [varint(header.length), header];
  for (const item of blocks.values()) chunks.push(varint(item.cid.length + item.data.length), item.cid, item.data);
  return { cid: `b${base32(root.cid)}`, car: concat(...chunks), root: root.cid, blocks: blocks.size };
}
export async function buildSite(source = resolve('site'), output = resolve('release')) {
  const result = await packageDirectory(source);
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'imdbundler.car'), result.car);
  await writeFile(join(output, 'cid.txt'), `${result.cid}\n`);
  await writeFile(join(output, 'checksums.txt'), `${createHash('sha256').update(result.car).digest('hex')}  imdbundler.car\n`);
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildSite();
  console.log(`IPFS release prepared locally: ${result.cid}\n${result.blocks} blocks / ${result.car.length} bytes\nImport release/imdbundler.car into an authorized IPFS pinning service. This command does not publish.`);
}
