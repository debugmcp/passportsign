# v0 acceptance — manual E2E checklist

This file is the living record of v0 acceptance. It begins with the Day 0
SDK prototype gate. The Day 7 walkthrough fills in the rest.

## Day 0 — SDK prototype (HARD GATE)

**Status:** ☐ pending

The four success criteria (all must pass; any failure is a re-plan
trigger, not "keep going"):

| # | Criterion | Pass? | Evidence |
|---|---|---|---|
| 1 | QR renders in terminal | ☐ | |
| 2 | Phone scan reaches the SDK bridge (zkPassport relay) | ☐ | |
| 3 | Proof comes back and parses cleanly | ☐ | |
| 4 | SDK verifier accepts the parsed proof (`verified: true`) | ☐ | |

**How to run:**

```
pnpm install
pnpm --filter @passportsign/cli run day0
# or, to also exercise the optional nationality disclosure path:
pnpm --filter @passportsign/cli run day0 -- --country
```

What the script does: instantiates `ZKPassport("dev.passportsign.dev")`,
builds a request with scope `dev.passportsign.dev:day0-prototype`,
renders the resulting URL as a terminal QR code, and waits up to 5
minutes for the SDK callbacks. Prints a structured pass/fail summary at
the end.

**Plan deviations discovered during prototype:**

(Fill in after running. Examples of things to flag here:
- The SDK's "bridge" model (relay) vs the plan's assumed "localhost HTTP
  bridge." If the relay model holds, acceptance criterion #6 and the
  README's network-constraint documentation need revision.
- Any required setup steps not anticipated.
- Behavior under poor network or backgrounded terminal.)

## Day 7 — full acceptance walkthrough

To be filled out after Day 7 real-passport bind against public Sigstore
Rekor with scope `dev.passportsign.dev:johnf`.

The six revised acceptance criteria:

| # | Criterion | Pass? | Evidence |
|---|---|---|---|
| 1 | Full binding flow against a real passport produces a `binding.passportsign.json` bundle plus a Rekor entry | ☐ | log_entry_hash: _TBD_ |
| 2 | Second machine, given only the bundle, verifies with zero operator dependency | ☐ | |
| 3 | Third party reading the public Sigstore Rekor log identifies the in-toto entry by predicateType, runs the SDK on the proof blob, confirms validity | ☐ | |
| 4 | `passportsign rebuild` reconstructs the SQLite cache *or* the limitation is documented (per Day 5 finding on Rekor index) | ☐ | |
| 5 | Canonical JCS test vectors pinned in `packages/core/test/fixtures/canonical-vectors.json` and the verifier CLI passes them | ☐ | |
| 6 | README documents the actual network/setup requirements for running the CLI (per Day 0 + Day 0.5 findings) | ☐ | |

**Real-passport Rekor entry hash (Day 7 evidence):**

`_TBD_`

Public log entries are forever; this hash is the living evidence that v0
shipped.
