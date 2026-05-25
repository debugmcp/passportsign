/**
 * Day 0 SDK prototype â€” HARD GATE.
 *
 * Confirms the zkPassport SDK works end-to-end in a Node CLI context.
 * Success requires all four criteria to pass:
 *
 *   (1) QR renders in the terminal.
 *   (2) Phone scan reaches the SDK's bridge (onRequestReceived fires).
 *   (3) Proof comes back and parses cleanly (onProofGenerated fires).
 *   (4) SDK verifier accepts the proof (onResult fires with verified=true).
 *
 * Any failure is a re-plan trigger, not "let's keep going." Record the
 * outcome of each criterion in docs/v0-acceptance.md.
 *
 * Usage:
 *   pnpm --filter @passportsign/cli exec tsx src/prototype-day0.ts
 *
 * Requirements:
 *   - ZKPassport mobile app installed (iOS App Store / Google Play).
 *   - Physical NFC-enabled passport (ICAO 9303).
 *   - Phone has internet access. (The SDK uses a hosted relay; the phone
 *     does NOT need to be on the same LAN as this script.)
 */

import { ZKPassport } from '@zkpassport/sdk';
import qrcode from 'qrcode-terminal';

const TIMEOUT_MS = 5 * 60 * 1000;

interface DayZeroGate {
  qrRendered: boolean;
  requestReceived: boolean;
  proofGenerated: boolean;
  resultVerified: boolean;
}

function printGate(gate: DayZeroGate): void {
  const mark = (b: boolean): string => (b ? 'PASS' : 'FAIL');
  console.log('');
  console.log('Day 0 gate:');
  console.log(`  (1) QR renders in terminal           : ${mark(gate.qrRendered)}`);
  console.log(`  (2) Phone scan reaches bridge        : ${mark(gate.requestReceived)}`);
  console.log(`  (3) Proof comes back and parses      : ${mark(gate.proofGenerated)}`);
  console.log(`  (4) SDK verifier accepts             : ${mark(gate.resultVerified)}`);
  console.log('');
}

async function main(): Promise<number> {
  const gate: DayZeroGate = {
    qrRendered: false,
    requestReceived: false,
    proofGenerated: false,
    resultVerified: false,
  };

  // Set --dev-mode to use mock passports (Zero Knowledge Republic).
  // Default OFF assumes a real NFC-scanned passport in the app.
  const devMode = process.argv.includes('--dev-mode');

  // Project ID is optional in SDK 0.15+ â€” the dashboard project is
  // looked up by domain (because the request is signed with the SDK's
  // ephemeral keypair, tied to the registered domain). Override only
  // if explicitly disambiguating.
  const projectIdFromFlag = (() => {
    const i = process.argv.indexOf('--project-id');
    return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
  })();
  const projectID = projectIdFromFlag ?? process.env['ZKPASSPORT_PROJECT_ID'];

  const domain = process.env['ZKPASSPORT_DOMAIN'] ?? 'passportsign.dev';

  const noPolicyForDisplay = process.argv.includes('--no-policy');
  const policyForDisplay = process.env['ZKPASSPORT_POLICY_ID'] ?? 'nationality-disclose';
  console.log('passportsign Day 0 SDK prototype');
  console.log(`  domain:    ${domain}`);
  if (projectID) console.log(`  project:   ${projectID}`);
  console.log(`  policy:    ${noPolicyForDisplay ? '(none â€” --no-policy)' : policyForDisplay}`);
  console.log(`  dev mode:  ${devMode ? 'ON  (accepts mock passports)' : 'OFF (real passport required)'}`);
  console.log('');
  console.log('Initialising zkPassport SDK...');

  // Match the @zkpassport/ui React component's exact init pattern: no
  // constructor options, no request() overrides. The dashboard supplies
  // the project's name/logo/purpose; the policy locks the scope.
  // (Earlier attempts passing disableProofStorage / explicit name+logo+
  // purpose+scope wedged the phone slider â€” the working sample QR did
  // none of those.)
  const zkPassport = new ZKPassport(domain);

  const queryBuilder = await zkPassport.request({
    ...(devMode ? { devMode: true } : {}),
    ...(projectID ? { projectID } : {}),
  });

  // Use a dashboard policy by default; --no-policy skips the .policy()
  // call entirely (lets us isolate whether the policy lookup is what
  // fails on the phone).
  const noPolicy = process.argv.includes('--no-policy');
  const policyId = process.env['ZKPASSPORT_POLICY_ID'] ?? 'nationality-disclose';
  const builder = noPolicy ? queryBuilder : queryBuilder.policy(policyId);
  const { url, onRequestReceived, onGeneratingProof, onProofGenerated, onResult, onReject, onError } =
    builder.done();

  console.log('Scan this QR with the ZKPassport mobile app:');
  console.log('');
  qrcode.generate(url, { small: true }, (qr: string) => {
    console.log(qr);
  });
  console.log('');
  console.log('Or open this URL on the same device as your ZKPassport app:');
  console.log(`  ${url}`);
  console.log('');
  gate.qrRendered = true;

  const result = await new Promise<number>((resolve) => {
    const timeout = setTimeout(() => {
      console.error('Timed out waiting for proof (5 min).');
      printGate(gate);
      resolve(2);
    }, TIMEOUT_MS);

    onRequestReceived(() => {
      console.log('[1/3] Request received on phone â€” user is reviewing.');
      gate.requestReceived = true;
    });

    onGeneratingProof(() => {
      console.log('[2/3] User accepted â€” proof is being generated on phone.');
    });

    onProofGenerated(({ vkeyHash, name, version }) => {
      console.log('[3/3] Proof received (a proof; the SDK may emit more).');
      console.log(`      vkey hash:    ${vkeyHash}`);
      console.log(`      circuit:      ${name}`);
      console.log(`      sdk version:  ${version}`);
      gate.proofGenerated = true;
    });

    onResult(({ uniqueIdentifier, verified, result }) => {
      clearTimeout(timeout);
      console.log('');
      console.log('SDK verifier returned a result.');
      console.log(`  verified:           ${verified}`);
      console.log(`  unique identifier:  ${uniqueIdentifier}`);
      console.log(`  disclosed result:   ${JSON.stringify(result, null, 2)}`);
      gate.resultVerified = verified === true;
      printGate(gate);
      resolve(gate.resultVerified ? 0 : 1);
    });

    onReject(() => {
      clearTimeout(timeout);
      console.log('User rejected the request on phone.');
      printGate(gate);
      resolve(1);
    });

    onError((err) => {
      clearTimeout(timeout);
      console.error('SDK error:', err);
      printGate(gate);
      resolve(2);
    });
  });

  return result;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('Fatal:', err);
    process.exit(2);
  });
