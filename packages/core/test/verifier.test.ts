import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';

import { BUNDLE_FORMAT_VERSION, type PassportsignBundle } from '../src/bundle.js';
import {
  type RekorClient,
  type RekorEntryResponse,
  type RekorLogInfo,
} from '../src/log/rekor.js';
import { hashLeaf, hashPair } from '../src/merkle.js';
import { verifyBundle } from '../src/verifier.js';

// We build a tiny Rekor-like scenario by hand so we can wire up a mock
// RekorClient that returns hashes consistent with a tree we control.

function makeBundleAndClient(opts: {
  tamperPayloadHash?: boolean;
  tamperInclusion?: boolean;
  tamperConsistency?: boolean;
} = {}) {
  const statementBytes = new TextEncoder().encode('the canonical statement');
  const payloadHashHex = createHash('sha256').update(statementBytes).digest('hex');

  // Build a Rekor "entry body" containing the spec we care about.
  const entryBodyJson = {
    apiVersion: '0.0.2',
    kind: 'intoto',
    spec: {
      content: {
        envelope: { payloadType: 'application/vnd.in-toto+json' },
        hash: { algorithm: 'sha256', value: 'envelope-hash-hex' },
        payloadHash: {
          algorithm: 'sha256',
          value: opts.tamperPayloadHash ? 'a'.repeat(64) : payloadHashHex,
        },
      },
    },
  };
  const bodyBytes = new TextEncoder().encode(JSON.stringify(entryBodyJson));
  const bodyBase64 = Buffer.from(bodyBytes).toString('base64');

  // Build a 2-leaf tree where our leaf is at index 0.
  const leaf = hashLeaf(bodyBytes);
  const sibling = hashLeaf(new TextEncoder().encode('other-leaf'));
  const root = hashPair(leaf, sibling);
  const inclusionHashes = [Buffer.from(sibling).toString('hex')];
  const rootHashHex = Buffer.from(root).toString('hex');

  const bundle: PassportsignBundle = {
    bundle_format_version: BUNDLE_FORMAT_VERSION,
    statement: Buffer.from(statementBytes).toString('hex'),
    proof_blob: 'AAAA',
    rekor: {
      log_entry_hash: 'uuid-1',
      inclusion_proof: {
        checkpoint: 'cp',
        hashes: opts.tamperInclusion ? ['00'.repeat(32)] : inclusionHashes,
        logIndex: 0,
        rootHash: rootHashHex,
        treeSize: 2,
      },
      log_root_at_submission: rootHashHex,
    },
  };

  const entry: RekorEntryResponse = {
    uuid: 'uuid-1',
    logIndex: 0,
    integratedTime: 1700000000,
    logID: 'log-id-1',
    body: bodyBase64,
    verification: {
      inclusionProof: {
        checkpoint: 'cp',
        hashes: inclusionHashes,
        logIndex: 0,
        rootHash: rootHashHex,
        treeSize: 2,
      },
      signedEntryTimestamp: 'set',
    },
  };

  const logInfo: RekorLogInfo = {
    rootHash: opts.tamperConsistency ? 'bb'.repeat(32) : rootHashHex,
    treeSize: 2,
    signedTreeHead: 'sig',
    treeID: 'tree-1',
  };

  const client: RekorClient = {
    submitIntoto: vi.fn(),
    getEntry: vi.fn(async () => entry),
    getLogInfo: vi.fn(async () => logInfo),
    getConsistencyProof: vi.fn(async () => ({ hashes: [], rootHash: logInfo.rootHash })),
  };

  return { bundle, client };
}

describe('verifyBundle — happy path (online)', () => {
  it('all enabled checks pass; overall pending (sdk_proof Day 7)', async () => {
    const { bundle, client } = makeBundleAndClient();
    const r = await verifyBundle(bundle, { rekor: client });
    expect(r.hash_match).toBe('pass');
    expect(r.inclusion_proof).toBe('pass');
    expect(r.root_consistency).toBe('pass');
    expect(r.sdk_proof).toBe('pending_day_7');
    expect(r.overall).toBe('pending');
    expect(r.errors).toEqual([]);
  });
});

describe('verifyBundle — without rekor client', () => {
  it('all checks skipped; overall pending', async () => {
    const { bundle } = makeBundleAndClient();
    const r = await verifyBundle(bundle);
    expect(r.hash_match).toBe('skipped');
    expect(r.inclusion_proof).toBe('skipped');
    expect(r.root_consistency).toBe('skipped');
    expect(r.overall).toBe('pending');
  });
});

describe('verifyBundle — failure paths', () => {
  it('payloadHash mismatch → hash_match fails, overall fails', async () => {
    const { bundle, client } = makeBundleAndClient({ tamperPayloadHash: true });
    const r = await verifyBundle(bundle, { rekor: client });
    expect(r.hash_match).toBe('fail');
    expect(r.overall).toBe('fail');
    expect(r.errors.some((e) => e.includes('payloadHash mismatch'))).toBe(true);
  });

  it('tampered inclusion proof → inclusion fails', async () => {
    const { bundle, client } = makeBundleAndClient({ tamperInclusion: true });
    const r = await verifyBundle(bundle, { rekor: client });
    expect(r.inclusion_proof).toBe('fail');
    expect(r.overall).toBe('fail');
  });

  it('current root differs at same treeSize → consistency fails', async () => {
    const { bundle, client } = makeBundleAndClient({ tamperConsistency: true });
    const r = await verifyBundle(bundle, { rekor: client });
    expect(r.root_consistency).toBe('fail');
    expect(r.overall).toBe('fail');
  });

  it('rekor getEntry throws → all online checks fail', async () => {
    const { bundle } = makeBundleAndClient();
    const failing: RekorClient = {
      submitIntoto: vi.fn(),
      getEntry: vi.fn(async () => {
        throw new Error('500');
      }),
      getLogInfo: vi.fn(),
      getConsistencyProof: vi.fn(),
    };
    const r = await verifyBundle(bundle, { rekor: failing });
    expect(r.hash_match).toBe('fail');
    expect(r.inclusion_proof).toBe('fail');
    expect(r.root_consistency).toBe('fail');
    expect(r.overall).toBe('fail');
  });
});
