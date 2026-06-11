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
} from '@passportsign/core';

import { updateIndexFileWithBinding } from '../index-file.js';
import { DOMAIN, SCOPE, ZKPASSPORT_SDK_VERSION, runSdkFlow } from '../sdk-flow.js';
import { header, promptEnter, spinner } from '../ui.js';

const GIST_FILENAME = 'passportsign.txt';

export interface BindOptions {
  country?: boolean;
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

  let indexPath: string | null = null;
  try {
    indexPath = updateIndexFileWithBinding(process.cwd(), githubUsername, {
      rekor_entry_hash: rekorEntry.uuid,
      bound_at: issuedAt.toISOString(),
    }).path;
  } catch (err) {
    // The binding is already on the log — don't fail the whole command
    // over a local convenience file, but make the user fix it.
    console.error(`! could not update passportsign-index.json: ${formatPassportsignError(err)}`);
  }

  console.log(`✓ bundle  → ${bundlePath}`);
  console.log(`✓ badge   → ${badgePath}`);
  if (indexPath) console.log(`✓ index   → ${indexPath}`);

  // --- Success summary ---
  const dateStr = issuedAt.toISOString().slice(0, 10);
  const altSuffix = sdk.issuing_country
    ? ` · ${sdk.issuing_country} · ${dateStr}`
    : ` · ${dateStr}`;
  const altText = `passportsign verified${altSuffix}`;
  const rekorUrl = `https://rekor.sigstore.dev/api/v1/log/entries/${rekorEntry.uuid}`;

  console.log('');
  console.log('Done.');
  console.log('');
  console.log('────────────────────────────────────────────────');
  console.log('Showing off your binding');
  console.log('────────────────────────────────────────────────');
  console.log('');
  console.log(`The badge file (${badgePath}) is a static SVG with your`);
  console.log('username, country, and bind date already baked in. To use it:');
  console.log('');
  console.log(`1. Commit ${badgePath.split(/[\\/]/).pop()} AND passportsign-index.json to the`);
  console.log(`   root of your "profile repo" — github.com/${githubUsername}/${githubUsername}`);
  console.log(`   — which GitHub renders on your profile page.`);
  console.log('');
  console.log('   The index file is how badge services and `passportsign list`');
  console.log('   discover your binding (public Rekor is not searchable by');
  console.log('   predicate type). Without it, your badge cannot resolve.');
  console.log('');
  console.log('2. Paste this into the README of that repo:');
  console.log('');
  console.log(
    `     ${renderBadgeMarkdown({
      badge_path: './passportsign-badge.svg',
      log_entry_hash: rekorEntry.uuid,
      alt_text: altText,
    })}`,
  );
  console.log('');
  console.log('   If you want to reference it from a DIFFERENT repo,');
  console.log('   replace `./passportsign-badge.svg` with a raw URL like:');
  console.log(`     https://raw.githubusercontent.com/<owner>/<repo>/main/passportsign-badge.svg`);
  console.log('');
  console.log('Verify the bundle yourself (or send it to a skeptic):');
  console.log(`  npx @passportsign/cli verify ${bundlePath}`);
  console.log('');
  console.log(`Public Rekor entry: ${rekorUrl}`);

  return 0;
}

function formatPassportsignError(err: unknown): string {
  if (err instanceof PassportsignError) {
    return `[${err.code}] ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}
