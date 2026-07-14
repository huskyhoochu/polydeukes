/**
 * @polydeukes/covenant — the run_covenant execution wrapper and the Bash analysis core.
 *
 * Pre-alpha. COVENANT-01 lands the wrapper: it spawns a covenant body,
 * pipes stdin-JSON, translates the body's exit code (1 → blocking 2),
 * and appends one ROI telemetry record per call via @polydeukes/core.
 * COVENANT-04a lands the pure Bash command-line tokenizer + mutation-target
 * extraction core that the path-shaped meta-covenant (04b–04d) builds on.
 * COVENANT-02 lands the path-routing dispatcher: the edit-time first-line layer
 * that routes protected-path mentions to their registered covenant bodies.
 * COVENANT-03 lands the self-mod meta-covenant — the dispatcher's first real
 * registrant: a pure judge + CLI body that block mutating tool calls on protected
 * paths, plus the escape-hatch seam whose bypasses are measured as `bypassed`.
 */

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
export { type CovenantRegistration, dispatchCovenants, matchRegistrations } from './dispatch.js';
export { envEscapeHatch } from './escape-hatch.js';
export { redirectWriteRule, sedInPlaceRule, teeRule } from './mutation-rules.js';
export { type RunCovenantSpec, runCovenant, translateExitCode } from './run-covenant.js';
export { judgeSelfModification, type SelfModificationSpec } from './self-mod.js';
