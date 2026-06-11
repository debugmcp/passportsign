import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  EntryParseError,
  STALENESS_WINDOW_MS,
  classifyBindings,
  parseIntotoEntry,
  type ParsedIntotoEntry,
} from '../src/classify.js';
import { PASSPORTSIGN_PREDICATE_TYPE } from '../src/statement.js';
import { type RekorEntryResponse } from '../src/log/rekor.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** The real v0 binding (cynarlab, 2026-05-25) captured verbatim from rekor.sigstore.dev. */
function liveEntry(): RekorEntryResponse {
  const raw = JSON.parse(readFileSync(join(FIXTURES, 'live-rekor-entry.json'), 'utf8')) as Record<
    string,
    Record<string, unknown>
  >;
  const [uuid, e] = Object.entries(raw)[0]!;
  return {
    uuid,
    logIndex: e['logIndex'] as number,
    integratedTime: e['integratedTime'] as number,
    logID: e['logID'] as string,
    body: e['body'] as string,
    attestation: e['attestation'] as { data?: string },
    verification: e['verification'] as RekorEntryResponse['verification'],
  };
}

describe('parseIntotoEntry', () => {
  it('recovers the in-toto statement from the live entry', () => {
    const parsed = parseIntotoEntry(liveEntry());
    expect(parsed.uuid).toMatch(/^108e9186/);
    expect(parsed.integratedTime).toBe(1779745657);
    expect(parsed.predicateType).toBe(PASSPORTSIGN_PREDICATE_TYPE);
    expect(parsed.statement.subject[0]!.name).toBe('github.com/cynarlab');
    const predicate = parsed.statement.predicate as Record<string, unknown>;
    expect(typeof predicate['unique_identifier']).toBe('string');
    expect(predicate['issuing_country']).toBe('CAN');
  });

  it('rejects an entry without an attestation', () => {
    const entry = liveEntry();
    delete (entry as { attestation?: unknown }).attestation;
    expect(() => parseIntotoEntry(entry)).toThrow(EntryParseError);
  });

  it('rejects a tampered attestation (payloadHash mismatch)', () => {
    const entry = liveEntry();
    // Re-encode a modified statement: still valid base64/JSON, wrong hash.
    const data = Buffer.from(entry.attestation!.data!, 'base64').toString('utf8');
    entry.attestation = {
      data: Buffer.from(data.replace('cynarlab', 'attacker')).toString('base64'),
    };
    expect(() => parseIntotoEntry(entry)).toThrow(EntryParseError);
  });

  it('rejects an attestation that is not an in-toto statement', () => {
    const entry = liveEntry();
    const bogus = Buffer.from(JSON.stringify({ hello: 'world' })).toString('utf8');
    // Recompute body so the payloadHash check passes but shape check fails.
    const bodyObj = JSON.parse(Buffer.from(entry.body, 'base64').toString('utf8')) as {
      spec: { content: { payloadHash: { value: string } } };
    };
    bodyObj.spec.content.payloadHash.value = createHash('sha256').update(bogus).digest('hex');
    entry.body = Buffer.from(JSON.stringify(bodyObj)).toString('base64');
    entry.attestation = { data: Buffer.from(bogus).toString('base64') };
    expect(() => parseIntotoEntry(entry)).toThrow(EntryParseError);
  });
});

// ---------------------------------------------------------------------------

const NOW = Date.parse('2026-06-11T00:00:00Z');
const RECENT = Math.floor((NOW - 10 * 24 * 3600 * 1000) / 1000); // 10 days ago
const ANCIENT = Math.floor((NOW - STALENESS_WINDOW_MS) / 1000) - 3600; // just past the window

function binding(
  uuid: string,
  uniqueIdentifier: string,
  integratedTime: number,
): ParsedIntotoEntry {
  return {
    uuid,
    integratedTime,
    predicateType: PASSPORTSIGN_PREDICATE_TYPE,
    statement: {
      _type: 'https://in-toto.io/Statement/v1',
      subject: [{ name: 'github.com/cynarlab', digest: { sha256: '0'.repeat(64) } }],
      predicateType: PASSPORTSIGN_PREDICATE_TYPE,
      predicate: { unique_identifier: uniqueIdentifier },
    },
  };
}

