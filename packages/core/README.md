# @passportsign/core

Core primitives for [passportsign](https://passportsign.dev) — the
Sigstore-adjacent personhood-attestation toolkit. Binds a GitHub
account to a passport-holding human via [zkPassport](https://zkpassport.id)
and logs the binding to the public [Sigstore Rekor](https://docs.sigstore.dev/logging/overview/)
transparency log as an [in-toto attestation](https://in-toto.io/Statement/v1).

This package contains the protocol primitives. See
[`@passportsign/cli`](https://www.npmjs.com/package/@passportsign/cli)
for the user-facing tool.

## What's in here

- **`canonical`** — RFC 8785 JCS canonical serialization
- **`statement`** — in-toto Statement v1 builder with our `passportsign.dev/personhood/v1` predicate type
- **`bundle`** — `binding.passportsign.json` portable format
- **`github`** — gist control check with full §4 error vocabulary
- **`log/rekor`** — Rekor client (intoto v0.0.2, log info, consistency proofs)
- **`merkle`** — RFC 6962 Merkle inclusion + consistency verification
- **`dsse`** — DSSE envelope builder (ephemeral ECDSA P-256)
- **`verifier`** — full bundle verifier
- **`badge`** — self-contained inline SVG badge
- **`storage/sqlite`** — local cache (separate export to avoid bundling `node:sqlite`)

## Spec

Full v0.4 spec at
[`docs/passportsign.md`](https://github.com/debugmcp/passportsign/blob/main/docs/passportsign.md)
in the source repo. The v0 acceptance evidence — including a live
real-passport Rekor entry — is at
[`docs/v0-acceptance.md`](https://github.com/debugmcp/passportsign/blob/main/docs/v0-acceptance.md).

## License

Apache-2.0
