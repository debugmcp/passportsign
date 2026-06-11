/**
 * Server-rendered verification status page for /verify/<username>.
 *
 * v0.5 interim: the Worker runs the same lookup pipeline as the badge
 * (entry integrity, inclusion proofs, classification) and renders the
 * result. The page says plainly that this rendering comes from the
 * operator — the trustless path is `npx @passportsign/cli verify`
 * against the bundle, and v1.0 replaces this page with one that runs
 * the checks client-side in the reader's own browser.
 */

import { type LookupResult } from '@passportsign/core/web';

function esc(s: string): string {
  return s.replace(/[<>&"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;',
  );
}

const STATE_BADGES: Record<string, string> = {
  active: '<span style="color:#2da44e">&#10003; active</span>',
  stale: '<span style="color:#bf8700">~ stale (older than 12 months)</span>',
  revoked: '<span style="color:#cf222e">&#10007; revoked</span>',
};

export function renderVerifyPage(username: string, result: LookupResult): string {
  const u = esc(username);
  const rows = result.classified
    .map(({ entry, state, revokedBy }) => {
      const predicate = entry.statement.predicate as Record<string, unknown>;
      const date = new Date(entry.integratedTime * 1000).toISOString().slice(0, 10);
      const country =
        typeof predicate['issuing_country'] === 'string'
          ? esc(predicate['issuing_country'] as string)
          : '<em>undisclosed</em>';
      const rekorUrl = `https://rekor.sigstore.dev/api/v1/log/entries/${esc(entry.uuid)}`;
      return `<tr>
        <td>${STATE_BADGES[state] ?? esc(state)}</td>
        <td>${date}</td>
        <td>${country}</td>
        <td><a href="${rekorUrl}"><code>${esc(entry.uuid.slice(0, 16))}&hellip;</code></a>${
          revokedBy ? `<br><small>revoked by <code>${esc(revokedBy.slice(0, 16))}&hellip;</code></small>` : ''
        }</td>
      </tr>`;
    })
    .join('\n');

  const problems = [...result.unreachable, ...result.invalid]
    .map((p) => `<li><code>${esc(p.uuid.slice(0, 16))}&hellip;</code> — ${esc(p.error)}</li>`)
    .join('\n');

  const body =
    result.index === null
      ? `<p><strong>@${u}</strong> has not published a <code>passportsign-index.json</code> —
         no bindings can be discovered. (Expected at
         <code>github.com/${u}/${u}</code>, branch <code>main</code>.)</p>`
      : `<table>
          <thead><tr><th>state</th><th>bound</th><th>country</th><th>rekor entry</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${problems ? `<h2>Problems</h2><ul>${problems}</ul>` : ''}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>passportsign — verify @${u}</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; max-width: 46rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; color: #1f2328; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid #d1d9e0; }
  code { background: #f6f8fa; padding: .1rem .3rem; border-radius: 4px; }
  .note { background: #fff8c5; border: 1px solid #d4a72c66; border-radius: 6px; padding: .75rem 1rem; margin: 1.25rem 0; }
  footer { margin-top: 2rem; font-size: .85rem; color: #59636e; }
</style>
</head>
<body>
<h1>passportsign &mdash; @${u}</h1>
<p>Bindings between <a href="https://github.com/${u}">github.com/${u}</a> and a
passport-holding human, published on the public
<a href="https://rekor.sigstore.dev">Sigstore Rekor</a> transparency log.</p>
${body}
<div class="note">
<strong>What this page checked:</strong> each entry's stored attestation hashes to
what Rekor recorded, its Merkle inclusion proof verifies, and its subject matches
this username. It did <strong>not</strong> re-run the zero-knowledge passport proof,
and it was rendered by the operator &mdash; a skeptic should not take its word.
For operator-independent verification, run
<code>npx @passportsign/cli verify &lt;bundle&gt;</code> against the user's
<code>binding.passportsign.json</code>, or fetch the Rekor entries yourself.
</div>
<footer>
<a href="https://passportsign.dev">passportsign.dev</a> &middot;
<a href="https://github.com/debugmcp/passportsign">source</a> &middot;
The badge asserts accountability evidence, not identity, skill, or good faith.
</footer>
</body>
</html>`;
}
