import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalSha256Hex } from '../src/canonical.js';
import { PassportsignError } from '../src/errors.js';
import { prepareRevocation, type PrepareRevocationInput } from '../src/revoke.js';
import { PASSPORTSIGN_REVOCATION_PREDICATE_TYPE } from '../src/statement.js';

const LIVE_UUID =
  '108e9186e8c5677a53b1918ed9b9bbe15194e42714fd3a3f8f0e163d3a22831120a4c540a332e151';
const PROOF_BYTES = new TextEncoder().encode('{"proofs":["fake"]}');
const PROOF_B64 = Buffer.from(PROOF_BYTES).toString('base64');

const validInput = (overrides: Partial<PrepareRevocationInput> = {}): PrepareRevocationInput => ({
  github_username: 'cynarlab',
  proof_blob_b64: PROOF_B64,
  unique_identifier: '1390203670935645337792956976427322308277296491010433858948',
  revokes_rekor_entry_hash: LIVE_UUID,
  scope: 'passportsign.dev:nationality-disclose:1',
  zkpassport_sdk_version: '0.15.1',
  ...overrides,
});

describe('prepareRevocation', () => {
  it('builds the revocation statement with derived hashes', () => {
    const prepared = prepareRevocation(validInput());
    expect(prepared.statement.predicateType).toBe(PASSPORTSIGN_REVOCATION_PREDICATE_TYPE);
    expect(prepared.statement.predicate.revokes_rekor_entry_hash).toBe(LIVE_UUID);
    expect(prepared.proof_blob_sha256_hex).toBe(
      createHash('sha256').update(PROOF_BYTES).digest('hex'),
    );
    expect(prepared.statement.predicate.proof_blob_sha256).toBe(prepared.proof_blob_sha256_hex);
    expect(prepared.statement_sha256_hex).toBe(canonicalSha256Hex(prepared.statement));
    expect(prepared.proof_blob_b64).toBe(PROOF_B64);
    // Canonical bytes round-trip to the statement.
    expect(JSON.parse(new TextDecoder().decode(prepared.statement_canonical))).toEqual(
      prepared.statement,
    );
  });

  it('rejects a proof blob that is not valid base64', () => {
    expect(() => prepareRevocation(validInput({ proof_blob_b64: '!!!not-base64!!!' }))).toThrow(
      PassportsignError,
    );
    try {
      prepareRevocation(validInput({ proof_blob_b64: '!!!not-base64!!!' }));
    } catch (err) {
      expect((err as PassportsignError).code).toBe('proof_invalid');
    }
  });

  it('rejects an empty proof blob', () => {
    expect(() => prepareRevocation(validInput({ proof_blob_b64: '' }))).toThrow(PassportsignError);
  });

  it('propagates statement validation failures (bad target uuid)', () => {
    expect(() => prepareRevocation(validInput({ revokes_rekor_entry_hash: 'short' }))).toThrow(
      TypeError,
    );
  });
});
