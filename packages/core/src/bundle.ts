/**
 * `binding.passportsign.json` bundle format — the portable unit of
 * verification.
 *
 * Rekor stores hashes, not artifacts. To verify a binding, a third party
 * needs both the Rekor entry (hash + inclusion proof) and the artifacts
 * that were hashed. The bundle carries both: the canonical statement bytes
 * (hex), the proof blob (base64), and the Rekor metadata.
 *
 * Shape follows the Sigstore verification-bundle pattern. The
 * `rekor.inclusion_proof` field is intentionally `unknown` for now — its
 * shape gets pinned in Day 5 after we've smoke-tested the public Sigstore
 * Rekor response format.
 */

import { readFileSync, writeFileSync } from 'node:fs';

export const BUNDLE_FORMAT_VERSION = 1 as const;

export interface RekorBundleFields {
  log_entry_hash: string;
  inclusion_proof: unknown;
  log_root_at_submission: string;
}

export interface PassportsignBundle {
  bundle_format_version: typeof BUNDLE_FORMAT_VERSION;
  /** Hex-encoded canonical JCS bytes of the in-toto statement. */
  statement: string;
  /** Base64-encoded zkPassport proof blob. */
  proof_blob: string;
  rekor: RekorBundleFields;
}

const HEX_EVEN = /^(?:[0-9a-f]{2})+$/;
// Standard base64: A-Z, a-z, 0-9, +, /, with 0-2 trailing '=' for padding.
// Length must be multiple of 4.
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export class BundleValidationError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = 'BundleValidationError';
  }
}

function fail(path: string, message: string): never {
  throw new BundleValidationError(path, message);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Type-guard validator for `PassportsignBundle`. Throws
 * `BundleValidationError` with a structured path on the first issue.
 */
export function validateBundle(value: unknown): asserts value is PassportsignBundle {
  if (!isObject(value)) fail('$', 'bundle must be a JSON object');

  if (value['bundle_format_version'] !== BUNDLE_FORMAT_VERSION) {
    fail(
      '$.bundle_format_version',
      `expected ${BUNDLE_FORMAT_VERSION}, got ${JSON.stringify(value['bundle_format_version'])}`,
    );
  }

  const statement = value['statement'];
  if (typeof statement !== 'string') fail('$.statement', 'must be a string');
  if (!HEX_EVEN.test(statement)) {
    fail('$.statement', 'must be lowercase even-length hex (canonical JCS bytes)');
  }

  const proofBlob = value['proof_blob'];
  if (typeof proofBlob !== 'string') fail('$.proof_blob', 'must be a string');
  if (!BASE64.test(proofBlob)) {
    fail('$.proof_blob', 'must be standard base64 (A-Z, a-z, 0-9, +, /, = padding)');
  }

  const rekor = value['rekor'];
  if (!isObject(rekor)) fail('$.rekor', 'must be an object');

  const logEntryHash = rekor['log_entry_hash'];
  if (typeof logEntryHash !== 'string' || logEntryHash.length === 0) {
    fail('$.rekor.log_entry_hash', 'must be a non-empty string');
  }

  if (!('inclusion_proof' in rekor)) {
    fail('$.rekor.inclusion_proof', 'is required (shape pinned in Day 5)');
  }

  const logRootAtSubmission = rekor['log_root_at_submission'];
  if (typeof logRootAtSubmission !== 'string' || logRootAtSubmission.length === 0) {
    fail('$.rekor.log_root_at_submission', 'must be a non-empty string');
  }
}

/**
 * Read and validate a `binding.passportsign.json` file. Throws on
 * invalid JSON or schema violations.
 */
export function readBundle(path: string): PassportsignBundle {
  const raw = readFileSync(path, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new BundleValidationError(
      '$',
      `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  validateBundle(parsed);
  return parsed;
}

/**
 * Validate and write a `binding.passportsign.json` file (pretty-printed).
 */
export function writeBundle(path: string, bundle: PassportsignBundle): void {
  validateBundle(bundle);
  writeFileSync(path, JSON.stringify(bundle, null, 2) + '\n', 'utf8');
}
