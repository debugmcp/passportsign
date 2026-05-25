# Days 3-4 plan — GitHub gist + SQLite + error mapping + bind orchestrator

After Days 1-2 we have offline primitives (canonical bytes, in-toto
statement, bundle). Days 3-4 add the rest of the bind flow that runs
*before* Rekor submission: the GitHub gist control check, the local
cache, the §4 error vocabulary, and an injectable orchestrator that
glues the SDK + gist + cache together.

Rekor still doesn't enter the picture until Day 5. The orchestrator
will return a structured "ready-to-submit" object that Day 5 turns
into an actual log entry + bundle.

---

## Files to create

```
packages/core/
├── src/
│   ├── errors.ts                 §4 error_code enum + PassportsignError
│   ├── nonce.ts                  cryptographically-random base32 nonce
│   ├── github.ts                 gist control check
│   ├── storage/
│   │   └── sqlite.ts             cache mirroring spec §5 (minus pending)
│   └── bind.ts                   orchestrator (SDK + gist + cache, no Rekor)
└── test/
    ├── errors.test.ts
    ├── nonce.test.ts
    ├── github.test.ts            mocked fetch
    ├── storage/
    │   └── sqlite.test.ts
    └── bind.test.ts              mocked SDK + mocked fetch + temp SQLite
```

No new runtime deps. `better-sqlite3` already pinned; `@noble/hashes`
already transitively present (via SDK) — we can use Node's built-in
`crypto` instead to avoid adding it as a direct dep.

## What each module exposes

### `errors.ts` — §4 error vocabulary

```ts
export const ERROR_CODES = [
  'username_invalid',
  'binding_pending_expired',
  'gist_not_found',
  'gist_wrong_content',
  'gist_wrong_owner',
  'gist_predates_init',
  'proof_invalid',
  'proof_scope_mismatch',
  'proof_missing_personhood',
  'log_submission_failed',
  'internal_error',
] as const;

export type ErrorCode = typeof ERROR_CODES[number];

export class PassportsignError extends Error {
  readonly code: ErrorCode;
  readonly cause?: unknown;
  constructor(code: ErrorCode, message: string, cause?: unknown);
}
```

Spec §4 verbatim, plus a typed exception class so callers can
`catch (e) { if (e instanceof PassportsignError && e.code === 'gist_not_found') ... }`.

### `nonce.ts` — binding nonce

```ts
/** 160-bit base32 nonce, gist-friendly: `zkm-<username>-<base32>`.
 *  Matches spec §3 step 1 (≥128 bits, base32 or base58, namespaced). */
export function generateNonce(username: string): string;
```

Uses Node's `crypto.randomBytes(20)` + RFC 4648 base32 (lowercase, no
padding). 20 bytes = 32 base32 chars. Total format:
`zkm-johnf-abcdefghijklmnopqrstuvwxyz234567`.

(Spec uses `zkm-` prefix as a holdover from zkmaintainer; staying with
that prefix means existing gist files don't need rename if anyone
already created them. The spec doc's example will be updated when we
hit the broader naming review in v0.5 if needed.)

### `github.ts` — gist control check

```ts
export interface GistEvidence {
  url: string;              // gist html_url
  content_sha256: string;   // lowercase hex
  updated_at: string;       // ISO 8601 from the gist API
}

export interface CheckGistOptions {
  username: string;
  expected_filename: string;  // "passportsign.txt"
  expected_content: string;   // exact nonce, no trimming
  not_before: Date;           // init timestamp
  token?: string;             // optional, for rate limits
  fetch?: typeof fetch;       // dependency-injection for tests
  baseUrl?: string;           // defaults to https://api.github.com
}

/** Throws PassportsignError with the matching §4 code on any failure. */
export async function checkGistControl(opts: CheckGistOptions): Promise<GistEvidence>;
```

Behavior:
- `GET /users/{username}/gists?per_page=100` then filter for filename match;
  if none found → `gist_not_found`.
- For matched gist, `GET /gists/{id}` to read content.
- Owner check: `gist.owner.login === username` (case-insensitive per
  spec §10 row 7) else `gist_wrong_owner`.
- Content exact match (no trim) else `gist_wrong_content`.
- `gist.updated_at < not_before` → `gist_predates_init`.
- 404 on `/users/{username}/gists` → `username_invalid`.
- Anything else 5xx-ish → `internal_error`.
- Token forwarded as `Authorization: Bearer <token>` *only* for rate
  limit headroom — documented as zero-special-access in module
  comments and README.

Tests mock `fetch` with deterministic responses covering each failure
mode plus the happy path.

