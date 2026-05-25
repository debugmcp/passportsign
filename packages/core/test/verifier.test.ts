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
    expect(r.sdk_proof).toBe('skipped');
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
    expect(r.sdk_proof).toBe('skipped');
    expect(r.overall).toBe('pending');
  });
});

describe('verifyBundle — with sdkVerifier', () => {
  it('sdk_proof passes when SDK validates and uniqueIdentifier matches', async () => {
    // The other checks need a fully consistent bundle (entry body
    // matching the new statement). Here we isolate sdk_proof by running
    // WITHOUT rekor — sdk_proof is independent.
    const { bundle, statementUniqueId, sdkPayloadB64 } = makeBundleWithSdk();
    const sdkVerifier = {
      verify: vi.fn(async () => ({ verified: true, uniqueIdentifier: statementUniqueId })),
    };
    bundle.proof_blob = sdkPayloadB64;
    const r = await verifyBundle(bundle, { sdkVerifier });
    expect(r.sdk_proof).toBe('pass');
    expect(sdkVerifier.verify).toHaveBeenCalledTimes(1);
  });

  it('sdk_proof fails when SDK reports verified=false', async () => {
    const { bundle, client, statementUniqueId, sdkPayloadB64 } = makeBundleWithSdk();
    bundle.proof_blob = sdkPayloadB64;
    const sdkVerifier = {
      verify: vi.fn(async () => ({ verified: false, uniqueIdentifier: statementUniqueId })),
    };
    const r = await verifyBundle(bundle, { rekor: client, sdkVerifier });
    expect(r.sdk_proof).toBe('fail');
    expect(r.overall).toBe('fail');
  });

  it('sdk_proof fails when SDK uniqueIdentifier differs from statement', async () => {
    const { bundle, client, sdkPayloadB64 } = makeBundleWithSdk();
    bundle.proof_blob = sdkPayloadB64;
    const sdkVerifier = {
      verify: vi.fn(async () => ({ verified: true, uniqueIdentifier: 'a-different-id' })),
    };
    const r = await verifyBundle(bundle, { rekor: client, sdkVerifier });
    expect(r.sdk_proof).toBe('fail');
    expect(r.overall).toBe('fail');
  });

  it('sdk_proof fails when proof_blob is not a valid SdkPayload', async () => {
    const { bundle, client } = makeBundleWithSdk();
    bundle.proof_blob = 'AAAA'; // not a SdkPayload
    const sdkVerifier = {
      verify: vi.fn(),
    };
    const r = await verifyBundle(bundle, { rekor: client, sdkVerifier });
    expect(r.sdk_proof).toBe('fail');
    expect(sdkVerifier.verify).not.toHaveBeenCalled();
  });
});

// Helper: build a bundle whose proof_blob is a valid SdkPayload and whose
// statement carries the matching unique_identifier.
function makeBundleWithSdk() {
  const statementUniqueId = '13902036709356453377929569764273223082772964910104338589480118024404105097567';
  // Statement object with the unique_identifier under predicate
  const statementObj = {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: 'github.com/johnf', digest: { sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' } }],
    predicateType: 'https://passportsign.dev/personhood/v1',
    predicate: {
      unique_identifier: statementUniqueId,
      issuing_country: 'CAN',
      disclosure_level: 'personhood+country',
      proof_blob_sha256: '0a'.repeat(32),
      gist_url: 'https://gist.github.com/johnf/abc',
      gist_content_sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      scope: 'passportsign.dev:nationality-disclose:1',
      zkpassport_sdk_version: '0.15.1',
    },
  };
  const statementHex = Buffer.from(JSON.stringify(statementObj)).toString('hex');

  // SdkPayload serialized via packSdkPayload-equivalent JSON
  const sdkPayload = {
    sdk_version: '0.15.1',
    proofs: [{ vkeyHash: '0x12ef', name: 'sig_check', version: '0.18.0' }],
    original_query: { nationality: { disclose: true } },
    query_result: { nationality: { disclose: { result: 'CAN' } } },
    dev_mode: false,
  };
  const sdkPayloadB64 = Buffer.from(JSON.stringify(sdkPayload)).toString('base64');

  const { bundle, client } = makeBundleAndClient();
  // override statement
  bundle.statement = statementHex;
  return { bundle, client, statementUniqueId, sdkPayloadB64 };
}

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
