# @passportsign/cli

[passportsign](https://passportsign.dev) CLI — bind a GitHub account
to a passport-holding human via [zkPassport](https://zkpassport.id),
publish the attestation to the public [Sigstore Rekor](https://docs.sigstore.dev/logging/overview/)
transparency log, and emit a self-contained inline SVG badge.

## Install

```bash
npm install -g @passportsign/cli
```

Or one-shot via `npx`:

```bash
npx @passportsign/cli bind <your-github-username> --country
```

Requires Node 22.5+ (uses `node:sqlite`). You also need the
ZKPassport mobile app ([iOS](https://apps.apple.com/us/app/zkpassport/id6477371975) /
[Android](https://play.google.com/store/apps/details?id=app.zkpassport.zkpassport))
with your NFC e-passport loaded.

## Commands

### `passportsign bind <github_username>`

Full v0 binding flow:

1. Generate a one-time nonce.
2. Prompt you to create a public GitHub gist named
   `passportsign.txt` containing that nonce.
3. Verify the gist via the GitHub API.
4. Render a QR code; you scan with the ZKPassport app, approve the
   disclosure on your phone.
5. Submit the resulting in-toto attestation to public Sigstore Rekor.
6. Write `binding.passportsign.json` and `passportsign-badge.svg`
   to the current directory.

Pass `--country` to disclose your passport's issuing country
(otherwise the attestation is personhood-only).

### `passportsign verify <bundle.json>`

Run four cryptographic checks against a binding bundle:

- Statement bytes hash to the Rekor entry's recorded `payloadHash`
- Merkle inclusion proof verifies against the captured root
- Captured root is consistent with the current witnessed root
  (no log rewrite that orphans the entry)
- zkPassport SDK accepts the proof and the unique identifier
  matches the statement

All checks run **without any dependency on a passportsign.dev
operator** — only public Sigstore Rekor and a local zkPassport SDK.

Flags:

- `--no-rekor-refetch` — offline structural verification only
- `--gist-recheck` — also re-fetch the captured gist URL as a
  liveness signal

## What the badge claims

> At time *T*, a human holding a valid government-issued passport
> (and optionally: a citizen of country *X*, if the subject chose to
> disclose) was in control of the GitHub account `@username`.

Explicit non-claims: this badge does **not** assert that the code is
human-written, that AI is not used, that the maintainer is currently
in control of the account, or that they are trustworthy. See
[`docs/passportsign.md`](https://github.com/debugmcp/passportsign/blob/main/docs/passportsign.md)
§1 for the full list.

## License

Apache-2.0. Source: https://github.com/debugmcp/passportsign
