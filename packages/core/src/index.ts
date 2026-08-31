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
} from './algebra.js';
export {
  type AlgebraDeclarationBody,
  ConfigValidationError,
  DEFAULT_TELEMETRY_LOG_PATH,
  type DisciplineDraft,
  type DisciplineEntry,
  type DisciplineForbid,
  defineConfig,
  type EnforceLevel,
  type LanguageProfile,
  type PolydeukesConfig,
  type ResolvedConfig,
  type ResolvedLanguageProfile,
} from './config.js';
export {
  EXIT_BREAK_BLOCKING,
  EXIT_BREAK_NON_BLOCKING,
  EXIT_UPHOLD,
} from './exit-codes.js';
export {
  type FailMode,
  type FailureKind,
  failModeToExitCode,
  resolveFailMode,
} from './fail-policy.js';
export { isPlainObject } from './is-plain-object.js';
export { normalizeProtectedPaths } from './protected-paths.js';
export {
  allFileChanges,
  type CovenantInput,
  type CovenantVerdict,
  type DispatchOutcome,
  type FileChange,
  parseInput,
  type SourceReader,
  verdictToExitCode,
} from './protocol.js';
export {
  aggregateGain,
  appendRecord,
  appendRecordFailOpen,
  formatRecordLine,
  type GainSummary,
  parseRecordLine,
  readRecords,
  runGain,
  type TelemetryEvent,
  type TelemetryRecord,
} from './telemetry.js';
export {
  type CanonicalTranscript,
  noopTranscript,
  type SubagentInvocation,
  type TranscriptToolCall,
  type TranscriptUserMessage,
  transcriptFromInput,
} from './transcript.js';
