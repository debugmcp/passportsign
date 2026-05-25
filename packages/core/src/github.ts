/**
 * GitHub gist control check per spec §3 step 5 and §14 "The gist control check."
 *
 * The honest semantic claim is: at the moment we checked, the named user
 * controlled a public gist with the expected filename and content. We
 * capture `html_url`, `updated_at`, and a SHA-256 of the content so the
 * evidence is independently re-checkable later (e.g. via the Wayback
 * Machine).
 *
 * The optional `token` is **purely for rate-limit headroom** — it
 * carries zero special access. Unauth'd: 60 req/hr; with token: 5000.
 */

import { createHash } from 'node:crypto';
import { PassportsignError } from './errors.js';

export interface GistEvidence {
  url: string;
  content_sha256: string;
  updated_at: string;
}

export interface CheckGistOptions {
  username: string;
  expected_filename: string;
  expected_content: string;
  not_before: Date;
  token?: string;
  fetch?: typeof fetch;
  baseUrl?: string;
}

interface GistFile {
  filename?: string;
  content?: string;
}

interface GistSummary {
  id: string;
  html_url: string;
  updated_at: string;
  owner?: { login?: string } | null;
  files: Record<string, GistFile>;
}

const DEFAULT_BASE_URL = 'https://api.github.com';
const GIST_LIST_PER_PAGE = 100;

function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function authHeaders(token: string | undefined): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'passportsign-cli',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function checkGistControl(opts: CheckGistOptions): Promise<GistEvidence> {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const headers = authHeaders(opts.token);

  if (opts.username.length === 0) {
    throw new PassportsignError('username_invalid', 'username must be non-empty');
  }

  // Step 1: list the user's gists, filter by filename.
  const listUrl = `${baseUrl}/users/${encodeURIComponent(opts.username)}/gists?per_page=${GIST_LIST_PER_PAGE}`;
  let listResponse: Response;
  try {
    listResponse = await fetchImpl(listUrl, { headers });
  } catch (err) {
    throw new PassportsignError(
      'internal_error',
      `GitHub list-gists request failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  if (listResponse.status === 404) {
    throw new PassportsignError(
      'username_invalid',
      `GitHub user '${opts.username}' not found`,
    );
  }
  if (!listResponse.ok) {
    throw new PassportsignError(
      'internal_error',
      `GitHub list-gists returned HTTP ${listResponse.status}`,
    );
  }

  let listBody: unknown;
  try {
    listBody = await listResponse.json();
  } catch (err) {
    throw new PassportsignError(
      'internal_error',
      'GitHub list-gists returned non-JSON',
      err,
    );
  }
  if (!Array.isArray(listBody)) {
    throw new PassportsignError(
      'internal_error',
      'GitHub list-gists did not return an array',
    );
  }

  const matches = (listBody as GistSummary[])
    .filter((g) => g && typeof g === 'object' && opts.expected_filename in (g.files ?? {}))
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));

  const match = matches[0];
  if (!match) {
    throw new PassportsignError(
      'gist_not_found',
      `no public gist owned by '${opts.username}' contains file '${opts.expected_filename}'`,
    );
  }

  // Step 2: re-fetch the gist by id to get the full content.
  let detailResponse: Response;
  try {
    detailResponse = await fetchImpl(`${baseUrl}/gists/${match.id}`, { headers });
  } catch (err) {
    throw new PassportsignError(
      'internal_error',
      `GitHub get-gist request failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }
  if (!detailResponse.ok) {
    throw new PassportsignError(
      'internal_error',
      `GitHub get-gist returned HTTP ${detailResponse.status}`,
    );
  }

  let detail: GistSummary;
  try {
    detail = (await detailResponse.json()) as GistSummary;
  } catch (err) {
    throw new PassportsignError('internal_error', 'GitHub get-gist returned non-JSON', err);
  }

  // Step 3: owner check (case-insensitive per spec §10 row 7).
  const ownerLogin = detail.owner?.login;
  if (!ownerLogin || ownerLogin.toLowerCase() !== opts.username.toLowerCase()) {
    throw new PassportsignError(
      'gist_wrong_owner',
      `gist ${match.id} owner '${ownerLogin ?? 'unknown'}' does not match expected '${opts.username}'`,
    );
  }

  // Step 4: content exact match.
  const file = (detail.files ?? {})[opts.expected_filename];
  const content = file?.content;
  if (typeof content !== 'string') {
    throw new PassportsignError(
      'gist_wrong_content',
      `gist ${match.id} has no readable content for '${opts.expected_filename}'`,
    );
  }
  if (content !== opts.expected_content) {
    throw new PassportsignError(
      'gist_wrong_content',
      `gist ${match.id} content does not exactly match the expected nonce`,
    );
  }

  // Step 5: freshness — gist's updated_at must be at/after init.
  const updatedAtMs = Date.parse(detail.updated_at);
  if (Number.isNaN(updatedAtMs)) {
    throw new PassportsignError(
      'internal_error',
      `gist ${match.id} updated_at is unparseable: ${detail.updated_at}`,
    );
  }
  if (updatedAtMs < opts.not_before.getTime()) {
    throw new PassportsignError(
      'gist_predates_init',
      `gist ${match.id} updated_at (${detail.updated_at}) predates init (${opts.not_before.toISOString()})`,
    );
  }

  return {
    url: detail.html_url,
    content_sha256: sha256Hex(content),
    updated_at: detail.updated_at,
  };
}
