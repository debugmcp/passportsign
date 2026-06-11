/**
 * DOM wiring for the bind page. All flow logic lives in
 * `controller.ts` (unit-tested); this file only moves values between
 * the page and the session.
 */

import { toCanvas } from 'qrcode';
import {
  PassportsignError,
  PublicSigstoreRekorClient,
} from '@passportsign/core/web';

import { BindSession, type BindProgress } from './controller.js';
import { startScan } from './sdk-adapter.js';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}

const usernameInput = el<HTMLInputElement>('username');
const discloseInput = el<HTMLInputElement>('disclose-country');
const ackInput = el<HTMLInputElement>('ack');
const startButton = el<HTMLButtonElement>('start');
const gistError = el<HTMLDivElement>('gist-error');
const patRow = el<HTMLDivElement>('pat-row');

function show(step: string): void {
  for (const id of ['step-form', 'step-gist', 'step-scan', 'step-done']) {
    const section = el(id);
    if (id === step) {
      section.removeAttribute('hidden');
    } else if (!section.hasAttribute('hidden')) {
      section.classList.add('done');
    }
  }
}

function explain(err: unknown): string {
  if (err instanceof PassportsignError) {
    const hints: Partial<Record<string, string>> = {
      gist_not_found: 'No gist named passportsign.txt was found on your account. Is it public, and saved?',
      gist_wrong_content: 'The gist exists but its content does not exactly match the nonce — watch for trailing whitespace or a newline.',
      gist_wrong_owner: 'The gist is owned by a different account than the username you entered.',
      gist_predates_init: 'The gist is older than this binding session — edit it so its updated time is fresh.',
      username_invalid: 'That does not look like a valid GitHub username.',
      log_submission_failed: 'Rekor (the public log) rejected or could not be reached. Nothing was published; try again.',
    };
    return hints[err.code] ?? `${err.code}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

function download(filename: string, content: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function updateStartEnabled(): void {
  startButton.disabled = !(ackInput.checked && usernameInput.value.trim().length > 0);
}
usernameInput.addEventListener('input', updateStartEnabled);
ackInput.addEventListener('change', updateStartEnabled);

let session: BindSession | null = null;

startButton.addEventListener('click', () => {
  try {
    session = new BindSession(usernameInput.value, discloseInput.checked, {
      // The QR render is a side effect of starting the scan — same
      // session (and nonce) all the way through.
      runScan: async (discloseCountry, onProgress) => {
        const scan = await startScan(discloseCountry, onProgress);
        await toCanvas(el<HTMLCanvasElement>('qr'), scan.url, { width: 280 });
        el<HTMLAnchorElement>('same-device').href = scan.url;
        return scan.result;
      },
      rekor: new PublicSigstoreRekorClient(),
    });
  } catch (err) {
    alert(explain(err));
    return;
  }
  el('nonce').textContent = session.nonce;
  show('step-gist');
});

el<HTMLButtonElement>('copy-nonce').addEventListener('click', () => {
  if (session) void navigator.clipboard.writeText(session.nonce);
});

el<HTMLButtonElement>('check-gist').addEventListener('click', () => {
  void (async () => {
    if (!session) return;
    gistError.setAttribute('hidden', '');
    const button = el<HTMLButtonElement>('check-gist');
    button.disabled = true;
    button.textContent = 'Checking…';
    try {
      const token = el<HTMLInputElement>('github-token').value.trim();
      await session.checkGist(token.length > 0 ? token : undefined);
      show('step-scan');
      await runScanStep();
    } catch (err) {
      gistError.removeAttribute('hidden');
      gistError.textContent = explain(err);
      if (err instanceof PassportsignError && String(err.cause ?? '').includes('403')) {
        patRow.removeAttribute('hidden');
      }
    } finally {
      button.disabled = false;
      button.textContent = "I've created it — check the gist";
    }
  })();
});

async function runScanStep(): Promise<void> {
  if (!session) return;
  const progress = el<HTMLParagraphElement>('scan-progress');
  const scanError = el<HTMLDivElement>('scan-error');
  const onProgress = (p: BindProgress): void => {
    progress.textContent = p.message;
  };

  try {
    const outputs = await session.scanAndSubmit(onProgress);

    el('rekor-uuid').textContent = `${outputs.rekorUuid.slice(0, 24)}…`;
    el<HTMLAnchorElement>('rekor-link').href = outputs.rekorUrl;
    el<HTMLTextAreaElement>('index-json').value = outputs.indexJson;
    el<HTMLTextAreaElement>('badge-md').value = outputs.badgeMarkdown;
    el<HTMLAnchorElement>('index-deeplink').href =
      `https://github.com/${session.username}/${session.username}/new/main?filename=passportsign-index.json&value=${encodeURIComponent(outputs.indexJson)}`;
    el<HTMLButtonElement>('dl-bundle').onclick = () =>
      download('binding.passportsign.json', outputs.bundleJson, 'application/json');
    el<HTMLButtonElement>('dl-badge').onclick = () =>
      download('passportsign-badge.svg', outputs.badgeSvg, 'image/svg+xml');
    el<HTMLButtonElement>('copy-md').onclick = () =>
      void navigator.clipboard.writeText(outputs.badgeMarkdown);
    show('step-done');
  } catch (err) {
    scanError.removeAttribute('hidden');
    scanError.textContent = explain(err);
  }
}
