import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';

import { prepareBinding, type PrepareBindingInput } from '../src/bind.js';
import { PassportsignError } from '../src/errors.js';
import { canonicalSha256Hex } from '../src/canonical.js';
import { PASSPORTSIGN_PREDICATE_TYPE } from '../src/statement.js';

const INIT_AT = new Date('2026-05-25T10:00:00.000Z');
const GIST_AT = '2026-05-25T10:30:00.000Z';

const PROOF_BYTES = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03]);
const PROOF_B64 = Buffer.from(PROOF_BYTES).toString('base64');
const PROOF_SHA256 = createHash('sha256').update(PROOF_BYTES).digest('hex');

const GIST_CONTENT_SHA256 = createHash('sha256').update('nonce-content').digest('hex');

function input(overrides: Partial<PrepareBindingInput> = {}): PrepareBindingInput {
  return {
    github_username: 'johnf',
    proof_blob_b64: PROOF_B64,
    unique_identifier: '13902036709356453377929569764273223082772964910104338589480118024404105097567',
    issuing_country: 'CAN',
    nonce: 'zkm-johnf-abcdefghijklmnopqrstuvwxyz234567',
    scope: 'passportsign.dev:nationality-disclose:1',
    zkpassport_sdk_version: '0.15.1',
    ...overrides,
  };
}

const happyGistMock = vi.fn(async () => ({
  url: 'https://gist.github.com/johnf/abc',
  content_sha256: GIST_CONTENT_SHA256,
  updated_at: GIST_AT,
}));

describe('prepareBinding — happy path', () => {
  it('returns a complete PreparedBinding', async () => {
    const result = await prepareBinding(input(), { issuedAt: INIT_AT }, { github: happyGistMock });

    expect(result.proof_blob_b64).toBe(PROOF_B64);
    expect(result.proof_blob_sha256_hex).toBe(PROOF_SHA256);
    expect(result.gist.url).toBe('https://gist.github.com/johnf/abc');
    expect(result.gist.content_sha256).toBe(GIST_CONTENT_SHA256);
    expect(result.statement._type).toBe('https://in-toto.io/Statement/v1');
    expect(result.statement.predicateType).toBe(PASSPORTSIGN_PREDICATE_TYPE);
    expect(result.statement.subject[0]!.name).toBe('github.com/johnf');
    expect(result.statement.subject[0]!.digest.sha256).toBe(GIST_CONTENT_SHA256);
    expect(result.statement.predicate.issuing_country).toBe('CAN');
    expect(result.statement.predicate.disclosure_level).toBe('personhood+country');
    expect(result.statement.predicate.proof_blob_sha256).toBe(PROOF_SHA256);
    expect(result.statement_sha256_hex).toBe(canonicalSha256Hex(result.statement));
    expect(Buffer.from(result.statement_canonical).toString('utf8')).toContain(
      '"predicateType":"https://passportsign.dev/personhood/v1"',
    );
  });

  it('passes the nonce through to the gist check as expected_content', async () => {
    const spy = vi.fn(happyGistMock);
    await prepareBinding(input(), { issuedAt: INIT_AT }, { github: spy });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      expected_content: input().nonce,
      not_before: INIT_AT,
      username: 'johnf',
      expected_filename: 'passportsign.txt',
    }));
  });

  it('honors a custom gist filename', async () => {
    const spy = vi.fn(happyGistMock);
    await prepareBinding(
      input(),
      { issuedAt: INIT_AT, gistFilename: 'other-name.txt' },
      { github: spy },
    );
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ expected_filename: 'other-name.txt' }),
    );
  });

  it('forwards GitHub token to the gist check', async () => {
    const spy = vi.fn(happyGistMock);
    await prepareBinding(
      input({ github_token: 'ghp_abc' }),
      { issuedAt: INIT_AT },
      { github: spy },
    );
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ token: 'ghp_abc' }));
  });

  it('produces personhood disclosure_level when issuing_country is null', async () => {
    const r = await prepareBinding(
      input({ issuing_country: null }),
      { issuedAt: INIT_AT },
      { github: happyGistMock },
    );
    expect(r.statement.predicate.disclosure_level).toBe('personhood');
    expect(r.statement.predicate.issuing_country).toBeNull();
  });
});

describe('prepareBinding — error paths', () => {
  it('propagates PassportsignError from the gist check', async () => {
    const failingGist = vi.fn(async () => {
      throw new PassportsignError('gist_not_found', 'simulated');
    });
    await expect(
      prepareBinding(input(), { issuedAt: INIT_AT }, { github: failingGist }),
    ).rejects.toMatchObject({ code: 'gist_not_found' });
  });

  it('proof_invalid when proof_blob_b64 decodes to zero bytes', async () => {
    await expect(
      prepareBinding(input({ proof_blob_b64: '' }), { issuedAt: INIT_AT }, { github: happyGistMock }),
    ).rejects.toMatchObject({ code: 'proof_invalid' });
  });

  it('subject digest equals gist content sha256 (the invariant)', async () => {
    const r = await prepareBinding(input(), { issuedAt: INIT_AT }, { github: happyGistMock });
    expect(r.statement.subject[0]!.digest.sha256).toBe(
      r.statement.predicate.gist_content_sha256,
    );
    expect(r.statement.subject[0]!.digest.sha256).toBe(r.gist.content_sha256);
  });
});
