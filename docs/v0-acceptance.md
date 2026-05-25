# v0 acceptance evidence

Manual checklist + living evidence for passportsign v0. Updated as each
gate is exercised.

---

## Day 0 — SDK prototype (HARD GATE)

Script: `packages/cli/src/prototype-day0.ts`

Run:

```
pnpm --filter @passportsign/cli exec tsx src/prototype-day0.ts
```

### Pre-flight

- [ ] **ZKPassport mobile app installed** on a phone with NFC.
  - [iOS App Store](https://apps.apple.com/us/app/zkpassport/id6477371975) — requires iOS 15.2+.
  - [Google Play](https://play.google.com/store/apps/details?id=app.zkpassport.zkpassport).
- [ ] **Physical NFC-enabled passport** (ICAO 9303). Most modern e-passports work.
- [ ] **Phone has internet access.** Does NOT need to be on the same LAN
      as the laptop — the SDK uses a hosted relay
      (`@obsidion/bridge` + websocket).

### Four-point gate (all must PASS to proceed)

| # | Criterion                                  | Status | Notes |
|---|--------------------------------------------|--------|-------|
| 1 | QR renders in terminal                     | PASS (2026-05-25) | `qrcode-terminal` renders the SDK's URL. |
| 2 | Phone scan reaches the SDK's bridge        | PASS (2026-05-25) | Yellow "Trusted Domain" badge confirmed in ZKPassport mobile app. |
| 3 | Proof comes back and parses cleanly        | PASS (2026-05-25) | 4 proofs received: `sig_check_dsc_tbs_*`, `data_check_integrity_*`, `sig_check_id_data_tbs_*`, `disclose_bytes`. |
| 4 | SDK verifier accepts the proof             | PASS (2026-05-25) | `verified: true`. Unique identifier `13902036709356453377929569764273223082772964910104338589480118024404105097567` (scoped to `passportsign.dev:nationality-disclose`). Nationality disclosed: `CAN`. |

Any failure on 1–4 is a re-plan trigger.

### Day 0 — root-cause notes (so the next person isn't stuck for hours)

The published `@zkpassport/sdk@0.15.1` does not work in a Node CLI out of
the box. Three issues, all patched via `patches/@zkpassport__sdk@0.15.1.patch`
(pinned in `pnpm-workspace.yaml` under `patchedDependencies`):

1. **`from 'buffer/'` (trailing slash)** — forces resolution to the
   `buffer` polyfill the way browser bundlers expect; on Node ESM the
   resolver flails through extensions and tsx ultimately tries
   `buffer/index.jsx`, failing. Fix: drop the slash → uses Node's
   built-in `buffer`.
2. **Named import from `i18n-iso-countries`** — the package's
   `entry-node.js` uses `module.exports = library` (assigned through a
   variable) which Node's `cjs-module-lexer` can't statically analyze,
   so `getAlpha3Code` etc. aren't surfaced as named exports. Fix:
   default-import the module and destructure after.
3. **Bridge `Origin` header defaults to `"nodejs"`** — `@obsidion/bridge`
   sends `Origin: nodejs` when the SDK doesn't pass an `origin` option
   to `Bridge.create`. The phone validates the WebSocket Origin against
   the project's primary domain; `nodejs` ≠ `passportsign.dev`, so it
   silently enters the "unrecognized" third state (no Trusted Domain
   badge, no untrusted-warning, slider blocked). Fix: pass
   `` origin: `https://${this.domain}` `` to `Bridge.create`. After the
   patch the phone shows the Trusted Domain badge and proofs flow.

Upstream is one line each — worth filing as an issue/PR on
[zkpassport-packages](https://github.com/zkpassport/zkpassport-packages).
Open issue [#150](https://github.com/zkpassport/zkpassport-packages/issues/150)
already reports symptom (3) without a known cause.

### zkPassport dashboard setup (one-time)

- Project: `passportsign` at [dashboard.zkpassport.id](https://dashboard.zkpassport.id/)
- Project ID: `9e5e0e19-216b-48ff-897b-764347517af2`
- Domain: `passportsign.dev` (verified via DNS TXT `_zkpassport` =
  `zkpassport-verify=passportsign.dev`)
- Policy: `nationality-disclose` (discloses `nationality`)
- Allowed origins: none (primary domain is implicit)

### Day 0.5 — network-setup story

After the gate passes on a happy path, probe the realistic setup:

- [ ] Phone on mobile data (not WiFi). Does it still work? (Expected
      yes — SDK uses a public relay.)
- [ ] Laptop on a corporate / restrictive network (outbound HTTPS only).
      Does the SDK's websocket negotiate? Document any required
      egress allowlist (Obsidion bridge endpoints).
- [ ] If anything requires a tunnel (ngrok or similar), document in
      README.

---

## Day 5 — Rekor smoke test (PASS, 2026-05-25)

One throwaway in-toto entry submitted to `rekor.sigstore.dev` to pin
the shape of the production Rekor client.

**Living evidence (permanent record):**

```
UUID:            108e9186e8c5677a083861840595aefe2c2b960164213d8a439199a631d8df3a2ec2b2cf6a27d326
logIndex:        1630811209
integratedTime:  1779739312
logID:           c0d23d6ad406973f9559f3ba2d1ca01f84147d8ffc5b8445c224f98b9591801d
predicateType:   https://dev.passportsign.dev/smoke-test/v1
```

Inspect at:
https://rekor.sigstore.dev/api/v1/log/entries/108e9186e8c5677a083861840595aefe2c2b960164213d8a439199a631d8df3a2ec2b2cf6a27d326

### What we learned (for the production client)

- **Entry type version**: `intoto` v0.0.2 is the accepted shape on the
  public instance.
- **Body shape gotchas** (different from the published OpenAPI schema):
  - `payload` and `sig` are **double-base64** at the Rekor API
    boundary (the DSSE base64 wrapped again as `strfmt.Base64`).
  - `publicKey` is single-base64 over the PEM bytes.
  - `keyid` must be **omitted entirely** if empty (Rekor strips it,
    sending `""` causes the canonicalised entry hash to mismatch).
  - `hash` and `payloadHash` are **required despite readOnly markers**.
    - `payloadHash` = sha256(canonical statement bytes).
    - `hash` = sha256(canonical JSON of `{payloadType, payload-base64,
      signatures:[{sig-base64, publicKey: PEM-string}]}`). Note
      publicKey is raw PEM **string** for this hash, not base64.
- **Signature algorithm**: ECDSA P-256 over SHA-256, DER-encoded.
  Ed25519 was rejected (500 "error generating canonicalised entry").
- **Response shape** (POST and GET): top-level wrapper is `{ <uuid>: {
  attestation, body, integratedTime, logID, logIndex, verification } }`.
- **`verification`** holds `inclusionProof` and `signedEntryTimestamp`.
  `inclusionProof.hashes` is ~18 deep at the current treeSize
  (~1.5 G entries).
- **`/api/v1/log/entries/retrieve`** by UUID works. By
  `hash: sha256:<payloadHash>` returned 0 entries for our submission —
  meaning **`rebuild` cannot enumerate our entries by payload hash on
  the public log.** Documented as deferral against acceptance #4 below.

### Acceptance criterion #4 — decision

Per the Day 5 finding above, the **`rebuild` command is explicitly
deferred to v1**. Rekor's public `/retrieve` endpoint doesn't index by
predicate type or payload hash for our entries, so reconstructing the
SQLite cache from log entries at public-log scale would require
walking the full log by `logIndex` — not feasible for a CLI.

v0 closure criterion #4 (revised): "rebuild deferred to v1; rationale
captured in Day 5 evidence above. The local cache is best-effort and
re-derivable in v1 via richer indexing once available."

## Day 7 — real-passport E2E (revised criteria, 6 items)

To be filled in when Day 7 runs.

1. **Bundle + Rekor entry produced from real passport.** TBD.
2. **Second machine verifies via bundle only.** TBD.
3. **Third party reads public Sigstore Rekor, identifies entry by
   predicateType, verifies.** TBD.
4. **`passportsign rebuild` reconstructs cache** (or documented
   deferral per Day-5 finding). TBD.
5. **Canonical-JCS test vectors pinned and verifier passes them.**
   TBD.
6. **README documents network constraints from Day 0.5.** TBD.

### Living evidence

Real-passport Rekor entry hash from Day 7 (committed here as permanent
proof that v0 shipped):

```
<rekor entry uuid TBD>
```

Inspect it at:

```
https://rekor.sigstore.dev/api/v1/log/entries/<uuid TBD>
```
