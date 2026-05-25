/**
 * Binding nonce per spec §3 step 1: cryptographically random, ≥128 bits,
 * base32-encoded for gist-friendliness, prefixed with the service
 * namespace ("zkm-") and the username for human readability.
 *
 * Format: `zkm-{username}-{base32}`
 * Entropy: 160 bits (20 bytes → 32 base32 chars).
 */

import { randomBytes } from 'node:crypto';

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
export const NONCE_BYTES = 20;
export const NONCE_BASE32_LENGTH = 32; // (20 * 8) / 5

/**
 * RFC 4648 base32 (lowercase, no padding) of the input bytes.
 *
 * Uses BigInt to avoid 32-bit overflow when accumulating ≥4 bytes.
 */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0n;
  let bitCount = 0;
  let result = '';
  for (const byte of bytes) {
    bits = (bits << 8n) | BigInt(byte);
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      const idx = Number((bits >> BigInt(bitCount)) & 0x1fn);
      result += BASE32_ALPHABET[idx];
    }
  }
  if (bitCount > 0) {
    const idx = Number((bits << BigInt(5 - bitCount)) & 0x1fn);
    result += BASE32_ALPHABET[idx];
  }
  return result;
}

/**
 * Generate a fresh nonce for a binding session.
 *
 * @param username - GitHub username to embed in the nonce (case preserved).
 * @returns `zkm-<username>-<32 base32 chars>` (length-stable for valid usernames).
 */
export function generateNonce(username: string): string {
  if (username.length === 0) {
    throw new TypeError('generateNonce: username must be non-empty');
  }
  const bytes = randomBytes(NONCE_BYTES);
  return `zkm-${username}-${base32Encode(bytes)}`;
}
