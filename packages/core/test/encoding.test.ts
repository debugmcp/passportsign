import { describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  bytesToUtf8,
  hexToBytes,
  randomBytes,
  sha256Bytes,
  sha256Hex,
  utf8ToBytes,
} from '../src/encoding.js';

describe('hex', () => {
  it('round-trips bytes', () => {
    const bytes = new Uint8Array([0x00, 0x01, 0xab, 0xff]);
    expect(bytesToHex(bytes)).toBe('0001abff');
    expect(hexToBytes('0001abff')).toEqual(bytes);
  });

  it('matches Buffer for arbitrary data', () => {
    const bytes = new Uint8Array(Array.from({ length: 256 }, (_, i) => i));
    expect(bytesToHex(bytes)).toBe(Buffer.from(bytes).toString('hex'));
  });

  it('hexToBytes rejects odd-length and non-hex input', () => {
    expect(() => hexToBytes('abc')).toThrow(TypeError);
    expect(() => hexToBytes('zz')).toThrow(TypeError);
  });
});

describe('base64', () => {
  it('round-trips and matches Buffer', () => {
    const cases = ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar', '{"json":true}'];
    for (const s of cases) {
      const bytes = new TextEncoder().encode(s);
      const b64 = bytesToBase64(bytes);
      expect(b64, s).toBe(Buffer.from(bytes).toString('base64'));
      expect(base64ToBytes(b64), s).toEqual(bytes);
    }
  });

  it('handles binary data round-trip', () => {
    const bytes = new Uint8Array(Array.from({ length: 256 }, (_, i) => i));
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it('base64ToBytes rejects invalid input', () => {
    expect(() => base64ToBytes('!!!not-base64!!!')).toThrow(TypeError);
    expect(() => base64ToBytes('abc')).toThrow(TypeError); // bad length
  });
});

describe('utf8', () => {
  it('round-trips multibyte text', () => {
    const s = 'héllo · 日本語';
    expect(bytesToUtf8(utf8ToBytes(s))).toBe(s);
  });
});

describe('sha256', () => {
  it('matches the NIST empty-string vector', () => {
    expect(sha256Hex(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('matches the NIST "abc" vector', () => {
    expect(sha256Hex(utf8ToBytes('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('sha256Bytes agrees with sha256Hex', () => {
    const bytes = utf8ToBytes('passportsign');
    expect(bytesToHex(sha256Bytes(bytes))).toBe(sha256Hex(bytes));
  });
});

describe('randomBytes', () => {
  it('returns the requested length with entropy', () => {
    const a = randomBytes(20);
    const b = randomBytes(20);
    expect(a).toHaveLength(20);
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });
});
