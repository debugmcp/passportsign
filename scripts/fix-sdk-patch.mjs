// One-shot: make the SDK patch's bridge-Origin forwarding Node-only.
// @obsidion/bridge throws if `origin` is set while running in a browser
// (the browser's own Origin header is authoritative there) — and the
// browser case doesn't need it: the page's origin already matches the
// dashboard-registered domain. Run via:
//   node scripts/fix-sdk-patch.mjs <edit-dir>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const editDir = process.argv[2];
if (!editDir) throw new Error('usage: node fix-sdk-patch.mjs <edit-dir>');

const needle = ',origin:`https://${this.domain}`})';
const replacement = ',...(typeof window>"u"?{origin:`https://${this.domain}`}:{})})';

for (const rel of ['dist/esm/index.js', 'dist/cjs/index.cjs']) {
  const path = join(editDir, rel);
  const src = readFileSync(path, 'utf8');
  const count = src.split(needle).length - 1;
  if (count !== 1) throw new Error(`${rel}: expected exactly 1 origin call site, found ${count}`);
  writeFileSync(path, src.replace(needle, replacement), 'utf8');
  console.log(`${rel}: origin forwarding now Node-only`);
}
