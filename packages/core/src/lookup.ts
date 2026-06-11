/**
 * Resolve a user's published bindings: index file → Rekor entries →
 * integrity + sanity checks → state classification.
 *
 * This is the shared read pipeline behind `passportsign list` and the
 * hosted badge service. The index file is user-controlled, so nothing
 * from it is trusted: every referenced entry is fetched from the log,
 * its attestation integrity-checked ({@link parseIntotoEntry}), its
 * inclusion proof verified, and its subject/predicateType checked
 * against what the index claimed it was.
 */

import {
  PASSPORTSIGN_PREDICATE_TYPE,
  PASSPORTSIGN_REVOCATION_PREDICATE_TYPE,
} from './statement.js';
import {
  classifyBindings,
  parseIntotoEntry,
  type ClassifiedBinding,
  type ParsedIntotoEntry,
} from './classify.js';
import { base64ToBytes, hexToBytes } from './encoding.js';
import { hashLeaf, verifyInclusion } from './merkle.js';
import { fetchProfileIndex, type ProfileIndex } from './profile-index.js';
import { type RekorClient, type RekorEntryResponse } from './log/rekor.js';

export interface LookupDeps {
  rekor: RekorClient;
  /** Epoch ms for staleness classification; defaults to the current time. */
  now?: number;
}

export interface LookupEntryProblem {
  uuid: string;
  error: string;
}

export interface LookupResult {
  index: ProfileIndex | null;
  classified: ClassifiedBinding[];
  /** Entries the log could not return (network, 404). */
  unreachable: LookupEntryProblem[];
  /** Entries that failed integrity or sanity checks — treat as hostile index content. */
  invalid: LookupEntryProblem[];
}

function verifyEntryInclusion(entry: RekorEntryResponse): boolean {
  const proof = entry.verification.inclusionProof;
  const leaf = hashLeaf(base64ToBytes(entry.body));
  return verifyInclusion(
    leaf,
    proof.logIndex,
    proof.treeSize,
    proof.hashes.map(hexToBytes),
    hexToBytes(proof.rootHash),
  );
}

interface FetchedSet {
  parsed: ParsedIntotoEntry[];
  unreachable: LookupEntryProblem[];
  invalid: LookupEntryProblem[];
}

async function fetchAndCheck(
  uuids: string[],
  expectedPredicateType: string,
  githubUsername: string,
  rekor: RekorClient,
): Promise<FetchedSet> {
  const out: FetchedSet = { parsed: [], unreachable: [], invalid: [] };
  const results = await Promise.allSettled(uuids.map((uuid) => rekor.getEntry(uuid)));

  results.forEach((result, i) => {
    const uuid = uuids[i]!;
    if (result.status === 'rejected') {
      const reason = result.reason;
      out.unreachable.push({
        uuid,
        error: reason instanceof Error ? reason.message : String(reason),
      });
      return;
    }
    try {
      const entry = result.value;
      if (!verifyEntryInclusion(entry)) {
        out.invalid.push({ uuid, error: 'inclusion proof does not verify' });
        return;
      }
      const parsed = parseIntotoEntry(entry);
      if (parsed.predicateType !== expectedPredicateType) {
        out.invalid.push({
          uuid,
          error: `predicateType ${parsed.predicateType} != expected ${expectedPredicateType}`,
        });
        return;
      }
      const subject = parsed.statement.subject[0]?.name ?? '';
      if (subject.toLowerCase() !== `github.com/${githubUsername}`.toLowerCase()) {
        out.invalid.push({
          uuid,
          error: `subject ${subject} does not match github.com/${githubUsername}`,
        });
        return;
      }
      out.parsed.push(parsed);
    } catch (err) {
      out.invalid.push({ uuid, error: err instanceof Error ? err.message : String(err) });
    }
  });

  return out;
}

/**
 * Run the lookup pipeline over an already-obtained index (e.g. the
 * user's file merged with an operator overlay).
 */
export async function lookupFromIndex(
  index: ProfileIndex,
  deps: LookupDeps,
): Promise<LookupResult> {
  const username = index.github_username;

  const [bindings, revocations] = await Promise.all([
    fetchAndCheck(
      index.bindings.map((b) => b.rekor_entry_hash),
      PASSPORTSIGN_PREDICATE_TYPE,
      username,
      deps.rekor,
    ),
    fetchAndCheck(
      index.revocations.map((r) => r.rekor_entry_hash),
      PASSPORTSIGN_REVOCATION_PREDICATE_TYPE,
      username,
      deps.rekor,
    ),
  ]);

  const classified = classifyBindings({
    bindings: bindings.parsed,
    revocations: revocations.parsed,
    ...(deps.now !== undefined ? { now: deps.now } : {}),
  });

  return {
    index,
    classified,
    unreachable: [...bindings.unreachable, ...revocations.unreachable],
    invalid: [...bindings.invalid, ...revocations.invalid],
  };
}

export interface LookupBindingsDeps extends LookupDeps {
  /** Injectable fetch for the index file request. */
  fetch?: typeof fetch;
}

/**
 * Fetch the user's published `passportsign-index.json` and resolve it.
 * `index: null` in the result means the user has not published one.
 */
export async function lookupBindings(
  githubUsername: string,
  deps: LookupBindingsDeps,
): Promise<LookupResult> {
  const index = await fetchProfileIndex(githubUsername, {
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });
  if (index === null) {
    return { index: null, classified: [], unreachable: [], invalid: [] };
  }
  return lookupFromIndex(index, deps);
}
