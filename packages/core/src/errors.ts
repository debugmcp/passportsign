/**
 * §4 error vocabulary — the set of failure codes a bind/verify call can
 * surface to a caller. Verbatim from `docs/passportsign.md` §4.
 *
 * Callers should `catch` `PassportsignError` and branch on `.code`. The
 * `cause` field carries the underlying error (HTTP response body, SDK
 * error, etc.) for logging — never for client display, since it may
 * include identifying data.
 */

export const ERROR_CODES = [
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
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class PassportsignError extends Error {
  readonly code: ErrorCode;
  override readonly cause: unknown;

  constructor(code: ErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'PassportsignError';
    this.code = code;
    this.cause = cause;
  }
}
