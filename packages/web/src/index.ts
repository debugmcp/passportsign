/**
 * Cloudflare Workers entry. All logic lives in `router.ts` /
 * `badge-handler.ts` (unit-tested with injected deps); this file only
 * wires the real platform pieces:
 *
 * - Rekor entries are immutable once included, so entry GETs ride
 *   Cloudflare's edge cache for a day (`cf.cacheTtl`). Index files
 *   change when users bind/revoke — short TTL.
 */

import { PublicSigstoreRekorClient } from '@passportsign/core/web';

import { route } from './router.js';

/** fetch with Cloudflare edge caching hints. */
function cachingFetch(cacheTtlSeconds: number): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, {
      ...init,
      cf: { cacheTtl: cacheTtlSeconds, cacheEverything: true },
    } as RequestInit)) as typeof fetch;
}

export default {
  async fetch(request: Request): Promise<Response> {
    return route(request, {
      // Index files: users push updates; keep the lag within the badge's own cache window.
      fetch: cachingFetch(120),
      // Entries are immutable; cache hard.
      rekor: new PublicSigstoreRekorClient({ fetch: cachingFetch(86400) }),
    });
  },
};