function revocation(
  uuid: string,
  uniqueIdentifier: string,
  revokes?: string,
): ParsedIntotoEntry {
  return {
    uuid,
    integratedTime: RECENT,
    predicateType: `${PASSPORTSIGN_PREDICATE_TYPE}#revocation`,
    statement: {
      _type: 'https://in-toto.io/Statement/v1',
      subject: [{ name: 'github.com/cynarlab', digest: { sha256: '0'.repeat(64) } }],
      predicateType: `${PASSPORTSIGN_PREDICATE_TYPE}#revocation`,
      predicate: {
        unique_identifier: uniqueIdentifier,
        ...(revokes ? { revokes_rekor_entry_hash: revokes } : {}),
      },
    },
  };
}

const UUID_A = 'a'.repeat(80);
const UUID_B = 'b'.repeat(80);
const UUID_R = 'c'.repeat(80);

describe('classifyBindings', () => {
  it('classifies a recent unrevoked binding as active', () => {
    const out = classifyBindings({
      bindings: [binding(UUID_A, 'uid-1', RECENT)],
      revocations: [],
      now: NOW,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.state).toBe('active');
  });

  it('classifies a binding past the 12-month window as stale', () => {
    const out = classifyBindings({
      bindings: [binding(UUID_A, 'uid-1', ANCIENT)],
      revocations: [],
      now: NOW,
    });
    expect(out[0]!.state).toBe('stale');
  });

  it('marks a binding revoked by a targeted revocation', () => {
    const out = classifyBindings({
      bindings: [binding(UUID_A, 'uid-1', RECENT), binding(UUID_B, 'uid-1', RECENT)],
      revocations: [revocation(UUID_R, 'uid-1', UUID_A)],
      now: NOW,
    });
    expect(out.find((b) => b.entry.uuid === UUID_A)!.state).toBe('revoked');
    expect(out.find((b) => b.entry.uuid === UUID_A)!.revokedBy).toBe(UUID_R);
    expect(out.find((b) => b.entry.uuid === UUID_B)!.state).toBe('active');
  });

  it('a revocation without a target revokes every binding with the same unique_identifier', () => {
    const out = classifyBindings({
      bindings: [binding(UUID_A, 'uid-1', RECENT), binding(UUID_B, 'uid-2', RECENT)],
      revocations: [revocation(UUID_R, 'uid-1')],
      now: NOW,
    });
    expect(out.find((b) => b.entry.uuid === UUID_A)!.state).toBe('revoked');
    expect(out.find((b) => b.entry.uuid === UUID_B)!.state).toBe('active');
  });

  it('a revocation for a different unique_identifier does not revoke', () => {
    const out = classifyBindings({
      bindings: [binding(UUID_A, 'uid-1', RECENT)],
      revocations: [revocation(UUID_R, 'uid-other', UUID_A)],
      now: NOW,
    });
    expect(out[0]!.state).toBe('active');
  });

  it('revoked wins over stale', () => {
    const out = classifyBindings({
      bindings: [binding(UUID_A, 'uid-1', ANCIENT)],
      revocations: [revocation(UUID_R, 'uid-1', UUID_A)],
      now: NOW,
    });
    expect(out[0]!.state).toBe('revoked');
  });

  it('ignores a foreign predicateType that merely ends with #revocation', () => {
    const foreign = revocation(UUID_R, 'uid-1', UUID_A);
    foreign.predicateType = 'https://evil.example/v9#revocation';
    (foreign.statement as { predicateType: string }).predicateType = foreign.predicateType;
    const out = classifyBindings({
      bindings: [binding(UUID_A, 'uid-1', RECENT)],
      revocations: [foreign],
      now: NOW,
    });
    expect(out[0]!.state).toBe('active');
  });

  it('ignores revocation entries whose predicateType is not the revocation type', () => {
    const fake = binding(UUID_R, 'uid-1', RECENT); // binding predicateType, not #revocation
    const out = classifyBindings({
      bindings: [binding(UUID_A, 'uid-1', RECENT)],
      revocations: [fake],
      now: NOW,
    });
    expect(out[0]!.state).toBe('active');
  });
});
