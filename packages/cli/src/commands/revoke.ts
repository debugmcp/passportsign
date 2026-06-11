/**
 * `passportsign revoke <github_username> [--entry <uuid>]`
 *
 * Revocation flow (spec §7, roadmap v0.5.2):
 *   1. Resolve target binding entries — from --entry, or by fetching
 *      the user's published passportsign-index.json
 *   2. Fetch each binding from Rekor and parse it (integrity-checked)
 *   3. Run the zkPassport scan (fresh proof from the same passport;
 *      no GitHub control needed — that's the recovery property)
 *   4. For each binding whose unique_identifier matches the scan,
 *      prepareRevocation → submitBinding → write revocation bundle
 *   5. Update the local passportsign-index.json and tell the user to
 *      commit it — without that, nobody learns of the revocation
 */

import { resolve } from 'node:path';

import {
  PassportsignError,
  PublicSigstoreRekorClient,
  fetchProfileIndex,
  packSdkPayload,
  parseIntotoEntry,
  prepareRevocation,
  submitBinding,
  writeBundle,
  type ParsedIntotoEntry,
} from '@passportsign/core';

import { updateIndexFileWithRevocation } from '../index-file.js';
import { SCOPE, ZKPASSPORT_SDK_VERSION, runSdkFlow } from '../sdk-flow.js';
import { header, spinner } from '../ui.js';

export interface RevokeOptions {
  /** Rekor entry UUID of a specific binding to revoke. */
  entry?: string;
}

export async function runRevokeCommand(
  githubUsername: string,
  opts: RevokeOptions = {},
): Promise<number> {
  console.log('passportsign revoke');
  console.log(`  github_username:   ${githubUsername}`);
  console.log('');
  console.log('A revocation needs only a fresh scan of the SAME passport that');
  console.log('made the binding — no GitHub access required. Note: anyone with');
  console.log('brief access to the passport can do this; harm is reversible by');
  console.log('re-binding (spec §7).');

  const rekor = new PublicSigstoreRekorClient();

  // --- Step 1: resolve target binding entry UUIDs ---
  header('Step 1/3 — Resolving bindings to revoke');
  let targetUuids: string[];
  if (opts.entry) {
    targetUuids = [opts.entry];
  } else {
    const indexSpinner = spinner(`Fetching published index for ${githubUsername}...`);
    let index;
    try {
      index = await fetchProfileIndex(githubUsername);
    } catch (err) {
      indexSpinner.fail(formatError(err));
      return 1;
    }
    if (!index || index.bindings.length === 0) {
      indexSpinner.fail(
        `No published index (or no bindings) found for ${githubUsername}. ` +
          `Expected: https://raw.githubusercontent.com/${githubUsername}/${githubUsername}/main/passportsign-index.json — ` +
          `or pass the binding's Rekor entry UUID with --entry.`,
      );
      return 1;
    }
    const alreadyRevoked = new Set(
      index.revocations.map((r) => r.revokes_rekor_entry_hash).filter(Boolean),
    );
    targetUuids = index.bindings
      .map((b) => b.rekor_entry_hash)
      .filter((uuid) => !alreadyRevoked.has(uuid));
    indexSpinner.succeed(
      `Found ${index.bindings.length} binding(s); ${targetUuids.length} not yet revoked.`,
    );
    if (targetUuids.length === 0) return 0;
  }

  const fetchSpinner = spinner('Fetching binding entries from Rekor...');
  const targets: ParsedIntotoEntry[] = [];
  for (const uuid of targetUuids) {
    try {
      const parsed = parseIntotoEntry(await rekor.getEntry(uuid));
      const subject = parsed.statement.subject[0]?.name;
      if (subject !== `github.com/${githubUsername}`) {
        fetchSpinner.fail(`Entry ${uuid.slice(0, 16)}… is for ${subject}, not ${githubUsername}.`);
        return 1;
      }
      targets.push(parsed);
    } catch (err) {
      fetchSpinner.fail(`Entry ${uuid.slice(0, 16)}…: ${formatError(err)}`);
      return 1;
    }
  }
  fetchSpinner.succeed(`Fetched ${targets.length} binding entr${targets.length === 1 ? 'y' : 'ies'}.`);

  // --- Step 2: fresh passport scan ---
  header('Step 2/3 — zkPassport scan (same passport as the binding)');
  console.log('');
  const sdk = await runSdkFlow(false);
  if (!sdk) return 1;

  const packed = packSdkPayload({
    sdk_version: ZKPASSPORT_SDK_VERSION,
    proofs: sdk.proofs,
    original_query: sdk.original_query,
    query_result: sdk.query_result,
    dev_mode: false,
  });

  // --- Step 3: submit one revocation entry per matching binding ---
  header('Step 3/3 — Submitting revocation(s) to public Sigstore Rekor');
  const revokedAt = new Date().toISOString();
  let submitted = 0;
  for (const target of targets) {
    const targetUid = (target.statement.predicate as Record<string, unknown>)[
      'unique_identifier'
    ];
    if (targetUid !== sdk.unique_identifier) {
      console.log(
        `! skipping ${target.uuid.slice(0, 16)}… — bound with a different passport ` +
          `(unique_identifier mismatch). Scan the passport that made this binding.`,
      );
      continue;
    }

    const submitSpinner = spinner(`Revoking ${target.uuid.slice(0, 16)}…`);
    try {
      const prepared = prepareRevocation({
        github_username: githubUsername,
        proof_blob_b64: packed.b64,
        unique_identifier: sdk.unique_identifier,
        revokes_rekor_entry_hash: target.uuid,
        scope: SCOPE,
        zkpassport_sdk_version: ZKPASSPORT_SDK_VERSION,
      });
      const { bundle, rekorEntry } = await submitBinding(prepared, { rekor });

      const bundlePath = resolve(
        process.cwd(),
        `revocation.${target.uuid.slice(0, 12)}.passportsign.json`,
      );
      writeBundle(bundlePath, bundle);
      updateIndexFileWithRevocation(process.cwd(), githubUsername, {
        rekor_entry_hash: rekorEntry.uuid,
        revokes_rekor_entry_hash: target.uuid,
        revoked_at: revokedAt,
      });
      submitSpinner.succeed(
        `Revoked ${target.uuid.slice(0, 16)}… → revocation entry ${rekorEntry.uuid.slice(0, 16)}… (bundle: ${bundlePath})`,
      );
      submitted += 1;
    } catch (err) {
      submitSpinner.fail(formatError(err));
      return 1;
    }
  }

  if (submitted === 0) {
    console.log('');
    console.log('No bindings were revoked (no unique_identifier matches).');
    return 1;
  }

  console.log('');
  console.log('────────────────────────────────────────────────');
  console.log('IMPORTANT: publish the updated index');
  console.log('────────────────────────────────────────────────');
  console.log('');
  console.log(`passportsign-index.json in this directory now lists the`);
  console.log(`revocation(s). Commit it to github.com/${githubUsername}/${githubUsername}`);
  console.log('(branch main) — badge services and `passportsign list` only');
  console.log('learn about revocations through that file. Until you push it,');
  console.log('your badge will still show as active.');

  return 0;
}

function formatError(err: unknown): string {
  if (err instanceof PassportsignError) {
    return `[${err.code}] ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}
