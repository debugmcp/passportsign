/**
 * Small CLI UI helpers: terminal QR rendering, Enter-to-continue prompt,
 * step headers, and a no-deps spinner using ora.
 */

import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import qrcode from 'qrcode-terminal';
import ora, { type Ora } from 'ora';

export function header(title: string): void {
  const bar = '─'.repeat(Math.max(0, 48 - title.length));
  console.log(`\n${title} ${bar}`);
}

export async function promptEnter(message = 'Press Enter to continue...'): Promise<void> {
  const rl = createInterface({ input, output });
  await rl.question(message);
  rl.close();
}

export function renderQr(url: string): Promise<void> {
  return new Promise((resolve) => {
    qrcode.generate(url, { small: true }, (qr) => {
      console.log(qr);
      resolve();
    });
  });
}

export function spinner(text: string): Ora {
  return ora({ text, spinner: 'dots' }).start();
}
