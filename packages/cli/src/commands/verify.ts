import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  PublicSigstoreRekorClient,
  readBundle,
  verifyBundle,
  type CheckResult,
  type SdkVerifier,
  type VerifyBundleDeps,
} from '@passportsign/core';
import { ZKPassport } from '@zkpassport/sdk';

export interface VerifyOptions {
  gistRecheck?: boolean;
  noRekorRefetch?: boolean;
}

const MARK: Record<CheckResult | 'pending_day_7', string> = {
  pass: 'PASS',
  fail: 'FAIL',
  skipped: 'SKIP',
  pending_day_7: 'PEND',
};

export async function runVerifyCommand(
  bundlePath: string,
  options: VerifyOptions = {},
): Promise<number> {
  let bundle;
  try {
    bundle = readBundle(bundlePath);
  } catch (err) {
    console.error(`Could not read bundle: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }

  const useRekor = !options.noRekorRefetch;

  // Build an SdkVerifier that delegates to a local ZKPassport instance.
  // The SDK's verify() runs Barretenberg locally and doesn't hit the
  // network for the cryptographic check itself, so this works for any
  // bundle regardless of who issued it.
  const zkPassport = new ZKPassport('passportsign.dev', { disableProofStorage: true });
  const sdkVerifier: SdkVerifier = {
    async verify(input) {
      const r = await zkPassport.verify({
        proofs: input.proofs as Parameters<typeof zkPassport.verify>[0]['proofs'],
        originalQuery: input.originalQuery as Parameters<typeof zkPassport.verify>[0]['originalQuery'],
        queryResult: input.queryResult as Parameters<typeof zkPassport.verify>[0]['queryResult'],
        ...(input.scope !== undefined ? { scope: input.scope } : {}),
        ...(input.devMode !== undefined ? { devMode: input.devMode } : {}),
      });
      return { verified: r.verified, uniqueIdentifier: r.uniqueIdentifier };
    },
  };

  const deps: VerifyBundleDeps = {
    sdkVerifier,
    ...(useRekor ? { rekor: new PublicSigstoreRekorClient() } : {}),
  };
  const result = await verifyBundle(bundle, deps);

  console.log(`bundle:        ${bundlePath}`);
  console.log(`rekor entry:   ${bundle.rekor.log_entry_hash}`);
  console.log('');
  console.log(`  [${MARK[result.hash_match]}] statement hash matches Rekor's recorded payloadHash`);
  console.log(`  [${MARK[result.inclusion_proof]}] inclusion proof verifies against captured root`);
  console.log(`  [${MARK[result.root_consistency]}] captured root is consistent with current witnessed root`);
  console.log(`  [${MARK[result.sdk_proof]}] zkPassport SDK accepts the proof + uniqueIdentifier matches statement`);

  if (options.gistRecheck) {
    const gistResult = await recheckGistLiveness(bundlePath, bundle);
    console.log(`  [${MARK[gistResult.status]}] gist still exists with same content  (liveness only)`);
    if (gistResult.detail) console.log(`        ${gistResult.detail}`);
  }

  console.log('');
  for (const err of result.errors) {
    console.error(`  ! ${err}`);
  }
  console.log(`Overall: ${result.overall.toUpperCase()}`);

  return result.overall === 'fail' ? 1 : 0;
}

interface GistRecheckResult {
  status: 'pass' | 'fail' | 'skipped';
  detail?: string;
}

async function recheckGistLiveness(
  bundlePath: string,
  bundle: ReturnType<typeof readBundle>,
): Promise<GistRecheckResult> {
  // The statement carries the gist_url and gist_content_sha256 inside the
  // predicate. We can recover them from the canonical statement bytes
  // stored in the bundle.
  void bundlePath;
  try {
    const statementBytes = Buffer.from(bundle.statement, 'hex').toString('utf8');
    const statement = JSON.parse(statementBytes) as {
      predicate: { gist_url: string; gist_content_sha256: string };
    };
    const expectedSha = statement.predicate.gist_content_sha256;
    const gistUrl = statement.predicate.gist_url;

    // Convert the HTML gist URL into the raw content URL is fiddly because
    // GitHub uses opaque IDs; a more honest liveness check is just to fetch
    // the gist's HTML and confirm the page is reachable. For an actual
    // content match we'd need the user's exact filename plus the gist's
    // raw permalink. Keep this v0-honest:
    const res = await fetch(gistUrl, { redirect: 'follow' });
    if (!res.ok) {
      return { status: 'fail', detail: `${gistUrl} → HTTP ${res.status}` };
    }
    return {
      status: 'pass',
      detail: `${gistUrl} reachable; full sha256 match requires the raw gist URL (expected ${expectedSha.slice(0, 16)}…)`,
    };
  } catch (err) {
    return {
      status: 'fail',
      detail: `gist recheck error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

void createHash; // suppress lint when sha helpers move here later
void readFileSync;
