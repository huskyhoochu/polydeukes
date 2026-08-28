/**
 * @polydeukes/covenant — the judging core.
 *
 * The execution wrapper (`runCovenant`) calls an in-process judge thunk, translates its
 * exit code, and appends one telemetry record per call. The path-routing dispatcher sends
 * an input to the covenant bodies whose protected paths it mentions. On top of a pure Bash
 * tokenizer sit three meta-covenants — self-mod (the tool axis), shell-mod (the Bash axis),
 * and transcript-mod — plus the discipline compiler that turns config entries into
 * registrations.
 */

export type { TelemetryEvent } from '@polydeukes/core';
export {
  type BaselineSnapshot,
  findUnattributed,
  readBaseline,
  type StoredBaseline,
  snapshotBaseline,
  writeBaseline,
} from './baseline.js';
export {
  extractMutations,
  type Indeterminate,
  type MutationAnalysis,
  type MutationRule,
  type MutationTarget,
  type RedirectToken,
  type SimpleCommand,
  type TokenizeResult,
  tokenizeCommandLine,
  type WordToken,
} from './bash-line.js';
export {
  type Break,
  type CompiledDeclaration,
  type ConfigFault,
  compileDeclaration,
  type DeclarationVerdict,
  EXTRACT_STEPS,
  type Item,
  type Items,
  judgeDeclaration,
  type PairedItems,
  scopeAdmits,
  UNARY_STEP_NAMES,
  type Witness,
  type World,
  witnessOpens,
} from './declaration-engine.js';
export {
  type Baseline,
  captureBaseline,
  diffBaselines,
  type FileDelta,
  judgeAddedViolations,
} from './delta.js';
export {
  type CompileDisciplinesSpec,
  compileDisciplineRegistrations,
  type DisciplineJudgeOptions,
  judgeDiscipline,
  type SuppliedWorld,
  worldsFromInput,
} from './discipline.js';
export { type CovenantRegistration, dispatchCovenants, matchRegistrations } from './dispatch.js';
export { mentionsPath, pathMatchesProtected } from './mention.js';
export { redirectWriteRule, sedInPlaceRule, teeRule } from './mutation-rules.js';
export {
  type JudgeOutcome,
  outcomeFromVerdict,
  type RunCovenantSpec,
  runCovenant,
  translateExitCode,
  UNJUDGEABLE_OUTCOME,
} from './run-covenant.js';
export {
  judgeSelfModification,
  type SelfModificationSpec,
  type SelfModRegistrationSpec,
  selfModRegistration,
} from './self-mod.js';
export {
  DEFAULT_READ_ONLY_COMMANDS,
  judgeShellModification,
  type ShellModificationSpec,
  type ShellModRegistrationSpec,
  shellModRegistration,
} from './shell-mod.js';
export {
  judgeTranscriptModification,
  type TranscriptModificationSpec,
  type TranscriptModRegistrationSpec,
  transcriptModRegistration,
} from './transcript-mod.js';
export { type TtlWitnessSpec, ttlWitness } from './ttl-witness.js';
