import { describe, expect, it, vi } from 'vitest';
import {
  buildStatement,
  buildRevocationStatement,
  canonicalize,
  hashLeaf,
  sha256Hex,
  bytesToBase64,
  bytesToHex,
  utf8ToBytes,
  type ProfileIndex,
  type RekorClient,
  type RekorEntryResponse,
} from '@passportsign/core/web';
import { buildBadge } from '../src/badge-handler.js';

const NOW = Date.parse('2026-06-11T00:00:00Z');
const RECENT = Math.floor(NOW / 1000) - 10 * 24 * 3600;
const ANCIENT = Math.floor(NOW / 1000) - 400 * 24 * 3600;

const UUID_BIND = 'a'.repeat(80);
const UUID_REVOKE = 'c'.repeat(80);

function bindingStatement(username: string) {
  return buildStatement({
    github_username: username,
    unique_identifier: 'uid-1',
    issuing_country: 'CAN',
    proof_blob_sha256: '0a'.repeat(32),
    gist_url: `https://gist.github.com/${username}/abc`,
    gist_content_sha256: 'e3'.repeat(32),
    scope: 'passportsign.dev:nationality-disclose:1',
    zkpassport_sdk_version: '0.15.1',
  });
}

function revocationStatement(username: string) {
  return buildRevocationStatement({
    github_username: username,
    unique_identifier: 'uid-1',
    revokes_rekor_entry_hash: UUID_BIND,
    proof_blob_sha256: '0b'.repeat(32),
    scope: 'passportsign.dev:nationality-disclose:1',
    zkpassport_sdk_version: '0.15.1',
  });
}

function fakeEntry(uuid: string, statement: object, integratedTime = RECENT): RekorEntryResponse {
  const attestation = canonicalize(statement);
  const body = utf8ToBytes(
    JSON.stringify({
      apiVersion: '0.0.2',
      kind: 'intoto',
      spec: { content: { payloadHash: { algorithm: 'sha256', value: sha256Hex(attestation) } } },
    }),
  );
  return {
    uuid,
    logIndex: 0,
    integratedTime,
    logID: 'log-id',
    body: bytesToBase64(body),
    attestation: { data: bytesToBase64(attestation) },
    verification: {
      inclusionProof: {
        checkpoint: '',
        hashes: [],
        logIndex: 0,
        rootHash: bytesToHex(hashLeaf(body)),
        treeSize: 1,
      },
      signedEntryTimestamp: 'set',
    },
  };
}

function mockRekor(entries: Record<string, RekorEntryResponse>): RekorClient {
  return {
    submitIntoto: vi.fn(),
    getEntry: vi.fn(async (uuid: string) => {
      const entry = entries[uuid];
      if (!entry) throw new Error(`404 for ${uuid}`);
      return entry;
    }),
    getLogInfo: vi.fn(),
    getConsistencyProof: vi.fn(),
  };
}

/** fetch stub serving the user index (raw.githubusercontent) and operator overlay (passportsign.dev/index). */
function mockFetch(opts: {
  userIndex?: ProfileIndex | null;
  overlay?: ProfileIndex | null;
}): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('https://raw.githubusercontent.com/')) {
      return opts.userIndex
        ? new Response(JSON.stringify(opts.userIndex), { status: 200 })
        : new Response('not found', { status: 404 });
    }
    if (url.startsWith('https://passportsign.dev/index/')) {
      return opts.overlay
        ? new Response(JSON.stringify(opts.overlay), { status: 200 })
        : new Response('not found', { status: 404 });
    }
    return new Response('unexpected url ' + url, { status: 500 });
  }) as typeof fetch;
}

function indexFor(username: string): ProfileIndex {
  return {
    version: 1,
    github_username: username,
    bindings: [{ rekor_entry_hash: UUID_BIND, bound_at: '2026-06-01T00:00:00Z' }],
    revocations: [],
  };
}

