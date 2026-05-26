Resolves #211. Matches symptom in #150.

## Background

`@zkpassport/sdk` calls `Bridge.create()` without forwarding an
`origin` option. `@obsidion/bridge` defaults the WebSocket `Origin`
header to the string `"nodejs"` when no origin is passed:

```js
// @obsidion/bridge/dist/{esm,cjs}/bridge-connection
return new WebSocketImpl(url, { headers: { Origin: origin || "nodejs" } });
```

The mobile app validates that `Origin` against the project's primary
domain (`_bridgeOrigin`). `"nodejs"` doesn't match any registered
domain, so the phone enters a silent "unrecognized" state on Node
integrations:

- **no** Trusted Domain badge
- **no** untrusted-domain warning (the in-between state most users see)
- the Confirm slider is permanently disabled
- **no error surfaced to the SDK** — `onError` is not invoked

In a browser this never bites, because the WebSocket spec forces
`Origin` to the real page origin (the browser security boundary
enforces it). It only manifests for Node consumers — CLIs,
server-side flows, scripted verifiers, etc.

## Reproducer (without the fix)

Issue #211 has a full reproducer. Minimal version:

```ts
import { ZKPassport } from "@zkpassport/sdk";
const zk = new ZKPassport("my-registered-domain.example");
const qb = await zk.request({});
const { url, onResult } = qb.policy("my-policy").done();
console.log("Scan:", url); // QR rendered from this
onResult((r) => console.log("verified:", r.verified));
```

On a registered domain with a real passport loaded: phone shows the
request shell but the slider never enables, no badge, no warning.
The bridge `Origin` header is `"nodejs"` instead of the project domain.

## Fix

Forward `origin: \`https://${this.domain}\`` to `Bridge.create()`.
The bridge code already accepts an `origin` option and passes it
through `getWebSocketClient` to the WebSocket headers — this PR just
wires it from the existing `this.domain`.

```diff
     const bridge = await Bridge.create({
       keyPair: keyPairOverride,
       bridgeId: topicOverride,
       bridgeUrl,
+      origin: `https://${this.domain}`,
     })
```

## Verification

I built a project (`passportsign`) that consumes this SDK from a
Node CLI, hit exactly this dead-end while debugging, and locally
patched the SDK with the change above. After the patch:

- The phone immediately shows the **Trusted Domain** badge for the
  registered domain.
- The Confirm slider enables.
- Proofs flow back through `onResult`, `verified: true`.

A real-passport binding produced through the patched SDK is now
permanent in public Sigstore Rekor:
[`108e9186e8c5677a…2e151`](https://rekor.sigstore.dev/api/v1/log/entries/108e9186e8c5677a53b1918ed9b9bbe15194e42714fd3a3f8f0e163d3a22831120a4c540a332e151)
— the v0 ship evidence of a project explicitly built on top of this SDK
for non-browser use.

## Why this matters

A handful of projects in the Sigstore ecosystem (and adjacent
identity-attestation tooling) want to use this SDK from Node — for
CLI tools, server-side verification flows, build-time attestation,
etc. Without this fix every such project hits a silent dead-end that
takes hours to diagnose because the failure mode surfaces nowhere in
the SDK's callbacks. Browser integrators never see this.

Happy to add a unit test (e.g., asserting `bridge.origin` is set to
`https://${domain}`) if useful — let me know the test style you'd
prefer.
