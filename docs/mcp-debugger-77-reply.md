---
For posting from @cynarlab on https://github.com/debugmcp/mcp-debugger/issues/77
Tone target: direct, modest, technical. Doesn't oversell. The badge does the work.
---

Direct answer to the question — I'm the human behind `debugmcp` and `mcp-debugger`.

[![passportsign verified · CAN · 2026-05-25](https://raw.githubusercontent.com/debugmcp/passportsign/main/docs/evidence/passportsign-badge.svg)](https://rekor.sigstore.dev/api/v1/log/entries/108e9186e8c5677a53b1918ed9b9bbe15194e42714fd3a3f8f0e163d3a22831120a4c540a332e151)

Click the badge — it opens the public [Sigstore Rekor](https://docs.sigstore.dev/logging/overview/) log entry. The entry binds `@cynarlab` to a passport-holding human (disclosing only Canadian citizenship) via a zero-knowledge proof from the [ZKPassport](https://zkpassport.id) SDK. My passport never leaves my phone; nothing about who I am beyond that ever touches a server.

The honest claim, no more:

> At time *T*, a human holding a valid government-issued passport (citizen of Canada, since I chose to disclose) was in control of the `@cynarlab` GitHub account.

What this **doesn't** claim, just to be explicit:

- That the code in this repo is human-written. (I write some, AI agents write a lot — that's the whole point of `mcp-debugger`: giving them tools to do it well.)
- That I'm not using AI. I am, extensively.
- That I'm trustworthy or skilled or acting in good faith. Just that I'm a real human you can hold accountable.

The full spec of what the badge does and doesn't promise is at https://passportsign.dev — which I built specifically to answer this issue. The motivation chain (#77 → tool → reply) is now public and verifiable end-to-end.

If you want to re-verify the attestation yourself without trusting me or `passportsign.dev`:

```bash
git clone https://github.com/debugmcp/passportsign
cd passportsign && pnpm install
pnpm --filter @passportsign/cli exec tsx src/index.ts verify docs/evidence/binding.passportsign.json
```

All four cryptographic checks should return PASS, talking only to public Sigstore Rekor and the local zkPassport SDK. No passportsign.dev involvement.

— JF
