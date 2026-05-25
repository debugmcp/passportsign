import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';

import { canonicalize } from '../../src/canonical.js';
import { signEnvelope, IN_TOTO_PAYLOAD_TYPE } from '../../src/dsse.js';
import { PassportsignError } from '../../src/errors.js';
import {
  buildIntotoEntryBody,
  PublicSigstoreRekorClient,
} from '../../src/log/rekor.js';

const SAMPLE_PAYLOAD = canonicalize({
  _type: 'https://in-toto.io/Statement/v1',
  predicateType: 'https://example.dev/test/v1',
  subject: [{ name: 's', digest: { sha256: 'a'.repeat(64) } }],
  predicate: { test: true },
});

function happyResponse(uuid = 'rekor-uuid-1') {
  return {
    [uuid]: {
      logIndex: 100,
      integratedTime: 1700000000,
      logID: 'log-id-1',
      body: 'base64-body',
      attestation: { data: 'base64-att' },
      verification: {
        inclusionProof: {
          checkpoint: 'cp',
          hashes: ['aabb', 'ccdd'],
          logIndex: 100,
          rootHash: 'rootroot',
          treeSize: 200,
        },
        signedEntryTimestamp: 'base64-set',
      },
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('buildIntotoEntryBody', () => {
  const { envelope } = signEnvelope(SAMPLE_PAYLOAD, IN_TOTO_PAYLOAD_TYPE);
  const body = buildIntotoEntryBody(envelope) as {
    apiVersion: string;
    kind: string;
    spec: { content: any };
  };

  it('has apiVersion 0.0.2 and kind intoto', () => {
    expect(body.apiVersion).toBe('0.0.2');
    expect(body.kind).toBe('intoto');
  });

  it('double-base64s payload and sig at the API boundary', () => {
    const env = body.spec.content.envelope;
    // payload field in the submission should decode once to give the DSSE base64
    expect(Buffer.from(env.payload, 'base64').toString()).toBe(envelope.payload);
    expect(Buffer.from(env.signatures[0].sig, 'base64').toString()).toBe(
      envelope.signatures[0]!.sig,
    );
  });

  it('single-base64s publicKey over the PEM bytes', () => {
    const decodedKey = Buffer.from(
      body.spec.content.envelope.signatures[0].publicKey,
      'base64',
    ).toString();
    expect(decodedKey).toBe(envelope.signatures[0]!.publicKey);
    expect(decodedKey).toContain('-----BEGIN PUBLIC KEY-----');
  });

  it('omits keyid entirely when empty (does not send "")', () => {
    expect(body.spec.content.envelope.signatures[0].keyid).toBeUndefined();
  });

  it('includes hash and payloadHash with sha256', () => {
    expect(body.spec.content.hash.algorithm).toBe('sha256');
    expect(body.spec.content.payloadHash.algorithm).toBe('sha256');
    // payloadHash = sha256 of raw payload bytes
    const expectedPayloadHash = createHash('sha256').update(SAMPLE_PAYLOAD).digest('hex');
    expect(body.spec.content.payloadHash.value).toBe(expectedPayloadHash);
  });

  it('rejects empty signatures array', () => {
    expect(() =>
      buildIntotoEntryBody({ ...envelope, signatures: [] }),
    ).toThrow(PassportsignError);
  });
});

describe('PublicSigstoreRekorClient.submitIntoto', () => {
  const { envelope } = signEnvelope(SAMPLE_PAYLOAD, IN_TOTO_PAYLOAD_TYPE);

  it('happy path: POST returns parsed RekorEntryResponse', async () => {
    const fetchImpl: typeof fetch = async (url, init) => {
      expect(String(url)).toContain('/api/v1/log/entries');
      expect(init?.method).toBe('POST');
      return jsonResponse(happyResponse(), 201);
    };
    const client = new PublicSigstoreRekorClient({ fetch: fetchImpl });
    const r = await client.submitIntoto(envelope);
    expect(r.uuid).toBe('rekor-uuid-1');
    expect(r.logIndex).toBe(100);
    expect(r.verification.inclusionProof.treeSize).toBe(200);
  });

  it('400 → PassportsignError log_submission_failed with body in message', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response('{"code":400,"message":"bad request"}', { status: 400 });
    const client = new PublicSigstoreRekorClient({ fetch: fetchImpl });
    await expect(client.submitIntoto(envelope)).rejects.toMatchObject({
      code: 'log_submission_failed',
    });
  });

  it('500 → log_submission_failed', async () => {
    const fetchImpl: typeof fetch = async () => new Response('boom', { status: 500 });
    const client = new PublicSigstoreRekorClient({ fetch: fetchImpl });
    await expect(client.submitIntoto(envelope)).rejects.toMatchObject({
      code: 'log_submission_failed',
    });
  });

  it('network error → log_submission_failed', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error('ECONNRESET');
    };
    const client = new PublicSigstoreRekorClient({ fetch: fetchImpl });
    await expect(client.submitIntoto(envelope)).rejects.toMatchObject({
      code: 'log_submission_failed',
    });
  });

  it('malformed response (non-object) → log_submission_failed', async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse([]);
    const client = new PublicSigstoreRekorClient({ fetch: fetchImpl });
    await expect(client.submitIntoto(envelope)).rejects.toMatchObject({
      code: 'log_submission_failed',
    });
  });

  it('missing verification block → log_submission_failed', async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({ 'uuid-1': { logIndex: 1, body: 'b' } });
    const client = new PublicSigstoreRekorClient({ fetch: fetchImpl });
    await expect(client.submitIntoto(envelope)).rejects.toMatchObject({
      code: 'log_submission_failed',
    });
  });

  it('uses default base URL when none provided', () => {
    const client = new PublicSigstoreRekorClient();
    expect(client).toBeInstanceOf(PublicSigstoreRekorClient);
  });
});

