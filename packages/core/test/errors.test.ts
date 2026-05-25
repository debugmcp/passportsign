import { describe, it, expect } from 'vitest';
import { ERROR_CODES, PassportsignError } from '../src/errors.js';

describe('ERROR_CODES', () => {
  it('matches spec §4 exactly', () => {
    expect(ERROR_CODES).toEqual([
      'username_invalid',
      'binding_pending_expired',
      'gist_not_found',
      'gist_wrong_content',
      'gist_wrong_owner',
      'gist_predates_init',
      'proof_invalid',
      'proof_scope_mismatch',
      'proof_missing_personhood',
      'log_submission_failed',
      'internal_error',
    ]);
  });

  it('has no duplicate codes', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });
});

describe('PassportsignError', () => {
  it('stores code, message, and cause', () => {
    const cause = new Error('underlying');
    const err = new PassportsignError('gist_not_found', 'no such gist', cause);
    expect(err.code).toBe('gist_not_found');
    expect(err.message).toBe('no such gist');
    expect(err.cause).toBe(cause);
    expect(err.name).toBe('PassportsignError');
  });

  it('is instanceof Error', () => {
    const err = new PassportsignError('internal_error', 'x');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PassportsignError);
  });

  it('cause defaults to undefined', () => {
    const err = new PassportsignError('internal_error', 'x');
    expect(err.cause).toBeUndefined();
  });
});
