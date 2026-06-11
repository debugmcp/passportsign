/**
 * Badge resolution (roadmap v0.5.4): username → published index (user
 * file + operator overlay) → verified Rekor entries → state → SVG.
 *
 * What the badge asserts: a well-formed passportsign entry for this
 * username is included in the public Rekor log and not revoked. The
 * Worker deliberately does NOT re-run ZK proof verification (bb.js is
 * far beyond Worker limits) — the click-through Rekor entry and
 * `passportsign verify` are the real evidence (spec §8: treat the
 * badge as a thumbnail).
 *
 * The operator overlay (`passportsign.dev/index/<user>.json`, an
 * append-only file in the project repo) exists because the user index
 * lives in a repo the account controls: an account hijacker could
 * scrub a revocation from it. Revocations from EITHER source count.
 */

import {
  fetchProfileIndex,
  lookupFromIndex,
  mergeProfileIndexes,
  renderBadgeSvg,
  type ClassifiedBinding,
  type ProfileIndex,
  type RekorClient,
} from '@passportsign/core/web';

export interface BadgeHandlerDeps {
  fetch: typeof fetch;
  rekor: RekorClient;
  now?: number;
  /** Base URL of the operator overlay; default `https://passportsign.dev/index`. */
  operatorIndexBase?: string;
}

export interface BadgeResult {
  svg: string;
  status: number;
  cacheControl: string;
}

const GITHUB_USERNAME = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/;
const ACTIVE_CACHE = 'public, max-age=300, s-maxage=300, stale-while-revalidate=600';
const UNKNOWN_CACHE = 'public, max-age=60';

function unknownBadge(): string {
  const label = 'passportsign';
  const value = 'unknown';
  const labelW = label.length * 7 + 16;
  const valueW = value.length * 7 + 16;
  const totalW = labelW + valueW;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="20" role="img" aria-label="${label}: ${value}">`,
    `<title>${label}: ${value}</title>`,
    `<clipPath id="r"><rect width="${totalW}" height="20" rx="3" fill="#fff"/></clipPath>`,
    `<g clip-path="url(#r)">`,
    `<rect width="${labelW}" height="20" fill="#555"/>`,
    `<rect x="${labelW}" width="${valueW}" height="20" fill="#9f9f9f"/>`,
    `</g>`,
    `<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="110" text-rendering="geometricPrecision">`,
    `<text x="${labelW * 5}" y="140" transform="scale(.1)">${label}</text>`,
    `<text x="${(labelW + valueW / 2) * 10}" y="140" transform="scale(.1)">${value}</text>`,
    `</g>`,
    `</svg>`,
  ].join('');
}

/** active > stale > revoked; newest inclusion time within the winning group. */
function pickPrimary(classified: ClassifiedBinding[]): ClassifiedBinding | null {
  for (const state of ['active', 'stale', 'revoked'] as const) {
    const group = classified.filter((c) => c.state === state);
    if (group.length > 0) {
      return group.reduce((a, b) => (b.entry.integratedTime > a.entry.integratedTime ? b : a));
    }
  }
  return null;
}

export async function buildBadge(
  usernameRaw: string,
  deps: BadgeHandlerDeps,
): Promise<BadgeResult> {
  const username = usernameRaw.toLowerCase();
  if (!GITHUB_USERNAME.test(username)) {
    return { svg: unknownBadge(), status: 200, cacheControl: UNKNOWN_CACHE };
  }

  const overlayBase = deps.operatorIndexBase ?? 'https://passportsign.dev/index';

  let userIndex: ProfileIndex | null = null;
  let overlay: ProfileIndex | null = null;
  try {
    [userIndex, overlay] = await Promise.all([
      fetchProfileIndex(username, { fetch: deps.fetch }),
      fetchProfileIndex(username, {
        fetch: deps.fetch,
        url: `${overlayBase}/${username}.json`,
      }),
    ]);
  } catch {
    // Malformed index or upstream failure — render unknown rather than 5xx
    // (the badge must always produce an image for <img> consumers).
    return { svg: unknownBadge(), status: 200, cacheControl: UNKNOWN_CACHE };
  }

  let index: ProfileIndex | null = userIndex;
  if (userIndex && overlay) {
    try {
      index = mergeProfileIndexes(userIndex, overlay);
    } catch {
      index = userIndex; // overlay for a different user — ignore it
    }
  } else if (overlay) {
    index = overlay;
  }

  if (!index || index.bindings.length === 0) {
    return { svg: unknownBadge(), status: 200, cacheControl: UNKNOWN_CACHE };
  }

  const result = await lookupFromIndex(index, {
    rekor: deps.rekor,
    ...(deps.now !== undefined ? { now: deps.now } : {}),
  });
  const primary = pickPrimary(result.classified);
  if (!primary) {
    return { svg: unknownBadge(), status: 200, cacheControl: UNKNOWN_CACHE };
  }

  const predicate = primary.entry.statement.predicate as Record<string, unknown>;
  const svg = renderBadgeSvg({
    github_username: username,
    issuing_country:
      typeof predicate['issuing_country'] === 'string'
        ? (predicate['issuing_country'] as string)
        : null,
    bound_at: new Date(primary.entry.integratedTime * 1000).toISOString(),
    log_entry_hash: primary.entry.uuid,
    state: primary.state,
  });

  return { svg, status: 200, cacheControl: ACTIVE_CACHE };
}
