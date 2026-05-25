/**
 * Submit a {@link PreparedBinding} to a Rekor log and assemble the
 * resulting {@link PassportsignBundle}.
 *
 * Composes the DSSE envelope step (with ephemeral ECDSA P-256 key)
 * with a {@link RekorClient}. Day 7 calls this to turn a real-passport
 * bind into a public-log entry plus a portable bundle.
 */

import { type PreparedBinding } from './bind.js';
import {
  BUNDLE_FORMAT_VERSION,
  type PassportsignBundle,
  validateBundle,
} from './bundle.js';
import { IN_TOTO_PAYLOAD_TYPE, signEnvelope } from './dsse.js';
import { type RekorClient, type RekorEntryResponse } from './log/rekor.js';

export interface SubmitBindingDeps {
  rekor: RekorClient;
}

export interface SubmitBindingResult {
  bundle: PassportsignBundle;
  rekorEntry: RekorEntryResponse;
}

/**
 * Sign the canonical statement bytes with an ephemeral ECDSA P-256 key,
 * submit the in-toto entry to Rekor, and assemble the bundle. Throws
 * `PassportsignError('log_submission_failed', …)` (from the client) on
 * any Rekor failure.
 */
export async function submitBinding(
  prepared: PreparedBinding,
  deps: SubmitBindingDeps,
): Promise<SubmitBindingResult> {
  const { envelope } = signEnvelope(prepared.statement_canonical, IN_TOTO_PAYLOAD_TYPE);
  const rekorEntry = await deps.rekor.submitIntoto(envelope);

  const bundle: PassportsignBundle = {
    bundle_format_version: BUNDLE_FORMAT_VERSION,
    statement: Buffer.from(prepared.statement_canonical).toString('hex'),
    proof_blob: prepared.proof_blob_b64,
    rekor: {
      log_entry_hash: rekorEntry.uuid,
      inclusion_proof: rekorEntry.verification.inclusionProof,
      log_root_at_submission: rekorEntry.verification.inclusionProof.rootHash,
    },
  };
  validateBundle(bundle);

  return { bundle, rekorEntry };
}
