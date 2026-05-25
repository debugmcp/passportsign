import { describe, it, expect } from 'vitest';
import { base32Encode, generateNonce, NONCE_BASE32_LENGTH } from '../src/nonce.js';

describe('base32Encode', () => {
  it('matches RFC 4648 test vectors (lowercase, no padding)', () => {
    // RFC 4648 §10 test vectors, lowercased and depadded for our variant.
    const cases: Array<[string, string]> = [
      ['', ''],
      ['f', 'my'],
      ['fo', 'mzxq'],
      ['foo', 'mzxw6'],
      ['foob', 'mzxw6yq'],
      ['fooba', 'mzxw6ytb'],
      ['foobar', 'mzxw6ytboi'],
    ];
    for (const [input, expected] of cases) {
      const got = base32Encode(new TextEncoder().encode(input));
      expect(got, `input "${input}"`).toBe(expected);
    }
  });

  it('encodes exact byte sequences deterministically', () => {
    // 0x00 0x44 0x32 0x14 0xc7 in binary, split into 5-bit groups:
    // 00000 00001 00010 00011 00100 00101 00110 00111 → indices 0..7 → "abcdefgh"
    const bytes = new Uint8Array([0x00, 0x44, 0x32, 0x14, 0xc7]);
    expect(base32Encode(bytes)).toBe('abcdefgh');
  });
});

describe('generateNonce', () => {
  it('format: zkm-<username>-<32 base32 chars>', () => {
    const n = generateNonce('johnf');
    expect(n).toMatch(/^zkm-johnf-[a-z2-7]{32}$/);
    expect(n).toHaveLength('zkm-johnf-'.length + NONCE_BASE32_LENGTH);
  });

  it('preserves username casing', () => {
    expect(generateNonce('JohnF')).toMatch(/^zkm-JohnF-[a-z2-7]{32}$/);
  });

  it('produces unique nonces across many calls (entropy check)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(generateNonce('u'));
    expect(seen.size).toBe(200);
  });

  it('throws on empty username', () => {
    expect(() => generateNonce('')).toThrow(TypeError);
  });
});
