# passportsign

Personhood attestations on the Sigstore transparency log.

`passportsign` binds a GitHub account to a passport-holding human, without
revealing the human's identity, and publishes that binding to the public
[Sigstore Rekor](https://docs.sigstore.dev/logging/overview/) log as an
[in-toto attestation](https://in-toto.io/Statement/v1) with a custom
`predicateType` of `https://passportsign.dev/personhood/v1`.

It is Sigstore-adjacent in the same way that
[gitsign](https://github.com/sigstore/gitsign) is. gitsign signs Git
commits with OIDC identity and logs to Rekor — but it doesn't establish
personhood. An AI agent with a GitHub account passes gitsign trivially.
`passportsign` fills that gap.

## What the badge claims

> At time *T*, a human holding a valid government-issued passport
> (and optionally: from country *X*, if the subject chose to disclose)
> was in control of the GitHub account `@username`.

That's it. See [`docs/passportsign.md`](docs/passportsign.md) §1 for the
full list of things the badge does *not* claim, and §8 for the limits of
its Sybil resistance.

## Status

**v0 — pre-alpha, CLI proof-of-concept.** v0 shipped 2026-05-25; six-point
[acceptance walkthrough](docs/v0-acceptance.md) green, including a
real-passport bind on the public Sigstore Rekor log:

  [![passportsign verified · CAN · 2026-05-25](docs/evidence/passportsign-badge.svg)](https://rekor.sigstore.dev/api/v1/log/entries/108e9186e8c5677a53b1918ed9b9bbe15194e42714fd3a3f8f0e163d3a22831120a4c540a332e151)

The companion bundle is at [`docs/evidence/binding.passportsign.json`](docs/evidence/binding.passportsign.json)
— run `passportsign verify` against it to re-derive the proof yourself.

## Quick start

You'll need:

- Node 22+ (uses `node:sqlite`).
- The **ZKPassport mobile app** ([iOS](https://apps.apple.com/us/app/zkpassport/id6477371975) /
  [Android](https://play.google.com/store/apps/details?id=app.zkpassport.zkpassport))
  with your real e-passport loaded.
- A GitHub account you can create a public gist on (you'll create one
  during the bind).
- pnpm 10+.

```bash
git clone https://github.com/debugmcp/passportsign.git
cd passportsign
pnpm install
```

### Bind a GitHub username to your passport

```bash
pnpm --filter @passportsign/cli exec tsx src/index.ts bind <your-github-username> --country
```

The CLI walks four steps:

1. **Gist** — prints a nonce and a filename (`passportsign.txt`); you
   create a public gist on `gist.github.com` with that exact content
   under the username you're binding.
2. **Scan** — renders a QR; you scan with the ZKPassport mobile app,
   approve the disclosure on your phone.
3. **Submit** — submits the resulting in-toto attestation to public
   Sigstore Rekor.
4. **Bundle + badge** — writes `binding.passportsign.json` and
   `passportsign-badge.svg` next to where you ran the command.

### Verify someone else's binding

```bash
pnpm --filter @passportsign/cli exec tsx src/index.ts verify ./binding.passportsign.json
```

Four checks, all run **without any dependency on a passportsign.dev
operator** — verification needs only public Sigstore Rekor and a local
zkPassport SDK:

- statement bytes hash to the Rekor entry's recorded payloadHash
- inclusion proof verifies against the captured root
- captured root is consistent with the current witnessed root (no log
  rewrite that orphans the entry)
- zkPassport SDK accepts the proof + the returned uniqueIdentifier
  matches the statement

Add `--no-rekor-refetch` for offline structural verification only
(skips the consistency check). Add `--gist-recheck` to also re-fetch
the captured gist URL as a liveness signal.

## Network requirements

- **Bind**: the laptop and phone both need internet. They do **not**
  need to be on the same LAN — the zkPassport SDK uses a hosted relay
  ([`@obsidion/bridge`](https://www.npmjs.com/package/@obsidion/bridge))
  to ferry the proof from phone to laptop. Mobile data on the phone +
  any internet on the laptop works.
- **Verify**: any internet (to talk to `rekor.sigstore.dev` for the
  online checks). Pure offline verification — `--no-rekor-refetch` —
  needs only the bundle plus the zkPassport SDK (downloaded with the
  CLI install).

## Repo layout

```
packages/
├── core/    shared state machine: canonical serialization, in-toto
│            statement builder, bundle format, GitHub gist check,
│            Rekor client, RFC 6962 Merkle, SQLite cache, verifier.
└── cli/     `passportsign` binary: bind, verify, rebuild, init-config.

docs/
├── passportsign.md        v0.4 spec
├── v0-acceptance.md       six-criteria walkthrough + living evidence
├── evidence/              real-passport bundle + badge from v0 ship
└── upstream-issues/       drafts for SDK fixes filed at zkpassport
```

## License

Apache-2.0. See [`LICENSE`](LICENSE).
