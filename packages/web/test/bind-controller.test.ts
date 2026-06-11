import { describe, expect, it, vi } from 'vitest';
import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  hashLeaf,
  hexToBytes,
  sha256Hex,
  utf8ToBytes,
  type DsseEnvelope,
  type GistEvidence,
  type RekorClient,
  type RekorEntryResponse,
} from '@passportsign/core/web';
import { BindSession, type SdkScanResult } from '../app/bind/controller.js';

const SCAN_RESULT: SdkScanResult = {
  proofs: [{ proof: 'fake' }],
  original_query: { q: 1 },
  query_result: { nationality: { disclose: { result: 'CAN' } } },
  unique_identifier: 'uid-12345',
  issuing_country: 'CAN',
};

function gistEvidence(content: string): GistEvidence {
  return {
    url: 'https://gist.github.com/cynarlab/abc',
    content_sha256: sha256Hex(utf8ToBytes(content)),
    updated_at: new Date().toISOString(),
  };
}

/** Rekor mock that builds a self-consistent entry from whatever envelope arrives. */
function mockRekor(): { rekor: RekorClient; submitted: DsseEnvelope[] } {
  const submitted: DsseEnvelope[] = [];
  const rekor: RekorClient = {
    submitIntoto: vi.fn(async (envelope: DsseEnvelope) => {
      submitted.push(envelope);
      const payloadBytes = base64ToBytes(envelope.payload);
      const body = utf8ToBytes(
        JSON.stringify({
          apiVersion: '0.0.2',
          kind: 'intoto',
          spec: { content: { payloadHash: { algorithm: 'sha256', value: sha256Hex(payloadBytes) } } },
        }),
      );
      const entry: RekorEntryResponse = {
        uuid: '1'.repeat(80),
        logIndex: 7,
        integratedTime: Math.floor(Date.now() / 1000),
        logID: 'log',
        body: bytesToBase64(body),
        attestation: { data: bytesToBase64(payloadBytes) },
        verification: {
          inclusionProof: {
            checkpoint: '',
            hashes: [],
            logIndex: 0,
            rootHash: bytesToHex(hashLeaf(body)),
            treeSize: 1,
          },
          signedEntryTimestamp: 'set',
        },
      };
      return entry;
    }),
    getEntry: vi.fn(),
    getLogInfo: vi.fn(),
    getConsistencyProof: vi.fn(),
  };
  return { rekor, submitted };
}

function makeSession(rekor: RekorClient) {
  const session = new BindSession('cynarlab', true, {
    checkGist: vi.fn(async () => gistEvidence(session.nonce)),
    runScan: vi.fn(async () => SCAN_RESULT),
    rekor,
  });
  return session;
}

describe('BindSession', () => {
  it('generates a nonce in the gist format', () => {
    const session = makeSession(mockRekor().rekor);
    expect(session.nonce).toMatch(/^zkm-cynarlab-[a-z2-7]{32}$/);
  });

  it('runs the full flow: scan → statement → sign → submit → verified outputs', async () => {
    const { rekor, submitted } = mockRekor();
    const session = makeSession(rekor);
    const outputs = await session.scanAndSubmit(() => {});

    // The submitted envelope's payload is the canonical statement in the bundle.
    expect(submitted).toHaveLength(1);
    const payloadHex = bytesToHex(base64ToBytes(submitted[0]!.payload));
    expect(outputs.bundle.statement).toBe(payloadHex);

    // Statement carries what the scan disclosed.
    const statement = JSON.parse(
      new TextDecoder().decode(hexToBytes(outputs.bundle.statement)),
    ) as { predicate: Record<string, unknown>; subject: Array<{ name: string }> };
    expect(statement.subject[0]!.name).toBe('github.com/cynarlab');
    expect(statement.predicate['unique_identifier']).toBe('uid-12345');
    expect(statement.predicate['issuing_country']).toBe('CAN');

    expect(outputs.rekorUuid).toBe('1'.repeat(80));
    expect(outputs.badgeSvg).toContain('<svg');
    expect(outputs.badgeMarkdown).toContain('https://passportsign.dev/badge/cynarlab.svg');
    expect(outputs.badgeMarkdown).toContain('https://passportsign.dev/verify/cynarlab');
    const index = JSON.parse(outputs.indexJson) as {
      github_username: string;
      bindings: Array<{ rekor_entry_hash: string }>;
    };
    expect(index.github_username).toBe('cynarlab');
    expect(index.bindings[0]!.rekor_entry_hash).toBe('1'.repeat(80));
  });

  it('rejects when the returned entry has a bogus inclusion proof', async () => {
    const { rekor } = mockRekor();
    const original = rekor.submitIntoto;
    rekor.submitIntoto = vi.fn(async (envelope: DsseEnvelope) => {
      const entry = await original(envelope);
      entry.verification.inclusionProof.rootHash = 'f'.repeat(64);
      return entry;
    });
    const session = makeSession(rekor);
    await expect(session.scanAndSubmit(() => {})).rejects.toThrow(/inclusion/i);
  });

  it('propagates gist-check failures with the spec error code', async () => {
    const session = new BindSession('cynarlab', false, {
      checkGist: vi.fn(async () => {
        const { PassportsignError } = await import('@passportsign/core/web');
        throw new PassportsignError('gist_wrong_content', 'mismatch');
      }),
      runScan: vi.fn(async () => SCAN_RESULT),
      rekor: mockRekor().rekor,
    });
    await expect(session.checkGist()).rejects.toMatchObject({ code: 'gist_wrong_content' });
  });

  it('omits country from the statement when disclosure is off', async () => {
    const { rekor } = mockRekor();
    const session = new BindSession('cynarlab', false, {
      checkGist: vi.fn(async () => gistEvidence(session.nonce)),
      runScan: vi.fn(async () => ({ ...SCAN_RESULT, issuing_country: null })),
      rekor,
    });
    const outputs = await session.scanAndSubmit(() => {});
    const statement = JSON.parse(
      new TextDecoder().decode(hexToBytes(outputs.bundle.statement)),
    ) as { predicate: Record<string, unknown> };
    expect(statement.predicate['issuing_country']).toBeNull();
    expect(statement.predicate['disclosure_level']).toBe('personhood');
  });
});
