/**
 * in-toto Statement v1 builder for passportsign attestations.
 *
 * The statement's canonical JCS bytes are what gets hashed into the
 * Rekor entry, so this module is the authoritative source for the
 * statement shape. Test vectors in
 * `test/fixtures/canonical-vectors.json` pin the canonicalization
 * output for representative statements built here.
 */

import { sha256Hex, utf8ToBytes } from './encoding.js';

export const IN_TOTO_STATEMENT_TYPE = 'https://in-toto.io/Statement/v1' as const;
export const PASSPORTSIGN_PREDICATE_TYPE =
  'https://passportsign.dev/personhood/v1' as const;
export const PASSPORTSIGN_REVOCATION_PREDICATE_TYPE =
  'https://passportsign.dev/personhood/v1#revocation' as const;

export type DisclosureLevel = 'personhood' | 'personhood+country';

export interface PassportsignPredicate {
  /** From the zkPassport SDK — deterministic for (passport, domain, scope). */
  unique_identifier: string;
  /** ICAO 3-letter code if disclosed, else null. Pass through as-returned by SDK. */
  issuing_country: string | null;
  /** Derived from issuing_country (null → personhood, set → personhood+country). */
  disclosure_level: DisclosureLevel;
  /** Lowercase hex SHA-256 of the proof blob bytes. */
  proof_blob_sha256: string;
  /** Public gist URL captured at binding time. */
  gist_url: string;
  /** Lowercase hex SHA-256 of the gist's content bytes. Also the subject digest. */
  gist_content_sha256: string;
  /** zkPassport scope (e.g. "passportsign.dev:nationality-disclose:1"). */
  scope: string;
  /** Version string from the zkPassport SDK that produced the proof. */
  zkpassport_sdk_version: string;
}

export interface PassportsignStatement {
  _type: typeof IN_TOTO_STATEMENT_TYPE;
  subject: Array<{
    name: string;
    digest: { sha256: string };
  }>;
  predicateType: typeof PASSPORTSIGN_PREDICATE_TYPE;
  predicate: PassportsignPredicate;
}

