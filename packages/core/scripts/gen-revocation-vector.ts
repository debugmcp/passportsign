// One-shot generator for the revocation canonical vector appended to
// test/fixtures/canonical-vectors.json. Run: npx tsx scripts/gen-revocation-vector.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildRevocationStatement } from '../src/statement.js';
import { canonicalize, canonicalSha256Hex } from '../src/canonical.js';

const s = buildRevocationStatement({
  github_username: 'johnf',
  unique_identifier:
    '13902036709356453377929569764273223082772964910104338589480118024404105097567',
  revokes_rekor_entry_hash:
    '108e9186e8c5677a53b1918ed9b9bbe15194e42714fd3a3f8f0e163d3a22831120a4c540a332e151',
  proof_blob_sha256: '0a'.repeat(32),
  scope: 'passportsign.dev:nationality-disclose:1',
  zkpassport_sdk_version: '0.15.1',
});

const vector = {
  name: 'revocation statement (passportsign v0.5)',
  input: s,
  canonicalBytesHex: Buffer.from(canonicalize(s)).toString('hex'),
  sha256Hex: canonicalSha256Hex(s),
};

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'test',
  'fixtures',
  'canonical-vectors.json',
);
const vectors = JSON.parse(readFileSync(fixturePath, 'utf8')) as Array<{ name: string }>;
if (!vectors.some((v) => v.name === vector.name)) {
  vectors.push(vector);
  writeFileSync(fixturePath, `${JSON.stringify(vectors, null, 2)}\n`, 'utf8');
}
console.log(`vectors: ${vectors.length}`);
