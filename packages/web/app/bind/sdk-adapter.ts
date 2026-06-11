/**
 * Real zkPassport SDK wiring for the browser. Served from
 * https://passportsign.dev, the bridge's Origin matches the domain
 * registered in the zkPassport dashboard natively — no SDK patch
 * needed (the CLI's patch exists only for Node).
 *
 * Mirrors the CLI's `sdk-flow.ts`. The SDK lazy-loads the bb.js WASM
 * when proofs arrive; `main.ts` can prefetch it while the user is on
 * the gist step.
 */

import { ZKPassport } from '@zkpassport/sdk';

import { DOMAIN, type BindProgress, type SdkScanResult } from './controller.js';

const POLICY_ID = 'nationality-disclose';
const SCAN_TIMEOUT_MS = 5 * 60 * 1000;

export interface ScanHandle {
  /** Deep-link URL — render as QR and as a same-device link. */
  url: string;
  result: Promise<SdkScanResult>;
}

export async function startScan(
  discloseCountry: boolean,
  onProgress: (progress: BindProgress) => void,
): Promise<ScanHandle> {
  const zkPassport = new ZKPassport(DOMAIN);
  const queryBuilder = await zkPassport.request({});
  const built = queryBuilder.policy(POLICY_ID).done();
  const { url, query, onRequestReceived, onGeneratingProof, onProofGenerated, onResult, onReject, onError } = built;

  const proofs: unknown[] = [];
  const result = new Promise<SdkScanResult>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Scan timed out after 5 minutes — reload to retry.')),
      SCAN_TIMEOUT_MS,
    );

    onRequestReceived(() => {
      onProgress({ phase: 'scan', message: 'Request received — review it on your phone.' });
    });
    onGeneratingProof(() => {
      onProgress({ phase: 'scan', message: 'Generating proofs on your phone…' });
    });
    onProofGenerated((p: unknown) => {
      proofs.push(p);
      onProgress({ phase: 'scan', message: `Proof ${proofs.length} received…` });
    });
    onResult((r: { uniqueIdentifier: string | undefined; verified: boolean; result: unknown }) => {
      clearTimeout(timeout);
      if (!r.verified) {
        reject(new Error('The SDK reported verified=false.'));
        return;
      }
      const queryResult = r.result as { nationality?: { disclose?: { result?: string } } };
      resolve({
        proofs,
        original_query: query,
        query_result: queryResult,
        unique_identifier: r.uniqueIdentifier ?? '',
        issuing_country: discloseCountry
          ? queryResult.nationality?.disclose?.result ?? null
          : null,
      });
    });
    onReject(() => {
      clearTimeout(timeout);
      reject(new Error('Request rejected on the phone.'));
    });
    onError((err: unknown) => {
      clearTimeout(timeout);
      reject(new Error(`SDK error: ${String(err)}`));
    });
  });

  return { url, result };
}
