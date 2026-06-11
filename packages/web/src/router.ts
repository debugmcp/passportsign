/**
 * Request routing, separated from the Workers entry so it can be unit
 * tested with injected deps (same DI pattern as core).
 */

import { lookupBindings, type RekorClient } from '@passportsign/core/web';

import { buildBadge, type BadgeHandlerDeps } from './badge-handler.js';
import { renderVerifyPage } from './verify-page.js';

export interface RouteDeps {
  fetch: typeof fetch;
  rekor: RekorClient;
  now?: number;
  operatorIndexBase?: string;
}

const BADGE_PATH = /^\/badge\/([^/]+)\.svg$/;
const VERIFY_PATH = /^\/verify\/([^/]+)$/;

export async function route(request: Request, deps: RouteDeps): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const url = new URL(request.url);

  const badgeMatch = BADGE_PATH.exec(url.pathname);
  if (badgeMatch) {
    const result = await buildBadge(decodeURIComponent(badgeMatch[1]!), deps as BadgeHandlerDeps);
    return new Response(result.svg, {
      status: result.status,
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': result.cacheControl,
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  const verifyMatch = VERIFY_PATH.exec(url.pathname);
  if (verifyMatch) {
    const username = decodeURIComponent(verifyMatch[1]!).toLowerCase();
    const result = await lookupBindings(username, {
      rekor: deps.rekor,
      fetch: deps.fetch,
      ...(deps.now !== undefined ? { now: deps.now } : {}),
    });
    return new Response(renderVerifyPage(username, result), {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    });
  }

  return new Response('not found', { status: 404 });
}