export interface BuildStatementInput {
  github_username: string;
  unique_identifier: string;
  issuing_country: string | null;
  proof_blob_sha256: string;
  gist_url: string;
  gist_content_sha256: string;
  scope: string;
  zkpassport_sdk_version: string;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;
const REKOR_UUID = /^[0-9a-f]{80}$/;

function assertSha256Hex(value: string, field: string): void {
  if (!SHA256_HEX.test(value)) {
    throw new TypeError(
      `${field}: expected lowercase 64-char hex SHA-256, got ${JSON.stringify(value)}`,
    );
  }
}

function assertRekorUuid(value: string, field: string): void {
  if (!REKOR_UUID.test(value)) {
    throw new TypeError(
      `${field}: expected 80-char lowercase hex Rekor entry UUID, got ${JSON.stringify(value)}`,
    );
  }
}

function assertNonEmpty(value: string, field: string): void {
  if (value.length === 0) {
    throw new TypeError(`${field}: must be non-empty`);
  }
}

/**
 * Build a passportsign in-toto Statement v1.
 *
 * Invariants enforced here (so the canonical bytes are always well-formed):
 * - `proof_blob_sha256` and `gist_content_sha256` are lowercase 64-char hex.
 * - `github_username`, `unique_identifier`, `gist_url`, `scope`,
 *   `zkpassport_sdk_version` are non-empty.
 * - `subject[0].digest.sha256 === gist_content_sha256` — the subject digest
 *   is the artifact whose control was demonstrated (the gist content).
 * - `disclosure_level` is derived from `issuing_country` and is never
 *   accepted from the caller.
 * - There is no `bound_at` field — the Rekor inclusion timestamp is the
 *   authoritative time of binding.
 */
export function buildStatement(input: BuildStatementInput): PassportsignStatement {
  assertSha256Hex(input.proof_blob_sha256, 'proof_blob_sha256');
  assertSha256Hex(input.gist_content_sha256, 'gist_content_sha256');
  assertNonEmpty(input.github_username, 'github_username');
  assertNonEmpty(input.unique_identifier, 'unique_identifier');
  assertNonEmpty(input.gist_url, 'gist_url');
  assertNonEmpty(input.scope, 'scope');
  assertNonEmpty(input.zkpassport_sdk_version, 'zkpassport_sdk_version');

  const disclosure_level: DisclosureLevel =
    input.issuing_country === null ? 'personhood' : 'personhood+country';

  return {
    _type: IN_TOTO_STATEMENT_TYPE,
    subject: [
      {
        name: `github.com/${input.github_username}`,
        digest: { sha256: input.gist_content_sha256 },
      },
    ],
    predicateType: PASSPORTSIGN_PREDICATE_TYPE,
    predicate: {
      unique_identifier: input.unique_identifier,
      issuing_country: input.issuing_country,
      disclosure_level,
      proof_blob_sha256: input.proof_blob_sha256,
      gist_url: input.gist_url,
      gist_content_sha256: input.gist_content_sha256,
      scope: input.scope,
      zkpassport_sdk_version: input.zkpassport_sdk_version,
    },
  };
}

export interface PassportsignRevocationPredicate {
  /** Must match the revoked binding's `unique_identifier` — same passport, same scope. */
  unique_identifier: string;
  /** Rekor entry UUID of the binding being revoked. */
  revokes_rekor_entry_hash: string;
  /** Lowercase hex SHA-256 of the fresh proof blob backing this revocation. */
  proof_blob_sha256: string;
  /** zkPassport scope — must equal the binding scope or the identifiers won't match. */
  scope: string;
  zkpassport_sdk_version: string;
}

export interface PassportsignRevocationStatement {
  _type: typeof IN_TOTO_STATEMENT_TYPE;
  subject: Array<{
    name: string;
    digest: { sha256: string };
  }>;
  predicateType: typeof PASSPORTSIGN_REVOCATION_PREDICATE_TYPE;
  predicate: PassportsignRevocationPredicate;
}

export interface BuildRevocationStatementInput {
  github_username: string;
  unique_identifier: string;
  revokes_rekor_entry_hash: string;
  proof_blob_sha256: string;
  scope: string;
  zkpassport_sdk_version: string;
}

/**
 * Build a passportsign revocation statement (spec §7, roadmap v0.5.2).
 *
 * Revocation requires only a fresh proof from the same passport — there
 * are deliberately no gist fields (no GitHub control needed; that's the
 * recovery property). The revocation always targets one concrete
 * binding entry; the subject digest is the sha256 of that entry's UUID
 * string, tying the statement to the artifact it acts on.
 */
export function buildRevocationStatement(
  input: BuildRevocationStatementInput,
): PassportsignRevocationStatement {
  assertRekorUuid(input.revokes_rekor_entry_hash, 'revokes_rekor_entry_hash');
  assertSha256Hex(input.proof_blob_sha256, 'proof_blob_sha256');
  assertNonEmpty(input.github_username, 'github_username');
  assertNonEmpty(input.unique_identifier, 'unique_identifier');
  assertNonEmpty(input.scope, 'scope');
  assertNonEmpty(input.zkpassport_sdk_version, 'zkpassport_sdk_version');

  const subjectDigest = sha256Hex(utf8ToBytes(input.revokes_rekor_entry_hash));

  return {
    _type: IN_TOTO_STATEMENT_TYPE,
    subject: [
      {
        name: `github.com/${input.github_username}`,
        digest: { sha256: subjectDigest },
      },
    ],
    predicateType: PASSPORTSIGN_REVOCATION_PREDICATE_TYPE,
    predicate: {
      unique_identifier: input.unique_identifier,
      revokes_rekor_entry_hash: input.revokes_rekor_entry_hash,
      proof_blob_sha256: input.proof_blob_sha256,
      scope: input.scope,
      zkpassport_sdk_version: input.zkpassport_sdk_version,
    },
  };
}