### `storage/sqlite.ts` — local cache

```ts
export interface BindingRow {
  github_username: string;       // primary key, lowercase per spec §10 row 7
  unique_identifier: string;
  issuing_country: string | null;
  disclosure_level: 'personhood' | 'personhood+country';
  scope: string;
  zkpassport_sdk_ver: string;
  proof_blob: Uint8Array;
  gist_url: string;
  gist_content_sha256: string;
  bound_at: string;              // ISO 8601, local cache only
  log_entry_hash: string;
  log_inclusion_proof: unknown;  // JSON
  log_root_at_submission: string;
  last_checked_at: string;       // ISO 8601
  status: 'active' | 'stale' | 'revoked';
}

export interface PassportsignCache {
  upsertBinding(row: BindingRow): void;
  getByUsername(username: string): BindingRow | null;
  getByUniqueIdentifier(uid: string): BindingRow[];
  setStatus(username: string, status: BindingRow['status']): void;
  setLastChecked(username: string, when: Date): void;
  close(): void;
}

export function openCache(path: string): PassportsignCache;
```

Schema mirrors spec §5 minus `pending_bindings`. Uses `better-sqlite3`
sync API. Username normalized lowercase on insert/read (spec §10 row 7).
Migration is a single `CREATE TABLE IF NOT EXISTS` for v0; we'll add a
proper migration framework when we need v2.

Tests use temp paths from `os.tmpdir()` and clean up after each.

### `bind.ts` — orchestrator (no Rekor yet)

```ts
export interface BindFlowInput {
  github_username: string;
  disclose_country: boolean;
  proof: ProofResult;        // from SDK callback (real or mocked)
  unique_identifier: string;
  issuing_country: string | null;
  nonce: string;
  scope: string;
  zkpassport_sdk_version: string;
}

export interface BindFlowDeps {
  github?: typeof checkGistControl;
  now?: () => Date;
}

export interface PreparedBinding {
  statement: PassportsignStatement;     // from statement.ts
  statement_canonical: Uint8Array;       // from canonical.ts
  statement_sha256_hex: string;
  proof_blob_b64: string;
  proof_blob_sha256_hex: string;
  gist: GistEvidence;
}

/** Runs the parts of §3 we own at this layer: gist check, then statement
 *  build + hash. Throws PassportsignError on the matching §4 path. */
export async function prepareBinding(
  input: BindFlowInput,
  init: { issuedAt: Date },
  deps?: BindFlowDeps,
): Promise<PreparedBinding>;
```

`prepareBinding` is the unit Day 5 will hand off to a Rekor submission
function. It deliberately does **not** touch the SDK directly — the
SDK proof comes in as data. The Day 0 CLI's `day0.ts` is the producer
of that proof; the new `passportsign bind` CLI command (built later)
chains: SDK → prepareBinding → Rekor submit → bundle write.

This is the layer where mocking actually lands cleanly: tests inject a
fake proof + a mocked `checkGistControl` and assert the resulting
`PreparedBinding` shape, error codes, etc.

## Test strategy

- **errors / nonce / sqlite**: pure unit tests, deterministic.
- **github**: dependency-injected `fetch`. Spec each §4 failure path
  with a canned response and assert the right `PassportsignError.code`.
  Eleven happy/sad combinations.
- **bind**: inject mocked github + a fake `ProofResult` + a `now()`
  override. Assert structured output and error mapping. No SDK, no
  file I/O.
- **cli wiring**: deferred to Day 5 (when the bind command also needs
  Rekor). For now CLI tests stay at `--passWithNoTests`.

## Acceptance for Days 3-4

- All §4 `error_code` values are exhaustively typed and each has at
  least one test that triggers it (across `github.ts` and `bind.ts`).
- `pnpm -r run test` and `pnpm -r run typecheck` green.
- New modules re-exported from `packages/core/src/index.ts`.
- Spec §3 step 5's first two checks ("gist exists with right
  content/owner/freshness" and "proof scope matches") are implemented
  and unit-tested. The third ("idempotency lookup against the local
  cache") is covered by storage tests.

## Order I'll execute in

1. `errors.ts` + tests (smallest, dependency for everything else)
2. `nonce.ts` + tests (small, independent)
3. `github.ts` + tests (largest single module; mock-fetch driven)
4. `storage/sqlite.ts` + tests (independent of others)
5. `bind.ts` + tests (depends on github + statement + canonical)
6. Re-export from `index.ts`; workspace `typecheck` and `test` green
7. Commit

Estimated ~4-5 hours of focused work, same as Days 1-2.
