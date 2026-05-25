# Day 5 plan — Rekor smoke test, then in-toto submission

After Days 3-4 we have a `PreparedBinding` ready to hand to a log
client. Day 5 builds the log client — `RekorClient` — and the chain
that turns a `PreparedBinding` plus a Rekor submission into a complete
`PassportsignBundle`. The smoke test comes first so we discover Rekor's
actual behavior on the production endpoint before locking the client
shape.

---

## Phase 1 — Smoke test (cheap, high-leverage, requires user OK)

Goal: submit a *single* throwaway in-toto entry to
`rekor.sigstore.dev` to learn:

1. Exact intoto entry-type version accepted (0.0.1 vs 0.0.2 vs newer).
2. Exact response body shape (UUID, integratedTime, logIndex, body,
   verification block).
3. Inclusion proof endpoint shape (hashes array, treeSize, logIndex).
4. Whether `POST /api/v1/log/entries/retrieve` indexes the in-toto
   `predicateType` for our `rebuild` use case.
5. Rate-limit headers / signed-tree-head endpoint.

Predicate type for the smoke entry: **`https://dev.passportsign.dev/smoke-test/v1`**
(clearly distinct from the production `https://passportsign.dev/personhood/v1`
so it never gets mistaken for a real binding).

Action is **one-way** — once submitted, the entry is in the public log
forever. The body is benign (random bytes, ephemeral key, nothing
identifying) but worth confirming with the user before pulling the
trigger.

Script: `packages/core/scripts/rekor-smoke.ts`. Output captured into
`docs/v0-acceptance.md` under a new "Day 5 — Rekor smoke test"
section as living evidence.

## Phase 2 — Build the production client

Files:

- **`packages/core/src/dsse.ts`** — DSSE envelope builder.
  Per-binding ephemeral Ed25519 key (Node built-in `crypto`), PAE
  per the DSSE spec, sign canonical statement bytes, return
  `Envelope` struct. The private key is **discarded after signing** —
  the proof + gist evidence inside the predicate is the actual
  authentication. The DSSE signature is a Rekor schema requirement,
  not a trust mechanism.

- **`packages/core/src/log/rekor.ts`** — `RekorClient` interface plus
  `PublicSigstoreRekorClient` implementation. Methods:
  - `submitIntoto(envelope, predicateType): Promise<RekorEntry>`
  - `getEntry(uuid): Promise<RekorEntry>`
  - `getInclusionProof(uuid): Promise<InclusionProof>`
  - `searchByPredicateType(predicateType): Promise<string[]>` —
    returns matching UUIDs *or* throws if not supported (used by
    `rebuild`; behavior pinned during smoke test).

  Dependency-injectable `fetch` + `baseUrl` for tests. All HTTP
  failures map to `PassportsignError('log_submission_failed', …)`.

- **`packages/core/src/submit.ts`** — `submitBinding(prepared, deps)`:
  given a `PreparedBinding` and a `RekorClient`, produces a
  `PassportsignBundle`. Builds the DSSE envelope, submits via the
  client, fetches the inclusion proof, assembles the bundle. Pure
  orchestrator over the client + DSSE + bundle modules.

## Phase 3 — Tests

- **dsse.test.ts**: sign/verify round-trip (Ed25519); PAE bytes match
  spec (5+ canned vectors); envelope structure correct.
- **rekor.test.ts**: mocked `fetch`, covers happy path + each HTTP
  failure mode → `log_submission_failed`. `searchByPredicateType`
  branch on supported/unsupported.
- **submit.test.ts**: mocked `RekorClient` + canned `PreparedBinding`,
  asserts resulting bundle shape passes `validateBundle`.

## Phase 4 — Round-trip dev confirmation

Run the actual chain end-to-end against public Rekor under the
**production scope** (since dashboard policy locks scope to
`passportsign.dev:nationality-disclose:1`). This is essentially the
Day 7 walkthrough, just without commitment to the result being
the "v0 ships" entry. Day 7 then becomes the formal acceptance
walkthrough that *records* its Rekor entry hash in the v0-acceptance
doc.

## Phase 5 — Rebuild feasibility decision

Based on smoke test results, decide:

- If Rekor's `/retrieve` indexes our predicate type → `rebuild`
  command is straightforward, builds in Day 5.
- If not → document the deferral in `docs/v0-acceptance.md` under
  acceptance criterion #4, mark `rebuild` as v1 work.

## Acceptance for Day 5

- One smoke-test entry exists in `rekor.sigstore.dev` with
  predicateType `https://dev.passportsign.dev/smoke-test/v1`; its
  UUID recorded in `docs/v0-acceptance.md` as evidence.
- `RekorClient`, `dsse.ts`, and `submit.ts` implemented and unit-
  tested.
- A test bundle generated end-to-end through `submit()` passes the
  Day 6 verifier's structural checks (statement hash matches Rekor
  recorded hash; inclusion proof verifies against captured root).
- `rebuild` feasibility documented (implemented or deferred).
- Workspace `pnpm -r run test` + `typecheck` green.

## Order I'll execute in

1. Write `scripts/rekor-smoke.ts` (DSSE + submit + retrieve + search).
   Show output to user. **Pause for user OK before running** — this
   submits to public Rekor.
2. Run smoke test, paste results into v0-acceptance.md.
3. Build `dsse.ts` + tests.
4. Build `rekor.ts` + tests (informed by smoke test's actual response).
5. Build `submit.ts` + tests.
6. End-to-end dry run against public Rekor (no real passport — use a
   mock proof_blob since `prepareBinding` accepts plain inputs).
7. Commit.
