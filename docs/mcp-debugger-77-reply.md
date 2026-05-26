---
Posted on https://github.com/debugmcp/mcp-debugger/issues/77 on
2026-05-26 from @cynarlab. The text below mirrors what was posted,
with a couple of small polishes noted inline as alternatives.
---

Hello -

This is an interesting question. There are many ways to answer and
many reasons you might be asking. This answer proves I have control
of a particular passport and GitHub account and chose to indelibly
link the two on Sigstore Rekor. I think this is more meaningful and
more private than, say, associating a name and picture with the
account.

[![passportsign verified · CAN · 2026-05-25](https://raw.githubusercontent.com/debugmcp/passportsign/main/docs/evidence/passportsign-badge.svg)](https://rekor.sigstore.dev/api/v1/log/entries/108e9186e8c5677a53b1918ed9b9bbe15194e42714fd3a3f8f0e163d3a22831120a4c540a332e151)

The badge above opens the public Sigstore Rekor log entry. The entry
binds `@cynarlab` to a passport-holding human (disclosing only
Canadian citizenship) via a zero-knowledge proof from the [ZKPassport
SDK](https://zkpassport.id). My passport never leaves my phone;
nothing about who I am beyond that ever touches a server.

This establishes:

> At time *T*, a human holding a valid government-issued passport
> (citizen of Canada, since I chose to disclose) was in control of
> the `@cynarlab` GitHub account.

What this **doesn't** claim, just to be explicit:

- That the code in this repo is human-written.
- That I'm not using AI. I am, extensively.
- That I'm trustworthy or skilled or acting in good faith. Just that
  I'm in control of a passport and a GitHub user and chose to link
  the two.

The full spec of what the badge does and doesn't promise is at
https://passportsign.dev — which was built specifically to answer
this issue. The motivation chain (#77 → tool → reply) is now public
and verifiable end-to-end.

To verify it yourself, with no trust in me or passportsign.dev:

```bash
curl -O https://raw.githubusercontent.com/debugmcp/passportsign/main/docs/evidence/binding.passportsign.json
npx @passportsign/cli verify ./binding.passportsign.json
```

All four cryptographic checks should return PASS.

— JF