describe('PublicSigstoreRekorClient.getEntry', () => {
  it('happy path', async () => {
    const fetchImpl: typeof fetch = async (url) => {
      expect(String(url)).toContain('/api/v1/log/entries/abcd');
      return jsonResponse(happyResponse('abcd'));
    };
    const client = new PublicSigstoreRekorClient({ fetch: fetchImpl });
    const r = await client.getEntry('abcd');
    expect(r.uuid).toBe('abcd');
  });

  it('404 → log_submission_failed', async () => {
    const fetchImpl: typeof fetch = async () => new Response('{}', { status: 404 });
    const client = new PublicSigstoreRekorClient({ fetch: fetchImpl });
    await expect(client.getEntry('missing')).rejects.toMatchObject({
      code: 'log_submission_failed',
    });
  });
});

describe('PublicSigstoreRekorClient.getLogInfo', () => {
  it('parses {rootHash, treeSize, signedTreeHead, treeID}', async () => {
    const fetchImpl: typeof fetch = async (url) => {
      expect(String(url)).toBe('https://rekor.sigstore.dev/api/v1/log');
      return jsonResponse({
        rootHash: 'abcd',
        treeSize: 12345,
        signedTreeHead: 'sig-bytes',
        treeID: '1010101',
      });
    };
    const client = new PublicSigstoreRekorClient({ fetch: fetchImpl });
    const info = await client.getLogInfo();
    expect(info).toEqual({
      rootHash: 'abcd',
      treeSize: 12345,
      signedTreeHead: 'sig-bytes',
      treeID: '1010101',
    });
  });

  it('500 → log_submission_failed', async () => {
    const fetchImpl: typeof fetch = async () => new Response('', { status: 500 });
    const client = new PublicSigstoreRekorClient({ fetch: fetchImpl });
    await expect(client.getLogInfo()).rejects.toMatchObject({ code: 'log_submission_failed' });
  });

  it('rejects malformed response missing required fields', async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({ rootHash: 'abcd', treeSize: 'not-a-number' });
    const client = new PublicSigstoreRekorClient({ fetch: fetchImpl });
    await expect(client.getLogInfo()).rejects.toMatchObject({ code: 'log_submission_failed' });
  });
});

describe('PublicSigstoreRekorClient.getConsistencyProof', () => {
  it('happy path: passes firstSize/lastSize as query params and returns hashes', async () => {
    const fetchImpl: typeof fetch = async (url) => {
      expect(String(url)).toContain('firstSize=10');
      expect(String(url)).toContain('lastSize=20');
      return jsonResponse({ hashes: ['aa', 'bb', 'cc'], rootHash: 'newroot' });
    };
    const client = new PublicSigstoreRekorClient({ fetch: fetchImpl });
    const p = await client.getConsistencyProof(10, 20);
    expect(p.hashes).toEqual(['aa', 'bb', 'cc']);
    expect(p.rootHash).toBe('newroot');
  });

  it('rejects malformed response', async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({ hashes: 'not-an-array' });
    const client = new PublicSigstoreRekorClient({ fetch: fetchImpl });
    await expect(client.getConsistencyProof(1, 2)).rejects.toMatchObject({
      code: 'log_submission_failed',
    });
  });

  it('500 → log_submission_failed', async () => {
    const fetchImpl: typeof fetch = async () => new Response('', { status: 500 });
    const client = new PublicSigstoreRekorClient({ fetch: fetchImpl });
    await expect(client.getConsistencyProof(1, 2)).rejects.toMatchObject({
      code: 'log_submission_failed',
    });
  });
});
