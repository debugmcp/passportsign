/**
 * The `passportsign-index.json` convention (roadmap v0.5.5).
 *
 * Public Rekor cannot be searched by predicateType, so discovery of a
 * user's bindings flows through a JSON file the user publishes at the
 * root of their profile repo (`github.com/<user>/<user>`, branch
 * `main`). The file lists Rekor entry UUIDs for bindings *and*
 * revocations — revocations are discoverable only through this file,
 * which is why the schema carries them from version 1.
 *
 * The file is user-controlled: consumers (the `list` command, the
 * badge service) must sanity-check every referenced entry against the
 * log rather than trusting the file's contents.
 */

import { PassportsignError } from './errors.js';

export const PROFILE_INDEX_VERSION = 1 as const;
export const PROFILE_INDEX_FILENAME = 'passportsign-index.json' as const;

/** Rekor entry UUIDs are 80 hex chars (16-byte tree-ID prefix + 32-byte entry hash). */
const REKOR_UUID = /^[0-9a-f]{80}$/;

export interface ProfileIndexBinding {
  rekor_entry_hash: string;
  /** ISO 8601; display convenience only — Rekor's integratedTime is authoritative. */
  bound_at: string;
}

export interface ProfileIndexRevocation {
  rekor_entry_hash: string;
  /** UUID of the binding entry being revoked; absent = revokes all bindings for this user. */
  revokes_rekor_entry_hash?: string;
  /** ISO 8601; display convenience only. */
  revoked_at: string;
}

export interface ProfileIndex {
  version: typeof PROFILE_INDEX_VERSION;
  github_username: string;
  bindings: ProfileIndexBinding[];
  revocations: ProfileIndexRevocation[];
}

export class ProfileIndexValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileIndexValidationError';
  }
}

export function createProfileIndex(githubUsername: string): ProfileIndex {
  if (githubUsername.length === 0) {
    throw new TypeError('github_username: must be non-empty');
  }
  return {
    version: PROFILE_INDEX_VERSION,
    github_username: githubUsername,
    bindings: [],
    revocations: [],
  };
}

function fail(message: string): never {
  throw new ProfileIndexValidationError(message);
}

function assertRekorUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !REKOR_UUID.test(value)) {
    fail(`${field}: expected 80-char lowercase hex Rekor entry UUID, got ${JSON.stringify(value)}`);
  }
  return value;
}

function assertIsoDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    fail(`${field}: expected ISO 8601 timestamp, got ${JSON.stringify(value)}`);
  }
  return value;
}

export function validateProfileIndex(raw: unknown): ProfileIndex {
  if (typeof raw !== 'object' || raw === null) {
    fail('index must be a JSON object');
  }
  const obj = raw as Record<string, unknown>;
  if (obj['version'] !== PROFILE_INDEX_VERSION) {
    fail(`version: expected ${PROFILE_INDEX_VERSION}, got ${JSON.stringify(obj['version'])}`);
  }
  const username = obj['github_username'];
  if (typeof username !== 'string' || username.length === 0) {
    fail('github_username: must be a non-empty string');
  }
  const bindingsRaw = obj['bindings'];
  if (!Array.isArray(bindingsRaw)) {
    fail('bindings: must be an array');
  }
  const revocationsRaw = obj['revocations'];
  if (!Array.isArray(revocationsRaw)) {
    fail('revocations: must be an array');
  }

  const bindings: ProfileIndexBinding[] = bindingsRaw.map((b, i) => {
    if (typeof b !== 'object' || b === null) fail(`bindings[${i}]: must be an object`);
    const rec = b as Record<string, unknown>;
    return {
      rekor_entry_hash: assertRekorUuid(rec['rekor_entry_hash'], `bindings[${i}].rekor_entry_hash`),
      bound_at: assertIsoDate(rec['bound_at'], `bindings[${i}].bound_at`),
    };
  });

  const revocations: ProfileIndexRevocation[] = revocationsRaw.map((r, i) => {
    if (typeof r !== 'object' || r === null) fail(`revocations[${i}]: must be an object`);
    const rec = r as Record<string, unknown>;
    const out: ProfileIndexRevocation = {
      rekor_entry_hash: assertRekorUuid(
        rec['rekor_entry_hash'],
        `revocations[${i}].rekor_entry_hash`,
      ),
      revoked_at: assertIsoDate(rec['revoked_at'], `revocations[${i}].revoked_at`),
    };
    if (rec['revokes_rekor_entry_hash'] !== undefined) {
      out.revokes_rekor_entry_hash = assertRekorUuid(
        rec['revokes_rekor_entry_hash'],
        `revocations[${i}].revokes_rekor_entry_hash`,
      );
    }
    return out;
  });

  return { version: PROFILE_INDEX_VERSION, github_username: username, bindings, revocations };
}

/** Append a binding; no-op (keeping the existing record) if the UUID is already listed. */
export function addBinding(index: ProfileIndex, binding: ProfileIndexBinding): ProfileIndex {
  if (index.bindings.some((b) => b.rekor_entry_hash === binding.rekor_entry_hash)) {
    return index;
  }
  return { ...index, bindings: [...index.bindings, binding] };
}

/** Append a revocation; no-op if the UUID is already listed. */
export function addRevocation(
  index: ProfileIndex,
  revocation: ProfileIndexRevocation,
): ProfileIndex {
  if (index.revocations.some((r) => r.rekor_entry_hash === revocation.rekor_entry_hash)) {
    return index;
  }
  return { ...index, revocations: [...index.revocations, revocation] };
}

/**
 * Union two indexes for the same user (e.g. the user's own file plus
 * the operator overlay). Deduped by entry UUID; first occurrence wins.
 */
export function mergeProfileIndexes(a: ProfileIndex, b: ProfileIndex): ProfileIndex {
  if (a.github_username.toLowerCase() !== b.github_username.toLowerCase()) {
    fail(
      `cannot merge indexes for different users: ${a.github_username} vs ${b.github_username}`,
    );
  }
  let merged = a;
  for (const binding of b.bindings) merged = addBinding(merged, binding);
  for (const revocation of b.revocations) merged = addRevocation(merged, revocation);
  return merged;
}

export function profileIndexUrl(githubUsername: string): string {
  return `https://raw.githubusercontent.com/${githubUsername}/${githubUsername}/main/${PROFILE_INDEX_FILENAME}`;
}

export interface FetchProfileIndexOptions {
  fetch?: typeof fetch;
  /** Override the URL (e.g. the operator overlay); defaults to the profile-repo convention. */
  url?: string;
}

/**
 * Fetch and validate a user's published index.
 *
 * Returns `null` on 404 (the user hasn't published one — an expected
 * state, not an error). Malformed content throws
 * `ProfileIndexValidationError`; transport/HTTP failures throw
 * `PassportsignError('internal_error')`.
 */
export async function fetchProfileIndex(
  githubUsername: string,
  opts: FetchProfileIndexOptions = {},
): Promise<ProfileIndex | null> {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const url = opts.url ?? profileIndexUrl(githubUsername);

  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch (err) {
    throw new PassportsignError(
      'internal_error',
      `profile-index fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new PassportsignError(
      'internal_error',
      `profile-index fetch returned ${response.status} for ${url}`,
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    throw new ProfileIndexValidationError(
      `profile-index at ${url} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return validateProfileIndex(body);
}
