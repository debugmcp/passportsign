/**
 * Runtime-neutral DSSE pieces shared by the node signer (`dsse.ts`)
 * and the WebCrypto signer (`dsse-web.ts`): the envelope shape and the
 * Pre-Authentication Encoding.
 */

import { utf8ToBytes } from './encoding.js';

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
  const typeBytes = utf8ToBytes(type);
  const prefix = `${DSSE_VERSION} ${typeBytes.length} ${type} ${body.length} `;
  const prefixBytes = utf8ToBytes(prefix);
  const out = new Uint8Array(prefixBytes.length + body.length);
  out.set(prefixBytes);
  out.set(body, prefixBytes.length);
  return out;
}
