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

export {
  type CompileDeclarationSpec,
  type CompiledDeclaration,
  type ConfigFault,
  compileDeclaration,
  type DeclarationVerdict,
  type JudgeDeclarationSpec,
  judgeDeclaration,
  type WitnessOpensSpec,
  type World,
  witnessOpens,
} from './declaration-engine.ts';
export {
  type CompileDisciplinesSpec,
  compileDisciplineRegistrations,
  type SuppliedWorld,
  type WorldsFromInputSpec,
  worldsFromInput,
} from './discipline.ts';
export {
  type CovenantRegistration,
  type DispatchCovenantsSpec,
  dispatchCovenants,
  type MetaCovenantRegistration,
  type WitnessPredicate,
} from './dispatch.ts';
export { type RunCovenantSpec, type RunCovenantVerdict, runCovenant } from './run-covenant.ts';
export { type SelfModRegistrationSpec, selfModRegistration } from './self-mod.ts';
export { type ShellModRegistrationSpec, shellModRegistration } from './shell-mod.ts';
export {
  type PlanSourcesSpec,
  planSources,
  type SourcePlan,
  type SuppliedSources,
  type SupplySourcesSpec,
  supplySources,
} from './supply.ts';
export {
  type TranscriptModRegistrationSpec,
  transcriptModRegistration,
} from './transcript-mod.ts';
export { type TtlWitnessSpec, ttlWitness } from './ttl-witness.ts';
