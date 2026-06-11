/**
 * The zkPassport QR round-trip shared by `bind` and `revoke`.
 *
 * Renders the SDK's deep-link as a terminal QR, waits on the SDK
 * callbacks (request received → generating → proofs → result), and
 * returns the proof material — or null after printing what went wrong.
 */

import { ZKPassport } from '@zkpassport/sdk';

import { renderQr, spinner } from './ui.js';

export const DOMAIN = 'passportsign.dev';
export const POLICY_ID = 'nationality-disclose';
export const POLICY_VERSION = 1;
export const SCOPE = `${DOMAIN}:${POLICY_ID}:${POLICY_VERSION}`;
export const ZKPASSPORT_SDK_VERSION = '0.15.1';

export interface SdkResultPayload {
  proofs: unknown[];
  original_query: unknown;
  query_result: { nationality?: { disclose?: { result?: string } } };
  unique_identifier: string;
  verified: boolean;
  issuing_country: string | null;
}

export async function runSdkFlow(discloseCountry: boolean): Promise<SdkResultPayload | null> {
  const zkPassport = new ZKPassport(DOMAIN);
  const queryBuilder = await zkPassport.request({});
  const built = queryBuilder.policy(POLICY_ID).done();
  const { url, query, onRequestReceived, onGeneratingProof, onProofGenerated, onResult, onReject, onError } = built;

  console.log('Scan this QR with the ZKPassport mobile app:');
  console.log('');
  await renderQr(url);
  console.log('');
  console.log(`Or open this on the same device as the app:`);
  console.log(`  ${url}`);
  console.log('');

  const proofs: unknown[] = [];
  let resolved:
    | { uniqueIdentifier?: string | undefined; verified: boolean; result: unknown }
    | undefined;
  const sdkSpinner = spinner('Waiting for request to be received on phone...');

  const outcome = await new Promise<'result' | 'reject' | 'error' | 'timeout'>((resolve) => {
    const timeout = setTimeout(() => resolve('timeout'), 5 * 60 * 1000);

    onRequestReceived(() => {
      sdkSpinner.text = 'Request received on phone — user is reviewing...';
    });
    onGeneratingProof(() => {
      sdkSpinner.text = 'User accepted — generating proofs on phone...';
    });
    onProofGenerated((p) => {
      proofs.push(p);
      sdkSpinner.text = `Proof ${proofs.length} received — continuing...`;
    });
    onResult((r) => {
      clearTimeout(timeout);
      resolved = r;
      resolve('result');
    });
    onReject(() => {
      clearTimeout(timeout);
      resolve('reject');
    });
    onError(() => {
      clearTimeout(timeout);
      resolve('error');
    });
  });

  if (outcome === 'timeout') {
    sdkSpinner.fail('SDK timed out after 5 minutes.');
    return null;
  }
  if (outcome === 'reject') {
    sdkSpinner.fail('User rejected the request on phone.');
    return null;
  }
  if (outcome === 'error') {
    sdkSpinner.fail('SDK reported an error.');
    return null;
  }
  if (!resolved || !resolved.verified) {
    sdkSpinner.fail('SDK returned verified=false.');
    return null;
  }
  sdkSpinner.succeed(`Proof verified by SDK (${proofs.length} proofs).`);

  const result = resolved.result as { nationality?: { disclose?: { result?: string } } };
  const country = discloseCountry ? result.nationality?.disclose?.result ?? null : null;

  return {
    proofs,
    original_query: query,
    query_result: result,
    unique_identifier: resolved.uniqueIdentifier ?? '',
    verified: resolved.verified,
    issuing_country: country,
  };
}
