# Roadmap — v0.5, v1.0, and beyond

v0 shipped 2026-05-25. The cryptographic core is sound: `passportsign
bind` produces a public-log entry, `passportsign verify` re-derives
the trust path with zero dependency on us. What's left is polish,
ergonomics, broader reach, and the parts of the spec that assumed
operator infrastructure we deliberately deferred.

This roadmap describes **what each milestone enables**, not when it
ships.

---

## v0.5 — Polish + first hosted endpoint

**Theme**: take the rough edges off v0, get the bundle approach out
of the way once upstream fixes land, ship the smallest possible
hosted service that gives `passportsign.dev/badge/<user>.svg` a real
home.

### v0.5.1 — Slim CLI (gated on upstream SDK PR)

**Blocked by**: [zkpassport/zkpassport-packages#212](https://github.com/zkpassport/zkpassport-packages/pull/212).

When upstream merges, our SDK patches become unnecessary. We can:

- Drop `tsup` bundling and ship a plain `tsc`-built CLI
- Drop `@aztec/bb.js` as a direct dependency (back to transitive via SDK)
- Cut the npm tarball from ~750 KB to <50 KB
- Type-check end users (the bundle currently strips types)

**What it enables**: cleaner upgrades, faster installs, better
developer experience for anyone building on top of `@passportsign/core`.

### v0.5.2 — Revocation

Per spec §7 and §9. The CLI gains:

```
passportsign revoke <github_username>
```

The user scans their passport (same flow as bind), the CLI submits a
revocation entry to Rekor with predicate type
`https://passportsign.dev/personhood/v1#revocation`. The revocation
binds the same `uniqueIdentifier` and explicitly marks the prior
binding as revoked.

The spec's revocation security tradeoff (§7) stands: anyone with
brief access to the passport can revoke; legitimate users can also
recover via revoke + fresh-bind.

**What it enables**:

- Cleanup of mistaken or compromised bindings
- Genuine "I no longer endorse this account" signals
- Visible state on the badge service (red badge → revoked)

### v0.5.3 — `passportsign list <username>`

A read-only command that walks the public Rekor log for entries
matching `subject.name == github.com/<username>` and prints every
binding (active, stale, revoked, with linked accounts under the same
`uniqueIdentifier`).

**What it enables**:

- Quick local introspection without a hosted service
- Building block for the v0.5 badge service
- A debugging tool when bindings get weird

### v0.5.4 — Cloudflare Worker badge service

Stand up `passportsign.dev/badge/<username>.svg` as a Cloudflare
Worker (free tier covers ~100K requests/day; $5/mo for 10M):

1. On request, look up `<username>` in a small static index
2. Fetch the latest binding from Rekor by entry hash
3. Determine state (active / stale / revoked) from the log
4. Render the SVG with appropriate color (green / yellow / red)
5. Return with `Cache-Control` (1–5 min) for CDN caching

The index is a static JSON file in this repo
(`docs/index/<username>.json` → `{ rekor_entry_hash, bound_at, ... }`)
that users add via PR. No database, no Postgres, no persistent state.

`passportsign.dev/verify/<username>` becomes a static HTML page that
loads the binding from Rekor and runs verification client-side
(same code path as the CLI's `verify`).

**What it enables**:

- A canonical URL for badges (instead of asking maintainers to host
  the SVG themselves)
- Live state — revocations and staleness show through automatically
- The visual experience the spec §4 originally described
- The architecture matches spec §7's "operator is a convenience, not
  a trust authority" because anyone can run the same Worker against
  the same Rekor log

### v0.5.5 — `passportsign-index.json` convention

A simple JSON file maintained per-user in their profile repo:

```json
{
  "bindings": [
    {
      "rekor_entry_hash": "108e9186...",
      "github_username": "cynarlab",
      "bound_at": "2026-05-25T15:47:00Z"
    }
  ]
}
```

`passportsign bind` writes this file alongside the bundle. The
Worker badge service can discover it at
`https://raw.githubusercontent.com/<user>/<user>/main/passportsign-index.json`,
no central registration needed.

**What it enables**:

- Zero-config badge resolution: badge URL works for anyone with a
  bound profile, no PR to the project required
- Self-hosted bindings stay discoverable
- Federation falls out naturally

---

## v1.0 — Web binding flow + federation

**Theme**: drop the CLI prerequisite. Anyone with a phone and a
browser can bind. Other operators can stand up their own services
against the same log.

### v1.0.1 — Browser binding flow at `passportsign.dev/bind`

A web page that walks the same four steps the CLI does:

1. Asks the user for their GitHub username and disclosure choice
2. Generates the nonce, displays it with a one-click "create gist"
   button (deep-links to gist.github.com pre-filled)
3. Verifies the gist
4. Renders the ZKPassport QR (or a same-device deep-link if the user
   is already on their phone)
5. After the SDK callback fires, submits the in-toto attestation to
   public Rekor and emits the bundle
6. Offers the bundle for download + the badge markdown to paste

Requires a small hosted backend for session state (per-bind nonce,
SDK transport). Edge function + Durable Objects (Cloudflare) or
similar — still no persistent database.

**What it enables**:

- The huge majority of maintainers who don't want to clone a repo
  to bind
- Discoverability — when someone clicks the badge, they can
  understand how it works without reading source
- Same Worker handles bind and verify, halving the moving parts

### v1.0.2 — Federation reference

Document and provide a reference deployment kit for running your own
`passportsign.dev`-equivalent against the same Rekor log. Operators
are interchangeable — bindings are first-class regardless of which
operator submitted them.

Specifically:

- A `docker-compose.yml` or Cloudflare Worker template
- Documentation of the operator's responsibilities (zero, since the
  log is canonical)
- Best practices for badge-service cache invalidation
- A list of known operators (federation directory) — a small JSON
  file in this repo

**What it enables**:

- Resistance to operator takedown or refusal
- Geographic distribution (low-latency badges from regional Workers)
- The spec §7 federation property goes from theoretical to real

### v1.0.3 — Standalone verifier package

Publish `@passportsign/verify` as a zero-dependency Node package
(plus a single-file browser build) that contains *only* the
verification logic: read a bundle, run the four cryptographic
checks, return a structured result. No CLI, no bind flow, no
hosting code.

**What it enables**:

- Drop-in verification for anyone building tooling around bindings
  (CI pipelines, repo analyzers, hiring tools, etc.)
- Audit-friendly: a small, single-purpose codebase reviewers can
  read end-to-end in an afternoon
- Smaller dependency surface than `@passportsign/cli`

### v1.0.4 — Mention-resolver bots

Slack and Discord bots that recognize `@cynarlab`-style mentions and
reply inline with the badge state, linked-cluster count, and link to
the live `/verify` page.

**What it enables**:

- Trust signals in the channels where maintainers and contributors
  actually talk
- An easy answer to "is this account real?" without leaving the chat
  window

### v1.0.5 — Multiple badge styles

Per spec §4. Beyond the current "pill with country" we ship:

- Compact (`🧍 verified`) for sidebars
- Pill with linked-account count
- Pill without country (already supported by the CLI, just not the
  hosted service yet)
- Maintainer-only mode that hides the country even if it was disclosed

**What it enables**:

- Tighter integration with READMEs that already have many badges
- Maintainer control over post-bind disclosure visibility

---

## v2 — Federation + org-level bindings + witness recruitment

**Theme**: graduate from a single-operator-plus-hobbyist-mirrors
model into a real federated identity-attestation network.

### Org-level bindings

A single human attests to control of a GitHub org rather than (or in
addition to) a personal account. Maps to spec §10 row 3.

**What it enables**: a clear signal of "this org has a human
maintainer accountable for it," distinct from per-user attestations.

### Coarser country disclosure

Maps to spec §10 row 11. Lets users disclose `EU` or `Schengen`
without revealing the specific country.

**What it enables**:

- More gradient between full disclosure and no disclosure
- Better fit for jurisdictions where citizenship is sensitive
  information

### Independent witness recruitment

Solicit additional independent witnesses (OSS foundations, security
research orgs) beyond Sigstore's default witness set. Maps to spec
§10 row 10.

**What it enables**:

- Higher confidence in log integrity (more honest witnesses to
  detect equivocation)
- Reduced single-point-of-failure on Sigstore alone

### Cross-service personhood signals

Bridge with adjacent projects (Self / Worldcoin / Human Passport) so
that a passportsign attestation counts toward other personhood-aware
ecosystems and vice versa.

**What it enables**:

- Less duplicated work for users
- Stronger sybil-resistance through cross-service correlation

---

## What's deliberately not in any milestone

For grounding — these are aspirations the project should resist:

- **A name registry, social graph, or directory of humans.** The
  project is about *evidence for accountability claims*, not a
  database of people.
- **High-stakes sybil resistance for governance / voting / airdrops.**
  Spec §8's limits are honest; this badge is not the right
  instrument for that.
- **Per-commit attestations.** That's gitsign's job and the badge
  shouldn't imply per-commit guarantees.
- **Country-based filtering at the service layer.** Disclosed
  country is in the log; downstream consumers filter per their own
  policies (spec §10 row 5).
- **Acting as a trust authority.** The skeptic must always be able
  to re-verify without us.

---

## Order of operations

The honest ordering is dependency-driven, not time-driven:

```
                upstream SDK PR merges (#212)
                            │
                            ▼
                       v0.5.1 Slim CLI
                            │
        ┌───────────────────┼──────────────────────┐
        ▼                   ▼                      ▼
v0.5.2 Revocation    v0.5.3 `list`        v0.5.5 Index convention
                            │                      │
                            └──────────┬───────────┘
                                       ▼
                          v0.5.4 Worker badge service
                                       │
                                       ▼
                              v1.0.1 Web bind flow
                                       │
              ┌────────────────────────┼─────────────────────────┐
              ▼                        ▼                         ▼
       v1.0.2 Federation     v1.0.3 Verifier pkg        v1.0.4 Bots
                                       │
                                       ▼
                            v1.0.5 Additional badges
                                       │
                                       ▼
                                v2 (federation,
                                org bindings,
                                witnesses, etc.)
```

Each milestone is independently shippable and independently useful.
v0.5.1 unblocks everything else; v0.5.4 (the badge service) is the
single biggest UX leap; v1.0.1 (web bind) is the single biggest
adoption leap.
