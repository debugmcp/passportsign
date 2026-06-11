import { describe, it, expect } from 'vitest';
import {
  PROFILE_INDEX_FILENAME,
  PROFILE_INDEX_VERSION,
  ProfileIndexValidationError,
  addBinding,
  addRevocation,
  createProfileIndex,
  fetchProfileIndex,
  mergeProfileIndexes,
  profileIndexUrl,
  validateProfileIndex,
  type ProfileIndex,
} from '../src/profile-index.js';
import { PassportsignError } from '../src/errors.js';

// The real v0 binding's Rekor UUID (80 hex chars: tree-ID prefix + entry hash).
const LIVE_UUID =
  '108e9186e8c5677a53b1918ed9b9bbe15194e42714fd3a3f8f0e163d3a22831120a4c540a332e151';
const OTHER_UUID = LIVE_UUID.replace(/1/g, '2');

function validIndex(): ProfileIndex {
  return {
    version: 1,
    github_username: 'cynarlab',
    bindings: [{ rekor_entry_hash: LIVE_UUID, bound_at: '2026-05-25T15:47:00Z' }],
    revocations: [],
  };
}

describe('createProfileIndex', () => {
  it('returns an empty v1 index for the username', () => {
    expect(createProfileIndex('cynarlab')).toEqual({
      version: PROFILE_INDEX_VERSION,
      github_username: 'cynarlab',
      bindings: [],
      revocations: [],
    });
  });

  it('throws on empty username', () => {
    expect(() => createProfileIndex('')).toThrow(TypeError);
  });
});

describe('validateProfileIndex', () => {
  it('accepts a well-formed index', () => {
    expect(validateProfileIndex(validIndex())).toEqual(validIndex());
  });

  it('accepts a revocation with and without revokes_rekor_entry_hash', () => {
    const idx = validIndex();
    idx.revocations = [
      { rekor_entry_hash: OTHER_UUID, revoked_at: '2026-06-01T00:00:00Z' },
      {
        rekor_entry_hash: OTHER_UUID.replace(/2/g, '3'),
        revokes_rekor_entry_hash: LIVE_UUID,
        revoked_at: '2026-06-02T00:00:00Z',
      },
    ];
    expect(validateProfileIndex(idx)).toEqual(idx);
  });

  it.each([
    ['non-object', 42],
    ['null', null],
    ['wrong version', { ...validIndex(), version: 2 }],
    ['missing username', { ...validIndex(), github_username: '' }],
    ['bindings not array', { ...validIndex(), bindings: {} }],
    [
      'rekor hash not 80-hex',
      { ...validIndex(), bindings: [{ rekor_entry_hash: 'abc', bound_at: '2026-05-25T15:47:00Z' }] },
    ],
    [
      'bound_at not a date',
      { ...validIndex(), bindings: [{ rekor_entry_hash: LIVE_UUID, bound_at: 'yesterday' }] },
    ],
    [
      'revocation with bad revokes hash',
      {
        ...validIndex(),
        revocations: [
          { rekor_entry_hash: OTHER_UUID, revokes_rekor_entry_hash: 'nope', revoked_at: '2026-06-01T00:00:00Z' },
        ],
      },
    ],
  ])('rejects %s', (_label, raw) => {
    expect(() => validateProfileIndex(raw)).toThrow(ProfileIndexValidationError);
  });
});

describe('addBinding / addRevocation', () => {
  it('appends a new binding immutably', () => {
    const idx = createProfileIndex('cynarlab');
    const out = addBinding(idx, { rekor_entry_hash: LIVE_UUID, bound_at: '2026-05-25T15:47:00Z' });
    expect(out.bindings).toHaveLength(1);
    expect(idx.bindings).toHaveLength(0);
  });

  it('is idempotent on the same rekor_entry_hash', () => {
    const idx = addBinding(createProfileIndex('cynarlab'), {
      rekor_entry_hash: LIVE_UUID,
      bound_at: '2026-05-25T15:47:00Z',
    });
    const out = addBinding(idx, { rekor_entry_hash: LIVE_UUID, bound_at: '2026-05-26T00:00:00Z' });
    expect(out.bindings).toHaveLength(1);
    expect(out.bindings[0]!.bound_at).toBe('2026-05-25T15:47:00Z');
  });

  it('appends revocations the same way', () => {
    const out = addRevocation(createProfileIndex('cynarlab'), {
      rekor_entry_hash: OTHER_UUID,
      revokes_rekor_entry_hash: LIVE_UUID,
      revoked_at: '2026-06-01T00:00:00Z',
    });
    expect(out.revocations).toHaveLength(1);
  });
});

describe('mergeProfileIndexes', () => {
  it('unions bindings and revocations, deduped by rekor_entry_hash', () => {
    const a = addBinding(createProfileIndex('cynarlab'), {
      rekor_entry_hash: LIVE_UUID,
      bound_at: '2026-05-25T15:47:00Z',
    });
    const b = addRevocation(
      addBinding(createProfileIndex('cynarlab'), {
        rekor_entry_hash: LIVE_UUID,
        bound_at: '2026-05-25T15:47:00Z',
      }),
      { rekor_entry_hash: OTHER_UUID, revoked_at: '2026-06-01T00:00:00Z' },
    );
    const merged = mergeProfileIndexes(a, b);
    expect(merged.bindings).toHaveLength(1);
    expect(merged.revocations).toHaveLength(1);
  });

  it('throws when usernames differ (case-insensitive match allowed)', () => {
    const a = createProfileIndex('cynarlab');
    const b = createProfileIndex('CynarLab');
    expect(() => mergeProfileIndexes(a, b)).not.toThrow();
    const c = createProfileIndex('someoneelse');
    expect(() => mergeProfileIndexes(a, c)).toThrow(ProfileIndexValidationError);
  });
});

describe('profileIndexUrl', () => {
  it('points at the profile repo raw file on main', () => {
    expect(profileIndexUrl('cynarlab')).toBe(
      'https://raw.githubusercontent.com/cynarlab/cynarlab/main/passportsign-index.json',
    );
  });

  it('uses the canonical filename constant', () => {
    expect(PROFILE_INDEX_FILENAME).toBe('passportsign-index.json');
    expect(profileIndexUrl('x')).toContain(PROFILE_INDEX_FILENAME);
  });
});

describe('fetchProfileIndex', () => {
  const okFetch = (body: unknown, status = 200): typeof fetch =>
    (async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })) as unknown as typeof fetch;

  it('returns the validated index on 200', async () => {
    const idx = await fetchProfileIndex('cynarlab', { fetch: okFetch(validIndex()) });
    expect(idx).toEqual(validIndex());
  });

  it('returns null on 404 (user has not published an index)', async () => {
    const fetch404 = (async () => new Response('not found', { status: 404 })) as unknown as typeof fetch;
    expect(await fetchProfileIndex('cynarlab', { fetch: fetch404 })).toBeNull();
  });

  it('throws ProfileIndexValidationError on malformed content', async () => {
    await expect(
      fetchProfileIndex('cynarlab', { fetch: okFetch({ version: 99 }) }),
    ).rejects.toThrow(ProfileIndexValidationError);
  });

  it('throws PassportsignError on non-404 HTTP failure', async () => {
    const fetch500 = (async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;
    await expect(fetchProfileIndex('cynarlab', { fetch: fetch500 })).rejects.toThrow(
      PassportsignError,
    );
  });

  it('throws PassportsignError on network failure', async () => {
    const fetchFail = (async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    await expect(fetchProfileIndex('cynarlab', { fetch: fetchFail })).rejects.toThrow(
      PassportsignError,
    );
  });
});
