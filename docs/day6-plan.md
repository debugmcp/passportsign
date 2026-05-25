# Day 6 plan — Merkle proofs + bundle verifier + verify CLI

After Day 5 we can submit and assemble bundles. Day 6 builds the
**verifier** — the trust anchor for everyone who's not us. The whole
project's "skeptic doesn't have to trust passportsign.dev" claim rests
on this code working correctly.

The SDK proof-verification piece is deferred to Day 7 (it needs a
bundle-schema extension to carry the SDK inputs). Day 6 covers
everything else: structural integrity, Merkle inclusion, and
log-root consistency.

---

## Files to create / extend

```
packages/core/src/
├── merkle.ts            NEW — RFC 6962 inclusion + consistency
├── log/rekor.ts         EXTEND — getLogInfo, getConsistencyProof
└── verifier.ts          NEW — verifyBundle(bundle, deps) → result

packages/cli/src/
└── commands/
    └── verify.ts        NEW — `passportsign verify <bundle.json>`
```

## RFC 6962 Merkle in `merkle.ts`

- `hashLeaf(bytes): Uint8Array` = sha256(0x00 || bytes)
- `hashPair(left, right): Uint8Array` = sha256(0x01 || left || right)
- `verifyInclusion(leafHash, leafIndex, treeSize, proofHashes, rootHash): boolean`
- `verifyConsistency(firstSize, secondSize, firstRoot, secondRoot, proofHashes): boolean`

Algorithms ported from certificate-transparency-go's
`merkle/log_verifier.go` (the canonical reference for Rekor's tree
format). Inner-vs-border split, with bit-decomposition of leaf index
against tree size.

**Tests**: a handful of small synthetic trees (sizes 1, 4, 7, 23) with
hand-computed expected roots. Plus one round-trip test against the
real Day 5 smoke entry — fetch its inclusion proof, run our verifier,
confirm it matches the captured root.

## Rekor client extensions

- `getLogInfo(): Promise<LogInfo>` → `{ rootHash, treeSize, signedTreeHead }`
  via `GET /api/v1/log`
- `getConsistencyProof(firstSize, lastSize): Promise<{ hashes }>` via
  `GET /api/v1/log/proof?firstSize=N&lastSize=M`

Tests use mocked fetch.

## `verifier.ts`

```ts
export interface BundleVerifyResult {
  hash_match: 'pass' | 'fail';
  inclusion_proof: 'pass' | 'fail';
  root_consistency: 'pass' | 'fail' | 'skipped';
  sdk_proof: 'pending_day_7';      // becomes 'pass'|'fail' on Day 7
  overall: 'pass' | 'fail' | 'pending';
  errors: string[];
}

export interface VerifyBundleDeps {
  rekor?: RekorClient;             // omit → skip root_consistency
}

export async function verifyBundle(
  bundle: PassportsignBundle,
  deps?: VerifyBundleDeps,
): Promise<BundleVerifyResult>;
```

Checks performed:

1. **`hash_match`** — re-derive the canonical entry leaf hash from
   `bundle.statement` (the canonical bytes, hex-encoded). Recreate the
   Rekor entry body (we have the statement, but not the envelope; we
   reconstruct using a deterministic ephemeral key won't work — see
   note below). Actually: the bundle's `rekor.log_entry_hash` is the
   UUID, which IS the leaf-hash hex-prefixed by `108e9186...`. We hash
   the entry body and compare to the leaf-hash derivable from the UUID.

   *Pragmatic plan*: compute sha256 of `bundle.statement` bytes,
   compare to the `payloadHash` we'd find inside the recorded Rekor
   entry body. To get the body we'd need to re-fetch from Rekor (or
   store the original body in the bundle — TODO Day 7 schema
   extension). For Day 6, **fetch the entry via `rekor.getEntry()`**
   and compare its `payloadHash` to sha256 of `bundle.statement` bytes.
   This requires the rekor dep — `hash_match` becomes `'skipped'`
   without it.

2. **`inclusion_proof`** — run `verifyInclusion` with the leaf hash
   (sha256(0x00 || decoded base64 body)), the captured logIndex and
   treeSize, the captured hashes, and the captured rootHash. **No
   network needed** — pure function over the bundle's contents.

3. **`root_consistency`** — only if `rekor` dep is provided. Fetch
   `getLogInfo` for the current root + treeSize. Then
   `getConsistencyProof(bundle.rekor.captured.treeSize, current.treeSize)`.
   Run `verifyConsistency` to confirm the captured root is an
   ancestor of the current one. Skipped (not failed) when offline.

4. **`sdk_proof`** — `'pending_day_7'`. Day 7 expands the bundle to
   include the SDK proofs/originalQuery/queryResult, then this flips
   to `'pass'|'fail'`.

5. **`overall`** — `'pass'` if all enabled checks passed; `'pending'`
   if only failing check is `sdk_proof === 'pending_day_7'` and
   everything else passed; `'fail'` otherwise.

## CLI command

```
passportsign verify <bundle.json> [--no-rekor-refetch] [--gist-recheck]
```

- Default: read bundle, run all checks (uses public Sigstore Rekor)
- `--no-rekor-refetch`: skip the root_consistency check (purely
  offline)
- `--gist-recheck`: also re-fetch the gist URL captured in the bundle
  and confirm the content sha256 still matches (a liveness signal,
  not a security check — flagged in the output)

Output: structured "passed / failed / skipped" per check, then a
single-line summary. Non-zero exit on any fail.

## Tests

- merkle: synthetic trees + 1 real-world round-trip against the
  smoke-test entry.
- rekor extensions: mocked fetch happy + error paths.
- verifier: mocked rekor returning a known good entry; assert all
  pass. Then negative cases: wrong leaf hash, malformed inclusion
  proof, stale root.
- cli verify: minimal smoke (run the command on a fixture bundle).

## Acceptance for Day 6

- `pnpm -r run test` + `typecheck` green.
- Verifier round-trips correctly against the actual Day 5 smoke-test
  Rekor entry (live integration test, can be gated behind an env
  var so CI doesn't hit the network every time).
- CLI `passportsign verify` exits 0 on a good bundle and non-zero on
  a tampered one.

## Order

1. `merkle.ts` + tests
2. `rekor.ts` extensions + tests
3. `verifier.ts` + tests
4. `cli/commands/verify.ts` + wire into `cli/src/index.ts`
5. Live smoke against the Day 5 entry — confirm we can verify our own
   submission from scratch
6. Commit
