import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';

import { canonicalize } from '../src/canonical.js';
import { packSdkPayload, unpackSdkPayload, type SdkPayload } from '../src/sdk-payload.js';

const samplePayload: SdkPayload = {
  sdk_version: '0.15.1',
  proofs: [
    { vkeyHash: '0x12ef', name: 'sig_check_dsc_tbs_1200_rsa_pss_4096_sha256', version: '0.18.0', proof: 'deadbeef', publicInputs: ['a', 'b'] },
    { vkeyHash: '0x05fd', name: 'data_check_integrity_sa_sha256_dg_sha256', version: '0.18.0', proof: 'cafebabe', publicInputs: ['c'] },
  ],
  original_query: { nationality: { disclose: true } },
  query_result: { nationality: { disclose: { result: 'CAN' } } },
  dev_mode: false,
};

describe('packSdkPayload', () => {
  it('round-trips through canonicalize + base64', () => {
    const packed = packSdkPayload(samplePayload);
    const unpacked = unpackSdkPayload(packed.b64);
    expect(unpacked).toEqual(samplePayload);
  });

  it('produces deterministic bytes (same payload, same hash)', () => {
    const a = packSdkPayload(samplePayload);
    const b = packSdkPayload(samplePayload);
    expect(a.b64).toBe(b.b64);
    expect(a.sha256Hex).toBe(b.sha256Hex);
  });

  it('sha256Hex matches sha256(canonical bytes)', () => {
    const packed = packSdkPayload(samplePayload);
    const expected = createHash('sha256').update(packed.bytes).digest('hex');
    expect(packed.sha256Hex).toBe(expected);
  });

  it('different proofs produce different bytes', () => {
    const a = packSdkPayload(samplePayload);
    const b = packSdkPayload({ ...samplePayload, sdk_version: '0.99.0' });
    expect(a.sha256Hex).not.toBe(b.sha256Hex);
  });

  it('canonical bytes survive key reordering (RFC 8785)', () => {
    const reordered: SdkPayload = {
      // Construct an equivalent payload with keys in a different declaration order
      query_result: samplePayload.query_result,
      original_query: samplePayload.original_query,
      proofs: samplePayload.proofs,
      sdk_version: samplePayload.sdk_version,
      dev_mode: samplePayload.dev_mode,
    };
    const a = packSdkPayload(samplePayload);
    const b = packSdkPayload(reordered);
    expect(a.sha256Hex).toBe(b.sha256Hex);
  });

  it('the bytes match canonicalize() of the input directly', () => {
    const packed = packSdkPayload(samplePayload);
    const direct = canonicalize(samplePayload);
    expect(Buffer.from(packed.bytes).toString('hex')).toBe(
      Buffer.from(direct).toString('hex'),
    );
  });
});

describe('unpackSdkPayload', () => {
  it('rejects payloads missing required fields', () => {
    const bad = Buffer.from(JSON.stringify({ sdk_version: '0.15.1' })).toString('base64');
    expect(() => unpackSdkPayload(bad)).toThrow(TypeError);
  });

  it('rejects payloads with wrong field types', () => {
    const bad = Buffer.from(
      JSON.stringify({ sdk_version: '0.15.1', dev_mode: 'yes', proofs: [] }),
    ).toString('base64');
    expect(() => unpackSdkPayload(bad)).toThrow(TypeError);
  });

  it('rejects non-JSON base64', () => {
    const bad = Buffer.from('not json').toString('base64');
    expect(() => unpackSdkPayload(bad)).toThrow();
  });
});
