/**
 * Node-only file I/O for `binding.passportsign.json` bundles. Kept out
 * of `bundle.ts` so the validation logic stays runtime-neutral (the
 * `./web` subpath exports validation but not these).
 */

import { readFileSync, writeFileSync } from 'node:fs';

import {
  BundleValidationError,
  validateBundle,
  type PassportsignBundle,
} from './bundle.js';

/**
 * Read and validate a `binding.passportsign.json` file. Throws on
 * invalid JSON or schema violations.
 */
export function readBundle(path: string): PassportsignBundle {
  const raw = readFileSync(path, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new BundleValidationError(
      '$',
      `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  validateBundle(parsed);
  return parsed;
}

/**
 * Validate and write a `binding.passportsign.json` file (pretty-printed).
 */
export function writeBundle(path: string, bundle: PassportsignBundle): void {
  validateBundle(bundle);
  writeFileSync(path, JSON.stringify(bundle, null, 2) + '\n', 'utf8');
}
