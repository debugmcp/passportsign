/**
 * One-shot fixture generator for test/fixtures/canonical-vectors.json.
 *
 * The fixtures are an immutable contract — additions OK, mutations require
 * deliberate version migration. This script is here to pin a new vector
 * with the exact bytes our canonicalize() produces today, *not* to silently
 * regenerate existing pins.
 *
 * Run: pnpm --filter @passportsign/core exec tsx scripts/generate-canonical-vectors.ts
 *
 * Output: JSON array, suitable for pasting into test/fixtures/canonical-vectors.json.
 * The drift test in test/canonical.test.ts will then assert this output is stable.
 */

import { canonicalize, canonicalSha256Hex } from '../src/canonical.js';

interface VectorInput {
  name: string;
  input: unknown;
}

const fullStatement = {
  _type: 'https://in-toto.io/Statement/v1',
  subject: [
    {
      name: 'github.com/johnf',
      digest: {
        sha256:
          'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      },
    },
  ],
  predicateType: 'https://passportsign.dev/personhood/v1',
  predicate: {
    unique_identifier:
      '13902036709356453377929569764273223082772964910104338589480118024404105097567',
    issuing_country: 'CAN',
    disclosure_level: 'personhood+country',
    proof_blob_sha256:
      '0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a',
    gist_url: 'https://gist.github.com/johnf/abcdef0123456789',
    gist_content_sha256:
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    scope: 'passportsign.dev:nationality-disclose:1',
    zkpassport_sdk_version: '0.15.1',
  },
};

const undisclosedCountry = {
  ...fullStatement,
  predicate: {
    ...fullStatement.predicate,
    issuing_country: null,
    disclosure_level: 'personhood',
  },
};

const unicodeSubject = {
  ...fullStatement,
  subject: [
    {
      name: 'github.com/jōhn-üser-🌐',
      digest: fullStatement.subject[0]!.digest,
    },
  ],
};

const numericEdge = {
  ...fullStatement,
  predicate: {
    ...fullStatement.predicate,
    // RFC 8785 numeric serialization should produce the same bytes for
    // these two representations. Pinning here makes future regressions
    // in canonify's number serialization immediately visible.
    proof_blob_sha256: '00'.repeat(32),
    numeric_test_int: 42,
    numeric_test_zero: 0,
    numeric_test_negative: -1,
  },
};

const vectorInputs: VectorInput[] = [
  { name: 'empty object', input: {} },
  { name: 'full in-toto statement (passportsign v0.4)', input: fullStatement },
  { name: 'statement with undisclosed country (null)', input: undisclosedCountry },
  { name: 'statement with Unicode in subject.name', input: unicodeSubject },
  { name: 'statement with numeric edge cases', input: numericEdge },
];

const output = vectorInputs.map((v) => ({
  name: v.name,
  input: v.input,
  canonicalBytesHex: Buffer.from(canonicalize(v.input)).toString('hex'),
  sha256Hex: canonicalSha256Hex(v.input),
}));

process.stdout.write(JSON.stringify(output, null, 2) + '\n');
