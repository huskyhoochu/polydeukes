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
  type BaselineSnapshot,
  findUnattributed,
  readBaseline,
  type StoredBaseline,
  snapshotBaseline,
  writeBaseline,
} from './baseline.js';
export {
  type CompiledDeclaration,
  type ConfigFault,
  compileDeclaration,
  type DeclarationVerdict,
  judgeDeclaration,
  type World,
  witnessOpens,
} from './declaration-engine.js';
export {
  type CompileDisciplinesSpec,
  compileDisciplineRegistrations,
  type SuppliedWorld,
  worldsFromInput,
} from './discipline.js';
export { type CovenantRegistration, dispatchCovenants } from './dispatch.js';
export { type RunCovenantSpec, runCovenant } from './run-covenant.js';
export { type SelfModRegistrationSpec, selfModRegistration } from './self-mod.js';
export { type ShellModRegistrationSpec, shellModRegistration } from './shell-mod.js';
export {
  type TranscriptModRegistrationSpec,
  transcriptModRegistration,
} from './transcript-mod.js';
export { type TtlWitnessSpec, ttlWitness } from './ttl-witness.js';
