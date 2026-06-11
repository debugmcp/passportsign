import { describe, expect, it, vi } from 'vitest';
import { type RekorClient } from '@passportsign/core/web';
import { route } from '../src/router.js';

const deps = {
  fetch: (async () => new Response('not found', { status: 404 })) as typeof fetch,
  rekor: {
    submitIntoto: vi.fn(),
    getEntry: vi.fn(async () => {
      throw new Error('no entries in this test');
    }),
    getLogInfo: vi.fn(),
    getConsistencyProof: vi.fn(),
  } as RekorClient,
};

describe('route', () => {
  it('GET /badge/<user>.svg returns an SVG with cache headers', async () => {
    const res = await route(new Request('https://passportsign.dev/badge/cynarlab.svg'), deps);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('image/svg+xml');
    expect(res.headers.get('Cache-Control')).toBeTruthy();
    expect(await res.text()).toContain('<svg');
  });

  it('GET /verify/<user> returns an HTML page naming the user', async () => {
    const res = await route(new Request('https://passportsign.dev/verify/cynarlab'), deps);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('cynarlab');
    expect(html).toContain('passportsign');
  });

  it('rejects non-GET methods', async () => {
    const res = await route(
      new Request('https://passportsign.dev/badge/x.svg', { method: 'POST' }),
      deps,
    );
    expect(res.status).toBe(405);
  });

  it('unknown paths return 404', async () => {
    const res = await route(new Request('https://passportsign.dev/nope'), deps);
    expect(res.status).toBe(404);
  });

  it('badge URL requires the .svg suffix', async () => {
    const res = await route(new Request('https://passportsign.dev/badge/cynarlab'), deps);
    expect(res.status).toBe(404);
  });
});
