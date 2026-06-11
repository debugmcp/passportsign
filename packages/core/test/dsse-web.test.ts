import { createVerify } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { IN_TOTO_PAYLOAD_TYPE, pae } from '../src/dsse.js';
import { signEnvelopeWeb } from '../src/dsse-web.js';
import { base64ToBytes, utf8ToBytes } from '../src/encoding.js';

const PAYLOAD = utf8ToBytes('{"_type":"https://in-toto.io/Statement/v1"}');

describe('signEnvelopeWeb', () => {
  it('produces a DSSE envelope shaped like the node signer output', async () => {
    const { envelope, publicKeyPem } = await signEnvelopeWeb(PAYLOAD, IN_TOTO_PAYLOAD_TYPE);
    expect(envelope.payloadType).toBe(IN_TOTO_PAYLOAD_TYPE);
    expect(base64ToBytes(envelope.payload)).toEqual(PAYLOAD);
    expect(envelope.signatures).toHaveLength(1);
    expect(envelope.signatures[0]!.publicKey).toBe(publicKeyPem);
    expect(publicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----\n')).toBe(true);
    expect(publicKeyPem.endsWith('-----END PUBLIC KEY-----\n')).toBe(true);
    expect(envelope.signatures[0]!.keyid).toBeUndefined();
  });

  it('drift check: node:crypto verifies the WebCrypto DER signature over PAE', async () => {
    const { envelope, publicKeyPem } = await signEnvelopeWeb(PAYLOAD, IN_TOTO_PAYLOAD_TYPE);
    const verifier = createVerify('SHA256');
    verifier.update(Buffer.from(pae(IN_TOTO_PAYLOAD_TYPE, PAYLOAD)));
    const ok = verifier.verify(
      publicKeyPem,
      Buffer.from(base64ToBytes(envelope.signatures[0]!.sig)),
    );
    expect(ok).toBe(true);
  });

  it('rejects a tampered payload under the same key (signature actually binds)', async () => {
    const { envelope, publicKeyPem } = await signEnvelopeWeb(PAYLOAD, IN_TOTO_PAYLOAD_TYPE);
    const verifier = createVerify('SHA256');
    verifier.update(Buffer.from(pae(IN_TOTO_PAYLOAD_TYPE, utf8ToBytes('tampered'))));
    const ok = verifier.verify(
      publicKeyPem,
      Buffer.from(base64ToBytes(envelope.signatures[0]!.sig)),
    );
    expect(ok).toBe(false);
  });

  it('generates a fresh ephemeral key per call', async () => {
    const a = await signEnvelopeWeb(PAYLOAD, IN_TOTO_PAYLOAD_TYPE);
    const b = await signEnvelopeWeb(PAYLOAD, IN_TOTO_PAYLOAD_TYPE);
    expect(a.publicKeyPem).not.toBe(b.publicKeyPem);
  });

  it('DER signature parses (SEQUENCE of two INTEGERs)', async () => {
    const { envelope } = await signEnvelopeWeb(PAYLOAD, IN_TOTO_PAYLOAD_TYPE);
    const der = base64ToBytes(envelope.signatures[0]!.sig);
    expect(der[0]).toBe(0x30); // SEQUENCE
    expect(der[2]).toBe(0x02); // INTEGER (r)
  });
});
