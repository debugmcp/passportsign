# passportsign — spec v0.4

A Sigstore-adjacent service that issues cryptographic attestations binding a
GitHub account to a passport-holding human, without revealing the human's
identity. All bindings are published to the public Sigstore Rekor transparency
log as in-toto attestations; the service itself is a convenience operator, not
a trust authority.

Domains: `passportsign.dev` (primary), `passportsign.org` (mirror / canonical
docs).

> **Changelog**
>
> v0.4:
> - Repositioned as Sigstore-adjacent. Entries are in-toto attestations
>   with a custom `predicateType` URI
>   (`https://passportsign.dev/personhood/v1`), submitted to the public
>   Sigstore Rekor instance (`rekor.sigstore.dev`).
> - Renamed: `zkmaintainer` → `passportsign`. Slots into the Sigstore
>   naming family (`gitsign`, `cosign`, `passportsign`).
> - New `binding.passportsign.json` bundle: the portable unit of
>   verification. Rekor stores hashes, not artifacts; the bundle carries
>   the canonical statement bytes, proof blob, inclusion proof, and
>   captured log root. See §14.
> - Subject digest in the in-toto statement is the gist content SHA-256
>   (meaningful — ties statement to demonstrated control); username is
>   not hashed.
> - `bound_at` removed from the canonical attestation; Rekor's inclusion
>   timestamp is authoritative. The local cache still records `bound_at`
>   for display.
> - v0 acceptance criteria revised to 6 items, including the Day 0 SDK
>   prototype gate and a real-passport Rekor entry hash committed to the
>   repo as living evidence. See §14.
>
> v0.3:
> - New §8: Sybil resistance — explicit properties and limits.
> - New §14: Implementation notes — canonical serialization, gist-check
>   semantics, Rekor entry type, mobile UX, testing strategy, v0 acceptance
>   criteria.
> - §3, §4: minor clarifications on nonces, gist semantics, error codes.
> - §7: revocation security tradeoff made explicit.
>
> v0.2:
> - Source of truth moved from a private DB to a public transparency log.
>   DB became a regeneratable cache.
> - Country became an opt-in selectively disclosed attribute.
> - Multiple bindings per passport explicitly allowed, with transparent
>   linkage.
> - Federation became intrinsic to the design.

---

## 1. What it claims, what it doesn't

### The claim

> At time *T*, a human holding a valid government-issued passport from a
> country on the recognized CSCA list (and optionally: from country *X*, if
> the subject chose to disclose) was in control of the GitHub account
> `@username`.

Country is an **opt-in selective disclosure**, chosen by the subject at scan
time in the zkPassport app. If disclosed, it's part of the proof. If not, the
attestation is personhood-only. Both states are first-class.

### Explicit non-claims

The badge does **not** assert any of the following, and the website must say
so plainly:

- That the code in the maintainer's repos is written by a human.
- That AI is not used in the project.
- That the maintainer is currently still in control of the account (the
  attestation is a snapshot at binding time).
- That the maintainer is trustworthy, skilled, or acting in good faith.
- Any link to the maintainer's real-world identity.
- A judgment about which countries are trustworthy. The service publishes the
  disclosed country attribute if granted; it does not filter by country.
  Country-based filtering is a downstream consumer choice, made against the
  public log.
- That distinct badges represent distinct humans. See §8.

### Why narrow

Overclaiming is the failure mode that kills trust services. The badge is
*evidence for an accountability claim* plus optional *attested attributes*,
not a substitute for the broader trust judgment a downstream user has to make
themselves.

---

## 2. Architecture

```
                  ┌────────────────────────┐
                  │  passportsign.dev web  │
                  │  (Next.js, convenience │
                  │   operator only)       │
                  └──────────┬─────────────┘
                             │
         ┌───────────────────┼────────────────────┐
         │                   │                    │
         ▼                   ▼                    ▼
  ┌─────────────┐    ┌───────────────┐   ┌─────────────────┐
  │ binding flow│    │ badge / proof │   │ verify (static) │
  │ (writes log)│    │ endpoints     │   │ in-browser ZK + │
  │             │    │ (reads cache) │   │ log inclusion   │
  └──────┬──────┘    └───────┬───────┘   └─────────────────┘
         │                   │                    │
         │                   ▼                    │
         │           ┌──────────────┐             │
         │           │ Postgres     │             │
         │           │ (CACHE only) │             │
         │           └──────────────┘             │
         │                                        │
         └──────► PUBLIC TRANSPARENCY LOG ◄───────┘
                  (Rekor or Rekor-shaped)
                       ▲           ▲
                       │           │
                  ┌────┴────┐ ┌────┴────┐
                  │ witness │ │ witness │  ... (N independent
                  └─────────┘ └─────────┘       witnesses co-sign
                                                log roots)
```

