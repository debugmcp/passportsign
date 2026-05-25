/**
 * Rekor client for in-toto v0.0.2 entries.
 *
 * Behavior pinned from the Day 5 smoke test against
 * `rekor.sigstore.dev` (see docs/v0-acceptance.md Day 5 evidence).
 * The most non-obvious bits live in `buildIntotoEntryBody` below.
 *
 * All HTTP failures surface as
 * `PassportsignError('log_submission_failed', …)` to match spec §4.
 */

import { createHash } from 'node:crypto';

import { canonicalize } from '../canonical.js';
import { type DsseEnvelope } from '../dsse.js';
import { PassportsignError } from '../errors.js';

export interface InclusionProof {
  checkpoint: string;
  hashes: string[];
  logIndex: number;
  rootHash: string;
  treeSize: number;
}

export interface RekorEntryResponse {
  uuid: string;
  logIndex: number;
  integratedTime: number;
  logID: string;
  /** base64-encoded canonicalised entry body the server stored. */
  body: string;
  /** Optional server-stored attestation (base64). */
  attestation?: { data?: string } | undefined;
  verification: {
    inclusionProof: InclusionProof;
    /** Rekor's signed timestamp over the entry (base64). */
    signedEntryTimestamp: string;
  };
}

export interface RekorLogInfo {
  /** Hex-encoded current root hash of the active tree. */
  rootHash: string;
  /** Number of entries currently in the active tree. */
  treeSize: number;
  /** Signed tree head (Rekor's signature over the current root + size). */
  signedTreeHead: string;
  /** Active tree ID (string per Rekor's API). */
  treeID: string;
}

export interface RekorConsistencyProof {
  /** Hex hashes proving treeSize=first is a prefix of treeSize=last. */
  hashes: string[];
  /** Hex root hash at the new size (informational; we verify against our own captured one). */
  rootHash: string;
}

export interface RekorClient {
  submitIntoto(envelope: DsseEnvelope): Promise<RekorEntryResponse>;
  getEntry(uuid: string): Promise<RekorEntryResponse>;
  getLogInfo(): Promise<RekorLogInfo>;
  getConsistencyProof(firstSize: number, lastSize: number): Promise<RekorConsistencyProof>;
}

export interface PublicSigstoreRekorClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

export const DEFAULT_REKOR_BASE_URL = 'https://rekor.sigstore.dev';

