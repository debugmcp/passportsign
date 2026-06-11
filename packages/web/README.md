# @passportsign/web

The hosted surface (roadmap v0.5.4): a Cloudflare Worker serving

- `GET /badge/<username>.svg` — live-state badge (green `active`,
  yellow `stale`, red `revoked`, gray `unknown`)
- `GET /verify/<username>` — human-readable verification status page

There is **no database**. State is derived per-request from two
sources, with CDN caching in front:

1. the user's published index —
   `https://raw.githubusercontent.com/<u>/<u>/main/passportsign-index.json`
2. the operator overlay — `https://passportsign.dev/index/<u>.json`
   (the `docs/index/` directory of this repo, served by GitHub Pages,
   appended to via PR)

every Rekor entry either file references is fetched from
`rekor.sigstore.dev`, integrity-checked against the entry's recorded
`payloadHash`, its inclusion proof verified, and its subject matched
against the username before it counts.

## What the badge asserts (and what it doesn't)

The badge asserts: *a well-formed passportsign entry for this username
is included in the public Rekor log and has not been revoked.* The
Worker does **not** re-run the zero-knowledge passport proof (bb.js is
far beyond Worker CPU/memory limits). Per spec §8: treat the badge as
a thumbnail — the click-through Rekor entry and
`npx @passportsign/cli verify <bundle>` are the real evidence.

## Why two index sources

The user index lives in a repo the GitHub account controls, so an
account hijacker could scrub a revocation from it. Revocations from
**either** source count; the operator overlay is the true owner's
recovery channel (append-only via PR to this repo). See spec §7.

## Why anyone can run this

The Worker holds no state and no keys. Point the same code at the same
log and you get the same answers — that's the federation property
(spec §7): the operator is a convenience, not a trust authority.

## Develop / deploy

```
pnpm --filter @passportsign/web dev      # wrangler dev on :8787
pnpm --filter @passportsign/web test
pnpm --filter @passportsign/web deploy   # first target: workers.dev
```

Custom-domain routes (`passportsign.dev/badge/*`, `/verify/*`) are
commented out in `wrangler.toml` until the zone moves to Cloudflare;
everything not matched by a route continues to be served by GitHub
Pages.

## Staleness lag

raw.githubusercontent's CDN (~5 min) plus the badge's own
`max-age=300` means a bind/revoke can take ~10 minutes to show. Known
and accepted; Rekor entries themselves are immutable and cached for a
day.
