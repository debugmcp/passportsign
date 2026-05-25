/**
 * Bind-flow orchestrator (no Rekor yet).
 *
 * Composes the pieces from `github.ts`, `statement.ts`, and `canonical.ts`
 * into a single "given these inputs, produce a ready-to-submit binding"
 * function. Day 5 will chain this with the Rekor submission and bundle
 * write to deliver the full `passportsign bind` CLI command.
 *
 * Deliberately does **not** call the zkPassport SDK directly — the proof
 * blob and SDK-derived metadata come in as plain data. The CLI's bind
 * command is the producer of that data (it drives the SDK + UI),
 * keeping this module pure and unit-testable without the SDK.
 */

import { createHash } from 'node:crypto';

import { canonicalize, canonicalSha256Hex } from './canonical.js';
import { PassportsignError } from './errors.js';
import { checkGistControl, type GistEvidence } from './github.js';
import { buildStatement, type PassportsignStatement } from './statement.js';

export interface PrepareBindingInput {
  github_username: string;
  /** Base64-encoded zkPassport proof blob (the SDK callback's serialized output). */
  proof_blob_b64: string;
  /** From the SDK's `onResult` callback. Deterministic for this passport + scope. */
  unique_identifier: string;
  /** ICAO 3-letter code if disclosed, else null. Pass through as-returned by SDK. */
  issuing_country: string | null;
  /** Per-binding nonce that was placed in the user's gist for the control check. */
  nonce: string;
  /** Full scope string (e.g. "passportsign.dev:nationality-disclose:1"). */
  scope: string;
  /** Version string from the zkPassport SDK that produced the proof. */
  zkpassport_sdk_version: string;
  /** Optional GitHub token for the gist check (rate limits only — no special access). */
  github_token?: string;
}

export interface PrepareBindingInit {
  /** Init timestamp — gist `updated_at` must be on or after this. */
  issuedAt: Date;
  /** Filename to look for in the user's gists. Defaults to `passportsign.txt`. */
  gistFilename?: string;
}

export interface PrepareBindingDeps {
  /** Inject for tests. Defaults to {@link checkGistControl}. */
  github?: typeof checkGistControl;
  /** Inject a fetch (forwarded to github). */
  fetch?: typeof fetch;
}

export interface PreparedBinding {
  statement: PassportsignStatement;
  statement_canonical: Uint8Array;
  statement_sha256_hex: string;
  proof_blob_b64: string;
  proof_blob_sha256_hex: string;
  gist: GistEvidence;
}

const DEFAULT_GIST_FILENAME = 'passportsign.txt';

function decodeBase64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Run the GitHub gist control check, then build the in-toto statement and
 * compute canonical bytes + hashes for the Rekor handoff.
 *
 * Throws {@link PassportsignError} with the matching §4 code on any
 * failure path.
 */
export async function prepareBinding(
  input: PrepareBindingInput,
  init: PrepareBindingInit,
  deps: PrepareBindingDeps = {},
): Promise<PreparedBinding> {
  const githubImpl = deps.github ?? checkGistControl;

  // 1. GitHub gist control check (throws PassportsignError on any §4 path).
  const gist = await githubImpl({
    username: input.github_username,
    expected_filename: init.gistFilename ?? DEFAULT_GIST_FILENAME,
    expected_content: input.nonce,
    not_before: init.issuedAt,
    ...(input.github_token ? { token: input.github_token } : {}),
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });

  // 2. Derive proof_blob sha256 from the base64 input.
  let proofBytes: Uint8Array;
  try {
    proofBytes = decodeBase64(input.proof_blob_b64);
  } catch (err) {
    throw new PassportsignError(
      'proof_invalid',
      `proof_blob_b64 is not valid base64`,
      err,
    );
  }
  if (proofBytes.length === 0) {
    throw new PassportsignError('proof_invalid', 'proof_blob_b64 decoded to zero bytes');
  }
  const proof_blob_sha256_hex = sha256Hex(proofBytes);

  // 3. Build the in-toto statement (enforces hex / non-empty invariants).
  const statement = buildStatement({
    github_username: input.github_username,
    unique_identifier: input.unique_identifier,
    issuing_country: input.issuing_country,
    proof_blob_sha256: proof_blob_sha256_hex,
    gist_url: gist.url,
    gist_content_sha256: gist.content_sha256,
    scope: input.scope,
    zkpassport_sdk_version: input.zkpassport_sdk_version,
  });

  // 4. Canonical bytes + sha256 for the Rekor entry.
  const statement_canonical = canonicalize(statement);
  const statement_sha256_hex = canonicalSha256Hex(statement);

  return {
    statement,
    statement_canonical,
    statement_sha256_hex,
    proof_blob_b64: input.proof_blob_b64,
    proof_blob_sha256_hex,
    gist,
  };
}