export class PublicSigstoreRekorClient implements RekorClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: PublicSigstoreRekorClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? DEFAULT_REKOR_BASE_URL;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
  }

  async submitIntoto(envelope: DsseEnvelope): Promise<RekorEntryResponse> {
    const body = buildIntotoEntryBody(envelope);
    return this.postEntry(body);
  }

  async getEntry(uuid: string): Promise<RekorEntryResponse> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/v1/log/entries/${uuid}`);
    } catch (err) {
      throw new PassportsignError(
        'log_submission_failed',
        `Rekor get-entry request failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
    if (!response.ok) {
      let errBody = '';
      try { errBody = await response.text(); } catch { /* ignore */ }
      throw new PassportsignError(
        'log_submission_failed',
        `Rekor get-entry returned ${response.status}: ${errBody}`,
      );
    }
    return parseEntryResponse(await response.json().catch(() => null));
  }

  async getLogInfo(): Promise<RekorLogInfo> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/v1/log`);
    } catch (err) {
      throw new PassportsignError(
        'log_submission_failed',
        `Rekor log-info request failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
    if (!response.ok) {
      throw new PassportsignError(
        'log_submission_failed',
        `Rekor log-info returned ${response.status}`,
      );
    }
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      throw new PassportsignError('log_submission_failed', 'Rekor log-info returned non-object');
    }
    const rootHash = body['rootHash'];
    const treeSize = body['treeSize'];
    const signedTreeHead = body['signedTreeHead'];
    const treeID = body['treeID'];
    if (
      typeof rootHash !== 'string' ||
      typeof treeSize !== 'number' ||
      typeof signedTreeHead !== 'string' ||
      typeof treeID !== 'string'
    ) {
      throw new PassportsignError('log_submission_failed', 'Rekor log-info missing required fields');
    }
    return { rootHash, treeSize, signedTreeHead, treeID };
  }

  async getConsistencyProof(firstSize: number, lastSize: number): Promise<RekorConsistencyProof> {
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.baseUrl}/api/v1/log/proof?firstSize=${firstSize}&lastSize=${lastSize}`,
      );
    } catch (err) {
      throw new PassportsignError(
        'log_submission_failed',
        `Rekor consistency-proof request failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
    if (!response.ok) {
      throw new PassportsignError(
        'log_submission_failed',
        `Rekor consistency-proof returned ${response.status}`,
      );
    }
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      throw new PassportsignError(
        'log_submission_failed',
        'Rekor consistency-proof returned non-object',
      );
    }
    const hashes = body['hashes'];
    const rootHash = body['rootHash'];
    if (!Array.isArray(hashes) || !hashes.every((h) => typeof h === 'string')) {
      throw new PassportsignError(
        'log_submission_failed',
        'Rekor consistency-proof has no hashes array',
      );
    }
    if (typeof rootHash !== 'string') {
      throw new PassportsignError(
        'log_submission_failed',
        'Rekor consistency-proof has no rootHash',
      );
    }
    return { hashes: hashes as string[], rootHash };
  }

  private async postEntry(body: unknown): Promise<RekorEntryResponse> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/v1/log/entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new PassportsignError(
        'log_submission_failed',
        `Rekor submit request failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
    if (!response.ok) {
      let errBody = '';
      try { errBody = await response.text(); } catch { /* ignore */ }
      throw new PassportsignError(
        'log_submission_failed',
        `Rekor submit returned ${response.status}: ${errBody}`,
      );
    }
    return parseEntryResponse(await response.json().catch(() => null));
  }
}

/**
 * Build the Rekor in-toto v0.0.2 entry submission body from a
 * DSSE envelope. Encoding quirks pinned during the Day 5 smoke test:
 *
 * - `payload` and `sig` are **double-base64** at the API boundary
 *   (Rekor's go-openapi `strfmt.Base64` re-encodes the already-base64
 *   DSSE strings).
 * - `publicKey` is **single-base64** over the PEM bytes (raw PEM text).
 * - `keyid` is **omitted entirely** if empty — sending `""` causes the
 *   server's canonicalised entry to differ from the client's and the
 *   submission fails with "error generating canonicalized entry".
 * - `hash` and `payloadHash` are **required despite the readOnly
 *   schema markers**. The server compares them to its own computation
 *   and rejects the submission on mismatch.
 *
 * @internal exported for direct testing.
 */
export function buildIntotoEntryBody(envelope: DsseEnvelope): unknown {
  if (envelope.signatures.length === 0) {
    throw new PassportsignError(
      'log_submission_failed',
      'envelope must have at least one signature',
    );
  }
  const sig0 = envelope.signatures[0]!;

  // payloadHash = sha256 of raw payload bytes.
  const payloadBytes = new Uint8Array(Buffer.from(envelope.payload, 'base64'));
  const payloadHashHex = createHash('sha256').update(payloadBytes).digest('hex');

  // envelopeHash = sha256 of canonical JSON of {payloadType, payload-base64,
  // signatures:[{sig-base64, publicKey: PEM-string [, keyid]}]} — note
  // publicKey is the raw PEM string for this hash (not base64).
  const sigForHash: Record<string, string> = {
    sig: sig0.sig,
    publicKey: sig0.publicKey,
  };
  if (sig0.keyid && sig0.keyid.length > 0) {
    sigForHash['keyid'] = sig0.keyid;
  }
  const envelopeForHash = {
    payloadType: envelope.payloadType,
    payload: envelope.payload,
    signatures: [sigForHash],
  };
  const envelopeHashHex = createHash('sha256')
    .update(canonicalize(envelopeForHash))
    .digest('hex');

  // Build the actual submission body.
  const sigItem: Record<string, string> = {
    sig: Buffer.from(sig0.sig).toString('base64'),
    publicKey: Buffer.from(sig0.publicKey).toString('base64'),
  };
  if (sig0.keyid && sig0.keyid.length > 0) {
    sigItem['keyid'] = sig0.keyid;
  }

  return {
    apiVersion: '0.0.2',
    kind: 'intoto',
    spec: {
      content: {
        envelope: {
          payloadType: envelope.payloadType,
          payload: Buffer.from(envelope.payload).toString('base64'),
          signatures: [sigItem],
        },
        hash: { algorithm: 'sha256', value: envelopeHashHex },
        payloadHash: { algorithm: 'sha256', value: payloadHashHex },
      },
    },
  };
}

function parseEntryResponse(raw: unknown): RekorEntryResponse {
  if (typeof raw !== 'object' || raw === null) {
    throw new PassportsignError(
      'log_submission_failed',
      'malformed Rekor response (not a JSON object)',
    );
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length !== 1) {
    throw new PassportsignError(
      'log_submission_failed',
      `expected exactly one UUID in Rekor response, got ${entries.length}`,
    );
  }
  const [uuid, entryRaw] = entries[0]!;
  const entry = entryRaw as Record<string, unknown>;
  const verification = entry['verification'] as Record<string, unknown> | undefined;
  if (!verification) {
    throw new PassportsignError(
      'log_submission_failed',
      'Rekor response missing verification block',
    );
  }
  const inclusionProof = verification['inclusionProof'] as InclusionProof | undefined;
  const signedEntryTimestamp = verification['signedEntryTimestamp'] as string | undefined;
  if (!inclusionProof || typeof signedEntryTimestamp !== 'string') {
    throw new PassportsignError(
      'log_submission_failed',
      'Rekor response missing inclusionProof or signedEntryTimestamp',
    );
  }

  return {
    uuid,
    logIndex: entry['logIndex'] as number,
    integratedTime: entry['integratedTime'] as number,
    logID: entry['logID'] as string,
    body: entry['body'] as string,
    ...(entry['attestation']
      ? { attestation: entry['attestation'] as { data?: string } }
      : {}),
    verification: { inclusionProof, signedEntryTimestamp },
  };
}
