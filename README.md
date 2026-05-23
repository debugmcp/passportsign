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

**v0 — pre-alpha, CLI proof-of-concept.** See the
[implementation plan](https://github.com/debugmcp/passportsign) (or the
local plan file referenced in the v0.4 spec). The v0 acceptance criteria
in [`docs/passportsign.md`](docs/passportsign.md) §14 list the six gates
that close out v0.

## Repo layout

```
packages/
├── core/    shared state machine: canonical serialization, in-toto
│            statement builder, bundle format, GitHub gist check,
│            zkPassport SDK wrapper, Rekor client, SQLite cache, verifier.
└── cli/     `passportsign` binary: bind, verify, rebuild, init-config.
```

## License

Apache-2.0. See [`LICENSE`](LICENSE).
