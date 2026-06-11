/**
 * Read-modify-write helpers for the user's local
 * `passportsign-index.json` (roadmap v0.5.5 convention). The CLI
 * writes this file next to the bundle; the user commits it to their
 * profile repo so the badge service and `list` can discover entries.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  PROFILE_INDEX_FILENAME,
  ProfileIndexValidationError,
  addBinding,
  addRevocation,
  createProfileIndex,
  validateProfileIndex,
  type ProfileIndex,
  type ProfileIndexBinding,
  type ProfileIndexRevocation,
} from '@passportsign/core';

export interface IndexFileUpdate {
  path: string;
  index: ProfileIndex;
}

function readOrCreate(dir: string, githubUsername: string): { path: string; index: ProfileIndex } {
  const path = join(dir, PROFILE_INDEX_FILENAME);
  if (!existsSync(path)) {
    return { path, index: createProfileIndex(githubUsername) };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new ProfileIndexValidationError(
      `${path} exists but is not valid JSON — fix or remove it before binding: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  return { path, index: validateProfileIndex(raw) };
}

function write(path: string, index: ProfileIndex): void {
  writeFileSync(path, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
}

export function updateIndexFileWithBinding(
  dir: string,
  githubUsername: string,
  binding: ProfileIndexBinding,
): IndexFileUpdate {
  const { path, index } = readOrCreate(dir, githubUsername);
  const updated = addBinding(index, binding);
  write(path, updated);
  return { path, index: updated };
}

export function updateIndexFileWithRevocation(
  dir: string,
  githubUsername: string,
  revocation: ProfileIndexRevocation,
): IndexFileUpdate {
  const { path, index } = readOrCreate(dir, githubUsername);
  const updated = addRevocation(index, revocation);
  write(path, updated);
  return { path, index: updated };
}
