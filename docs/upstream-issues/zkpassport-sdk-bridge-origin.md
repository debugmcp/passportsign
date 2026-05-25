# zkpassport-packages issue

**Filed:** [zkpassport/zkpassport-packages#211](https://github.com/zkpassport/zkpassport-packages/issues/211)
on 2026-05-25 from the `debugmcpdev` GitHub account.

Title:

> `@zkpassport/sdk` silently blocks phone slider when used from Node — bridge `Origin` defaults to `"nodejs"` instead of project domain

---

## Body

### Summary

When `@zkpassport/sdk` is used from a Node.js context (CLI, server-side
verification flow), `Bridge.create()` is called without an `origin`
option. `@obsidion/bridge` then defaults the WebSocket `Origin` header
to the string `"nodejs"`:

```js
// @obsidion/bridge/dist/{esm,cjs}/bridge-connection.{js,cjs}
return new WebSocketImpl(url, { headers: { Origin: origin || "nodejs" } });
```

The mobile app validates that `Origin` against the project's primary
domain (`_bridgeOrigin`). `"nodejs"` doesn't match any registered
domain, so the phone enters a silent **"unrecognized"** state:

- **No** Trusted Domain badge (green check)
- **No** Untrusted Domain warning ("proceed at your own risk")
- The Confirm slider is permanently disabled — user cannot proceed
- **No error surfaced to the SDK** — `onError` is not invoked

This appears to be the same symptom as the open
[#150 — Unsure how to debug "There was an issue verifying the connection to the website."](https://github.com/zkpassport/zkpassport-packages/issues/150),
which has been unresolved for ~2 months.

### Repro

```ts
import { ZKPassport } from "@zkpassport/sdk";
import qrcode from "qrcode-terminal";

const z = new ZKPassport("your-registered-domain.example");
const qb = await z.request({});
const { url, onResult } = qb.policy("your-policy-id").done();
qrcode.generate(url, { small: true }, (qr) => console.log(qr));
onResult((r) => console.log("verified:", r.verified));
```

With a passport loaded and a registered domain, the phone displays the
request name and disclosure but the slider never activates. The bridge
WebSocket `Origin` header is `"nodejs"`.

(Confirming this is the cause: locally patching the SDK to pass
`` origin: `https://${this.domain}` `` to `Bridge.create()` makes the
slider activate and the Trusted Domain badge appear, with no other
changes.)

### Fix

In `packages/zkpassport-sdk/src/...` (wherever `request()` calls
`Bridge.create()`):

```diff
-const n = await Bridge.create({ keyPair, bridgeId, bridgeUrl })
+const n = await Bridge.create({
+  keyPair,
+  bridgeId,
+  bridgeUrl,
+  origin: `https://${this.domain}`,
+})
```

The bridge code already forwards `origin` correctly down to
`getWebSocketClient`, so this is a one-line change.

### Related Node-compat issues (less critical)

While debugging this on Node 24, I hit two other published-build issues
in the same SDK. Filing them here for visibility, happy to split into
separate issues/PRs:

1. **`import 'buffer/'` (trailing slash) in the published ESM bundle.**
   The trailing slash forces Node's resolver into directory-resolution
   that walks through TS extensions (under `tsx`), ultimately trying
   `buffer/index.jsx` and failing with `ERR_MODULE_NOT_FOUND`. Drop the
   slash so Node uses its built-in `buffer`:

   ```diff
   -import { Buffer } from 'buffer/'
   +import { Buffer } from 'buffer'
   ```

2. **Named imports from `i18n-iso-countries`.** The package's
   `entry-node.js` does `module.exports = library` via a variable
   assignment, which Node's `cjs-module-lexer` cannot statically
   analyze. Named imports fail at module load:
   `SyntaxError: The requested module 'i18n-iso-countries' does not
   provide an export named 'getAlpha3Code'`. Fix in the SDK:

   ```diff
   -import { registerLocale, getAlpha3Code } from 'i18n-iso-countries'
   +import iso from 'i18n-iso-countries'
   +const { registerLocale, getAlpha3Code } = iso
   ```

### Environment

- `@zkpassport/sdk` 0.15.1
- `@obsidion/bridge` 0.11.2
- Node.js 24.14.1, pnpm 10.33.0, Windows 11 + macOS (both affected)
- Real e-passport, registered domain on the dashboard, DNS-verified,
  policy created. Same symptom whether `disableProofStorage` is set or
  not, whether `devMode` is on (with mock passport) or off (real).

### Why this matters

The Sigstore community has projects building on this SDK in non-browser
contexts (CLIs, server-side verification, build-time attestation flows).
Without this fix, any such project hits a silent dead-end that takes
hours to diagnose because the failure mode doesn't surface to the SDK's
`onError` callback.

Happy to send a PR if helpful.
