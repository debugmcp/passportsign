import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { canonicalize } from '../src/canonical.js';
import { PassportsignError } from '../src/errors.js';
import { hashLeaf } from '../src/merkle.js';
import { lookupBindings, lookupFromIndex } from '../src/lookup.js';
import {
  buildRevocationStatement,
  buildStatement,
} from '../src/statement.js';
import {
  addBinding,
  addRevocation,
  createProfileIndex,
  type ProfileIndex,
} from '../src/profile-index.js';
import { type RekorClient, type RekorEntryResponse } from '../src/log/rekor.js';

const NOW = Date.parse('2026-06-11T00:00:00Z');
const RECENT = Math.floor(NOW / 1000) - 10 * 24 * 3600;

const UUID_BIND = 'a'.repeat(80);
const UUID_BIND2 = 'b'.repeat(80);
const UUID_REVOKE = 'c'.repeat(80);

function bindingStatement(username: string, uid: string) {
  return buildStatement({
    github_username: username,
    unique_identifier: uid,
    issuing_country: 'CAN',
    proof_blob_sha256: '0a'.repeat(32),
    gist_url: `https://gist.github.com/${username}/abc`,
    gist_content_sha256: 'e3'.repeat(32),
    scope: 'passportsign.dev:nationality-disclose:1',
    zkpassport_sdk_version: '0.15.1',
  });
}

/** Build a self-consistent Rekor entry: a single-leaf tree whose root is the leaf hash. */
function fakeEntry(uuid: string, statement: object, integratedTime = RECENT): RekorEntryResponse {
  const attestation = canonicalize(statement);
  const payloadHash = createHash('sha256').update(attestation).digest('hex');
  const body = Buffer.from(
    JSON.stringify({
      apiVersion: '0.0.2',
      kind: 'intoto',
      spec: { content: { payloadHash: { algorithm: 'sha256', value: payloadHash } } },
    }),
  );
  const rootHash = Buffer.from(hashLeaf(new Uint8Array(body))).toString('hex');
  return {
    uuid,
    logIndex: 0,
    integratedTime,
    logID: 'log-id',
    body: body.toString('base64'),
    attestation: { data: attestation.length > 0 ? Buffer.from(attestation).toString('base64') : '' },
    verification: {
      inclusionProof: { checkpoint: '', hashes: [], logIndex: 0, rootHash, treeSize: 1 },
      signedEntryTimestamp: 'set',
    },
  };
}

function mockRekor(entries: Record<string, RekorEntryResponse>): RekorClient {
  return {
    submitIntoto: vi.fn(),
    getEntry: vi.fn(async (uuid: string) => {
      const entry = entries[uuid];
      if (!entry) throw new PassportsignError('log_submission_failed', `404 for ${uuid}`);
      return entry;
    }),
    getLogInfo: vi.fn(),
    getConsistencyProof: vi.fn(),
  };
}

function indexWith(
  username: string,
  bindings: string[],
  revocations: Array<{ uuid: string; revokes?: string }> = [],
): ProfileIndex {
  let idx = createProfileIndex(username);
  for (const uuid of bindings) {
    idx = addBinding(idx, { rekor_entry_hash: uuid, bound_at: '2026-06-01T00:00:00Z' });
  }
  for (const r of revocations) {
    idx = addRevocation(idx, {
      rekor_entry_hash: r.uuid,
      ...(r.revokes ? { revokes_rekor_entry_hash: r.revokes } : {}),
      revoked_at: '2026-06-02T00:00:00Z',
    });
  }
  return idx;
}

