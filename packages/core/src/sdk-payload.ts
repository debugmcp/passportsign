/**
 * Pack/unpack the zkPassport SDK inputs that a verifier needs to re-run
 * proof verification offline.
 *
 * Rather than expanding the bundle schema, we re-purpose the existing
 * `proof_blob` field: it's the base64 of canonical JCS bytes of an
 * {@link SdkPayload} object. The statement's `proof_blob_sha256` already
 * binds those bytes to the rest of the binding — Day 5's hash check
 * carries through.
 */

import { createHash } from 'node:crypto';
import { canonicalize } from './canonical.js';

export interface SdkPayload {
  /** The zkPassport SDK version that produced these proofs. */
  sdk_version: string;
  /** Array of ProofResult objects from onProofGenerated callbacks. */
  proofs: unknown[];
  /** The Query object from queryBuilder, in serialised form. */
  original_query: unknown;
  /** The QueryResult from the SDK's onResult callback. */
  query_result: unknown;
  /** Whether the proofs are mock (zkPassport dev mode). */
  dev_mode: boolean;
}

export interface PackedSdkPayload {
  /** Canonical bytes (RFC 8785 JCS UTF-8). */
  bytes: Uint8Array;
  /** Base64 of `bytes` — the value that goes into `bundle.proof_blob`. */
  b64: string;
  /** Lowercase-hex SHA-256 of `bytes` — the value that goes into the statement's `proof_blob_sha256`. */
  sha256Hex: string;
}

export function packSdkPayload(payload: SdkPayload): PackedSdkPayload {
  const bytes = canonicalize(payload);
  const b64 = Buffer.from(bytes).toString('base64');
  const sha256Hex = createHash('sha256').update(bytes).digest('hex');
  return { bytes, b64, sha256Hex };
}

export function unpackSdkPayload(b64: string): SdkPayload {
  const bytes = Buffer.from(b64, 'base64');
  const parsed = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
  // Defensive shape check (cheap; the canonicalize round-trip would already catch shape issues elsewhere).
  if (
    typeof parsed['sdk_version'] !== 'string' ||
    typeof parsed['dev_mode'] !== 'boolean' ||
    !Array.isArray(parsed['proofs'])
  ) {
    throw new TypeError('unpackSdkPayload: not a valid SdkPayload shape');
  }
  return {
    sdk_version: parsed['sdk_version'],
    proofs: parsed['proofs'],
    original_query: parsed['original_query'],
    query_result: parsed['query_result'],
    dev_mode: parsed['dev_mode'],
  };
}