Stack:

- **Web app**: Next.js 14+ on Vercel or Fly.
- **Source of truth**: a public append-only transparency log (default v1:
  Sigstore Rekor instance; self-hosted Rekor-shaped log possible).
- **Cache**: Postgres (Neon or Supabase fine; SQLite acceptable single-region).
  Fully regeneratable from the log.
- **Identity proofs**: `@zkpassport/sdk` for proof verification.
- **GitHub control check**: GitHub REST API v3, token only for higher rate
  limits.
- **Badge rendering**: server-rendered SVG, no external dependency.

**Critical property:** the DB is a cache, not authoritative. Losing the DB is
an availability incident, not a security incident. The log is canonical.

---

## 3. The binding flow

The whole reason the system works is that it binds two things — control of a
GitHub account and possession of a passport — without learning either
identity, and then publishes the binding to a public log so the operator
cannot retroactively lie about what happened.

### Step-by-step

1. **Init.** User visits `passportsign.dev`, enters GitHub username
   `johnf`, and chooses whether to disclose country. Backend generates a
   nonce (cryptographically random, ≥128 bits, base32 or base58 encoded for
   gist-friendliness), e.g. `zkm-johnf-7f3a9c1e...`, stores a pending row,
   returns: `{ binding_id, nonce, scope, qr_payload, expires_at }`.
2. **Scope.** Scope passed to zkPassport is `passportsign.dev:johnf`. This
   makes the resulting `uniqueIdentifier` deterministic for this passport
   under this service's namespace, and unlinkable to any other zkPassport use.
