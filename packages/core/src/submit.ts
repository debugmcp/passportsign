/**
 * Submit a {@link PreparedBinding} to a Rekor log and assemble the
 * resulting {@link PassportsignBundle}.
 *
 * Composes the DSSE envelope step (with ephemeral ECDSA P-256 key)
 * with a {@link RekorClient}. Day 7 calls this to turn a real-passport
 * bind into a public-log entry plus a portable bundle.
 */

import { assembleBundle, type PassportsignBundle, type SubmittableStatement } from './bundle.js';
import { IN_TOTO_PAYLOAD_TYPE, signEnvelope } from './dsse.js';
import { type RekorClient, type RekorEntryResponse } from './log/rekor.js';

export { type SubmittableStatement } from './bundle.js';

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
  prepared: SubmittableStatement,
  deps: SubmitBindingDeps,
): Promise<SubmitBindingResult> {
  const { envelope } = signEnvelope(prepared.statement_canonical, IN_TOTO_PAYLOAD_TYPE);
  const rekorEntry = await deps.rekor.submitIntoto(envelope);
  return { bundle: assembleBundle(prepared, rekorEntry), rekorEntry };
}