describe('buildBadge', () => {
  it('renders a green active badge with cache headers for a bound user', async () => {
    const result = await buildBadge('cynarlab', {
      fetch: mockFetch({ userIndex: indexFor('cynarlab') }),
      rekor: mockRekor({ [UUID_BIND]: fakeEntry(UUID_BIND, bindingStatement('cynarlab')) }),
      now: NOW,
    });
    expect(result.status).toBe(200);
    expect(result.svg).toContain('#4c1');
    expect(result.svg).toContain('CAN');
    expect(result.cacheControl).toContain('max-age=300');
  });

  it('renders yellow for a stale binding', async () => {
    const result = await buildBadge('cynarlab', {
      fetch: mockFetch({ userIndex: indexFor('cynarlab') }),
      rekor: mockRekor({ [UUID_BIND]: fakeEntry(UUID_BIND, bindingStatement('cynarlab'), ANCIENT) }),
      now: NOW,
    });
    expect(result.svg).toContain('#dfb317');
  });

  it('renders red when the binding is revoked via the user index', async () => {
    const idx = indexFor('cynarlab');
    idx.revocations = [
      { rekor_entry_hash: UUID_REVOKE, revokes_rekor_entry_hash: UUID_BIND, revoked_at: '2026-06-02T00:00:00Z' },
    ];
    const result = await buildBadge('cynarlab', {
      fetch: mockFetch({ userIndex: idx }),
      rekor: mockRekor({
        [UUID_BIND]: fakeEntry(UUID_BIND, bindingStatement('cynarlab')),
        [UUID_REVOKE]: fakeEntry(UUID_REVOKE, revocationStatement('cynarlab')),
      }),
      now: NOW,
    });
    expect(result.svg).toContain('#e05d44');
    expect(result.svg).toContain('revoked');
  });

  it('counts revocations from the operator overlay even if the user index omits them', async () => {
    const overlay: ProfileIndex = {
      version: 1,
      github_username: 'cynarlab',
      bindings: [],
      revocations: [
        { rekor_entry_hash: UUID_REVOKE, revokes_rekor_entry_hash: UUID_BIND, revoked_at: '2026-06-02T00:00:00Z' },
      ],
    };
    const result = await buildBadge('cynarlab', {
      fetch: mockFetch({ userIndex: indexFor('cynarlab'), overlay }),
      rekor: mockRekor({
        [UUID_BIND]: fakeEntry(UUID_BIND, bindingStatement('cynarlab')),
        [UUID_REVOKE]: fakeEntry(UUID_REVOKE, revocationStatement('cynarlab')),
      }),
      now: NOW,
    });
    expect(result.svg).toContain('#e05d44');
  });

  it('renders a gray unknown badge with short cache when no index exists', async () => {
    const result = await buildBadge('nobody', {
      fetch: mockFetch({}),
      rekor: mockRekor({}),
      now: NOW,
    });
    expect(result.status).toBe(200);
    expect(result.svg).toContain('unknown');
    expect(result.cacheControl).toContain('max-age=60');
  });

  it('renders unknown for an invalid username without fetching anything', async () => {
    const fetchSpy = vi.fn();
    const result = await buildBadge('../etc/passwd', {
      fetch: fetchSpy as unknown as typeof fetch,
      rekor: mockRekor({}),
      now: NOW,
    });
    expect(result.svg).toContain('unknown');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('normalizes the username to lowercase (spec §10 row 7)', async () => {
    const urls: string[] = [];
    const fetchSpy = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
    await buildBadge('CynarLab', { fetch: fetchSpy, rekor: mockRekor({}), now: NOW });
    expect(urls.every((u) => u.includes('cynarlab') && !u.includes('CynarLab'))).toBe(true);
  });

  it('an active binding wins over a revoked one (most-trustworthy state shown)', async () => {
    const UUID_BIND2 = 'b'.repeat(80);
    const idx = indexFor('cynarlab');
    idx.bindings.push({ rekor_entry_hash: UUID_BIND2, bound_at: '2026-06-03T00:00:00Z' });
    idx.revocations = [
      { rekor_entry_hash: UUID_REVOKE, revokes_rekor_entry_hash: UUID_BIND, revoked_at: '2026-06-02T00:00:00Z' },
    ];
    // UUID_BIND revoked, UUID_BIND2 active → badge shows active.
    const bind2 = buildStatement({
      github_username: 'cynarlab',
      unique_identifier: 'uid-2',
      issuing_country: null,
      proof_blob_sha256: '0c'.repeat(32),
      gist_url: 'https://gist.github.com/cynarlab/def',
      gist_content_sha256: 'e4'.repeat(32),
      scope: 'passportsign.dev:nationality-disclose:1',
      zkpassport_sdk_version: '0.15.1',
    });
    const result = await buildBadge('cynarlab', {
      fetch: mockFetch({ userIndex: idx }),
      rekor: mockRekor({
        [UUID_BIND]: fakeEntry(UUID_BIND, bindingStatement('cynarlab')),
        [UUID_BIND2]: fakeEntry(UUID_BIND2, bind2),
        [UUID_REVOKE]: fakeEntry(UUID_REVOKE, revocationStatement('cynarlab')),
      }),
      now: NOW,
    });
    expect(result.svg).toContain('#4c1');
  });
});
