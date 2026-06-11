/**
 * `@passportsign/core/web` — the runtime-neutral surface.
 *
 * Everything exported here runs on Node, Cloudflare Workers, and
 * browsers: no `node:fs`, no `node:crypto`, no `node:sqlite`, no
 * `Buffer`. The Worker badge service and the browser bind flow import
 * from this subpath; if something node-only sneaks in, their bundlers
 * fail loudly at build time — that's the contract this file enforces.
 *
 * Node-only counterparts stay on the main entry: `readBundle` /
 * `writeBundle` (fs), `signEnvelope` (node crypto; use
 * `signEnvelopeWeb` here), `submitBinding` (composes the node signer;
 * compose `signEnvelopeWeb` + `RekorClient.submitIntoto` +
 * `assembleBundle` instead), and the SQLite cache.
 */

export { canonicalize, canonicalSha256Hex } from './canonical.js';

export {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  bytesToUtf8,
  hexToBytes,
  randomBytes,
  sha256Bytes,
  sha256Hex,
  utf8ToBytes,
} from './encoding.js';

export {
  IN_TOTO_STATEMENT_TYPE,
  PASSPORTSIGN_PREDICATE_TYPE,
  PASSPORTSIGN_REVOCATION_PREDICATE_TYPE,
  buildRevocationStatement,
  buildStatement,
  type BuildRevocationStatementInput,
  type BuildStatementInput,
  type DisclosureLevel,
  type PassportsignPredicate,
  type PassportsignRevocationPredicate,
  type PassportsignRevocationStatement,
  type PassportsignStatement,
} from './statement.js';

export {
  BUNDLE_FORMAT_VERSION,
  BundleValidationError,
  assembleBundle,
  validateBundle,
  type PassportsignBundle,
  type RekorBundleFields,
  type SubmittableStatement,
} from './bundle.js';

export { ERROR_CODES, PassportsignError, type ErrorCode } from './errors.js';

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
  prepareBinding,
  type PrepareBindingDeps,
  type PrepareBindingInit,
  type PrepareBindingInput,
  type PreparedBinding,
} from './bind.js';

export {
  prepareRevocation,
  type PrepareRevocationInput,
  type PreparedRevocation,
} from './revoke.js';

export {
  DSSE_VERSION,
  IN_TOTO_PAYLOAD_TYPE,
  pae,
  type DsseEnvelope,
  type DsseSignature,
} from './dsse-common.js';

export {
  p1363ToDer,
  signEnvelopeWeb,
  type SignEnvelopeWebResult,
} from './dsse-web.js';

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
  hashLeaf,
  hashPair,
  verifyConsistency,
  verifyInclusion,
} from './merkle.js';

export {
  packSdkPayload,
  unpackSdkPayload,
  type PackedSdkPayload,
  type SdkPayload,
} from './sdk-payload.js';

export {
  renderBadgeMarkdown,
  renderBadgeSvg,
  type BadgeInput,
} from './badge.js';

export {
  PROFILE_INDEX_FILENAME,
  PROFILE_INDEX_VERSION,
  ProfileIndexValidationError,
  addBinding,
  addRevocation,
  createProfileIndex,
  fetchProfileIndex,
  mergeProfileIndexes,
  profileIndexUrl,
  validateProfileIndex,
  type FetchProfileIndexOptions,
  type ProfileIndex,
  type ProfileIndexBinding,
  type ProfileIndexRevocation,
} from './profile-index.js';

export {
  EntryParseError,
  STALENESS_WINDOW_MS,
  classifyBindings,
  parseIntotoEntry,
  type BindingState,
  type ClassifiedBinding,
  type ClassifyBindingsInput,
  type InTotoStatement,
  type ParsedIntotoEntry,
} from './classify.js';

export {
  lookupBindings,
  lookupFromIndex,
  type LookupBindingsDeps,
  type LookupDeps,
  type LookupEntryProblem,
  type LookupResult,
} from './lookup.js';

export {
  verifyBundle,
  type BundleVerifyResult,
  type CheckResult,
  type SdkVerifier,
  type SdkVerifyInput,
  type SdkVerifyResult,
  type VerifyBundleDeps,
} from './verifier.js';
