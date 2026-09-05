/**
 * @polydeukes/core — the thin, domain- and agent-agnostic core.
 *
 * Alpha. Carries the covenant protocol, the ROI telemetry collector, and the config
 * schema. Pure types and functions, except telemetry's confined I/O functions
 * (appendRecord / readRecords / appendRecordFailOpen).
 * See https://github.com/huskyhoochu/polydeukes
 */

export {
  type AlgebraDeclaration,
  BINARY_COMBINATOR_NAMES,
  type BinaryStep,
  type ExtractBlock,
  type ExtractStep,
  RELATION_NAMES,
  type RelateEntry,
  type RelationDecl,
  type RelationName,
  type ScopeBlock,
  SUPPLY_POLICIES,
  type SupplyBlock,
  type UnaryStep,
  validateAlgebraDeclaration,
  type Witness,
  type WitnessBlock,
  type Witnesses,
} from './algebra.ts';
export {
  AXIS_NAMES,
  type Axis,
  type DerivableDeclaration,
  deriveShape,
  MECHANISM_NAMES,
  MECHANISM_SHAPES,
  type MechanismName,
  type MechanismShape,
} from './catalogue.ts';
export {
  type AlgebraDeclarationBody,
  ConfigValidationError,
  DEFAULT_TELEMETRY_LOG_PATH,
  type DisciplineDraft,
  type DisciplineEntry,
  defineConfig,
  type EnforceLevel,
  type LanguageProfile,
  type PolydeukesConfig,
  type ResolvedConfig,
  type ResolvedLanguageProfile,
} from './config.ts';
export {
  EXIT_BREAK_BLOCKING,
  EXIT_BREAK_NON_BLOCKING,
  EXIT_UPHOLD,
} from './exit-codes.ts';
export {
  type FailMode,
  type FailureKind,
  failModeToExitCode,
  resolveFailMode,
} from './fail-policy.ts';
export { isPlainObject } from './is-plain-object.ts';
export { normalizeProtectedPaths } from './protected-paths.ts';
export {
  allFileChanges,
  type ChannelReader,
  type CovenantInput,
  type CovenantVerdict,
  type DispatchOutcome,
  type FileChange,
  parseInput,
  type SourceReader,
  verdictToExitCode,
} from './protocol.ts';
export {
  aggregateGain,
  appendRecord,
  appendRecordFailOpen,
  formatRecordLine,
  type GainSummary,
  parseRecordLine,
  readRecords,
  runGain,
  SKIP_REASONS,
  type SkipReason,
  type TelemetryEvent,
  type TelemetryRecord,
} from './telemetry.ts';
export {
  type CanonicalTranscript,
  noopTranscript,
  type TranscriptToolCall,
  type TranscriptUserMessage,
  transcriptFromInput,
} from './transcript.ts';
