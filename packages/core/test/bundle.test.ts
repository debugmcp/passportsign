import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BUNDLE_FORMAT_VERSION,
  BundleValidationError,
  readBundle,
  validateBundle,
  writeBundle,
  type PassportsignBundle,
} from '../src/bundle.js';

const validBundle = (overrides: Partial<PassportsignBundle> = {}): PassportsignBundle => ({
  bundle_format_version: BUNDLE_FORMAT_VERSION,
  statement: '7b7d',
  proof_blob: 'AAAA',
  rekor: {
    log_entry_hash: '24296fb24b8ad77a',
    inclusion_proof: {
      hashes: ['aabb', 'ccdd'],
      logIndex: 42,
      rootHash: 'eeff',
      treeSize: 100,
    },
    log_root_at_submission: 'sig-bytes-here',
  },
  ...overrides,
});

describe('validateBundle', () => {
  it('accepts a well-formed bundle', () => {
    expect(() => validateBundle(validBundle())).not.toThrow();
  });

  it('accepts inclusion_proof of any shape (including null)', () => {
    expect(() =>
      validateBundle(validBundle({ rekor: { ...validBundle().rekor, inclusion_proof: null } })),
    ).not.toThrow();
  });

  it.each([
    ['not an object (number)', 123, '$'],
    ['not an object (array)', [], '$'],
    ['not an object (null)', null, '$'],
  ])('rejects bundle when %s', (_label, bad, path) => {
    expect(() => validateBundle(bad)).toThrow(BundleValidationError);
    try {
      validateBundle(bad);
    } catch (e) {
      expect((e as BundleValidationError).path).toBe(path);
    }
  });

  it('rejects wrong bundle_format_version', () => {
    expect(() =>
      validateBundle({ ...validBundle(), bundle_format_version: 2 as never }),
    ).toThrow(/bundle_format_version/);
  });

  it.each([
    ['7B7D', 'uppercase hex'],
    ['abc', 'odd-length'],
    ['zzzz', 'non-hex chars'],
    ['', 'empty'],
  ])('rejects statement %s (%s)', (statement) => {
    expect(() => validateBundle(validBundle({ statement }))).toThrow(/statement/);
  });

  it.each([
    ['not!base64', 'contains illegal chars'],
    ['AAA', 'length not multiple of 4'],
    ['AAAAA', 'length not multiple of 4'],
  ])('rejects proof_blob %s (%s)', (proof_blob) => {
    expect(() => validateBundle(validBundle({ proof_blob }))).toThrow(/proof_blob/);
  });

  it('rejects missing rekor field', () => {
    const b = validBundle() as Partial<PassportsignBundle>;
    delete b.rekor;
    expect(() => validateBundle(b)).toThrow(/rekor/);
  });

  it('rejects empty rekor.log_entry_hash', () => {
    expect(() =>
      validateBundle(validBundle({ rekor: { ...validBundle().rekor, log_entry_hash: '' } })),
    ).toThrow(/log_entry_hash/);
  });

  it('rejects missing rekor.inclusion_proof field', () => {
    const r = { ...validBundle().rekor } as Partial<typeof validBundle.prototype.rekor> & {
      inclusion_proof?: unknown;
    };
    delete r.inclusion_proof;
    expect(() => validateBundle(validBundle({ rekor: r as never }))).toThrow(/inclusion_proof/);
  });

  it('rejects empty rekor.log_root_at_submission', () => {
    expect(() =>
      validateBundle(
        validBundle({ rekor: { ...validBundle().rekor, log_root_at_submission: '' } }),
      ),
    ).toThrow(/log_root_at_submission/);
  });
});

describe('readBundle / writeBundle round-trip', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'passportsign-bundle-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('write → read returns the same bundle', () => {
    const path = join(dir, 'binding.passportsign.json');
    const original = validBundle();
    writeBundle(path, original);
    const reread = readBundle(path);
    expect(reread).toEqual(original);
  });

  it('readBundle throws on invalid JSON', () => {
    const path = join(dir, 'bad.json');
    writeBundleRaw(path, 'this is not json');
    expect(() => readBundle(path)).toThrow(/invalid JSON/);
  });

  it('readBundle throws on schema violation', () => {
    const path = join(dir, 'malformed.json');
    writeBundleRaw(path, JSON.stringify({ bundle_format_version: 1 }));
    expect(() => readBundle(path)).toThrow(BundleValidationError);
  });

  it('writeBundle refuses to serialize a malformed bundle', () => {
    const path = join(dir, 'reject.json');
    const bad = { ...validBundle(), statement: 'NOT_HEX' };
    expect(() => writeBundle(path, bad as never)).toThrow(BundleValidationError);
  });
});

// Helper that bypasses validation to write arbitrary bytes for negative tests.
function writeBundleRaw(path: string, content: string): void {
  const { writeFileSync } = require('node:fs') as typeof import('node:fs');
  writeFileSync(path, content, 'utf8');
}
