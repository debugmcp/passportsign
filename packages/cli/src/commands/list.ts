/**
 * `passportsign list <github_username> [--entry <uuid>] [--json]`
 *
 * Read-only introspection (roadmap v0.5.3): resolve the user's
 * published passportsign-index.json, fetch every referenced Rekor
 * entry, verify integrity + inclusion, classify state, and print.
 *
 * `--entry` inspects a specific Rekor entry without an index file —
 * the debugging tool for when bindings get weird.
 *
 * Same pipeline the hosted badge service runs; `--json` emits the raw
 * result for scripting.
 */

import {
  PassportsignError,
  PublicSigstoreRekorClient,
  addBinding,
  createProfileIndex,
  lookupBindings,
  lookupFromIndex,
  profileIndexUrl,
  type LookupResult,
} from '@passportsign/core';

import { spinner } from '../ui.js';

export interface ListOptions {
  /** Inspect one specific Rekor entry UUID instead of resolving the index. */
  entry?: string;
  json?: boolean;
}

export async function runListCommand(
  githubUsername: string,
  opts: ListOptions = {},
): Promise<number> {
  const rekor = new PublicSigstoreRekorClient();
  const lookupSpinner = opts.json ? null : spinner(`Resolving bindings for ${githubUsername}...`);

  let result: LookupResult;
  try {
    if (opts.entry) {
      const index = addBinding(createProfileIndex(githubUsername), {
        rekor_entry_hash: opts.entry,
        bound_at: new Date(0).toISOString(),
      });
      result = await lookupFromIndex(index, { rekor });
    } else {
      result = await lookupBindings(githubUsername, { rekor });
    }
  } catch (err) {
    const msg = err instanceof PassportsignError ? `[${err.code}] ${err.message}` : String(err);
    if (lookupSpinner) lookupSpinner.fail(msg);
    else console.error(msg);
    return 1;
  }

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return result.index === null ? 2 : 0;
  }

  if (result.index === null) {
    lookupSpinner!.fail(
      `${githubUsername} has not published a passportsign-index.json.\n` +
        `  Expected at: ${profileIndexUrl(githubUsername)}\n` +
        `  (Created by \`passportsign bind\`; commit it to the profile repo.)`,
    );
    return 2;
  }
  lookupSpinner!.succeed(
    `${result.classified.length} binding(s) for ${githubUsername}` +
      (opts.entry ? ' (direct entry inspection)' : ''),
  );

  console.log('');
  for (const { entry, state, revokedBy } of result.classified) {
    const predicate = entry.statement.predicate as Record<string, unknown>;
    const date = new Date(entry.integratedTime * 1000).toISOString().slice(0, 10);
    const country = typeof predicate['issuing_country'] === 'string'
      ? (predicate['issuing_country'] as string)
      : '—';
    const uid = String(predicate['unique_identifier'] ?? '');
    const marker = state === 'active' ? '✓' : state === 'stale' ? '~' : '✗';
    console.log(`${marker} ${state.toUpperCase().padEnd(8)} ${entry.uuid.slice(0, 16)}…`);
    console.log(`    bound:      ${date} (Rekor integratedTime)`);
    console.log(`    disclosure: ${String(predicate['disclosure_level'] ?? 'unknown')} (country: ${country})`);
    console.log(`    identifier: ${uid.slice(0, 24)}${uid.length > 24 ? '…' : ''}`);
    if (revokedBy) console.log(`    revoked by: ${revokedBy.slice(0, 16)}…`);
    console.log(`    entry:      https://rekor.sigstore.dev/api/v1/log/entries/${entry.uuid}`);
    console.log('');
  }

  // Accounts linked through the same passport are only visible across
  // *published indexes*; this command sees one user's index, so it can
  // only annotate duplicates within it.
  const byUid = new Map<string, number>();
  for (const { entry } of result.classified) {
    const uid = String((entry.statement.predicate as Record<string, unknown>)['unique_identifier'] ?? '');
    byUid.set(uid, (byUid.get(uid) ?? 0) + 1);
  }
  const linked = [...byUid.values()].filter((n) => n > 1);
  if (linked.length > 0) {
    console.log(`note: ${linked.length} identifier(s) appear on multiple bindings above (same passport).`);
  }

  for (const problem of result.unreachable) {
    console.log(`! unreachable: ${problem.uuid.slice(0, 16)}… — ${problem.error}`);
  }
  for (const problem of result.invalid) {
    console.log(`✗ INVALID: ${problem.uuid.slice(0, 16)}… — ${problem.error}`);
    console.log('  (listed in the index but failed verification — possibly hostile content)');
  }

  return result.invalid.length > 0 ? 1 : 0;
}
