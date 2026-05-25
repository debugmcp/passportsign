/**
 * Bundle verifier — the trust anchor for everyone who is not us.
 *
 * Day 6 scope: structural integrity (statement hash matches Rekor's
 * recorded payloadHash), Merkle inclusion proof against the captured
 * root, and log-root consistency between the captured root and the
 * current witnessed root.
 *
 * Day 7 scope (deferred): SDK proof verification. Requires a
 * bundle-schema extension to carry SDK inputs (proofs array,
 * originalQuery, queryResult). For now `sdk_proof` reports
 * `'pending_day_7'`.
 */

import { createHash } from 'node:crypto';

import { type PassportsignBundle, validateBundle } from './bundle.js';
import { type RekorClient } from './log/rekor.js';
import { hashLeaf, verifyConsistency, verifyInclusion } from './merkle.js';

export type CheckResult = 'pass' | 'fail' | 'skipped';

export interface BundleVerifyResult {
  /**
   * Statement bytes in the bundle hash to the `payloadHash` Rekor recorded
   * for the entry.
   */
  hash_match: CheckResult;
  /**
   * The captured inclusion proof verifies the Rekor entry's leaf hash
   * against the captured root.
   */
  inclusion_proof: CheckResult;
  /**
   * The captured root is a prefix of the current witnessed root (the log
   * has not been rewritten in a way that orphans our entry). Skipped when
   * no rekor client is provided.
   */
  root_consistency: CheckResult;
  /**
   * SDK proof verification — Day 7 work. Always `'pending_day_7'` until
   * the bundle schema is extended.
   */
  sdk_proof: 'pending_day_7';
  /**
   * `'pass'` only when every enabled check passes; `'fail'` if any check
   * fails; `'pending'` when everything else passes but `sdk_proof` is
   * still pending Day 7.
   */
  overall: 'pass' | 'fail' | 'pending';
  errors: string[];
}

export interface VerifyBundleDeps {
  /** Inject a Rekor client to enable hash_match / inclusion / consistency checks. */
  rekor?: RekorClient;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

interface ParsedEntryBody {
  payloadHashHex: string;
}

function parseEntryBody(bodyBase64: string): ParsedEntryBody {
  const bytes = Buffer.from(bodyBase64, 'base64').toString('utf8');
  const body = JSON.parse(bytes) as Record<string, unknown>;
  const spec = body['spec'] as Record<string, unknown> | undefined;
  const content = spec?.['content'] as Record<string, unknown> | undefined;
  const payloadHash = content?.['payloadHash'] as Record<string, unknown> | undefined;
  const value = payloadHash?.['value'];
  if (typeof value !== 'string') {
    throw new Error('Rekor entry body missing spec.content.payloadHash.value');
  }
  return { payloadHashHex: value };
}

/**
 * Verify a passportsign bundle. Online checks (hash_match, inclusion_proof,
 * root_consistency) require a {@link RekorClient}; without one they are
 * marked `'skipped'`. SDK proof verification is Day 7 work and currently
 * always returns `'pending_day_7'`.
 */
export async function verifyBundle(
  bundle: PassportsignBundle,
  deps: VerifyBundleDeps = {},
): Promise<BundleVerifyResult> {
  validateBundle(bundle);

  const result: BundleVerifyResult = {
    hash_match: 'skipped',
    inclusion_proof: 'skipped',
    root_consistency: 'skipped',
    sdk_proof: 'pending_day_7',
    overall: 'pending',
    errors: [],
  };

  if (!deps.rekor) {
    return result;
  }

  // 1. Fetch the entry from Rekor (any operator's Rekor mirror would do).
  let entry;
  try {
    entry = await deps.rekor.getEntry(bundle.rekor.log_entry_hash);
  } catch (err) {
    result.errors.push(
      `failed to fetch Rekor entry: ${err instanceof Error ? err.message : String(err)}`,
    );
    result.overall = 'fail';
    result.hash_match = 'fail';
    result.inclusion_proof = 'fail';
    result.root_consistency = 'fail';
    return result;
  }

  // 2. hash_match: bundle.statement bytes' sha256 must equal entry.body's payloadHash.
  const statementBytes = hexToBytes(bundle.statement);
  const expectedPayloadHash = sha256Hex(statementBytes);
  let entryPayloadHash: string;
  try {
    entryPayloadHash = parseEntryBody(entry.body).payloadHashHex;
  } catch (err) {
    result.errors.push(
      `failed to parse Rekor entry body: ${err instanceof Error ? err.message : String(err)}`,
    );
    result.hash_match = 'fail';
    result.inclusion_proof = 'fail';
    result.root_consistency = 'fail';
    result.overall = 'fail';
    return result;
  }
  result.hash_match = expectedPayloadHash === entryPayloadHash ? 'pass' : 'fail';
  if (result.hash_match === 'fail') {
    result.errors.push(
      `payloadHash mismatch: bundle says ${expectedPayloadHash}, Rekor entry has ${entryPayloadHash}`,
    );
  }

  // 3. inclusion_proof: leaf hash = sha256(0x00 || decoded-body-bytes); verify against captured root.
  const bodyBytes = new Uint8Array(Buffer.from(entry.body, 'base64'));
  const leaf = hashLeaf(bodyBytes);
  const captured = bundle.rekor.inclusion_proof as {
    hashes: string[];
    logIndex: number;
    treeSize: number;
    rootHash: string;
  };
  const proofHashes = captured.hashes.map(hexToBytes);
  const rootBytes = hexToBytes(captured.rootHash);
  result.inclusion_proof = verifyInclusion(
    leaf,
    captured.logIndex,
    captured.treeSize,
    proofHashes,
    rootBytes,
  )
    ? 'pass'
    : 'fail';
  if (result.inclusion_proof === 'fail') {
    result.errors.push('inclusion proof does not verify against captured root');
  }

  // 4. root_consistency: captured root must be a prefix of current witnessed root.
  try {
    const logInfo = await deps.rekor.getLogInfo();
    if (logInfo.treeSize < captured.treeSize) {
      result.errors.push(
        `current tree size ${logInfo.treeSize} is smaller than captured ${captured.treeSize} — log may have been rewound`,
      );
      result.root_consistency = 'fail';
    } else if (logInfo.treeSize === captured.treeSize) {
      // Same tree, just compare roots
      result.root_consistency =
        logInfo.rootHash === captured.rootHash ? 'pass' : 'fail';
      if (result.root_consistency === 'fail') {
        result.errors.push(
          `root mismatch at same treeSize: captured ${captured.rootHash}, current ${logInfo.rootHash}`,
        );
      }
    } else {
      const proof = await deps.rekor.getConsistencyProof(
        captured.treeSize,
        logInfo.treeSize,
      );
      const proofBytes = proof.hashes.map(hexToBytes);
      result.root_consistency = verifyConsistency(
        captured.treeSize,
        logInfo.treeSize,
        rootBytes,
        hexToBytes(logInfo.rootHash),
        proofBytes,
      )
        ? 'pass'
        : 'fail';
      if (result.root_consistency === 'fail') {
        result.errors.push(
          'consistency proof does not verify — captured root is not an ancestor of current root',
        );
      }
    }
  } catch (err) {
    result.errors.push(
      `consistency check error: ${err instanceof Error ? err.message : String(err)}`,
    );
    result.root_consistency = 'fail';
  }

  // 5. overall: pass only when nothing failed; pending while sdk_proof is Day 7 work.
  const fails = [result.hash_match, result.inclusion_proof, result.root_consistency].filter(
    (s) => s === 'fail',
  );
  result.overall = fails.length > 0 ? 'fail' : 'pending';
  return result;
}
