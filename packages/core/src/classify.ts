/**
 * Parse Rekor in-toto entries back into statements and classify
 * binding state (active / stale / revoked).
 *
 * This is the read-side counterpart of `statement.ts`/`submit.ts`:
 * the `list` command and the badge service both consume entries the
 * profile index points at, and neither may trust the index — every
 * entry is integrity-checked against the hash Rekor recorded.
 *
 * Staleness (spec §10 row 1): a binding moves to `stale` 12 months
 * after its Rekor inclusion time. `integratedTime` is authoritative;
 * user-supplied dates in the index are display-only.
 */

import { createHash } from 'node:crypto';

import { type RekorEntryResponse } from './log/rekor.js';
import { IN_TOTO_STATEMENT_TYPE } from './statement.js';

/** Spec §10 row 1: bindings move to `stale` after 12 months. */
export const STALENESS_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

export class EntryParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EntryParseError';
  }
}

/** Generic in-toto Statement v1 shape (predicate left untyped — callers narrow). */
export interface InTotoStatement {
  _type: typeof IN_TOTO_STATEMENT_TYPE;
  subject: Array<{ name: string; digest: Record<string, string> }>;
  predicateType: string;
  predicate: unknown;
}

export interface ParsedIntotoEntry {
  uuid: string;
  /** Unix seconds — Rekor's authoritative inclusion time. */
  integratedTime: number;
  predicateType: string;
  statement: InTotoStatement;
}

function fail(message: string): never {
  throw new EntryParseError(message);
}

/**
 * Decode a Rekor in-toto entry's stored attestation back into its
 * statement, verifying the attestation bytes hash to the
 * `payloadHash` Rekor recorded in the entry body. The hash check is
 * what lets consumers trust an entry fetched via an untrusted index.
 */
export function parseIntotoEntry(entry: RekorEntryResponse): ParsedIntotoEntry {
  const data = entry.attestation?.data;
  if (typeof data !== 'string' || data.length === 0) {
    fail(`entry ${entry.uuid}: no stored attestation`);
  }
  const attestationBytes = Buffer.from(data, 'base64');

  let bodyObj: unknown;
  try {
    bodyObj = JSON.parse(Buffer.from(entry.body, 'base64').toString('utf8'));
  } catch {
    fail(`entry ${entry.uuid}: body is not base64 JSON`);
  }
  const payloadHash = (
    bodyObj as { spec?: { content?: { payloadHash?: { algorithm?: string; value?: string } } } }
  )?.spec?.content?.payloadHash;
  if (payloadHash?.algorithm !== 'sha256' || typeof payloadHash.value !== 'string') {
    fail(`entry ${entry.uuid}: body has no sha256 payloadHash`);
  }
  const computed = createHash('sha256').update(attestationBytes).digest('hex');
  if (computed !== payloadHash.value) {
    fail(
      `entry ${entry.uuid}: attestation hash mismatch (computed ${computed}, recorded ${payloadHash.value})`,
    );
  }

  let statement: unknown;
  try {
    statement = JSON.parse(attestationBytes.toString('utf8'));
  } catch {
    fail(`entry ${entry.uuid}: attestation is not JSON`);
  }
  const s = statement as Partial<InTotoStatement>;
  if (
    s?._type !== IN_TOTO_STATEMENT_TYPE ||
    !Array.isArray(s.subject) ||
    typeof s.predicateType !== 'string'
  ) {
    fail(`entry ${entry.uuid}: attestation is not an in-toto Statement v1`);
  }

  return {
    uuid: entry.uuid,
    integratedTime: entry.integratedTime,
    predicateType: s.predicateType,
    statement: s as InTotoStatement,
  };
}

export type BindingState = 'active' | 'stale' | 'revoked';

export interface ClassifiedBinding {
  entry: ParsedIntotoEntry;
  state: BindingState;
  /** UUID of the revocation entry that caused `revoked`, when applicable. */
  revokedBy?: string;
}

export interface ClassifyBindingsInput {
  bindings: ParsedIntotoEntry[];
  revocations: ParsedIntotoEntry[];
  /** Epoch milliseconds; defaults to the current time. */
  now?: number;
}

function predicateField(entry: ParsedIntotoEntry, field: string): string | undefined {
  const predicate = entry.statement.predicate;
  if (typeof predicate !== 'object' || predicate === null) return undefined;
  const value = (predicate as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Classify each binding:
 * - `revoked` if a revocation entry (predicateType `…#revocation`)
 *   carries the same `unique_identifier` and either targets this
 *   binding's UUID via `revokes_rekor_entry_hash` or has no target
 *   (revokes all bindings under that identifier);
 * - else `stale` if older than {@link STALENESS_WINDOW_MS};
 * - else `active`.
 */
export function classifyBindings(input: ClassifyBindingsInput): ClassifiedBinding[] {
  const now = input.now ?? Date.now();
  const revocations = input.revocations.filter((r) =>
    r.predicateType.endsWith('#revocation'),
  );

  return input.bindings.map((entry) => {
    const uid = predicateField(entry, 'unique_identifier');
    const revokedBy = revocations.find((r) => {
      if (predicateField(r, 'unique_identifier') !== uid || uid === undefined) return false;
      const target = predicateField(r, 'revokes_rekor_entry_hash');
      return target === undefined || target === entry.uuid;
    });
    if (revokedBy) {
      return { entry, state: 'revoked', revokedBy: revokedBy.uuid };
    }
    if (now - entry.integratedTime * 1000 > STALENESS_WINDOW_MS) {
      return { entry, state: 'stale' };
    }
    return { entry, state: 'active' };
  });
}
