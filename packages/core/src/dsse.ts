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

import { pae, type DsseEnvelope } from './dsse-common.js';

export {
  DSSE_VERSION,
  IN_TOTO_PAYLOAD_TYPE,
  pae,
  type DsseEnvelope,
  type DsseSignature,
} from './dsse-common.js';

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
