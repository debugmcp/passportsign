import { describe, it, expect } from 'vitest';

import {
  buildStatement,
  PASSPORTSIGN_PREDICATE_TYPE,
  IN_TOTO_STATEMENT_TYPE,
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
