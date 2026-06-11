/**
 * The browser bind flow's state logic (roadmap v1.0.1), kept free of
 * DOM so it unit-tests in vitest. `main.ts` wires it to the page;
 * `sdk-adapter.ts` provides the real `runScan`.
 *
 * Mirrors the CLI's bind command step for step, with two differences:
 * signing uses WebCrypto (`signEnvelopeWeb`), and Rekor submission
 * goes straight from the browser (rekor.sigstore.dev sends CORS
 * headers — verified 2026-06-11). There is no server-side session
 * state anywhere: the nonce lives in this object, in this tab.
 *
 * The page verifies the returned entry's inclusion proof locally
 * before declaring success — the browser never takes Rekor's (or any
 * proxy's) word for it.
 */

import {
  IN_TOTO_PAYLOAD_TYPE,
  PassportsignError,
  assembleBundle,
  addBinding,
  base64ToBytes,
  checkGistControl,
  createProfileIndex,
  generateNonce,
  hashLeaf,
  hexToBytes,
  packSdkPayload,
  prepareBinding,
  renderBadgeSvg,
  signEnvelopeWeb,
  verifyInclusion,
  type GistEvidence,
  type PassportsignBundle,
  type RekorClient,
  type RekorEntryResponse,
} from '@passportsign/core/web';

export const DOMAIN = 'passportsign.dev';
export const SCOPE = `${DOMAIN}:nationality-disclose:1`;
export const ZKPASSPORT_SDK_VERSION = '0.15.1';
export const GIST_FILENAME = 'passportsign.txt';

export interface BindProgress {
  phase: 'scan' | 'prepare' | 'submit' | 'verify';
  message: string;
}

/** What the zkPassport scan hands back (see sdk-adapter.ts / cli's sdk-flow.ts). */
export interface SdkScanResult {
  proofs: unknown[];
  original_query: unknown;
  query_result: unknown;
  unique_identifier: string;
  issuing_country: string | null;
}

export interface BindSessionDeps {
  /** Drives the QR + phone round-trip. Throws or rejects on scan failure. */
  runScan: (
    discloseCountry: boolean,
    onProgress: (progress: BindProgress) => void,
  ) => Promise<SdkScanResult>;
  rekor: RekorClient;
  checkGist?: typeof checkGistControl;
  sign?: typeof signEnvelopeWeb;
  fetch?: typeof fetch;
  /** Optional GitHub token (rate-limit headroom only). */
  githubToken?: string;
}

export interface BindOutputs {
  bundle: PassportsignBundle;
  bundleJson: string;
  badgeSvg: string;
  badgeMarkdown: string;
  indexJson: string;
  rekorUuid: string;
  rekorUrl: string;
}

export class BindSession {
  readonly username: string;
  readonly discloseCountry: boolean;
  readonly nonce: string;
  readonly issuedAt: Date;
  private readonly deps: BindSessionDeps;
  private gist: GistEvidence | null = null;

  constructor(usernameRaw: string, discloseCountry: boolean, deps: BindSessionDeps) {
    this.username = usernameRaw.trim();
    if (this.username.length === 0) {
      throw new PassportsignError('username_invalid', 'username must be non-empty');
    }
    this.discloseCountry = discloseCountry;
    this.deps = deps;
    this.issuedAt = new Date();
    this.nonce = generateNonce(this.username);
  }

  /** Step 2: verify the user created the gist. Re-runnable until it passes. */
  async checkGist(tokenOverride?: string): Promise<GistEvidence> {
    const check = this.deps.checkGist ?? checkGistControl;
    const token = tokenOverride ?? this.deps.githubToken;
    this.gist = await check({
      username: this.username,
      expected_filename: GIST_FILENAME,
      expected_content: this.nonce,
      not_before: this.issuedAt,
      ...(token ? { token } : {}),
      ...(this.deps.fetch ? { fetch: this.deps.fetch } : {}),
    });
    return this.gist;
  }

  /** Steps 3–6: scan → canonical statement → sign → Rekor → local inclusion check. */
  async scanAndSubmit(onProgress: (progress: BindProgress) => void): Promise<BindOutputs> {
    onProgress({ phase: 'scan', message: 'Waiting for the phone…' });
    const scan = await this.deps.runScan(this.discloseCountry, onProgress);

    onProgress({ phase: 'prepare', message: 'Building the canonical statement…' });
    const packed = packSdkPayload({
      sdk_version: ZKPASSPORT_SDK_VERSION,
      proofs: scan.proofs,
      original_query: scan.original_query,
      query_result: scan.query_result,
      dev_mode: false,
    });
    const prepared = await prepareBinding(
      {
        github_username: this.username,
        proof_blob_b64: packed.b64,
        unique_identifier: scan.unique_identifier,
        issuing_country: this.discloseCountry ? scan.issuing_country : null,
        nonce: this.nonce,
        scope: SCOPE,
        zkpassport_sdk_version: ZKPASSPORT_SDK_VERSION,
      },
      { issuedAt: this.issuedAt },
      {
        ...(this.deps.checkGist ? { github: this.deps.checkGist } : {}),
        ...(this.deps.fetch ? { fetch: this.deps.fetch } : {}),
      },
    );

    onProgress({ phase: 'submit', message: 'Signing and submitting to public Sigstore Rekor…' });
    const sign = this.deps.sign ?? signEnvelopeWeb;
    const { envelope } = await sign(prepared.statement_canonical, IN_TOTO_PAYLOAD_TYPE);
    const entry = await this.deps.rekor.submitIntoto(envelope);

    onProgress({ phase: 'verify', message: 'Verifying the inclusion proof locally…' });
    assertEntryInclusion(entry);

    const bundle = assembleBundle(prepared, entry);
    return this.buildOutputs(bundle, entry, scan.issuing_country);
  }

  private buildOutputs(
    bundle: PassportsignBundle,
    entry: RekorEntryResponse,
    issuingCountry: string | null,
  ): BindOutputs {
    const username = this.username;
    const badgeSvg = renderBadgeSvg({
      github_username: username,
      issuing_country: this.discloseCountry ? issuingCountry : null,
      bound_at: this.issuedAt.toISOString(),
      log_entry_hash: entry.uuid,
    });
    // Web binders get the hosted live-state badge URL (CLI users get a static file).
    const badgeMarkdown = `[![passportsign verified](https://${DOMAIN}/badge/${username}.svg)](https://${DOMAIN}/verify/${username})`;
    const index = addBinding(createProfileIndex(username), {
      rekor_entry_hash: entry.uuid,
      bound_at: this.issuedAt.toISOString(),
    });
    return {
      bundle,
      bundleJson: `${JSON.stringify(bundle, null, 2)}\n`,
      badgeSvg,
      badgeMarkdown,
      indexJson: `${JSON.stringify(index, null, 2)}\n`,
      rekorUuid: entry.uuid,
      rekorUrl: `https://rekor.sigstore.dev/api/v1/log/entries/${entry.uuid}`,
    };
  }
}

function assertEntryInclusion(entry: RekorEntryResponse): void {
  const proof = entry.verification.inclusionProof;
  const ok = verifyInclusion(
    hashLeaf(base64ToBytes(entry.body)),
    proof.logIndex,
    proof.treeSize,
    proof.hashes.map(hexToBytes),
    hexToBytes(proof.rootHash),
  );
  if (!ok) {
    throw new PassportsignError(
      'log_submission_failed',
      'Rekor accepted the entry but its inclusion proof does not verify locally',
    );
  }
}
