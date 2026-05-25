/**
 * Day 5 Phase 1 — Rekor smoke test.
 *
 * Submits a single throwaway in-toto entry to rekor.sigstore.dev to
 * confirm:
 *   - entry-type version accepted (intoto v0.0.2)
 *   - response body shape (UUID, integratedTime, logIndex, body, verification)
 *   - inclusion-proof endpoint shape
 *   - whether /api/v1/log/entries/retrieve indexes the predicateType
 *
 * Predicate type is `https://dev.passportsign.dev/smoke-test/v1` — clearly
 * distinct from the production `https://passportsign.dev/personhood/v1`.
 *
 * This is a ONE-WAY action: the entry is committed to the public log
 * forever. Body is benign (random bytes, ephemeral key, no PII).
 *
 * Run: pnpm --filter @passportsign/core exec tsx scripts/rekor-smoke.ts
 */

import { createSign, generateKeyPairSync, randomBytes, createHash } from 'node:crypto';
import { canonicalize } from '../src/canonical.js';

const REKOR_BASE = 'https://rekor.sigstore.dev';
const SMOKE_PREDICATE_TYPE = 'https://dev.passportsign.dev/smoke-test/v1';
const PAYLOAD_TYPE = 'application/vnd.in-toto+json';
const DSSE_VERSION = 'DSSEv1';

function pae(type: string, payload: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const prefix = `${DSSE_VERSION} ${typeBytes.length} ${type} ${payload.length} `;
  const prefixBytes = new TextEncoder().encode(prefix);
  const out = new Uint8Array(prefixBytes.length + payload.length);
  out.set(prefixBytes);
  out.set(payload, prefixBytes.length);
  return out;
}

