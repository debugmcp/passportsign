/**
 * Public API of @passportsign/core.
 *
 * Day 1-2: canonical JCS + in-toto statement + bundle format.
 * Day 3-4: §4 error vocabulary + nonce + GitHub gist check +
 *          SQLite cache + bind orchestrator (no Rekor yet).
 */

export {
  canonicalize,
  canonicalSha256Hex,
} from './canonical.js';

export {
  IN_TOTO_STATEMENT_TYPE,
  PASSPORTSIGN_PREDICATE_TYPE,
  buildStatement,
  type BuildStatementInput,
  type DisclosureLevel,
  type PassportsignPredicate,
  type PassportsignStatement,
} from './statement.js';

export {
  BUNDLE_FORMAT_VERSION,
  BundleValidationError,
  readBundle,
  validateBundle,
  writeBundle,
  type PassportsignBundle,
  type RekorBundleFields,
} from './bundle.js';

export {
  ERROR_CODES,
  PassportsignError,
  type ErrorCode,
} from './errors.js';

export {
  NONCE_BYTES,
  NONCE_BASE32_LENGTH,
  base32Encode,
  generateNonce,
} from './nonce.js';

export {
  checkGistControl,
  type CheckGistOptions,
  type GistEvidence,
} from './github.js';

export {
  openCache,
  type BindingRow,
  type PassportsignCache,
  type Status,
} from './storage/sqlite.js';

export {
  prepareBinding,
  type PrepareBindingDeps,
  type PrepareBindingInit,
  type PrepareBindingInput,
  type PreparedBinding,
} from './bind.js';

export {
  DSSE_VERSION,
  IN_TOTO_PAYLOAD_TYPE,
  pae,
  signEnvelope,
  type DsseEnvelope,
  type DsseSignature,
  type SignEnvelopeResult,
} from './dsse.js';

export {
  DEFAULT_REKOR_BASE_URL,
  PublicSigstoreRekorClient,
  buildIntotoEntryBody,
  type InclusionProof,
  type PublicSigstoreRekorClientOptions,
  type RekorClient,
  type RekorEntryResponse,
} from './log/rekor.js';

export {
  submitBinding,
  type SubmitBindingDeps,
  type SubmitBindingResult,
} from './submit.js';

export {
  hashLeaf,
  hashPair,
  verifyConsistency,
  verifyInclusion,
} from './merkle.js';

export {
  verifyBundle,
  type BundleVerifyResult,
  type CheckResult,
  type VerifyBundleDeps,
} from './verifier.js';
