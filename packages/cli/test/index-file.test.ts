import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PROFILE_INDEX_FILENAME, ProfileIndexValidationError } from '@passportsign/core';
import { updateIndexFileWithBinding } from '../src/index-file.js';

const UUID_A =
  '108e9186e8c5677a53b1918ed9b9bbe15194e42714fd3a3f8f0e163d3a22831120a4c540a332e151';
const UUID_B = UUID_A.replace(/1/g, '2');

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'passportsign-index-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('updateIndexFileWithBinding', () => {
  it('creates passportsign-index.json when none exists', () => {
    const { path, index } = updateIndexFileWithBinding(dir, 'cynarlab', {
      rekor_entry_hash: UUID_A,
      bound_at: '2026-05-25T15:47:00Z',
    });
    expect(path).toBe(join(dir, PROFILE_INDEX_FILENAME));
    expect(index.bindings).toHaveLength(1);
    const onDisk = JSON.parse(readFileSync(path, 'utf8'));
    expect(onDisk.version).toBe(1);
    expect(onDisk.github_username).toBe('cynarlab');
    expect(onDisk.bindings[0].rekor_entry_hash).toBe(UUID_A);
    // File ends with a newline (friendly for git diffs).
    expect(readFileSync(path, 'utf8').endsWith('\n')).toBe(true);
  });

  it('appends to an existing index and preserves prior entries', () => {
    updateIndexFileWithBinding(dir, 'cynarlab', {
      rekor_entry_hash: UUID_A,
      bound_at: '2026-05-25T15:47:00Z',
    });
    const { index } = updateIndexFileWithBinding(dir, 'cynarlab', {
      rekor_entry_hash: UUID_B,
      bound_at: '2026-06-01T00:00:00Z',
    });
    expect(index.bindings.map((b) => b.rekor_entry_hash)).toEqual([UUID_A, UUID_B]);
  });

  it('is idempotent for the same entry hash', () => {
    updateIndexFileWithBinding(dir, 'cynarlab', {
      rekor_entry_hash: UUID_A,
      bound_at: '2026-05-25T15:47:00Z',
    });
    const { index } = updateIndexFileWithBinding(dir, 'cynarlab', {
      rekor_entry_hash: UUID_A,
      bound_at: '2026-05-25T15:47:00Z',
    });
    expect(index.bindings).toHaveLength(1);
  });

  it('throws on a corrupt existing file and leaves it untouched', () => {
    const path = join(dir, PROFILE_INDEX_FILENAME);
    writeFileSync(path, '{"version": 99}', 'utf8');
    expect(() =>
      updateIndexFileWithBinding(dir, 'cynarlab', {
        rekor_entry_hash: UUID_A,
        bound_at: '2026-05-25T15:47:00Z',
      }),
    ).toThrow(ProfileIndexValidationError);
    expect(readFileSync(path, 'utf8')).toBe('{"version": 99}');
  });
});
