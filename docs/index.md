---
title: passportsign
description: Personhood attestations on the Sigstore transparency log.
---

> Is there a human behind this GitHub account?

`passportsign` answers that, cryptographically, without revealing who.

A maintainer scans their passport with the [ZKPassport][zkp] mobile
app and proves the chip is genuine. They prove control of a GitHub
account by publishing a one-time nonce in a public gist. The
resulting attestation lands in the public [Sigstore Rekor][rekor]
transparency log as an [in-toto statement][intoto] with predicate
type `https://passportsign.dev/personhood/v1`. Anyone — skeptic, bot,
employer, downstream consumer — can re-verify it from scratch, with
no need to trust passportsign.dev itself.

It is **Sigstore-adjacent**, in the same way that
[gitsign](https://github.com/sigstore/gitsign) is. gitsign signs Git
commits with OIDC identity and logs to Rekor — but it doesn't
establish personhood. An AI agent with a GitHub account passes
gitsign trivially. `passportsign` fills that gap.

## See it live

The first real-passport bind, shipped 2026-05-25:

[![passportsign verified · CAN · 2026-05-25](https://raw.githubusercontent.com/debugmcp/passportsign/main/docs/evidence/passportsign-badge.svg)](https://rekor.sigstore.dev/api/v1/log/entries/108e9186e8c5677a53b1918ed9b9bbe15194e42714fd3a3f8f0e163d3a22831120a4c540a332e151)

Binds `@cynarlab` — the maintainer of
[`debugmcp/mcp-debugger`](https://github.com/debugmcp/mcp-debugger) —
to a passport-holding human, disclosing only Canadian citizenship.
Click through to read the entry on Rekor; nothing about who they are
beyond that ever touches a server.

## What the badge claims, and what it doesn't

The full claim, no more:

> At time *T*, a human holding a valid government-issued passport
> (and optionally: a citizen of country *X*, if the subject chose to
> disclose) was in control of the GitHub account `@username`.

The badge does **not** claim:

- The code in the maintainer's repos is human-written.
- AI was not used in the project.
- The maintainer is *currently* in control of the account (the
  attestation is a snapshot at binding time).
- The maintainer is trustworthy, skilled, or acting in good faith.
- Any link to the human's real-world identity beyond what they
  explicitly disclosed.
- That distinct badges represent distinct humans.

Overclaiming is the failure mode that kills trust services. The
badge is *evidence for an accountability claim* plus optional
*attested attributes*, not a substitute for any broader judgement.
See the [spec §1][spec-1] for the full statement and [§8][spec-8] for
the explicit Sybil-resistance limits.

## Try it

You'll need [Node 22+][node], the
[ZKPassport mobile app][zkp-ios] (or [Android][zkp-android]) with an
NFC e-passport loaded, and a GitHub account you can create a public
gist on.

```bash
git clone https://github.com/debugmcp/passportsign.git
cd passportsign
pnpm install
pnpm --filter @passportsign/cli exec tsx src/index.ts bind <your-github-username> --country
```

The CLI walks four steps — gist → QR scan → Rekor submit → bundle &
badge written to your working directory. Detailed flow in the
[repo README][repo].

### Verify someone else's binding

```bash
pnpm --filter @passportsign/cli exec tsx src/index.ts verify ./binding.passportsign.json
```

Four checks, **zero dependency on a passportsign.dev operator**:

1. The statement bytes hash to the Rekor entry's recorded payloadHash.
2. The Merkle inclusion proof verifies against the captured root.
3. The captured root is consistent with the current witnessed root
   (no log rewrite that orphans the entry).
4. The zkPassport SDK accepts the proof, and the unique identifier
   it produces matches the statement.

`--no-rekor-refetch` skips the online checks for purely offline
verification; `--gist-recheck` adds a liveness signal by re-fetching
the captured gist URL.

## How it works

| Layer | What it does | Who provides it |
|---|---|---|
| zkPassport SDK | Generates and verifies the zero-knowledge proof from the passport's NFC chip | [docs.zkpassport.id](https://docs.zkpassport.id) |
| GitHub gist | One-time nonce posted publicly under the bound username, proving GitHub-side control | github.com |
| in-toto statement | Canonical attestation: the gist + proof + scope + (optional) disclosed country | [in-toto.io](https://in-toto.io) |
| Sigstore Rekor | Append-only, witnessed, transparency log — the trust anchor | [docs.sigstore.dev](https://docs.sigstore.dev) |
| passportsign | Glues the four together; ships the CLI + verifier | this project |

The skeptic's full re-derivation: fetch the entry from public Rekor,
run the zkPassport SDK on the embedded proof, re-hash the statement,
walk the Merkle path. No passportsign-controlled service required at
any step.

## Status & roadmap

| Version | Scope | Status |
|---|---|---|
| **v0** | CLI proof-of-concept: bind, verify, badge generation | **shipped 2026-05-25** |
| v1 | Next.js web app: hosted badge service at `passportsign.dev/badge/<user>.svg`, `/verify/<user>` static verifier, REST API | planned (~3–4 weeks) |
| v1.5 | Slack/Discord bot mention-resolvers, federated operators, reference standalone verifier CLI | planned |
| v2 | Federated operators, org-level bindings, additional witness recruitment | planned |

The full v0 acceptance walkthrough — six criteria, all PASS or
deliberately deferred to v1 — is in
[`docs/v0-acceptance.md`](https://github.com/debugmcp/passportsign/blob/main/docs/v0-acceptance.md).

## Why this exists

It was built to answer one specific question, asked publicly on
[`debugmcp/mcp-debugger#77`](https://github.com/debugmcp/mcp-debugger/issues/77):
*"Who are the key humans behind debugmcp and mcp-debugger?"*. The
maintainer wrote `passportsign` and bound their own GitHub account
to a passport-holding human as the response. That whole chain —
question → product → response — is public and verifiable.

## Source & links

- **Repository**: [github.com/debugmcp/passportsign](https://github.com/debugmcp/passportsign)
- **Spec**: [`docs/passportsign.md`](https://github.com/debugmcp/passportsign/blob/main/docs/passportsign.md) (v0.4)
- **Acceptance evidence**: [`docs/v0-acceptance.md`](https://github.com/debugmcp/passportsign/blob/main/docs/v0-acceptance.md)
- **The v0 ship entry on Rekor**: [`108e9186…2e151`](https://rekor.sigstore.dev/api/v1/log/entries/108e9186e8c5677a53b1918ed9b9bbe15194e42714fd3a3f8f0e163d3a22831120a4c540a332e151)
- **License**: Apache-2.0
- **Domain**: `passportsign.dev` (also `passportsign.org`)

[zkp]: https://zkpassport.id
[zkp-ios]: https://apps.apple.com/us/app/zkpassport/id6477371975
[zkp-android]: https://play.google.com/store/apps/details?id=app.zkpassport.zkpassport
[rekor]: https://docs.sigstore.dev/logging/overview/
[intoto]: https://in-toto.io/Statement/v1
[node]: https://nodejs.org/
[repo]: https://github.com/debugmcp/passportsign
[spec-1]: https://github.com/debugmcp/passportsign/blob/main/docs/passportsign.md#1-what-it-claims-what-it-doesnt
[spec-8]: https://github.com/debugmcp/passportsign/blob/main/docs/passportsign.md#8-sybil-resistance--properties-and-limits
