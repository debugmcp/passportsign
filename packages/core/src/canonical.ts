import canonify from '@truestamp/canonify';
import { createHash } from 'node:crypto';

/**
 * RFC 8785 JCS-canonical UTF-8 bytes for a JSON-serializable value.
 *
 * Wraps `@truestamp/canonify` (pinned at exact 1.0.3) and UTF-8 encodes the
 * resulting string. The fixture-pinned drift test in
 * `test/canonical.test.ts` guards against silent behavior changes in the
 * underlying library — JCS implementations have had subtle bugs and this
 * function's output is the most security-critical artifact in the repo.
 *
 * Throws `TypeError` if the value cannot be canonicalized (e.g. undefined,
 * cycles, non-JSON-serializable types).
 */
export function canonicalize(value: unknown): Uint8Array {
  const canonical = canonify(value);
  if (canonical === undefined) {
    throw new TypeError(
      'canonicalize: value cannot be JCS-canonicalized (undefined / cycle / non-JSON)',
    );
  }
  return new TextEncoder().encode(canonical);
}

/**
 * Lowercase-hex SHA-256 of `canonicalize(value)`. Used to derive the
 * Rekor entry hash for the in-toto statement.
 */
export function canonicalSha256Hex(value: unknown): string {
  const bytes = canonicalize(value);
  return createHash('sha256').update(bytes).digest('hex');
}
