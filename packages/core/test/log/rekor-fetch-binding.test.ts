import { afterEach, describe, expect, it } from 'vitest';
import { PublicSigstoreRekorClient } from '../../src/log/rekor.js';

/**
 * Browser `window.fetch` throws "Illegal invocation" when called with
 * any `this` other than undefined/globalThis. Node's fetch ignores
 * `this`, so only an emulation catches the regression where the
 * client stores the global fetch as an instance property and thereby
 * rebinds it.
 */
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('PublicSigstoreRekorClient default fetch', () => {
  it('works when the global fetch is this-sensitive (browser semantics)', async () => {
    globalThis.fetch = function (this: unknown) {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            rootHash: 'ab',
            treeSize: 1,
            signedTreeHead: 'sth',
            treeID: 'tree-1',
          }),
          { status: 200 },
        ),
      );
    } as typeof fetch;

    const client = new PublicSigstoreRekorClient();
    const info = await client.getLogInfo();
    expect(info.treeSize).toBe(1);
  });
});
