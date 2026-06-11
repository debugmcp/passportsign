/**
 * Runtime-neutral byte/string primitives.
 *
 * Every module that needs hashing or hex/base64 goes through here so
 * the rest of core has no `node:crypto` / `Buffer` dependency and runs
 * unchanged on Node, Cloudflare Workers, and browsers. SHA-256 comes
 * from `@noble/hashes` (pure JS, synchronous — WebCrypto's async
 * digest would force async signatures through the whole verify path).
 */

import { sha256 } from '@noble/hashes/sha256';

const HEX_CHARS = '0123456789abcdef';

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) {
    out += HEX_CHARS[b >> 4]! + HEX_CHARS[b & 0x0f]!;
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new TypeError(`hexToBytes: invalid hex string (length ${hex.length})`);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP: Record<string, number> = {};
for (let i = 0; i < B64_ALPHABET.length; i++) B64_LOOKUP[B64_ALPHABET[i]!] = i;

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += B64_ALPHABET[b0 >> 2]!;
    out += B64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)]!;
    out += i + 1 < bytes.length ? B64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)]! : '=';
    out += i + 2 < bytes.length ? B64_ALPHABET[b2 & 0x3f]! : '=';
  }
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  if (b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) {
    throw new TypeError('base64ToBytes: invalid base64 string');
  }
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  const byteLength = (b64.length / 4) * 3 - padding;
  const out = new Uint8Array(byteLength);
  let outIdx = 0;
  for (let i = 0; i < b64.length; i += 4) {
    const c0 = B64_LOOKUP[b64[i]!]!;
    const c1 = B64_LOOKUP[b64[i + 1]!]!;
    const c2 = b64[i + 2] === '=' ? 0 : B64_LOOKUP[b64[i + 2]!]!;
    const c3 = b64[i + 3] === '=' ? 0 : B64_LOOKUP[b64[i + 3]!]!;
    if (outIdx < byteLength) out[outIdx++] = (c0 << 2) | (c1 >> 4);
    if (outIdx < byteLength) out[outIdx++] = ((c1 & 0x0f) << 4) | (c2 >> 2);
    if (outIdx < byteLength) out[outIdx++] = ((c2 & 0x03) << 6) | c3;
  }
  return out;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function utf8ToBytes(s: string): Uint8Array {
  return textEncoder.encode(s);
}

export function bytesToUtf8(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

export function sha256Bytes(bytes: Uint8Array): Uint8Array {
  return sha256(bytes);
}

export function sha256Hex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

/** Cryptographically secure random bytes via the platform's WebCrypto. */
export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}
