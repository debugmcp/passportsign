import { describe, it, expect } from 'vitest';
import { createVerify } from 'node:crypto';

import { DSSE_VERSION, IN_TOTO_PAYLOAD_TYPE, pae, signEnvelope } from '../src/dsse.js';

describe('pae', () => {
  it('matches the DSSE spec for a trivial body', () => {
    const body = new TextEncoder().encode('hello');
    const out = pae('text/plain', body);
    const expected = new TextEncoder().encode('DSSEv1 10 text/plain 5 hello');
    expect(Array.from(out)).toEqual(Array.from(expected));
  });

  it('matches the canonical "" / "" test vector', () => {
    const out = pae('', new Uint8Array());
    const expected = new TextEncoder().encode('DSSEv1 0  0 ');
    expect(Array.from(out)).toEqual(Array.from(expected));
  });

  it('encodes byte lengths in ASCII decimal', () => {
    const body = new Uint8Array(123);
    const out = pae('application/x-test', body);
    const prefix = `${DSSE_VERSION} 18 application/x-test 123 `;
    expect(new TextDecoder().decode(out.slice(0, prefix.length))).toBe(prefix);
    expect(out.length).toBe(prefix.length + 123);
  });

  it('handles UTF-8 bytes correctly in length count', () => {
    const type = 'üñïçødë'; // multi-byte chars
    const typeByteLen = new TextEncoder().encode(type).length;
    const body = new TextEncoder().encode('hi');
    const out = pae(type, body);
    const prefix = `${DSSE_VERSION} ${typeByteLen} ${type} 2 `;
    const prefixBytes = new TextEncoder().encode(prefix);
    expect(Array.from(out.slice(0, prefixBytes.length))).toEqual(Array.from(prefixBytes));
  });
});

describe('signEnvelope', () => {
  it('produces a DSSE envelope with single base64 payload and signature', () => {
    const payload = new TextEncoder().encode('test payload');
    const { envelope } = signEnvelope(payload, IN_TOTO_PAYLOAD_TYPE);

    expect(envelope.payloadType).toBe(IN_TOTO_PAYLOAD_TYPE);
    expect(Buffer.from(envelope.payload, 'base64').toString()).toBe('test payload');
    expect(envelope.signatures).toHaveLength(1);
    expect(envelope.signatures[0]!.publicKey).toContain('-----BEGIN PUBLIC KEY-----');
  });

  it('signature verifies against the embedded public key over PAE(type, payload)', () => {
    const payload = new TextEncoder().encode('verify this');
    const { envelope, publicKeyPem } = signEnvelope(payload, IN_TOTO_PAYLOAD_TYPE);
    const paeBytes = pae(IN_TOTO_PAYLOAD_TYPE, payload);
    const sig = Buffer.from(envelope.signatures[0]!.sig, 'base64');

    const verifier = createVerify('SHA256');
    verifier.update(Buffer.from(paeBytes));
    expect(verifier.verify(publicKeyPem, sig)).toBe(true);
  });

  it('different payloads produce different signatures (ephemeral key)', () => {
    const a = signEnvelope(new TextEncoder().encode('a'), IN_TOTO_PAYLOAD_TYPE);
    const b = signEnvelope(new TextEncoder().encode('b'), IN_TOTO_PAYLOAD_TYPE);
    expect(a.envelope.signatures[0]!.sig).not.toBe(b.envelope.signatures[0]!.sig);
    expect(a.publicKeyPem).not.toBe(b.publicKeyPem);
  });

  it('does not include keyid in the produced envelope', () => {
    const { envelope } = signEnvelope(new TextEncoder().encode('x'), IN_TOTO_PAYLOAD_TYPE);
    expect(envelope.signatures[0]!.keyid).toBeUndefined();
  });
});
