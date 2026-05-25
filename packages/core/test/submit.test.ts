import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';

import { buildStatement } from '../src/statement.js';
import { canonicalize } from '../src/canonical.js';
import { PassportsignError } from '../src/errors.js';
import { type PreparedBinding } from '../src/bind.js';
import { type RekorClient, type RekorEntryResponse } from '../src/log/rekor.js';
import { submitBinding } from '../src/submit.js';
import { BUNDLE_FORMAT_VERSION } from '../src/bundle.js';

function makePrepared(): PreparedBinding {
  const statement = buildStatement({
    github_username: 'johnf',
    unique_identifier: '12345',
    issuing_country: 'CAN',
    proof_blob_sha256: '0a'.repeat(32),
    gist_url: 'https://gist.github.com/johnf/abc',
    gist_content_sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    scope: 'passportsign.dev:nationality-disclose:1',
    zkpassport_sdk_version: '0.15.1',
  });
  const canonical = canonicalize(statement);
  const proofBytes = new Uint8Array([0x01, 0x02, 0x03]);
  return {
    statement,
    statement_canonical: canonical,
    statement_sha256_hex: createHash('sha256').update(canonical).digest('hex'),
    proof_blob_b64: Buffer.from(proofBytes).toString('base64'),
    proof_blob_sha256_hex: createHash('sha256').update(proofBytes).digest('hex'),
    gist: {
      url: 'https://gist.github.com/johnf/abc',
      content_sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      updated_at: '2026-05-25T10:30:00.000Z',
    },
  };
}

function happyRekorClient(): RekorClient {
  const response: RekorEntryResponse = {
    uuid: 'rekor-entry-uuid-abc',
    logIndex: 12345,
    integratedTime: 1779739312,
    logID: 'log-id-1',
    body: 'base64-encoded-body',
    verification: {
      inclusionProof: {
        checkpoint: 'cp-1',
        hashes: ['aabb', 'ccdd', 'eeff'],
        logIndex: 12345,
        rootHash: 'rootroot-hex',
        treeSize: 99999,
      },
      signedEntryTimestamp: 'base64-set',
    },
  };
  return {
    submitIntoto: vi.fn(async () => response),
    getEntry: vi.fn(async () => response),
    getLogInfo: vi.fn(),
    getConsistencyProof: vi.fn(),
  };
}

describe('submitBinding', () => {
  it('happy path: returns a validated PassportsignBundle + rekor entry', async () => {
    const prepared = makePrepared();
    const rekor = happyRekorClient();
    const { bundle, rekorEntry } = await submitBinding(prepared, { rekor });

    expect(bundle.bundle_format_version).toBe(BUNDLE_FORMAT_VERSION);
    expect(bundle.statement).toBe(Buffer.from(prepared.statement_canonical).toString('hex'));
    expect(bundle.proof_blob).toBe(prepared.proof_blob_b64);
    expect(bundle.rekor.log_entry_hash).toBe('rekor-entry-uuid-abc');
    expect(bundle.rekor.log_root_at_submission).toBe('rootroot-hex');
    expect(bundle.rekor.inclusion_proof).toMatchObject({
      logIndex: 12345,
      treeSize: 99999,
      rootHash: 'rootroot-hex',
    });
    expect(rekorEntry.uuid).toBe('rekor-entry-uuid-abc');
  });

  it('signs the canonical statement and submits via the client', async () => {
    const prepared = makePrepared();
    const rekor = happyRekorClient();
    await submitBinding(prepared, { rekor });
    expect(rekor.submitIntoto).toHaveBeenCalledTimes(1);
    const envelopeArg = (rekor.submitIntoto as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(envelopeArg.payloadType).toBe('application/vnd.in-toto+json');
    // payload base64 decodes to the canonical bytes
    expect(Buffer.from(envelopeArg.payload, 'base64').toString()).toBe(
      Buffer.from(prepared.statement_canonical).toString(),
    );
    expect(envelopeArg.signatures).toHaveLength(1);
    expect(envelopeArg.signatures[0].publicKey).toContain('-----BEGIN PUBLIC KEY-----');
  });

  it('propagates PassportsignError from the rekor client', async () => {
    const failing: RekorClient = {
      submitIntoto: vi.fn(async () => {
        throw new PassportsignError('log_submission_failed', 'simulated 500');
      }),
      getEntry: vi.fn(),
      getLogInfo: vi.fn(),
      getConsistencyProof: vi.fn(),
    };
    await expect(submitBinding(makePrepared(), { rekor: failing })).rejects.toMatchObject({
      code: 'log_submission_failed',
    });
  });
});
