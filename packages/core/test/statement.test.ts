import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';

import {
  buildRevocationStatement,
  buildStatement,
  PASSPORTSIGN_PREDICATE_TYPE,
  PASSPORTSIGN_REVOCATION_PREDICATE_TYPE,
  IN_TOTO_STATEMENT_TYPE,
  type BuildRevocationStatementInput,
  type BuildStatementInput,
} from '../src/statement.js';
import { canonicalize } from '../src/canonical.js';

const validInput = (overrides: Partial<BuildStatementInput> = {}): BuildStatementInput => ({
  github_username: 'johnf',
  unique_identifier: '13902036709356453377929569764273223082772964910104338589480118024404105097567',
  issuing_country: 'CAN',
  proof_blob_sha256: '0a'.repeat(32),
  gist_url: 'https://gist.github.com/johnf/abcdef0123456789',
  gist_content_sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  scope: 'passportsign.dev:nationality-disclose:1',
  zkpassport_sdk_version: '0.15.1',
  ...overrides,
});

describe('buildStatement', () => {
  it('happy path with country disclosed', () => {
    const s = buildStatement(validInput());
    expect(s._type).toBe(IN_TOTO_STATEMENT_TYPE);
    expect(s.predicateType).toBe(PASSPORTSIGN_PREDICATE_TYPE);
    expect(s.subject).toHaveLength(1);
    expect(s.subject[0]!.name).toBe('github.com/johnf');
    expect(s.subject[0]!.digest.sha256).toBe(validInput().gist_content_sha256);
    expect(s.predicate.disclosure_level).toBe('personhood+country');
    expect(s.predicate.issuing_country).toBe('CAN');
  });

  it('happy path with country undisclosed', () => {
    const s = buildStatement(validInput({ issuing_country: null }));
    expect(s.predicate.disclosure_level).toBe('personhood');
    expect(s.predicate.issuing_country).toBeNull();
  });

  it('subject digest matches gist_content_sha256 (the invariant)', () => {
    const s = buildStatement(validInput());
    expect(s.subject[0]!.digest.sha256).toBe(s.predicate.gist_content_sha256);
  });

  describe('rejects malformed hex', () => {
    it.each([
      ['uppercase', 'A'.repeat(64)],
      ['too short', '0a'.repeat(31)],
      ['too long', '0a'.repeat(33)],
      ['non-hex chars', 'z'.repeat(64)],
      ['empty', ''],
    ])('proof_blob_sha256 %s', (_label, bad) => {
      expect(() => buildStatement(validInput({ proof_blob_sha256: bad }))).toThrow(TypeError);
    });

    it.each([
      ['uppercase', 'A'.repeat(64)],
      ['too short', '0a'.repeat(31)],
      ['non-hex chars', 'g'.repeat(64)],
    ])('gist_content_sha256 %s', (_label, bad) => {
      expect(() => buildStatement(validInput({ gist_content_sha256: bad }))).toThrow(TypeError);
    });
  });

  describe('rejects empty required strings', () => {
    it.each([
      'github_username',
      'unique_identifier',
      'gist_url',
      'scope',
      'zkpassport_sdk_version',
    ] as const)('%s', (field) => {
      expect(() => buildStatement(validInput({ [field]: '' }))).toThrow(TypeError);
    });
  });

  it('round-trip: canonicalize → parse JSON → deep-equal', () => {
    const s = buildStatement(validInput());
    const bytes = canonicalize(s);
    const reparsed = JSON.parse(new TextDecoder().decode(bytes));
    expect(reparsed).toEqual(s);
  });

  it('no bound_at field in the output', () => {
    const s = buildStatement(validInput());
    expect('bound_at' in s).toBe(false);
    expect('bound_at' in s.predicate).toBe(false);
  });
});

const LIVE_UUID =
  '108e9186e8c5677a53b1918ed9b9bbe15194e42714fd3a3f8f0e163d3a22831120a4c540a332e151';

const validRevocationInput = (
  overrides: Partial<BuildRevocationStatementInput> = {},
): BuildRevocationStatementInput => ({
  github_username: 'johnf',
  unique_identifier:
    '13902036709356453377929569764273223082772964910104338589480118024404105097567',
  revokes_rekor_entry_hash: LIVE_UUID,
  proof_blob_sha256: '0a'.repeat(32),
  scope: 'passportsign.dev:nationality-disclose:1',
  zkpassport_sdk_version: '0.15.1',
  ...overrides,
});

describe('buildRevocationStatement', () => {
  it('predicateType is the #revocation fragment of the binding type', () => {
    expect(PASSPORTSIGN_REVOCATION_PREDICATE_TYPE).toBe(
      `${PASSPORTSIGN_PREDICATE_TYPE}#revocation`,
    );
    const s = buildRevocationStatement(validRevocationInput());
    expect(s._type).toBe(IN_TOTO_STATEMENT_TYPE);
    expect(s.predicateType).toBe(PASSPORTSIGN_REVOCATION_PREDICATE_TYPE);
  });

  it('subject digest is the sha256 of the revoked entry UUID string', () => {
    const s = buildRevocationStatement(validRevocationInput());
    expect(s.subject[0]!.name).toBe('github.com/johnf');
    expect(s.subject[0]!.digest.sha256).toBe(
      createHash('sha256').update(LIVE_UUID, 'utf8').digest('hex'),
    );
  });

  it('predicate carries the revocation fields and no gist fields', () => {
    const s = buildRevocationStatement(validRevocationInput());
    expect(s.predicate.revokes_rekor_entry_hash).toBe(LIVE_UUID);
    expect(s.predicate.unique_identifier).toBe(validRevocationInput().unique_identifier);
    expect(s.predicate.proof_blob_sha256).toBe('0a'.repeat(32));
    expect('gist_url' in s.predicate).toBe(false);
    expect('gist_content_sha256' in s.predicate).toBe(false);
    expect('bound_at' in s.predicate).toBe(false);
    expect('issuing_country' in s.predicate).toBe(false);
  });

  it.each([
    ['too short', 'ab'.repeat(10)],
    ['uppercase', 'A'.repeat(80)],
    ['non-hex', 'z'.repeat(80)],
    ['empty', ''],
  ])('rejects malformed revokes_rekor_entry_hash (%s)', (_label, bad) => {
    expect(() =>
      buildRevocationStatement(validRevocationInput({ revokes_rekor_entry_hash: bad })),
    ).toThrow(TypeError);
  });

  it('rejects malformed proof_blob_sha256', () => {
    expect(() =>
      buildRevocationStatement(validRevocationInput({ proof_blob_sha256: 'A'.repeat(64) })),
    ).toThrow(TypeError);
  });

  it.each(['github_username', 'unique_identifier', 'scope', 'zkpassport_sdk_version'] as const)(
    'rejects empty %s',
    (field) => {
      expect(() => buildRevocationStatement(validRevocationInput({ [field]: '' }))).toThrow(
        TypeError,
      );
    },
  );

  it('round-trip: canonicalize → parse JSON → deep-equal', () => {
    const s = buildRevocationStatement(validRevocationInput());
    const reparsed = JSON.parse(new TextDecoder().decode(canonicalize(s)));
    expect(reparsed).toEqual(s);
  });
});
