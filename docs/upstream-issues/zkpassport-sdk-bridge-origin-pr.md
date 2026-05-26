# Upstream PR — `fix(sdk): forward origin to Bridge.create`

Resolves issue [zkpassport/zkpassport-packages#211](https://github.com/zkpassport/zkpassport-packages/issues/211)
(filed by `@debugmcpdev` on 2026-05-25). Matches the silent-slider
symptom in the older open issue
[zkpassport/zkpassport-packages#150](https://github.com/zkpassport/zkpassport-packages/issues/150).

## To submit (one-shot, from `@cynarlab` or `@debugmcpdev`)

```bash
gh repo fork zkpassport/zkpassport-packages --clone --remote
cd zkpassport-packages
git checkout -b fix-bridge-origin-for-node
# Apply the one-line edit shown in the diff below (packages/zkpassport-sdk/src/index.ts line ~681)
git commit -am "fix(sdk): forward origin to Bridge.create so Node integrations get the Trusted Domain badge"
git push -u origin fix-bridge-origin-for-node
gh pr create --repo zkpassport/zkpassport-packages \
  --title "fix(sdk): forward origin to Bridge.create so Node integrations get the Trusted Domain badge" \
  --body-file ../passportsign/docs/upstream-issues/zkpassport-sdk-bridge-origin-pr-body.md
```

(Adjust the `--body-file` path to wherever you have this repo cloned.)

---

## Title

```
fix(sdk): forward origin to Bridge.create so Node integrations get the Trusted Domain badge
```

## Body

See [`zkpassport-sdk-bridge-origin-pr-body.md`](./zkpassport-sdk-bridge-origin-pr-body.md)
(separate file so it can be passed verbatim to `gh pr create --body-file`).

## The diff

```diff
--- a/packages/zkpassport-sdk/src/index.ts
+++ b/packages/zkpassport-sdk/src/index.ts
@@ -677,6 +677,7 @@
     const bridge = await Bridge.create({
       keyPair: keyPairOverride,
       bridgeId: topicOverride,
       bridgeUrl,
+      origin: `https://${this.domain}`,
     })
```

That's it. One line.