async function main(): Promise<number> {
  console.log('--- Rekor smoke test ---');
  console.log(`target:    ${REKOR_BASE}`);
  console.log(`predicate: ${SMOKE_PREDICATE_TYPE}`);
  console.log('');

  // 1. Build a trivial in-toto statement
  const statement = {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [
      {
        name: 'smoke-test-subject',
        digest: { sha256: createHash('sha256').update('smoke-test').digest('hex') },
      },
    ],
    predicateType: SMOKE_PREDICATE_TYPE,
    predicate: {
      purpose:
        "Day 5 smoke test for passportsign. Confirms the in-toto/Rekor round-trip and informs the production client's shape. Not a real binding.",
      random: randomBytes(16).toString('hex'),
      submitted_by: 'passportsign-day5-smoke',
      submitted_at: new Date().toISOString(),
    },
  };

  // 2. Canonical payload bytes
  const payload = canonicalize(statement);
  const payloadB64 = Buffer.from(payload).toString('base64');
  console.log(`payload length: ${payload.length} bytes`);
  console.log(`payload sha256: ${createHash('sha256').update(payload).digest('hex')}`);

  // 3. Ephemeral ECDSA P-256 keypair + DSSE sign.
  // (Rekor's intoto v0.0.2 uses sigstore/signature, which is most commonly
  // exercised with ECDSA. Ed25519 may not be in the supported set.)
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const paeBytes = pae(PAYLOAD_TYPE, payload);
  const signer = createSign('SHA256');
  signer.update(Buffer.from(paeBytes));
  const sigBuf = signer.sign(privateKey);
  const sigB64 = sigBuf.toString('base64');
  const pubKeyPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
  console.log(`pae length:   ${paeBytes.length} bytes`);
  console.log(`sig length:   ${sigBuf.length} bytes (ECDSA P-256, DER-encoded)`);
  console.log('');

  // 4. Compute hash + payloadHash. Schema marks these readOnly but Rekor
  //    actually requires them on submission — see sigstore-js
  //    packages/sign/src/witness/tlog/entry.ts (toProposedIntotoEntry +
  //    calculateDSSEHash).
  const payloadHashHex = createHash('sha256').update(payload).digest('hex');

  // The "envelope hash" is sha256 of a canonical JSON of a specific shape:
  //   - payload: single-base64
  //   - sig: single-base64
  //   - publicKey: PEM as raw string (NOT base64-encoded for this hash)
  //   - keyid omitted entirely when empty
  const envelopeForHash: Record<string, unknown> = {
    payloadType: PAYLOAD_TYPE,
    payload: payloadB64,
    signatures: [
      { sig: sigB64, publicKey: pubKeyPem },
    ],
  };
  const envelopeHashHex = createHash('sha256')
    .update(canonicalize(envelopeForHash))
    .digest('hex');

  // 5. Construct the Rekor intoto v0.0.2 entry body.
  //
  // - payload and sig are DOUBLE-base64 (Rekor's strfmt.Base64 over the
  //   already-base64 DSSE strings).
  // - publicKey is single-base64 over the PEM bytes.
  // - keyid is OMITTED entirely if empty.
  // - hash and payloadHash are required despite readOnly markers.
  const entryBody = {
    apiVersion: '0.0.2',
    kind: 'intoto',
    spec: {
      content: {
        envelope: {
          payloadType: PAYLOAD_TYPE,
          payload: Buffer.from(payloadB64).toString('base64'),       // base64(base64(canonical))
          signatures: [
            {
              sig: Buffer.from(sigB64).toString('base64'),           // base64(base64(sig))
              publicKey: Buffer.from(pubKeyPem).toString('base64'),  // base64(PEM bytes)
            },
          ],
        },
        hash: { algorithm: 'sha256', value: envelopeHashHex },
        payloadHash: { algorithm: 'sha256', value: payloadHashHex },
      },
    },
  };

  // 5. POST to Rekor
  console.log('--- POST /api/v1/log/entries ---');
  const submitRes = await fetch(`${REKOR_BASE}/api/v1/log/entries`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'passportsign-day5-smoke',
    },
    body: JSON.stringify(entryBody),
  });
  console.log(`status: ${submitRes.status} ${submitRes.statusText}`);
  console.log(`rate-limit headers: ${JSON.stringify({
    remaining: submitRes.headers.get('x-ratelimit-remaining'),
    limit: submitRes.headers.get('x-ratelimit-limit'),
    reset: submitRes.headers.get('x-ratelimit-reset'),
  })}`);
  const submitBodyRaw = await submitRes.text();
  if (!submitRes.ok) {
    console.error('submit body:', submitBodyRaw);
    return 1;
  }
  const submitBody = JSON.parse(submitBodyRaw) as Record<string, unknown>;
  const uuid = Object.keys(submitBody)[0]!;
  const entry = submitBody[uuid] as Record<string, unknown>;

  console.log(`UUID:               ${uuid}`);
  console.log(`logIndex:           ${entry['logIndex']}`);
  console.log(`integratedTime:     ${entry['integratedTime']}`);
  console.log(`logID:              ${entry['logID']}`);
  console.log(`verification keys:  ${Object.keys((entry['verification'] as object) ?? {}).join(', ')}`);
  console.log('');

  // 6. GET the entry to confirm round-trip
  console.log(`--- GET /api/v1/log/entries/${uuid} ---`);
  const getRes = await fetch(`${REKOR_BASE}/api/v1/log/entries/${uuid}`);
  console.log(`status: ${getRes.status}`);
  if (getRes.ok) {
    const fetched = (await getRes.json()) as Record<string, unknown>;
    const fetchedEntry = fetched[uuid] as Record<string, unknown>;
    console.log(`top-level keys: ${Object.keys(fetchedEntry).join(', ')}`);
    if (fetchedEntry['verification']) {
      console.log(`verification.keys: ${Object.keys(fetchedEntry['verification'] as object).join(', ')}`);
      const v = fetchedEntry['verification'] as Record<string, unknown>;
      if (v['inclusionProof']) {
        const ip = v['inclusionProof'] as Record<string, unknown>;
        console.log(`inclusionProof.keys: ${Object.keys(ip).join(', ')}`);
        console.log(`inclusionProof.treeSize: ${ip['treeSize']}`);
        console.log(`inclusionProof.logIndex: ${ip['logIndex']}`);
        console.log(`inclusionProof.rootHash: ${ip['rootHash']}`);
        console.log(`inclusionProof.hashes length: ${(ip['hashes'] as unknown[]).length}`);
      }
    }
  }
  console.log('');

  // 7. Search by predicate type
  console.log('--- POST /api/v1/log/entries/retrieve (search by hash) ---');
  // Rekor's retrieve endpoint takes either hash, logIndex, or entryUUIDs.
  // It does NOT have a predicateType index. We confirm this is the case.
  const retrieveBody = {
    // Try to retrieve by the entry hash we just submitted (so we can confirm
    // the retrieve endpoint works in general).
    entryUUIDs: [uuid],
  };
  const retrieveRes = await fetch(`${REKOR_BASE}/api/v1/log/entries/retrieve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(retrieveBody),
  });
  console.log(`status: ${retrieveRes.status}`);
  if (retrieveRes.ok) {
    const retrieveBody = (await retrieveRes.json()) as unknown[];
    console.log(`retrieved ${retrieveBody.length} entries by UUID`);
  } else {
    console.log(`retrieve body: ${await retrieveRes.text()}`);
  }
  console.log('');

  // 8. Check the search-by-attribute capabilities of the retrieve endpoint
  console.log('--- testing /retrieve with payloadHash filter ---');
  const payloadSha = createHash('sha256').update(payload).digest('hex');
  const hashSearchRes = await fetch(`${REKOR_BASE}/api/v1/log/entries/retrieve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hash: `sha256:${payloadSha}` }),
  });
  console.log(`status: ${hashSearchRes.status}`);
  if (hashSearchRes.ok) {
    const body = (await hashSearchRes.json()) as unknown[];
    console.log(`hash-search returned ${body.length} UUID(s)`);
  } else {
    console.log(`body: ${await hashSearchRes.text()}`);
  }
  console.log('');

  console.log('=== SMOKE TEST COMPLETE ===');
  console.log(`Living evidence — Day 5 entry UUID: ${uuid}`);
  console.log(`Public URL: ${REKOR_BASE}/api/v1/log/entries/${uuid}`);
  console.log('');
  console.log('Findings to record in docs/v0-acceptance.md:');
  console.log('  - intoto entry-type version that worked');
  console.log('  - top-level response keys');
  console.log('  - inclusionProof shape (root hash, tree size, hashes count)');
  console.log('  - search-by-hash support (confirmed/unsupported)');
  console.log('  - rate-limit headroom (if visible)');
  console.log('  - feasibility of `rebuild` walking the log for our predicateType');

  return 0;
}

main()
  .then((c) => process.exit(c))
  .catch((e) => {
    console.error('fatal:', e);
    process.exit(2);
  });
