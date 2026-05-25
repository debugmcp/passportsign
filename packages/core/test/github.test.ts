import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';

import { checkGistControl } from '../src/github.js';
import { PassportsignError } from '../src/errors.js';

const USERNAME = 'johnf';
const FILENAME = 'passportsign.txt';
const NONCE = 'zkm-johnf-abcdefghijklmnopqrstuvwxyz234567';
const INIT_AT = new Date('2026-05-25T10:00:00.000Z');
const GIST_AT = new Date('2026-05-25T10:30:00.000Z');

interface FetchPlan {
  listResponse?: Partial<Response> & {
    status?: number;
    body?: unknown;
    bodyRaw?: string;
    throw?: Error;
  };
  detailResponse?: Partial<Response> & {
    status?: number;
    body?: unknown;
    bodyRaw?: string;
    throw?: Error;
  };
}

function makeResponse(opts: {
  status?: number;
  body?: unknown;
  bodyRaw?: string;
}): Response {
  const status = opts.status ?? 200;
  if (opts.bodyRaw !== undefined) {
    return new Response(opts.bodyRaw, { status });
  }
  return new Response(JSON.stringify(opts.body ?? null), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function buildFetch(plan: FetchPlan): typeof fetch {
  return async (url: RequestInfo | URL) => {
    const u = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
    if (u.includes('/users/')) {
      if (plan.listResponse?.throw) throw plan.listResponse.throw;
      return makeResponse(plan.listResponse ?? {});
    }
    if (u.includes('/gists/')) {
      if (plan.detailResponse?.throw) throw plan.detailResponse.throw;
      return makeResponse(plan.detailResponse ?? {});
    }
    throw new Error(`unexpected URL in test: ${u}`);
  };
}

function goodListEntry(updatedAt = GIST_AT.toISOString()) {
  return {
    id: 'gist-id-abc',
    html_url: 'https://gist.github.com/johnf/abc',
    updated_at: updatedAt,
    owner: { login: 'johnf' },
    files: { [FILENAME]: { filename: FILENAME } },
  };
}

function goodDetail(content = NONCE, updatedAt = GIST_AT.toISOString(), ownerLogin = 'johnf') {
  return {
    id: 'gist-id-abc',
    html_url: 'https://gist.github.com/johnf/abc',
    updated_at: updatedAt,
    owner: { login: ownerLogin },
    files: { [FILENAME]: { filename: FILENAME, content } },
  };
}

async function expectCode(p: Promise<unknown>, code: string): Promise<void> {
  try {
    await p;
    throw new Error('expected rejection');
  } catch (e) {
    expect(e).toBeInstanceOf(PassportsignError);
    expect((e as PassportsignError).code).toBe(code);
  }
}

describe('checkGistControl — happy path', () => {
  it('returns GistEvidence with url, content_sha256, updated_at', async () => {
    const fetchImpl = buildFetch({
      listResponse: { body: [goodListEntry()] },
      detailResponse: { body: goodDetail() },
    });
    const ev = await checkGistControl({
      username: USERNAME,
      expected_filename: FILENAME,
      expected_content: NONCE,
      not_before: INIT_AT,
      fetch: fetchImpl,
    });
    expect(ev.url).toBe('https://gist.github.com/johnf/abc');
    expect(ev.updated_at).toBe(GIST_AT.toISOString());
    expect(ev.content_sha256).toBe(createHash('sha256').update(NONCE).digest('hex'));
  });

  it('picks the most recently-updated matching gist when multiple exist', async () => {
    const older = { ...goodListEntry('2026-05-24T00:00:00.000Z'), id: 'older' };
    const newer = goodListEntry();
    const fetchImpl = buildFetch({
      listResponse: { body: [older, newer] },
      detailResponse: { body: goodDetail() },
    });
    const ev = await checkGistControl({
      username: USERNAME,
      expected_filename: FILENAME,
      expected_content: NONCE,
      not_before: INIT_AT,
      fetch: fetchImpl,
    });
    expect(ev.url).toBe('https://gist.github.com/johnf/abc');
  });

  it('forwards token as Bearer authorization', async () => {
    let seenHeader: string | undefined;
    const fetchImpl: typeof fetch = async (_url, init) => {
      const headers = new Headers(init?.headers);
      seenHeader = headers.get('authorization') ?? undefined;
      // Always return the list path, then short-circuit
      return makeResponse({ body: [goodListEntry()] });
    };
    // Hijack: only call list once via custom test wrapper
    try {
      await checkGistControl({
        username: USERNAME,
        expected_filename: FILENAME,
        expected_content: NONCE,
        not_before: INIT_AT,
        token: 'ghp_test_token',
        fetch: fetchImpl,
      });
    } catch {
      // We expect this to fail on the detail step (since we return list shape).
    }
    expect(seenHeader).toBe('Bearer ghp_test_token');
  });
});

describe('checkGistControl — §4 error paths', () => {
  it('username_invalid: empty username', async () => {
    await expectCode(
      checkGistControl({
        username: '',
        expected_filename: FILENAME,
        expected_content: NONCE,
        not_before: INIT_AT,
        fetch: buildFetch({}),
      }),
      'username_invalid',
    );
  });

  it('username_invalid: list returns 404', async () => {
    const fetchImpl = buildFetch({ listResponse: { status: 404, body: { message: 'Not Found' } } });
    await expectCode(
      checkGistControl({
        username: 'nonexistent',
        expected_filename: FILENAME,
        expected_content: NONCE,
        not_before: INIT_AT,
        fetch: fetchImpl,
      }),
      'username_invalid',
    );
  });

  it('gist_not_found: no gist with matching filename', async () => {
    const noMatch = { ...goodListEntry(), files: { 'other.txt': { filename: 'other.txt' } } };
    const fetchImpl = buildFetch({ listResponse: { body: [noMatch] } });
    await expectCode(
      checkGistControl({
        username: USERNAME,
        expected_filename: FILENAME,
        expected_content: NONCE,
        not_before: INIT_AT,
        fetch: fetchImpl,
      }),
      'gist_not_found',
    );
  });

  it('gist_not_found: empty gists list', async () => {
    const fetchImpl = buildFetch({ listResponse: { body: [] } });
    await expectCode(
      checkGistControl({
        username: USERNAME,
        expected_filename: FILENAME,
        expected_content: NONCE,
        not_before: INIT_AT,
        fetch: fetchImpl,
      }),
      'gist_not_found',
    );
  });

  it('gist_wrong_owner: detail owner differs from username', async () => {
    const fetchImpl = buildFetch({
      listResponse: { body: [goodListEntry()] },
      detailResponse: { body: goodDetail(NONCE, GIST_AT.toISOString(), 'imposter') },
    });
    await expectCode(
      checkGistControl({
        username: USERNAME,
        expected_filename: FILENAME,
        expected_content: NONCE,
        not_before: INIT_AT,
        fetch: fetchImpl,
      }),
      'gist_wrong_owner',
    );
  });

  it('gist_wrong_owner: case-insensitive match passes', async () => {
    const fetchImpl = buildFetch({
      listResponse: { body: [goodListEntry()] },
      detailResponse: { body: goodDetail(NONCE, GIST_AT.toISOString(), 'JOHNF') },
    });
    await expect(
      checkGistControl({
        username: USERNAME,
        expected_filename: FILENAME,
        expected_content: NONCE,
        not_before: INIT_AT,
        fetch: fetchImpl,
      }),
    ).resolves.toBeDefined();
  });

  it('gist_wrong_content: content differs from expected', async () => {
    const fetchImpl = buildFetch({
      listResponse: { body: [goodListEntry()] },
      detailResponse: { body: goodDetail('different content') },
    });
    await expectCode(
      checkGistControl({
        username: USERNAME,
        expected_filename: FILENAME,
        expected_content: NONCE,
        not_before: INIT_AT,
        fetch: fetchImpl,
      }),
      'gist_wrong_content',
    );
  });

  it('gist_wrong_content: trailing whitespace fails (exact match enforced)', async () => {
    const fetchImpl = buildFetch({
      listResponse: { body: [goodListEntry()] },
      detailResponse: { body: goodDetail(NONCE + '\n') },
    });
    await expectCode(
      checkGistControl({
        username: USERNAME,
        expected_filename: FILENAME,
        expected_content: NONCE,
        not_before: INIT_AT,
        fetch: fetchImpl,
      }),
      'gist_wrong_content',
    );
  });

  it('gist_wrong_content: file present but no content field', async () => {
    const detail = goodDetail();
    detail.files[FILENAME] = { filename: FILENAME };
    const fetchImpl = buildFetch({
      listResponse: { body: [goodListEntry()] },
      detailResponse: { body: detail },
    });
    await expectCode(
      checkGistControl({
        username: USERNAME,
        expected_filename: FILENAME,
        expected_content: NONCE,
        not_before: INIT_AT,
        fetch: fetchImpl,
      }),
      'gist_wrong_content',
    );
  });

  it('gist_predates_init: updated_at before init timestamp', async () => {
    const before = '2026-05-25T09:00:00.000Z'; // before INIT_AT (10:00)
    const fetchImpl = buildFetch({
      listResponse: { body: [goodListEntry(before)] },
      detailResponse: { body: goodDetail(NONCE, before) },
    });
    await expectCode(
      checkGistControl({
        username: USERNAME,
        expected_filename: FILENAME,
        expected_content: NONCE,
        not_before: INIT_AT,
        fetch: fetchImpl,
      }),
      'gist_predates_init',
    );
  });

  it('internal_error: list returns 500', async () => {
    const fetchImpl = buildFetch({ listResponse: { status: 500, body: {} } });
    await expectCode(
      checkGistControl({
        username: USERNAME,
        expected_filename: FILENAME,
        expected_content: NONCE,
        not_before: INIT_AT,
        fetch: fetchImpl,
      }),
      'internal_error',
    );
  });

  it('internal_error: list throws network error', async () => {
    const fetchImpl = buildFetch({ listResponse: { throw: new Error('econnreset') } });
    await expectCode(
      checkGistControl({
        username: USERNAME,
        expected_filename: FILENAME,
        expected_content: NONCE,
        not_before: INIT_AT,
        fetch: fetchImpl,
      }),
      'internal_error',
    );
  });

  it('internal_error: detail returns 500', async () => {
    const fetchImpl = buildFetch({
      listResponse: { body: [goodListEntry()] },
      detailResponse: { status: 500, body: {} },
    });
    await expectCode(
      checkGistControl({
        username: USERNAME,
        expected_filename: FILENAME,
        expected_content: NONCE,
        not_before: INIT_AT,
        fetch: fetchImpl,
      }),
      'internal_error',
    );
  });

  it('internal_error: list body is not an array', async () => {
    const fetchImpl = buildFetch({ listResponse: { body: { not: 'an array' } } });
    await expectCode(
      checkGistControl({
        username: USERNAME,
        expected_filename: FILENAME,
        expected_content: NONCE,
        not_before: INIT_AT,
        fetch: fetchImpl,
      }),
      'internal_error',
    );
  });

  it('internal_error: list body is non-JSON', async () => {
    const fetchImpl = buildFetch({ listResponse: { bodyRaw: '<<not json>>' } });
    await expectCode(
      checkGistControl({
        username: USERNAME,
        expected_filename: FILENAME,
        expected_content: NONCE,
        not_before: INIT_AT,
        fetch: fetchImpl,
      }),
      'internal_error',
    );
  });
});
