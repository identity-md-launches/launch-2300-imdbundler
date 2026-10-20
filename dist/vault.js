import { Wallet, randomBytes, hexlify, getAddress } from './vendor/ethers.js';

const FORMAT = 'imdbundler-vault';
const ITERATIONS = 600_000;
const encoder = new TextEncoder();
const aad = encoder.encode(`${FORMAT}:1`);
const fail = (message) => { throw new Error(message); };
const base64 = (bytes) => btoa(String.fromCharCode(...bytes));
function unbase64(text, max) {
  if (typeof text !== 'string' || text.length > max || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) fail('Invalid encrypted vault.');
  return Uint8Array.from(atob(text), c => c.charCodeAt(0));
}
function checkPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) fail('Use a password of 12–1024 characters.');
}
async function encryptionKey(password, salt) {
  const bytes = encoder.encode(password);
  try {
    const material = await crypto.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveKey']);
    return await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, material,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  } finally { bytes.fill(0); }
}

export class Vault {
  #wallets = [];
  #revision = 0;
  get count() { return this.#wallets.length; }
  get addresses() { return this.#wallets.map(w => w.address); }
  clear() { this.#wallets = []; this.#revision++; }
  generate(count) {
    if (!Number.isInteger(count) || count < 1 || count > 50) fail('Choose 1–50 wallets.');
    if (this.count) fail('Clear the existing wallets before generating a new set.');
    if (!globalThis.crypto?.getRandomValues || !globalThis.crypto?.subtle) fail('A secure browser context (HTTPS or localhost) is required.');
    const next = [];
    for (let i = 0; i < count; i++) {
      const bytes = randomBytes(32);
      try {
        const wallet = new Wallet(hexlify(bytes));
        next.push({ address: wallet.address, privateKey: wallet.privateKey });
      } finally { bytes.fill(0); }
    }
    this.#wallets = next;
    this.#revision++;
    return this.addresses;
  }
  async encrypt(password) {
    checkPassword(password);
    if (!this.count) fail('Generate or restore wallets first.');
    const revision = this.#revision;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cleartext = encoder.encode(JSON.stringify({ wallets: this.#wallets }));
    try {
      const key = await encryptionKey(password, salt);
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, key, cleartext);
      if (revision !== this.#revision) fail('Wallets changed during export. Please try again.');
      return JSON.stringify({ format: FORMAT, version: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS,
        cipher: 'AES-256-GCM', salt: base64(salt), iv: base64(iv), ciphertext: base64(new Uint8Array(ciphertext)) }, null, 2);
    } finally { cleartext.fill(0); }
  }
  async keystore(index, password) {
    checkPassword(password);
    if (!Number.isInteger(index) || index < 0 || index >= this.count) fail('Choose one wallet.');
    const revision = this.#revision;
    const encrypted = await new Wallet(this.#wallets[index].privateKey).encrypt(password);
    if (revision !== this.#revision) fail('Wallets changed during export. Please try again.');
    return encrypted;
  }
  async restore(text, password) {
    checkPassword(password);
    if (this.count) fail('Clear the existing wallets before restoring a backup.');
    if (typeof text !== 'string' || text.length > 100_000) fail('Vault file is too large.');
    const revision = this.#revision;
    let bytes;
    try {
      const file = JSON.parse(text);
      if (file.format !== FORMAT || file.version !== 1 || file.kdf !== 'PBKDF2-SHA256' || file.iterations !== ITERATIONS || file.cipher !== 'AES-256-GCM') fail('format');
      const salt = unbase64(file.salt, 24), iv = unbase64(file.iv, 16), encrypted = unbase64(file.ciphertext, 90_000);
      if (salt.length !== 16 || iv.length !== 12 || encrypted.length < 17) fail('format');
      const key = await encryptionKey(password, salt);
      bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, key, encrypted));
      const content = JSON.parse(new TextDecoder().decode(bytes));
      if (!Array.isArray(content.wallets) || content.wallets.length < 1 || content.wallets.length > 50) fail('format');
      const wallets = content.wallets.map(w => {
        if (typeof w.privateKey !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(w.privateKey)) fail('format');
        const wallet = new Wallet(w.privateKey);
        if (wallet.address !== getAddress(w.address)) fail('address');
        return { address: wallet.address, privateKey: wallet.privateKey };
      });
      if (new Set(wallets.map(w => w.address)).size !== wallets.length) fail('duplicates');
      if (revision !== this.#revision || this.count) fail('changed');
      this.#wallets = wallets; this.#revision++;
      return this.addresses;
    } catch { fail('Cannot restore: wrong password, damaged file, unsupported format, or wallets changed.'); }
    finally { bytes?.fill(0); }
  }
}
