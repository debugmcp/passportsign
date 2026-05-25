# Days 1–2 plan — canonical core

Build the security-critical foundation: a deterministic bytes-in /
bytes-out canonical serializer for in-toto statements, plus the
`binding.passportsign.json` bundle format. All offline, all unit-tested,
no SDK or network. After this lands, every downstream piece (Rekor
submission, verifier, rebuild-from-log) can be built against a stable
contract.

The pinned **test vectors** are the contract. Treat them like a database
schema — once committed, they can be added to but not silently changed.

---

## Files to create

```
packages/core/
├── src/
│   ├── canonical.ts       RFC 8785 JCS wrapper + drift detection
│   ├── statement.ts       in-toto Statement v1 builder + types
│   ├── bundle.ts          binding.passportsign.json read/write/validate
│   └── index.ts           re-export public API (expand existing stub)
└── test/
    ├── canonical.test.ts
    ├── statement.test.ts
    ├── bundle.test.ts
    └── fixtures/
        └── canonical-vectors.json   pinned input → bytes → sha256
```

No new dependencies beyond what's already pinned in `packages/core/package.json`
(`@truestamp/canonify` exact 1.0.3). Vitest is already configured at the workspace level.

## What each module exposes

### `canonical.ts` — RFC 8785 JCS

```ts
/** RFC 8785 JCS-canonical UTF-8 bytes for a JSON-serializable value. */
export function canonicalize(value: unknown): Uint8Array;

/** SHA-256 of canonicalize(value), hex-encoded. */
export function canonicalSha256Hex(value: unknown): string;
```

Implementation: thin wrapper around `@truestamp/canonify` (pinned
exact at 1.0.3) → UTF-8 encode → SHA-256 via Node's built-in `crypto`.

**Drift test (security-critical):** `canonical.test.ts` reads
`fixtures/canonical-vectors.json` and asserts byte-for-byte that
`canonicalize(vector.input)` matches `Buffer.from(vector.canonicalBytesHex, 'hex')`.
Any change in `@truestamp/canonify`'s output trips the test. Five
vectors at minimum:

1. Empty object `{}`
2. The example in-toto statement from spec §14
3. Statement with `issuing_country: null` (undisclosed)
4. Statement with Unicode in a string field (covers escape rules)
5. Statement with float / integer mixing in any numeric field

For each: `{ name, input, canonicalBytesHex, sha256Hex }`.

### `statement.ts` — in-toto Statement v1

Types and a builder that matches spec §14's "in-toto statement shape"
exactly:

```ts
export const PASSPORTSIGN_PREDICATE_TYPE =
  'https://passportsign.dev/personhood/v1';

export type DisclosureLevel = 'personhood' | 'personhood+country';

export interface PassportsignPredicate {
  unique_identifier: string;          // from zkPassport SDK
  issuing_country: string | null;     // ICAO 3-letter or null if undisclosed
  disclosure_level: DisclosureLevel;
  proof_blob_sha256: string;          // hex
  gist_url: string;
  gist_content_sha256: string;        // hex; also used as subject digest
  scope: string;                      // e.g. "passportsign.dev:johnf"
  zkpassport_sdk_version: string;
}

export interface PassportsignStatement {
  _type: 'https://in-toto.io/Statement/v1';
  subject: Array<{
    name: string;                     // "github.com/<username>"
    digest: { sha256: string };
  }>;
  predicateType: typeof PASSPORTSIGN_PREDICATE_TYPE;
  predicate: PassportsignPredicate;
}

export interface BuildStatementInput {
  github_username: string;
  unique_identifier: string;
  issuing_country: string | null;
  proof_blob_sha256: string;
  gist_url: string;
  gist_content_sha256: string;
  scope: string;
  zkpassport_sdk_version: string;
}

export function buildStatement(input: BuildStatementInput): PassportsignStatement;
```

**Key invariants enforced by `buildStatement`:**

- `subject[0].digest.sha256 === input.gist_content_sha256` (we tie the
  subject digest to the gist control evidence per the v0.4 spec).
- `disclosure_level` is derived: `null` country → `"personhood"`,
  non-null → `"personhood+country"`.
- All hex fields validated as lowercase 64-char hex; throw on bad input.
- No `bound_at` field (Rekor inclusion timestamp is authoritative).

Unit tests cover: happy path with country, happy path without country,
hex validation rejections (uppercase, wrong length, non-hex), and one
round-trip canonicalize→parse→compare check.

### `bundle.ts` — `binding.passportsign.json`

```ts
export const BUNDLE_FORMAT_VERSION = 1;

export interface RekorBundleFields {
  log_entry_hash: string;
  inclusion_proof: unknown;           // shape pinned in Day 5 when Rekor is real
  log_root_at_submission: string;
}

export interface PassportsignBundle {
  bundle_format_version: 1;
  statement: string;                  // canonical JCS bytes, hex-encoded
  proof_blob: string;                 // base64
  rekor: RekorBundleFields;
}

export function writeBundle(path: string, bundle: PassportsignBundle): void;
export function readBundle(path: string): PassportsignBundle;
export function validateBundle(value: unknown): asserts value is PassportsignBundle;
```

Implementation: JSON write/read via Node's `fs/promises` (sync versions
for CLI ergonomics). Schema validation is a hand-rolled type guard —
no extra dependency, ~30 lines, exhaustive over the fields. Throws with
a structured error indicating the offending path.

Unit tests: round-trip a fixture bundle through write→read, validation
rejects malformed bundles (wrong version, missing field, non-hex
statement, non-base64 proof, etc.).

### `index.ts` — public API

Re-export the named exports above. Replace the current stub.

## Subtasks

I'll add these to `TaskCreate` after this plan is approved:

1. Wire `canonical.ts` + drift fixture (~1 hr)
2. Wire `statement.ts` + builder + invariant tests (~1 hr)
3. Wire `bundle.ts` + round-trip tests (~1 hr)
4. Pin 5 canonical vectors in `fixtures/canonical-vectors.json` (~1 hr)
5. Vitest config tweak if needed (likely none) + green CI run (~30 min)

Total ~4–5 hours of focused work. Matches the "Days 1–2" budget in the
plan.

## What this is NOT

- **No Rekor interaction.** That's Day 5. Bundle's `rekor.inclusion_proof`
  shape stays `unknown` here; Day 5 narrows it once we've smoke-tested
  the public Sigstore Rekor response format.
- **No SDK calls.** Statement builder takes plain inputs.
- **No file I/O outside bundle.ts.** Canonical and statement are pure
  functions — they don't even touch the filesystem.
- **No CLI surface.** Days 3–4 wire these into a `passportsign bind`
  command; Days 1–2 are library-only.

## Acceptance for Days 1–2

- `pnpm test` green in `packages/core/` with vitest reporting all
  fixture vectors passing.
- `pnpm typecheck` green workspace-wide.
- 5+ canonical-JCS vectors committed and asserted byte-exact.
- Statement builder rejects all the malformed-hex shapes listed above
  with structured errors.
- Bundle round-trip green; validation rejects every documented
  malformation.

After Days 1–2 land, Days 3–4 (GitHub gist check + SQLite + error
mapping) can begin in parallel from a stable contract.
