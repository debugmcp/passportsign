import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openCache, type BindingRow, type PassportsignCache } from '../../src/storage/sqlite.js';

function row(overrides: Partial<BindingRow> = {}): BindingRow {
  return {
    github_username: 'johnf',
    unique_identifier: '13902036709356453377929569764273223082772964910104338589480118024404105097567',
    issuing_country: 'CAN',
    disclosure_level: 'personhood+country',
    scope: 'passportsign.dev:nationality-disclose:1',
    zkpassport_sdk_ver: '0.15.1',
    proof_blob: new Uint8Array([0x01, 0x02, 0x03]),
    gist_url: 'https://gist.github.com/johnf/abc',
    gist_content_sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    bound_at: '2026-05-25T10:30:00.000Z',
    log_entry_hash: 'rekor-entry-uuid-1',
    log_inclusion_proof: { hashes: ['aabb'], logIndex: 1, rootHash: 'cc', treeSize: 2 },
    log_root_at_submission: 'sig-root-1',
    last_checked_at: '2026-05-25T10:30:00.000Z',
    status: 'active',
    ...overrides,
  };
}

describe('openCache', () => {
  let dir: string;
  let cache: PassportsignCache;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'passportsign-sqlite-test-'));
    cache = openCache(join(dir, 'cache.db'));
  });

  afterEach(() => {
    cache.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips a binding row', () => {
    const original = row();
    cache.upsertBinding(original);
    const got = cache.getByUsername('johnf');
    expect(got).not.toBeNull();
    expect(got).toEqual(original);
  });

  it('preserves Uint8Array proof_blob bytes through the round-trip', () => {
    cache.upsertBinding(row({ proof_blob: new Uint8Array([0, 1, 2, 3, 254, 255]) }));
    const got = cache.getByUsername('johnf');
    expect(Array.from(got!.proof_blob)).toEqual([0, 1, 2, 3, 254, 255]);
  });

  it('preserves log_inclusion_proof JSON shape', () => {
    const proof = { nested: { value: 42 }, list: [1, 2, 3], nullField: null };
    cache.upsertBinding(row({ log_inclusion_proof: proof }));
    const got = cache.getByUsername('johnf');
    expect(got!.log_inclusion_proof).toEqual(proof);
  });

  it('lowercases username on insert and read (spec §10 row 7)', () => {
    cache.upsertBinding(row({ github_username: 'JohnF' }));
    expect(cache.getByUsername('JOHNF')).not.toBeNull();
    expect(cache.getByUsername('JohnF')!.github_username).toBe('johnf');
  });

  it('getByUsername returns null for unknown user', () => {
    expect(cache.getByUsername('nobody')).toBeNull();
  });

  it('getByUniqueIdentifier returns all bindings under that identifier', () => {
    cache.upsertBinding(row({ github_username: 'a', log_entry_hash: 'h-a' }));
    cache.upsertBinding(row({ github_username: 'b', log_entry_hash: 'h-b' }));
    cache.upsertBinding(row({
      github_username: 'c',
      log_entry_hash: 'h-c',
      unique_identifier: 'different',
    }));
    const got = cache.getByUniqueIdentifier(row().unique_identifier);
    expect(got.map((r) => r.github_username).sort()).toEqual(['a', 'b']);
  });

  it('upsert updates an existing row by primary key', () => {
    cache.upsertBinding(row({ status: 'active' }));
    cache.upsertBinding(row({ status: 'stale', last_checked_at: '2026-06-01T00:00:00.000Z' }));
    const got = cache.getByUsername('johnf')!;
    expect(got.status).toBe('stale');
    expect(got.last_checked_at).toBe('2026-06-01T00:00:00.000Z');
  });

  it('setStatus updates only the status', () => {
    cache.upsertBinding(row({ status: 'active' }));
    cache.setStatus('johnf', 'revoked');
    expect(cache.getByUsername('johnf')!.status).toBe('revoked');
  });

  it('setLastChecked updates last_checked_at to ISO 8601', () => {
    cache.upsertBinding(row());
    const when = new Date('2026-06-15T12:00:00.000Z');
    cache.setLastChecked('johnf', when);
    expect(cache.getByUsername('johnf')!.last_checked_at).toBe(when.toISOString());
  });

  it('rejects invalid status via CHECK constraint', () => {
    expect(() => cache.upsertBinding(row({ status: 'bogus' as never }))).toThrow();
  });

  it('rejects invalid disclosure_level via CHECK constraint', () => {
    expect(() =>
      cache.upsertBinding(row({ disclosure_level: 'something' as never })),
    ).toThrow();
  });

  it('UNIQUE log_entry_hash blocks duplicate entries across users', () => {
    cache.upsertBinding(row({ github_username: 'a' }));
    expect(() => cache.upsertBinding(row({ github_username: 'b' }))).toThrow();
  });
});
