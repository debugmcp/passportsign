/**
 * Revocation orchestrator (roadmap v0.5.2, spec §7).
 *
 * Mirror of `bind.ts`'s `prepareBinding` minus the GitHub gist check:
 * revocation deliberately requires only a fresh proof from the same
 * passport, so a user who lost their GitHub account can still revoke.
 * The result feeds the same `submitBinding` Rekor path — a revocation
 * is just another in-toto entry, with the `#revocation` predicateType.
 */

import { canonicalize, canonicalSha256Hex } from './canonical.js';
import { base64ToBytes, sha256Hex } from './encoding.js';
import { PassportsignError } from './errors.js';
import {
  buildRevocationStatement,
  type PassportsignRevocationStatement,
} from './statement.js';

export interface PrepareRevocationInput {
  github_username: string;
  /** Base64-encoded zkPassport proof blob (fresh scan, same passport). */
  proof_blob_b64: string;
  /** From the SDK's `onResult` — must match the binding being revoked. */
  unique_identifier: string;
  /** Rekor entry UUID of the binding to revoke. */
  revokes_rekor_entry_hash: string;
  scope: string;
  zkpassport_sdk_version: string;
}

export interface PreparedRevocation {
  statement: PassportsignRevocationStatement;
  statement_canonical: Uint8Array;
  statement_sha256_hex: string;
  proof_blob_b64: string;
  proof_blob_sha256_hex: string;
}

export function prepareRevocation(input: PrepareRevocationInput): PreparedRevocation {
  let proofBytes: Uint8Array;
  try {
    proofBytes = base64ToBytes(input.proof_blob_b64);
  } catch (err) {
    throw new PassportsignError('proof_invalid', 'proof_blob_b64 is not valid base64', err);
  }
  if (proofBytes.length === 0) {
    throw new PassportsignError('proof_invalid', 'proof_blob_b64 decoded to zero bytes');
  }
  const proof_blob_sha256_hex = sha256Hex(proofBytes);

  const statement = buildRevocationStatement({
    github_username: input.github_username,
    unique_identifier: input.unique_identifier,
    revokes_rekor_entry_hash: input.revokes_rekor_entry_hash,
    proof_blob_sha256: proof_blob_sha256_hex,
    scope: input.scope,
    zkpassport_sdk_version: input.zkpassport_sdk_version,
  });

  return {
    statement,
    statement_canonical: canonicalize(statement),
    statement_sha256_hex: canonicalSha256Hex(statement),
    proof_blob_b64: input.proof_blob_b64,
    proof_blob_sha256_hex,
  };
}