describe('lookupFromIndex', () => {
  it('classifies a published binding as active', async () => {
    const rekor = mockRekor({ [UUID_BIND]: fakeEntry(UUID_BIND, bindingStatement('cynarlab', 'uid-1')) });
    const result = await lookupFromIndex(indexWith('cynarlab', [UUID_BIND]), { rekor, now: NOW });
    expect(result.classified).toHaveLength(1);
    expect(result.classified[0]!.state).toBe('active');
    expect(result.unreachable).toHaveLength(0);
    expect(result.invalid).toHaveLength(0);
  });

  it('a revocation entry listed in the index revokes its target', async () => {
    const revocation = buildRevocationStatement({
      github_username: 'cynarlab',
      unique_identifier: 'uid-1',
      revokes_rekor_entry_hash: UUID_BIND,
      proof_blob_sha256: '0b'.repeat(32),
      scope: 'passportsign.dev:nationality-disclose:1',
      zkpassport_sdk_version: '0.15.1',
    });
    const rekor = mockRekor({
      [UUID_BIND]: fakeEntry(UUID_BIND, bindingStatement('cynarlab', 'uid-1')),
      [UUID_REVOKE]: fakeEntry(UUID_REVOKE, revocation),
    });
    const result = await lookupFromIndex(
      indexWith('cynarlab', [UUID_BIND], [{ uuid: UUID_REVOKE, revokes: UUID_BIND }]),
      { rekor, now: NOW },
    );
    expect(result.classified[0]!.state).toBe('revoked');
    expect(result.classified[0]!.revokedBy).toBe(UUID_REVOKE);
  });

  it('an unreachable entry is reported but does not fail the others', async () => {
    const rekor = mockRekor({ [UUID_BIND]: fakeEntry(UUID_BIND, bindingStatement('cynarlab', 'uid-1')) });
    const result = await lookupFromIndex(indexWith('cynarlab', [UUID_BIND, UUID_BIND2]), {
      rekor,
      now: NOW,
    });
    expect(result.classified).toHaveLength(1);
    expect(result.unreachable).toHaveLength(1);
    expect(result.unreachable[0]!.uuid).toBe(UUID_BIND2);
  });

  it('rejects an entry whose subject is a different user (index is untrusted)', async () => {
    const rekor = mockRekor({ [UUID_BIND]: fakeEntry(UUID_BIND, bindingStatement('attacker', 'uid-1')) });
    const result = await lookupFromIndex(indexWith('cynarlab', [UUID_BIND]), { rekor, now: NOW });
    expect(result.classified).toHaveLength(0);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0]!.error).toContain('subject');
  });

  it('rejects an entry with a non-passportsign predicateType in the bindings list', async () => {
    const revocation = buildRevocationStatement({
      github_username: 'cynarlab',
      unique_identifier: 'uid-1',
      revokes_rekor_entry_hash: UUID_BIND2,
      proof_blob_sha256: '0b'.repeat(32),
      scope: 'passportsign.dev:nationality-disclose:1',
      zkpassport_sdk_version: '0.15.1',
    });
    // A revocation entry listed as a *binding* must be rejected.
    const rekor = mockRekor({ [UUID_BIND]: fakeEntry(UUID_BIND, revocation) });
    const result = await lookupFromIndex(indexWith('cynarlab', [UUID_BIND]), { rekor, now: NOW });
    expect(result.classified).toHaveLength(0);
    expect(result.invalid).toHaveLength(1);
  });

  it('rejects an entry whose inclusion proof does not verify', async () => {
    const entry = fakeEntry(UUID_BIND, bindingStatement('cynarlab', 'uid-1'));
    entry.verification.inclusionProof.rootHash = 'f'.repeat(64);
    const rekor = mockRekor({ [UUID_BIND]: entry });
    const result = await lookupFromIndex(indexWith('cynarlab', [UUID_BIND]), { rekor, now: NOW });
    expect(result.classified).toHaveLength(0);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0]!.error).toContain('inclusion');
  });

  it('username match is case-insensitive (spec §10 row 7)', async () => {
    const rekor = mockRekor({ [UUID_BIND]: fakeEntry(UUID_BIND, bindingStatement('CynarLab', 'uid-1')) });
    const result = await lookupFromIndex(indexWith('cynarlab', [UUID_BIND]), { rekor, now: NOW });
    expect(result.classified).toHaveLength(1);
  });
});

describe('lookupBindings', () => {
  it('returns index:null when the user has not published an index', async () => {
    const fetch404 = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
    const result = await lookupBindings('cynarlab', {
      rekor: mockRekor({}),
      fetch: fetch404,
      now: NOW,
    });
    expect(result.index).toBeNull();
    expect(result.classified).toHaveLength(0);
  });

  it('fetches the index then classifies (end to end with mocks)', async () => {
    const idx = indexWith('cynarlab', [UUID_BIND]);
    const fetchOk = (async () =>
      new Response(JSON.stringify(idx), { status: 200 })) as unknown as typeof fetch;
    const rekor = mockRekor({ [UUID_BIND]: fakeEntry(UUID_BIND, bindingStatement('cynarlab', 'uid-1')) });
    const result = await lookupBindings('cynarlab', { rekor, fetch: fetchOk, now: NOW });
    expect(result.index).toEqual(idx);
    expect(result.classified[0]!.state).toBe('active');
  });
});