3. **GitHub control.** UI instructs the user to create a public gist named
   `passportsign.txt` containing exactly the nonce (no surrounding
   whitespace, no trailing newline that wasn't in the supplied string).
4. **Passport scan.** UI shows the zkPassport QR. The disclosure request is
   `{ personhood, country? }` — the app shows the user exactly what's being
   asked for and lets them grant or refuse the country part at scan time.
   Personhood is mandatory; country is optional.
5. **Server-side verify.** Three checks, fail on any:
   - `@zkpassport/sdk` verifies the proof; scope matches.
   - GitHub API: gist exists, owned by `johnf`, content is exact match to
     the nonce, and `updated_at` is after the init timestamp. (We use
     `updated_at`, not `created_at`, because gist contents can be edited
     after creation; the only honest claim is "this user controlled this
     gist at time T".) Capture gist URL and SHA-256 of content.
   - Idempotency check: is `(uniqueIdentifier, github_username)` already
     bound? If yes, return existing record. (No uniqueness check on
     `uniqueIdentifier` alone — see §5, §8.)
6. **Submit to transparency log.** Build the canonical binding tuple using
   the canonical-JSON serialization from §14, submit to Rekor, receive
   `log_entry_hash` and an inclusion proof.
7. **Cache.** Persist the row in local Postgres, including the log entry hash
   and inclusion proof.
8. **Hand off.** Return badge markdown plus link to `/verify/johnf`.

After step 6, the binding is publicly verifiable by anyone, forever, without
relying on passportsign.dev. Steps 7 and 8 are operator conveniences.

### Failure modes the flow has to handle

- Gist created with wrong content / wrong filename / wrong owner: fail
  cleanly with the matching error code from §4.
- Proof valid but `(uniqueIdentifier, username)` race collision: enforce via
  pending-row locking. First to commit wins; subsequent attempts return the
  existing record.
- Proof generation timeout / abandoned: pending rows expire after 1 hour.
- Log submission fails: do **not** persist to cache. Return a retry-safe
  error. The binding is not "real" until it's in the log.

### Idempotency

A user re-running the flow with the same passport and same username produces
the same `uniqueIdentifier` and (modulo nonce/gist details) the same binding.
The implementation must detect this and return the existing log entry rather
than producing a duplicate.

---

## 4. Public API

All endpoints stable, versioned under `/v1`.

### Write

```
POST /v1/bind/init
  body:    { github_username, disclose_country: bool }
  returns: { binding_id, nonce, scope, qr_payload, expires_at }

POST /v1/bind/complete
  body:    { binding_id, zkpassport_proof }
  returns: { status, badge_markdown,
             log_entry_hash, log_inclusion_proof }  on success
           { status, error_code }                   on failure
```

### Error codes

`POST /v1/bind/*` returns one of these `error_code` values on failure:

| Code                       | Meaning                                                                 |
|----------------------------|-------------------------------------------------------------------------|
| `username_invalid`         | Malformed or non-existent GitHub username                               |
| `binding_pending_expired`  | `binding_id` expired or unknown                                         |
| `gist_not_found`           | No matching gist for the username                                       |
| `gist_wrong_content`       | Gist found but contents do not exactly match the nonce                  |
| `gist_wrong_owner`         | Gist owner does not match the username                                  |
| `gist_predates_init`       | Gist's `updated_at` is before the init timestamp                        |
| `proof_invalid`            | `@zkpassport/sdk` rejected the proof                                    |
| `proof_scope_mismatch`     | Proof's scope does not match the expected scope                         |
| `proof_missing_personhood` | Required personhood disclosure absent                                   |
| `log_submission_failed`    | Transparency log unreachable or rejected entry                          |
| `internal_error`           | Anything else; do not leak detail to the client                         |

A successful idempotent re-bind returns `status: "idempotent_existing"` with
the existing record, not an error.

### Read

```
GET /v1/badge/:username.svg
  → server-rendered SVG. Cache-Control: public, max-age=300.

GET /v1/proof/:username.json
  → {
      username,
      bound_at,
      scope,
      unique_identifier,
      issuing_country,          // null if undisclosed
      disclosure_level,         // 'personhood' | 'personhood+country'
      proof_blob,
      gist_url,
      gist_content_sha256,
      log_entry_hash,
      log_inclusion_proof,
      log_root_at_submission,
      zkpassport_sdk_version
    }
  → the trust-anchor endpoint. Skeptics re-verify locally and never need to
    trust passportsign.dev.

GET /v1/linked/:username
  → {
      unique_identifier,
      accounts: [ { username, bound_at, status }, ... ]
    }
  → all GitHub accounts bound to the same passport under this service's scope.

GET /v1/binding/:username
  → lightweight metadata, no proof blob. For quick status checks.

GET /v1/log/snapshot
  → most recent witnessed log root and witness signatures, plus the
    operator's view of the log size. Lets external monitors detect
    equivocation.

GET /verify/:username
  → static HTML page. Loads /v1/proof/:username.json and runs, in the
    browser:
      1. zkPassport SDK proof verifier
      2. Merkle inclusion-proof verification against the current witnessed
         log root
      3. (Optional) fetch the gist URL to confirm GitHub control still
         holds
    Renders ✓ / ✗ based on these local checks, not the server's claim.
```

### Badge SVG format

Variants:

- **Pill (default)**: `passportsign | verified human · 2026-05-22`
- **Pill with country**: `passportsign | verified human · USA · 2026-05-22`
- **Pill with linked count**: `passportsign | verified human · linked: 3`
- **Compact**: `🧍 verified` (sidebars, tight spaces)

Visual rule: the no-disclosure badge and the country-disclosed badge use the
same color, weight, and shape. The disclosed-country variant simply adds the
country tag. We do not visually shame non-disclosure.

Color logic:
- **Green**: active, log inclusion verified within freshness window.
- **Yellow**: stale (past re-verification window — see §10).
- **Red**: revoked or failed re-verification.

---

## 5. Data model

Single primary table for v0.3, treated as a cache.

```sql
CREATE TABLE bindings (
  github_username        TEXT PRIMARY KEY,
  unique_identifier      TEXT NOT NULL,            -- NOT UNIQUE
  issuing_country        TEXT,                     -- as returned by zkPassport SDK, nullable
  disclosure_level       TEXT NOT NULL
                              CHECK (disclosure_level IN
                                     ('personhood','personhood+country')),
  scope                  TEXT NOT NULL,
  zkpassport_sdk_ver     TEXT NOT NULL,
  proof_blob             BYTEA NOT NULL,
  gist_url               TEXT NOT NULL,
  gist_content_sha256    TEXT NOT NULL,
  bound_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  log_entry_hash         TEXT NOT NULL UNIQUE,
  log_inclusion_proof    JSONB NOT NULL,
  log_root_at_submission TEXT NOT NULL,
  last_checked_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  status                 TEXT NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active','stale','revoked'))
);

CREATE INDEX ON bindings(unique_identifier);   -- linked-accounts lookup

CREATE TABLE pending_bindings (
  binding_id        UUID PRIMARY KEY,
  github_username   TEXT NOT NULL,
  nonce             TEXT NOT NULL,
  scope             TEXT NOT NULL,
  disclose_country  BOOLEAN NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL
);

CREATE TABLE revocations (
  github_username  TEXT PRIMARY KEY,
  revoked_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason           TEXT NOT NULL,
  log_entry_hash   TEXT NOT NULL UNIQUE       -- revocation is itself a log entry
);
```

The `bindings` table is fully derivable from the public log. A reference
"rebuild from log" tool ships with the OSS repo.

What we do **not** store:

- Passport data (never leaves user's phone — that's the SDK architecture).
- IP addresses, user agents, or any other request metadata against binding
  or verification events. Access logs are off, or aggressively stripped, on
  `/v1/bind/*`, `/v1/proof/*`, and `/verify/*`.

### On dropping UNIQUE from `unique_identifier`

A single passport can deliberately bind multiple GitHub accounts. The
linkage is **transparent**: anyone hitting `/v1/linked/:username` sees the
set. This is intentional. It permits legitimate use (personal/work splits,
bot accounts, account migrations) while preventing the more dangerous
pattern of one human running an undisclosed network of "verified" sock
puppets. See §8 and §10 row 6 for policy rationale.

---

## 6. Where the badge goes

GitHub has no native individual profile badge system. The badge lives in
markdown, in three places by priority:

### Primary: user profile README

GitHub renders the README of the special repo `username/username` on the
user's profile page. Since the binding is at the *account* level, this is
canonical.

```markdown
[![passportsign verified](https://passportsign.dev/v1/badge/johnf.svg)](https://passportsign.dev/verify/johnf)
```

### Secondary: per-repo README

A repo's README can carry the same badge linking to the maintainer's
verification page. Most repo visitors never click through to profiles, so
this is high-value.

```markdown
[![maintainer: passportsign verified](https://passportsign.dev/v1/badge/johnf.svg)](https://passportsign.dev/verify/johnf)
```

### Tertiary: repo About sidebar

Set the repo's website URL to `https://passportsign.dev/verify/johnf`.

### Anti-patterns

- Don't embed the badge in commit signatures or anywhere that implies
  per-commit attestation. The badge is about the account, not the code.
- Don't render the badge in a way that implies the repo content is
  human-written.

---

## 7. Trust model

The bedrock principle: **a skeptic must never have to trust
passportsign.dev.**

### What the skeptic does trust, and why

1. **The zkPassport cryptographic construction.** Root of identity assurance.
   Open-source circuits and SDK; the trust here is the same trust anyone
   using zkPassport already accepts.
2. **The transparency log's witness network.** Multiple independent
   witnesses co-sign log roots. As long as a quorum is honest, the log
   cannot equivocate or rewrite history. Same model as Certificate
   Transparency.
3. **The verifier code running locally in the skeptic's browser.** The
   `/verify` page is statically generated, reproducible, and mirrorable.

### What the skeptic does NOT have to trust

- That passportsign.dev performed the gist check honestly — the gist URL
  and content SHA are in the log entry; re-check via GitHub or Web Archive.
- That passportsign.dev hasn't tampered with the DB — DB is a cache, log
  is canonical.
- That passportsign.dev still exists — log entries remain verifiable after
  the operator is gone.
- That passportsign.dev isn't equivocating — witnesses detect this.
- That passportsign.dev hasn't backdated entries — log timestamps are the
  log's, not the operator's.

### Residual operator capabilities

The operator can:

- **Refuse to operate** (denial of service).
- **Refuse to publish a specific binding** (censorship). Mitigation: user
  can run their own operator instance against the same log, or use the CLI
  to submit directly.
- **Mis-render a badge** (UX, not trust — the `/verify` page is the trust
  anchor).

What the operator **cannot** do, even when malicious:

- Fabricate a binding without a real ZK proof.
- Quietly remove or modify a published binding.
- Show different bindings to different viewers (equivocation; witnesses
  catch it).
- Backdate a binding (log timestamps are external).

### Revocation security tradeoff

Revocation requires only a fresh proof from the same passport — *not*
control of the GitHub account being revoked. This is deliberate:

- **Pro:** If the GitHub account is compromised, the legitimate human can
  still revoke via passport alone. Recovery is possible.
- **Con:** If the passport is stolen or briefly accessed, an attacker can
  revoke the victim's binding(s).

The con is acceptable because the harm is reversible — a revoked binding
can be re-established via a fresh binding flow — and because the recovery
property is the more common case. Users should be told this explicitly in
the binding UI. See also §10 row 2.

### Federation as a consequence

Because the log is the trust anchor and not the operator, anyone can run a
passportsign instance against the same log. Bindings issued by different
operators are first-class equivalent. The "what if the operator is
malicious" question reduces to "use a different operator" — they're
interchangeable.

---

## 8. Sybil resistance — properties and limits

### What the system makes hard

- **One human appearing as N independent verified humans.** A single
  passport produces the same `uniqueIdentifier` under this service's scope,
  and multiple bindings appear linked in `/v1/linked/:username`. The Sybil
  attempt is visible.
- **Manufacturing badges without a passport.** Cryptographically infeasible
  under the zkPassport construction.
- **Operator-injected fake bindings.** Prevented by the transparency log
  and witnessed roots.

### What the system does not prevent

- **Multiple passports per human.** Dual citizens and other legitimate
  multi-passport holders get multiple *unlinked* bindings. A determined
  attacker with three passports gets three unlinked badges.
- **Pooled passports.** A small group cooperatively binds accounts that are
  all operationally controlled by one person. Each binding is legitimate
  from the system's viewpoint; the coordination is invisible.
- **Passport rental / gray-market access.** A market for "scan-and-return"
  passport access exists at modest cost. Once bound, the buyer's binding is
  linked to the seller's other bindings, but casual consumers may not
  check.
- **State-actor scale.** Governments with privileged access to citizen
  passport infrastructure could potentially generate bindings beyond
  individual scale. The NFC handshake is interactive, which limits this,
  but doesn't eliminate it.
- **Coerced bindings.** Real passport, real account, real-looking binding,
  but the human was social-engineered into binding an account they don't
  actually control.

### What the badge can and can't be used for

Safe consumer questions:

- ✓ "Is a human accountable for this account?" The badge gives a meaningful
  yes.
- ✓ "Are these N accounts secretly one human under this service?"
  Answered by `/v1/linked`.

Unsafe consumer questions:

- ✗ "Are these N badges N distinct humans?" Approximately, but vulnerable
  to the multi-passport, pooled-passport, and rental vectors.
- ✗ "Has this person been Sybil-flagged elsewhere?" The system has no
  cross-service knowledge.
- ✗ Any decision where value-per-successful-Sybil exceeds the cost of a
  passport on the gray market. Airdrops, governance, or anything with
  significant per-identity payout will attract attacks the system isn't
  designed to resist.

### Guidance for integrators

Downstream tools that surface passportsign badges in trust-weighted UIs
(code-review weighting, governance, reputation systems) should treat the
**linked cluster** — not the individual account — as the unit of trust.
The `/v1/linked/:username` endpoint exists specifically for this. Surface
the linkage in the integrating UI; don't hide it.

The honest framing for the docs site: *"passportsign makes Sybil attacks
more expensive and more visible, not impossible. Treat the badge as a
positive signal of human accountability, not a guarantee of unique
humanness."*

---

## 9. Privacy commitments

Written commitments, published on the site:

### Public-by-design

Every binding tuple is fully public via the log. There is no private state
on the service that, if leaked, would harm subjects. The proof blob and
`uniqueIdentifier` are not personally identifying under the zkPassport
construction.

### What subjects must be informed of, prominently, before binding

- **Country disclosure is permanent.** If you disclose your country in a
  binding, that disclosure is in the public log forever.
- **Multiple bindings under the same passport are visibly linked, forever.**
  Revocation removes a binding from active reads but the log entry
  remains.
- **The gist is captured at binding time.** Deleting the gist after binding
  does not remove the captured URL or content SHA from the log.
- **Anyone with brief access to your passport can revoke your binding.**
  See §7 revocation tradeoff. Re-binding restores it.

### What the service does not collect

- No identifying info about verifiers (badge / proof endpoint requests).
- No identifying info about subjects beyond what they themselves published.

### Right to revoke

A subject can revoke a binding by submitting a fresh proof from the same
passport. Revocation is itself a log entry. Active reads return `revoked`;
the historical entry remains visible for auditability.

---

## 10. Open decisions

| # | Decision | Default proposal |
|---|----------|------------------|
| 1 | Re-verification cadence | Bindings move to `stale` after 12 months. Same passport + fresh gist refreshes. Yellow badge until refreshed. |
| 2 | Rebinding after account loss | Submit fresh proof from same passport; previous binding revoked under that `uniqueIdentifier`. No need to recover the lost GitHub account. |
| 3 | Org-level bindings | Out of scope for v1. Revisit v2. |
| 4 | CSCA root policy | Accept all ICAO-recognized issuers at v1. |
| 5 | Country / sanctions filtering at service layer | **Do not do this.** Disclosed country (if granted) is in the log; downstream consumers filter per their own policies. |
| 6 | Cap on bindings per passport | No cap at v1. Linkage is transparent; abuse is detectable. Add a soft cap (e.g. 10) only if patterns appear. |
| 7 | Username casing | Normalize to lowercase in cache; case-insensitive in API; preserve user's casing for display. |
| 8 | GitHub username renames | Detect on stale check; mark stale; require re-verification under the new username. Old log entries remain. |
| 9 | Transparency log: Sigstore Rekor vs self-hosted | v1: piggyback on the public Sigstore Rekor instance. Migrate to self-hosted or co-hosted only if rate limits or governance become limiting. |
| 10 | Witness set | v1: rely on Sigstore's existing witnesses. v2: solicit additional independent witnesses (OSS foundations, security research orgs). |
| 11 | Coarser country disclosure (EU / region) | Out of scope for v1. zkPassport supports predicates; UI complexity not yet justified. |

---

## 11. Roadmap

### v0 (private, ~1 week)

- CLI tool that runs the binding flow against the zkPassport SDK, performs
  the GitHub gist check, submits to the log, and prints the resulting log
  entry hash and inclusion proof.
- Single user (the author) as proof of concept.
- No web app yet — CLI exercises every code path.

### v1 (public, ~3–4 weeks)

- Public web flow with gist-based GitHub control check.
- Selective country disclosure.
- Submission to public Rekor log.
- Postgres cache + read endpoints.
- `/verify/:username` static page with in-browser SDK + inclusion-proof
  verification.
- Privacy policy, ToS, open-source repo.

### v1.5

- Slack / Discord bots resolving `@user` mentions to badge state with log
  links.
- Additional badge styles (compact, country, linked-count).
- Mirroring tooling — anyone can run a read-only mirror from the log.
- Reference standalone verifier CLI (zero dependency on passportsign.dev).

### v2

- Federated operators submitting to the same log.
- Org-level bindings (one human attested across an org).
- Optional coarser country disclosure (region / continent).
- Independent witness recruitment beyond Sigstore default.

---

## 12. Non-goals

- Solving "is this AI-generated code." Impossible to prove and not the
  badge's job.
- Solving high-stakes sybil resistance for voting, airdrops, governance,
  etc. See §8.
- Replacing per-commit signature verification (GPG/SSH). Orthogonal — use
  both.
- Replacing GitHub's organization domain verification. Different problem.
- Filtering or judging subjects by nationality, residency, or any other
  attribute.

---

## 13. Open-source posture

Apache 2.0 (matches zkPassport's own license choice). Repo includes:

- The Next.js app.
- The binding state machine, including the gist check and the log
  submission.
- The badge SVG templates.
- The `/verify/:username` static page.
- A reference CLI for offline binding submission and proof publication.
- A "rebuild cache from log" tool — given a log range, reconstruct the
  full DB from scratch.
- A standalone verifier CLI with zero dependency on passportsign.dev.
- Reproducible build / deploy instructions for running your own instance.

The combination of an open-source operator and an external trust anchor (the
log) is what makes the federation property real instead of theoretical.

---

## 14. Implementation notes

These are guidance for the implementer rather than design constraints. They
cover the predictable footguns.

### Canonical serialization of the in-toto statement

Every Rekor entry must have a deterministic byte representation so that anyone
re-deriving the in-toto statement gets the same `log_entry_hash`. Use
**RFC 8785 (JSON Canonicalization Scheme)** via a pinned library (we use
`@truestamp/canonify` plus a drift test that asserts the library produces
the exact expected byte sequence — JCS implementations have had subtle bugs).

The canonical attestation is an in-toto Statement:

```json
{
  "_type": "https://in-toto.io/Statement/v1",
  "subject": [
    { "name": "github.com/johnf",
      "digest": { "sha256": "<sha256 of gist content bytes>" } }
  ],
  "predicateType": "https://passportsign.dev/personhood/v1",
  "predicate": {
    "unique_identifier":      "<from zkPassport SDK>",
    "issuing_country":        "USA",       // or null if undisclosed
    "disclosure_level":       "personhood+country",
    "proof_blob_sha256":      "<sha256 of proof bytes>",
    "gist_url":               "https://gist.github.com/...",
    "gist_content_sha256":    "<sha256 of gist content>",
    "scope":                  "passportsign.dev:johnf",
    "zkpassport_sdk_version": "<sdk version>"
  }
}
```

The subject digest is the gist content SHA — the actual artifact whose
control was demonstrated. It necessarily equals
`predicate.gist_content_sha256`; both are present because in-toto consumers
expect the subject digest at the statement level while our verifier reads
the predicate. **No `bound_at`** — Rekor's inclusion timestamp is
authoritative. **No `operator_id`** — the operator is not part of the
trust anchor.

The proof blob is *not* in the canonical statement. It travels in the
`binding.passportsign.json` bundle (see below) and is bound to the
statement via `proof_blob_sha256`.

Pin the exact serialization in the OSS repo with test vectors. This is the
single most security-relevant piece of code in the system — get it wrong
and verifiers disagree with the log.

### The `binding.passportsign.json` bundle

Rekor stores hashes, not artifacts. To verify a binding, a third party
needs both the Rekor entry (hash + inclusion proof) and the artifacts
that were hashed. The bundle is the portable unit that carries both:

```json
{
  "bundle_format_version": 1,
  "statement":     "<canonical JCS bytes of the in-toto statement>",
  "proof_blob":    "<base64 of zkPassport proof>",
  "rekor": {
    "log_entry_hash":         "<rekor entry UUID>",
    "inclusion_proof":        { /* merkle path */ },
    "log_root_at_submission": "<signed log root>"
  }
}
```

`passportsign bind` emits the bundle as a primary output. `passportsign
verify <bundle.json>` consumes it and runs four checks: SDK validates
`proof_blob`; canonical statement bytes hash to the Rekor entry's
recorded hash; Merkle inclusion verifies against `log_root_at_submission`;
log-root consistency check between captured and current roots (to detect
log rewrites that would orphan the entry).

The bundle is what you copy between machines, attach to issues, link
from READMEs. The Rekor entry is the trust anchor; the bundle is the
portability mechanism. Shape follows the Sigstore verification-bundle
pattern.

### The gist control check

- API: `GET /users/:username/gists` filtered by filename, then
  `GET /gists/:gist_id` for content.
- Use `updated_at` for the freshness check, not `created_at`. Owners can
  edit gist contents at any time; the honest semantic claim is "this user
  controlled this gist at the time we checked."
- Content match must be exact, including trailing whitespace. Trim is the
  user's responsibility, documented in the binding UI.
- Public gists only. Secret gists defeat the public verifiability property
  and the third-party re-check via Web Archive.

### Country code format

Use whatever `@zkpassport/sdk` returns from the disclosure. This is likely
ICAO 3-letter codes (which mostly but not exactly match ISO 3166 alpha-3,
e.g., `D` for Germany in ICAO MRZ format). **Do not normalize or remap;
pass through as-is.** Document this in the OSS repo so downstream
consumers know how to compare codes.

### Rekor entry type

Use the `intoto` Rekor entry type, with the in-toto Statement above as
the attestation payload and a custom `predicateType` URI we publish
ourselves (`https://passportsign.dev/personhood/v1`). This is honest
about what the entry is — an attestation, not a signature — and slots
into existing Sigstore tooling for free.

`hashedrekord` is the wrong fit: it's shaped for
`(artifact, signature, public_key)`. A zkPassport proof isn't a
signature over the artifact, and there's no signer public key in the
classical sense (verification keys are baked into the proving system).
Forcing this into `hashedrekord` would be semantically misleading.

Confirm the exact in-toto entry-type version against the live Rekor API
at start of Day 5 (entry-type versions evolve) and then lock it in
config.

A custom Rekor entry type would be cleaner long-term (typed predicate
semantics, better tooling integration) but is more work and requires
Sigstore ecosystem participation. Revisit at v2.

### Mobile / desktop handoff UX

The trickiest UX is the moment between "user clicks bind" on desktop and
"user opens zkPassport on phone" and "proof returns to desktop." The SDK
handles the bridge but the binding UI must:

- Render a QR scannable from a phone at typical reading distance.
- Poll for proof completion (don't require user to refresh).
- Time out gracefully (~5 min) and let the user re-render the QR.
- Survive desktop tab being backgrounded during the phone-side flow.
- Handle the case where the user completes the proof on phone but the
  desktop session has expired — the SDK proof should be re-submittable
  via the CLI as a fallback.

### Testing without burning a real passport

There is no full substitute for a real passport scan, but two test modes
help:

- **SDK mock mode.** zkPassport's SDK provides a test path that returns
  pre-generated proofs. Use this for unit and integration tests of
  everything downstream of proof verification.
- **One real passport for end-to-end.** The developer's own passport is
  the integration-test fixture. Treat carefully — once bound under the
  production scope, it's bound.

Use a `staging.passportsign.dev` deployment with a distinct scope
(`staging.passportsign.dev:*`) and a separate log to keep dev bindings
out of production.

### Local development

A `docker-compose` with Sigstore's standalone `rekor-server` image
(SQLite/in-memory backend) is sufficient for dev. The heavier
Rekor + Trillian + MySQL stack is unnecessary for a single developer.
Bindings made locally are not attached to the public log and cannot be
verified by anyone else; this is fine for development.

### Acceptance criteria for v0

v0 is **complete** when:

1. The CLI runs the full binding flow against a real passport, producing
   a `binding.passportsign.json` bundle plus a public Sigstore Rekor entry.
2. A second machine, given only the bundle, independently verifies the
   binding using the OSS verifier CLI. Zero dependency on a
   passportsign.dev operator.
3. A third party reading the public Sigstore Rekor log identifies the
   in-toto entry by its `predicateType`, runs the zkPassport SDK on the
   proof blob, and confirms validity.
4. `passportsign rebuild` reconstructs the SQLite cache from a log
   range — *or*, if a Day-5 investigation finds Rekor's index doesn't
   support search-by-predicateType at public-log scale, `rebuild` is
   explicitly deferred to v1 with a documented reason. Either outcome
   is acceptable for v0 closure; the decision is recorded in
   `docs/v0-acceptance.md`.
5. Test vectors for the in-toto statement's canonical JCS bytes are
   pinned in the repo and the verifier CLI passes them.
6. README documents the localhost-HTTP-bridge requirement, the
   phone-network constraint (per Day 0.5 findings), and any tunnel
   setup required for realistic conditions.

The Day 0 SDK prototype is a hard gate before any of the above: the QR
must render, the phone must reach the localhost bridge, the proof must
parse, and the SDK verifier must accept it. Failure on any of those
four points is a re-plan trigger, not a "keep going."

If all six hold end-to-end (Day 0 included), the cryptographic core is
sound and v1 is purely a polish-layer-and-web-UI exercise on top. The
actual Rekor entry hash from the real-passport bind is committed to
`docs/v0-acceptance.md` as living evidence.