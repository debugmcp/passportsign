# Day 7 plan — real-passport bind + SDK proof verification + badge

The last day. After this, v0 ships.

What ties together: the SDK proof verification (the `pending_day_7`
flag in the verifier becomes real), the full `passportsign bind`
command (chains everything we've built), the inline SVG badge so v0
users have a real GitHub-renderable artifact without needing a hosted
service, and the real-passport end-to-end walk that produces our
"living evidence" Rekor entry committed to the repo.

---

## Phase 1 — Pack/unpack SDK proof inputs (no bundle schema change)

The SDK's `verify()` method needs `{ proofs, originalQuery, queryResult }`
(plus optional scope/devMode). Today, `proof_blob` in the bundle is an
opaque base64 string. Re-purpose it as **canonical JSON of the SDK
inputs**, base64-encoded. The statement's `proof_blob_sha256` already
binds these bytes to the rest of the binding.

```ts
// packages/core/src/sdk-payload.ts
export interface SdkPayload {
  sdk_version: string;
  proofs: unknown[];
  original_query: unknown;
  query_result: unknown;
  dev_mode: boolean;
}

export function packSdkPayload(p: SdkPayload): { bytes: Uint8Array; b64: string; sha256Hex: string };
export function unpackSdkPayload(b64: string): SdkPayload;
```

This means no `bundle_format_version` bump — v0 bundles stay v1. The
verifier and bind command just learn how to read the bytes.

## Phase 2 — Flip `sdk_proof` in `verifier.ts`

Add an injectable `SdkVerifier` to `VerifyBundleDeps`:

```ts
export interface SdkVerifier {
  verify(input: {
    proofs: unknown[];
    originalQuery: unknown;
    queryResult: unknown;
    scope?: string;
    devMode?: boolean;
  }): Promise<{ verified: boolean; uniqueIdentifier: string | undefined }>;
}

export interface VerifyBundleDeps {
  rekor?: RekorClient;
  sdkVerifier?: SdkVerifier;
}
```

When provided, the verifier:

1. Unpacks `bundle.proof_blob` → SDK inputs.
2. Calls `sdkVerifier.verify({...})`.
3. Asserts `verified === true`.
4. Asserts the returned `uniqueIdentifier` equals the statement
   predicate's `unique_identifier`.

If not provided → `sdk_proof: 'skipped'` (the bundle is structurally
valid but we couldn't run the SDK).

The CLI's `verify` command instantiates a `ZKPassport(domain)` and
passes `(zkPassport.verify.bind(zkPassport))` as the verifier.

## Phase 3 — `passportsign bind` CLI command

Order of operations the user sees:

1. **Init.** Generate the nonce. Print the gist instructions:
   > Create a public GitHub gist named `passportsign.txt` with EXACTLY
   > this content (no trailing newline):
   >
   >   `zkm-johnf-…`
   >
   > Press Enter once it's saved.
2. **Gist check.** When the user presses Enter, run `checkGistControl`.
   If any §4 error code returns, print clearly, offer to retry.
3. **QR / SDK flow.** Wire the same Day-0 plumbing: render QR, await
   ZKPassport scan, collect proofs + result.
4. **Pack SDK payload.** Build the `SdkPayload` object, canonicalise,
   base64 — this is `proof_blob`.
5. **prepareBinding.** Re-uses the existing orchestrator (we just feed
   it the packed proof_blob and the SDK-derived `unique_identifier`
   and `issuing_country`).
6. **submitBinding.** DSSE + Rekor submit.
7. **Write bundle.** `binding.passportsign.json` next to where the
   command was run.
8. **Write badge.** `passportsign-badge.svg` next to the bundle.
9. **Print success.** Show the Rekor URL, the markdown snippet to
   embed the badge, and the bundle path.

Files:
- `packages/cli/src/ui.ts` — QR rendering, simple prompts, polling
  spinner.
- `packages/cli/src/commands/bind.ts` — orchestrator.
- `packages/cli/src/index.ts` — wire it up.

Replaces the standalone `day0.ts` prototype (its job is done).

## Phase 4 — Inline SVG badge

`packages/core/src/badge.ts`:

```ts
export interface BadgeInput {
  github_username: string;
  issuing_country: string | null;
  bound_at: string;                 // ISO 8601, for display
  log_entry_hash?: string;          // tooltip / hidden text
}

export function renderBadgeSvg(input: BadgeInput): string;
```

Output: a self-contained ~700-byte SVG, shields.io-style pill:

```
+----------------+--------------------------+
| passportsign   | verified human · CAN     |
+----------------+--------------------------+
```

Two-segment fixed-width rendering, hand-rolled (no external SVG lib).
Text widths estimated from char count (Verdana ~7px/char at the
chosen font size).

For the markdown link emitted by `bind`, point the badge at the Rekor
entry directly until v1's `/verify/<username>` is live:

```markdown
[![passportsign verified · CAN](./passportsign-badge.svg)](https://rekor.sigstore.dev/api/v1/log/entries/<uuid>)
```

User commits the SVG to their `johnf/johnf` profile repo, references
it from the README, and the badge renders on their profile.

## Phase 5 — Real-passport E2E walkthrough

This is the gated step. Order:

1. I scaffold + verify everything above with **mock SDK proofs**
   (using zkPassport dev-mode for unit tests).
2. I hand off to you with explicit "run this now, scan with phone"
   instructions.
3. You run `passportsign bind <your-username> --country` end-to-end
   against the production scope (`passportsign.dev:nationality-disclose:1`).
4. Bundle + badge written; Rekor entry hash captured.
5. I commit the **real-passport Rekor entry hash** as the closing
   line in `docs/v0-acceptance.md` — the permanent v0-shipped
   evidence per acceptance criterion #1.

## Phase 6 — Acceptance walkthrough

Once the bind succeeds, walk all six revised criteria in
`docs/v0-acceptance.md`:

1. CLI runs the full binding flow against a real passport, produces a
   bundle + Rekor entry. ← Phase 5.
2. Second machine, given only the bundle, independently verifies. ←
   run `passportsign verify ./binding.passportsign.json` on a
   different machine (or just delete local node_modules and
   re-install to simulate).
3. Third party reading Rekor identifies the entry by predicateType,
   runs SDK on the proof blob, confirms validity. ← uses verifier
   with `--no-rekor-refetch=false` so it fetches from Rekor; the SDK
   runs as part of the verifier.
4. `rebuild`. ← documented deferral, already in v0-acceptance.md
   (Day 5).
5. Test vectors pinned + verifier passes them. ← already green from
   Days 1-2.
6. README documents the bridge + network constraint. ← write the
   README content during Phase 6.

## Phase 7 — Landing page on GitHub Pages

Once acceptance is signed: stand up a minimal static landing site at
`/docs/site/`, configure Pages to serve from there, CNAME
`passportsign.dev` to it. One page with the v0.4 pitch + install
instructions + link to spec. The bare minimum that gives the domain
a real face for first-time visitors. Defer styling polish to a
future iteration.

---

## Order I'll execute in

1. `sdk-payload.ts` + tests
2. Update `verifier.ts` for `sdk_proof`, mock-SDK tests
3. `badge.ts` + tests
4. `cli/ui.ts` helpers
5. `cli/commands/bind.ts` + skeleton wire-up
6. Workspace test/typecheck green
7. **Pause and hand off** for Phase 5 (real passport)
8. Phase 6 docs after real bind succeeds
9. Phase 7 landing page

Estimated 2-3 hours of focused work for phases 1-4, plus your phone
time at Phase 5.
