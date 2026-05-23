// Day 0 SDK prototype — HARD GATE for v0.
//
// Validates the four Day 0 success criteria recorded in
// docs/v0-acceptance.md:
//   1. QR renders in the terminal.
//   2. Phone scan reaches the SDK bridge.
//   3. Proof comes back and parses cleanly.
//   4. SDK verifier accepts the parsed proof.
//
// Any failure on those four points is a re-plan trigger.
// Run with:  pnpm --filter @passportsign/cli run day0  [--country]
//
// Note: the SDK is loaded via createRequire (CJS build) because the SDK's
// ESM bundle has a broken `import 'buffer/'` (trailing slash) that fails
// Node 24's stricter ESM resolver. CJS resolution handles it. We pull
// types separately from the .d.ts.
import { createRequire } from 'node:module';
import type { ZKPassport as ZKPassportType } from '@zkpassport/sdk';
import qrcode from 'qrcode-terminal';

const require = createRequire(import.meta.url);
const sdk = require('@zkpassport/sdk') as { ZKPassport: typeof ZKPassportType };
const { ZKPassport } = sdk;

const DOMAIN = 'dev.passportsign.dev';
const SCOPE = 'dev.passportsign.dev:day0-prototype';
const TIMEOUT_MS = 5 * 60 * 1000;

interface Day0Result {
  qrRendered: boolean;
  bridgeReached: boolean;
  proofParsed: boolean;
  sdkAcceptedProof: boolean;
  uniqueIdentifier: string | undefined;
  nationality: string | undefined;
  proofCount: number;
}

async function main(): Promise<void> {
  const discloseNationality = process.argv.includes('--country');

  const result: Day0Result = {
    qrRendered: false,
    bridgeReached: false,
    proofParsed: false,
    sdkAcceptedProof: false,
    uniqueIdentifier: undefined,
    nationality: undefined,
    proofCount: 0,
  };

  const zkp = new ZKPassport(DOMAIN);
  const qb = await zkp.request({
    name: 'passportsign Day 0',
    logo: 'https://passportsign.dev/logo.png',
    purpose: 'Day 0 SDK prototype: confirm proof round-trip from phone to CLI',
    scope: SCOPE,
  });

  const builder = discloseNationality ? qb.disclose('nationality') : qb;
  const { url, requestId, onBridgeConnect, onRequestReceived, onGeneratingProof, onProofGenerated, onResult, onReject, onError } = builder.done();

  console.log('\nDay 0 prototype — passportsign SDK round-trip\n');
  console.log(`  domain:   ${DOMAIN}`);
  console.log(`  scope:    ${SCOPE}`);
  console.log(`  requestId:${requestId}`);
  console.log(`  disclose: ${discloseNationality ? 'nationality' : '(none — personhood only)'}`);
  console.log(`  url:      ${url}\n`);
  console.log('Scan with the zkPassport app:\n');
  qrcode.generate(url, { small: true });
  result.qrRendered = true;

  onBridgeConnect(() => console.log('[bridge] connected'));
  onRequestReceived(() => {
    console.log('[phone] request received');
    result.bridgeReached = true;
  });
  onGeneratingProof(() => console.log('[phone] generating proof…'));
  onProofGenerated((proof) => {
    result.proofCount += 1;
    console.log(`[phone] proof generated (${result.proofCount}): ${proof.name ?? '(unnamed)'}`);
  });

  const completion = new Promise<'result' | 'reject' | 'error'>((resolve) => {
    onResult(({ uniqueIdentifier, verified, result: query }) => {
      result.proofParsed = true;
      result.sdkAcceptedProof = verified;
      result.uniqueIdentifier = uniqueIdentifier;
      const nat = query?.nationality?.disclose?.result;
      result.nationality = typeof nat === 'string' ? nat : undefined;
      console.log('[result] received');
      console.log(`  verified:         ${verified}`);
      console.log(`  uniqueIdentifier: ${uniqueIdentifier ?? '(none)'}`);
      console.log(`  nationality:      ${result.nationality ?? '(not disclosed)'}`);
      resolve('result');
    });
    onReject(() => {
      console.log('[phone] request rejected by user');
      resolve('reject');
    });
    onError((err) => {
      console.error(`[error] ${err}`);
      resolve('error');
    });
  });

  const timeout = new Promise<'timeout'>((resolve) => {
    setTimeout(() => resolve('timeout'), TIMEOUT_MS);
  });

  const outcome = await Promise.race([completion, timeout]);
  if (outcome === 'timeout') {
    console.error(`\n[timeout] no result after ${TIMEOUT_MS / 1000}s`);
  }

  printSummary(result, outcome);
  process.exit(allPassed(result) ? 0 : 1);
}

function allPassed(r: Day0Result): boolean {
  return r.qrRendered && r.bridgeReached && r.proofParsed && r.sdkAcceptedProof;
}

function printSummary(r: Day0Result, outcome: 'result' | 'reject' | 'error' | 'timeout'): void {
  console.log('\n— Day 0 success criteria —');
  console.log(`  [${r.qrRendered ? '✓' : '✗'}] QR rendered in terminal`);
  console.log(`  [${r.bridgeReached ? '✓' : '✗'}] Phone scan reached the SDK bridge`);
  console.log(`  [${r.proofParsed ? '✓' : '✗'}] Proof came back and parsed cleanly`);
  console.log(`  [${r.sdkAcceptedProof ? '✓' : '✗'}] SDK verifier accepted the proof`);
  console.log(`\noutcome: ${outcome}`);
  console.log(allPassed(r) ? 'PASS — Day 0 gate cleared.' : 'FAIL — re-plan trigger.');
  if (allPassed(r)) {
    console.log('\nNext: copy the above results into docs/v0-acceptance.md and proceed to Days 1–2.');
  }
}

main().catch((e: unknown) => {
  console.error('[fatal]', e);
  process.exit(1);
});
