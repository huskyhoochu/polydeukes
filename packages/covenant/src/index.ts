/**
 * @polydeukes/covenant — the run_covenant execution wrapper.
 *
 * Pre-alpha. COVENANT-01 lands the wrapper: it spawns a covenant body,
 * pipes stdin-JSON, translates the body's exit code (1 → blocking 2),
 * and appends one ROI telemetry record per call via @polydeukes/core.
 */

export { type RunCovenantSpec, runCovenant, translateExitCode } from './run-covenant.js';
