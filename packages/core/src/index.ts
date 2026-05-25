/**
 * Public API of @passportsign/core.
 *
 * Day 1-2 surface: canonical JCS, in-toto Statement v1 builder, and the
 * binding.passportsign.json bundle format. All pure / I/O-bounded to the
 * bundle file. No SDK, no network.
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
