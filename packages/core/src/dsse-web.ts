/**
 * WebCrypto variant of the DSSE envelope signer for runtimes without
 * `node:crypto` sign APIs (browsers, edge workers). Same semantics as
 * `dsse.ts`'s `signEnvelope`: ephemeral ECDSA P-256 key, discarded
 * after signing; the signature is a Rekor schema requirement, not a
 * trust mechanism.
 *
 * Two impedance mismatches with what Rekor expects, both handled here:
 * - WebCrypto emits raw P1363 (`r || s`) signatures; Rekor needs DER.
 * - WebCrypto exports SPKI as raw bytes; Rekor needs PEM text.
 *
 * The drift test in `test/dsse-web.test.ts` verifies output with
 * `node:crypto.createVerify` so the two signers cannot diverge silently.
 */

import { bytesToBase64 } from './encoding.js';
import { pae, type DsseEnvelope } from './dsse-common.js';

export interface SignEnvelopeWebResult {
  envelope: DsseEnvelope;
  publicKeyPem: string;
}

/** Strip leading zero bytes, then re-add one if the high bit is set (DER INTEGER rule). */
function derInteger(bytes: Uint8Array): Uint8Array {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start++;
  const trimmed = bytes.subarray(start);
  if (trimmed[0]! & 0x80) {
    const padded = new Uint8Array(trimmed.length + 1);
    padded.set(trimmed, 1);
    return padded;
  }
  return trimmed;
}

/** Convert a P1363 (r||s) ECDSA signature to DER SEQUENCE(INTEGER r, INTEGER s). */
export function p1363ToDer(sig: Uint8Array): Uint8Array {
  if (sig.length % 2 !== 0) {
    throw new TypeError(`p1363ToDer: signature length ${sig.length} is not even`);
  }
  const half = sig.length / 2;
  const r = derInteger(sig.subarray(0, half));
  const s = derInteger(sig.subarray(half));
  const body = new Uint8Array(2 + r.length + 2 + s.length);
  body[0] = 0x02;
  body[1] = r.length;
  body.set(r, 2);
  body[2 + r.length] = 0x02;
  body[3 + r.length] = s.length;
  body.set(s, 4 + r.length);
  // P-256 DER bodies are < 128 bytes, so a single length byte suffices.
  const out = new Uint8Array(2 + body.length);
  out[0] = 0x30;
  out[1] = body.length;
  out.set(body, 2);
  return out;
}

function spkiToPem(spki: Uint8Array): string {
  const b64 = bytesToBase64(spki);
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----\n`;
}

/**
 * Generate an ephemeral ECDSA P-256 keypair via WebCrypto, sign
 * PAE(payloadType, payload), and return a DSSE envelope. Async because
 * WebCrypto is; otherwise interchangeable with `signEnvelope`.
 */
export async function signEnvelopeWeb(
  payload: Uint8Array,
  payloadType: string,
): Promise<SignEnvelopeWebResult> {
  const subtle = globalThis.crypto.subtle;
  const keyPair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
  ]);

  const paeBytes = pae(payloadType, payload);
  const rawSig = new Uint8Array(
    await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, paeBytes),
  );
  const derSig = p1363ToDer(rawSig);

  const spki = new Uint8Array(await subtle.exportKey('spki', keyPair.publicKey));
  const publicKeyPem = spkiToPem(spki);

  return {
    envelope: {
      payloadType,
      payload: bytesToBase64(payload),
      signatures: [{ sig: bytesToBase64(derSig), publicKey: publicKeyPem }],
    },
    publicKeyPem,
  };
}
