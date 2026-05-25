/**
 * `passportsign bind <github_username> [--country]`
 *
 * Full v0 binding flow:
 *   1. Generate nonce + prompt the user to create a public gist
 *   2. Verify GitHub gist control
 *   3. Run the zkPassport SDK (QR → mobile app → proofs)
 *   4. Pack SDK payload + prepareBinding (canonical statement)
 *   5. submitBinding (DSSE + Rekor)
 *   6. Write `binding.passportsign.json`
 *   7. Render + write `passportsign-badge.svg`
 *   8. Print the markdown snippet the user pastes into their profile README
 *
 * Errors at every step map to spec §4 error codes via PassportsignError
 * thrown from the underlying core functions.
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  PassportsignError,
  PublicSigstoreRekorClient,
  checkGistControl,
  generateNonce,
  packSdkPayload,
  prepareBinding,
  renderBadgeMarkdown,
  renderBadgeSvg,
  submitBinding,
  writeBundle,
  type SdkPayload,
} from '@passportsign/core';
import { ZKPassport } from '@zkpassport/sdk';

import { header, promptEnter, renderQr, spinner } from '../ui.js';

const DOMAIN = 'passportsign.dev';
const POLICY_ID = 'nationality-disclose';
const POLICY_VERSION = 1;
const SCOPE = `${DOMAIN}:${POLICY_ID}:${POLICY_VERSION}`;
const ZKPASSPORT_SDK_VERSION = '0.15.1';
const GIST_FILENAME = 'passportsign.txt';

export interface BindOptions {
  country?: boolean;
}

interface SdkResultPayload {
  proofs: unknown[];
  original_query: unknown;
  query_result: { nationality?: { disclose?: { result?: string } } };
  unique_identifier: string;
  verified: boolean;
  issuing_country: string | null;
}

export async function runBindCommand(
  githubUsername: string,
  opts: BindOptions = {},
): Promise<number> {
  console.log('passportsign bind');
  console.log(`  github_username:   ${githubUsername}`);
  console.log(`  disclose country:  ${opts.country ? 'yes' : 'no'}`);
  console.log(`  domain:            ${DOMAIN}`);
  console.log(`  scope:             ${SCOPE}`);

  const issuedAt = new Date();
  const nonce = generateNonce(githubUsername);

  // --- Step 1: gist instructions + wait for the user to create it ---
  header('Step 1/4 — GitHub gist control check');
  console.log('');
  console.log('Create a public GitHub gist with these exact details:');
  console.log(`  Filename:  ${GIST_FILENAME}`);
  console.log(`  Content:   ${nonce}`);
  console.log(`             (no trailing newline)`);
  console.log('');
  await promptEnter('Save the gist, then press Enter to continue...');

  const gistSpinner = spinner('Verifying gist...');
  try {
    await checkGistControl({
      username: githubUsername,
      expected_filename: GIST_FILENAME,
      expected_content: nonce,
      not_before: issuedAt,
    });
    gistSpinner.succeed('Gist verified.');
  } catch (err) {
    gistSpinner.fail(formatPassportsignError(err));
    return 1;
  }

  // --- Step 2: zkPassport SDK round-trip ---
  header('Step 2/4 — zkPassport scan');
  console.log('');
  const sdk = await runSdkFlow(opts.country ?? false);
  if (!sdk) return 1;

  // --- Step 3: prepareBinding (statement build) + submitBinding (Rekor) ---
  header('Step 3/4 — Submitting to public Sigstore Rekor');
  const packed = packSdkPayload({
    sdk_version: ZKPASSPORT_SDK_VERSION,
    proofs: sdk.proofs,
    original_query: sdk.original_query,
    query_result: sdk.query_result,
    dev_mode: false,
  });

  const submitSpinner = spinner('Preparing canonical statement...');
  let prepared;
  try {
    prepared = await prepareBinding(
      {
        github_username: githubUsername,
        proof_blob_b64: packed.b64,
        unique_identifier: sdk.unique_identifier,
        issuing_country: sdk.issuing_country,
        nonce,
        scope: SCOPE,
        zkpassport_sdk_version: ZKPASSPORT_SDK_VERSION,
      },
      { issuedAt },
    );
  } catch (err) {
    submitSpinner.fail(formatPassportsignError(err));
    return 1;
  }
  submitSpinner.text = 'Submitting to Rekor...';

  let bundle;
  let rekorEntry;
  try {
    const result = await submitBinding(prepared, {
      rekor: new PublicSigstoreRekorClient(),
    });
    bundle = result.bundle;
    rekorEntry = result.rekorEntry;
  } catch (err) {
    submitSpinner.fail(formatPassportsignError(err));
    return 1;
  }
  submitSpinner.succeed(`Rekor entry ${rekorEntry.uuid.slice(0, 16)}… (logIndex ${rekorEntry.logIndex})`);

  // --- Step 4: write bundle + badge ---
  header('Step 4/4 — Writing bundle + badge');
  const bundlePath = resolve(process.cwd(), 'binding.passportsign.json');
  const badgePath = resolve(process.cwd(), 'passportsign-badge.svg');

  writeBundle(bundlePath, bundle);
  const svg = renderBadgeSvg({
    github_username: githubUsername,
    issuing_country: sdk.issuing_country,
    bound_at: issuedAt.toISOString(),
    log_entry_hash: rekorEntry.uuid,
  });
  writeFileSync(badgePath, svg, 'utf8');

  console.log(`✓ bundle  → ${bundlePath}`);
  console.log(`✓ badge   → ${badgePath}`);

  // --- Success summary ---
  console.log('');
  console.log('Done.');
  console.log('');
  console.log('Embed in your GitHub profile README:');
  console.log('');
  const altSuffix = sdk.issuing_country
    ? ` · ${sdk.issuing_country} · ${issuedAt.toISOString().slice(0, 10)}`
    : ` · ${issuedAt.toISOString().slice(0, 10)}`;
  console.log(
    `  ${renderBadgeMarkdown({
      badge_path: './passportsign-badge.svg',
      log_entry_hash: rekorEntry.uuid,
      alt_text: `passportsign verified${altSuffix}`,
    })}`,
  );
  console.log('');
  console.log('Or verify the bundle directly:');
  console.log('  passportsign verify ./binding.passportsign.json');
  console.log('');
  console.log(`Public Rekor entry: https://rekor.sigstore.dev/api/v1/log/entries/${rekorEntry.uuid}`);

  return 0;
}

async function runSdkFlow(discloseCountry: boolean): Promise<SdkResultPayload | null> {
  const zkPassport = new ZKPassport(DOMAIN);
  const queryBuilder = await zkPassport.request({});
  const built = queryBuilder.policy(POLICY_ID).done();
  const { url, query, onRequestReceived, onGeneratingProof, onProofGenerated, onResult, onReject, onError } = built;

  console.log('Scan this QR with the ZKPassport mobile app:');
  console.log('');
  await renderQr(url);
  console.log('');
  console.log(`Or open this on the same device as the app:`);
  console.log(`  ${url}`);
  console.log('');

  const proofs: unknown[] = [];
  let resolved:
    | { uniqueIdentifier?: string | undefined; verified: boolean; result: unknown }
    | undefined;
  const sdkSpinner = spinner('Waiting for request to be received on phone...');

  const outcome = await new Promise<'result' | 'reject' | 'error' | 'timeout'>((resolve) => {
    const timeout = setTimeout(() => resolve('timeout'), 5 * 60 * 1000);

    onRequestReceived(() => {
      sdkSpinner.text = 'Request received on phone — user is reviewing...';
    });
    onGeneratingProof(() => {
      sdkSpinner.text = 'User accepted — generating proofs on phone...';
    });
    onProofGenerated((p) => {
      proofs.push(p);
      sdkSpinner.text = `Proof ${proofs.length} received — continuing...`;
    });
    onResult((r) => {
      clearTimeout(timeout);
      resolved = r;
      resolve('result');
    });
    onReject(() => {
      clearTimeout(timeout);
      resolve('reject');
    });
    onError(() => {
      clearTimeout(timeout);
      resolve('error');
    });
  });

  if (outcome === 'timeout') {
    sdkSpinner.fail('SDK timed out after 5 minutes.');
    return null;
  }
  if (outcome === 'reject') {
    sdkSpinner.fail('User rejected the request on phone.');
    return null;
  }
  if (outcome === 'error') {
    sdkSpinner.fail('SDK reported an error.');
    return null;
  }
  if (!resolved || !resolved.verified) {
    sdkSpinner.fail('SDK returned verified=false.');
    return null;
  }
  sdkSpinner.succeed(`Proof verified by SDK (${proofs.length} proofs).`);

  const result = resolved.result as { nationality?: { disclose?: { result?: string } } };
  const country = discloseCountry ? result.nationality?.disclose?.result ?? null : null;

  return {
    proofs,
    original_query: query,
    query_result: result,
    unique_identifier: resolved.uniqueIdentifier ?? '',
    verified: resolved.verified,
    issuing_country: country,
  };
}

function formatPassportsignError(err: unknown): string {
  if (err instanceof PassportsignError) {
    return `[${err.code}] ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}
