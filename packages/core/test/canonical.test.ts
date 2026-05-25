import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { canonicalize, canonicalSha256Hex } from '../src/canonical.js';

const fixturesPath = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'canonical-vectors.json',
);

interface Vector {
  name: string;
  input: unknown;
  canonicalBytesHex: string;
  sha256Hex: string;
}

const vectors: Vector[] = JSON.parse(readFileSync(fixturesPath, 'utf8'));

describe('canonical', () => {
  describe('canonicalize() produces pinned bytes (drift detection)', () => {
    for (const v of vectors) {
      it(v.name, () => {
        const got = Buffer.from(canonicalize(v.input)).toString('hex');
        expect(got).toBe(v.canonicalBytesHex);
      });
    }
  });

  describe('canonicalSha256Hex() produces pinned digests', () => {
    for (const v of vectors) {
      it(v.name, () => {
        expect(canonicalSha256Hex(v.input)).toBe(v.sha256Hex);
      });
    }
  });

  it('throws TypeError on undefined', () => {
    expect(() => canonicalize(undefined)).toThrow(TypeError);
  });

  it('throws TypeError on cyclic input', () => {
    const cycle: Record<string, unknown> = {};
    cycle['self'] = cycle;
    expect(() => canonicalize(cycle)).toThrow();
  });
});
