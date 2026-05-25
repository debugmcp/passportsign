/**
 * DSSE (Dead Simple Signing Envelope) envelope builder.
 *
 * Per-binding ephemeral ECDSA P-256 key — the private key is discarded
 * after signing. The DSSE signature is a Rekor schema requirement, not
 * a trust mechanism. The actual authentication for passportsign comes
 * from the zkPassport proof + GitHub gist evidence carried inside the
 * statement's predicate, not from this signature.
 *
 * Spec: https://github.com/secure-systems-lab/dsse/blob/master/protocol.md
 *
 * Note on key algorithm choice: ECDSA P-256 over SHA-256 is what
 * Rekor's public instance accepts for intoto v0.0.2 entries. Ed25519
 * is in the DSSE spec but the public Rekor's verification path rejected
 * it during the Day 5 smoke test (500 "error generating canonicalized
 * entry"). See `docs/v0-acceptance.md` Day 5 evidence.
 */

import { createSign, generateKeyPairSync } from 'node:crypto';

export const DSSE_VERSION = 'DSSEv1';
export const IN_TOTO_PAYLOAD_TYPE = 'application/vnd.in-toto+json';

export interface DsseSignature {
  /** Single-base64 of the raw signature bytes. */
  sig: string;
  /** PEM-encoded SubjectPublicKeyInfo. */
  publicKey: string;
  /** Optional key identifier. Omit (don't pass empty string) when not set. */
  keyid?: string;
}

export interface DsseEnvelope {
  /** Media type of the payload (e.g. `application/vnd.in-toto+json`). */
  payloadType: string;
  /** Single-base64 of the raw payload bytes. */
  payload: string;
  signatures: DsseSignature[];
}

/**
 * DSSE Pre-Authentication Encoding (PAE):
 *
 *   "DSSEv1" SP LEN(type) SP type SP LEN(body) SP body
 *
 * Where SP is a single 0x20 space, LEN is the ASCII-decimal length of
 * the following byte string.
 */
export function pae(type: string, body: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const prefix = `${DSSE_VERSION} ${typeBytes.length} ${type} ${body.length} `;
  const prefixBytes = new TextEncoder().encode(prefix);
  const out = new Uint8Array(prefixBytes.length + body.length);
  out.set(prefixBytes);
  out.set(body, prefixBytes.length);
  return out;
}

export interface SignEnvelopeResult {
  envelope: DsseEnvelope;
  /** PEM of the ephemeral public key (also embedded in envelope.signatures[0].publicKey). */
  publicKeyPem: string;
}

/**
 * Generate an ephemeral ECDSA P-256 keypair, sign PAE(payloadType,
 * payload), and return a DSSE envelope. The private key is discarded
 * before return.
 */
export function signEnvelope(payload: Uint8Array, payloadType: string): SignEnvelopeResult {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const paeBytes = pae(payloadType, payload);
  const signer = createSign('SHA256');
  signer.update(Buffer.from(paeBytes));
  const sigBuf = signer.sign(privateKey);
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;

  return {
    envelope: {
      payloadType,
      payload: Buffer.from(payload).toString('base64'),
      signatures: [
        {
          sig: sigBuf.toString('base64'),
          publicKey: publicKeyPem,
        },
      ],
    },
    publicKeyPem,
  };
}
