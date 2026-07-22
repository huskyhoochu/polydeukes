/**
 * `runCovenant` — the covenant execution wrapper (COVENANT-01).
 *
 * Spawns a covenant body, pipes the opaque stdin payload verbatim, translates the
 * body's exit code by policy (1 → blocking 2), and appends exactly one ROI telemetry
 * record per call via {@link appendRecordFailOpen} (the core's fail-open wrapper
 * around its sole collector — no local logger). Process spawning is confined to this file;
 * {@link translateExitCode} is pure.
 */

import { spawn } from 'node:child_process';
import {
  appendRecordFailOpen,
  EXIT_BREAK_BLOCKING,
  EXIT_BREAK_NON_BLOCKING,
  EXIT_UPHOLD,
  type TelemetryEvent,
} from '@polydeukes/core';

/** The wrapper's final verdict — `1` never escapes: a break becomes the blocking `2`. */
type WrapperExitCode = typeof EXIT_UPHOLD | typeof EXIT_BREAK_BLOCKING;

/**
 * `runCovenant` specification (PRD §4.1).
 *
 * `stdinPayload` is opaque cargo — piped to the body's stdin verbatim, never parsed or
 * validated (that is the body's fail-closed `parseInput`). `subject` defaults to the
 * `-` sentinel in telemetry when absent. `telemetryPath` is always an explicit argument.
 * `enforce` selects the translation column (CONFIG-06): absent defaults to `block`.
 */
export type RunCovenantSpec = {
  command: string;
  args?: string[];
  stdinPayload: string;
  label: string;
  subject?: string;
  telemetryPath: string;
  enforce?: 'block' | 'advise';
};

/**
 * Translate a body outcome into the wrapper verdict and telemetry event (PRD §4.2, pure).
 *
 * `bodyExitCode === 0` (uphold) passes; every other outcome — a break report (`1`), the
 * body's own fail-closed (`2`), any uninterpretable code (`3+`), or a spawn failure /
 * signal termination (`null`) — is fail-closed to the blocking `2` / `blocked`. This is
 * the CORE-03 evolution seam: the unconditional 1→2 translation lives here, isolated.
 *
 * `enforce` (CONFIG-06 §4.4) relaxes ONLY the verdict cell: under `advise` a break
 * report (`1`) becomes `0` / `advised` — recorded, not blocking. Every unjudgeable
 * outcome (`2`, `3+`, `null`) stays `2` / `blocked` regardless of level.
 */
export function translateExitCode(
  bodyExitCode: number | null,
  enforce: 'block' | 'advise' = 'block',
): {
  exitCode: WrapperExitCode;
  event: TelemetryEvent;
} {
  if (bodyExitCode === EXIT_UPHOLD) {
    return { exitCode: EXIT_UPHOLD, event: 'passed' };
  }
  if (enforce === 'advise' && bodyExitCode === EXIT_BREAK_NON_BLOCKING) {
    return { exitCode: EXIT_UPHOLD, event: 'advised' };
  }
  return { exitCode: EXIT_BREAK_BLOCKING, event: 'blocked' };
}

/** Spawn the body, pipe the payload to its stdin, and resolve its exit code (or `null`). */
function spawnBody(command: string, args: string[], stdinPayload: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['pipe', 'inherit', 'inherit'] });

    // Spawn failure (nonexistent executable, etc.) — cannot judge, so resolve `null`
    // and let the translation table fail-closed. Never reject: the wrapper never throws.
    child.on('error', () => resolve(null));

    // A signal-terminated body reports code `null`; the translation table treats it as
    // fail-closed too.
    child.on('close', (code) => resolve(code));

    // The payload is opaque — written verbatim, not serialized or validated.
    child.stdin.on('error', () => {});
    child.stdin.end(stdinPayload);
  });
}

/**
 * Run a covenant body through the wrapper (PRD §4).
 *
 * Resolves with the wrapper's final `exitCode` (`0` or `2`) and the raw `bodyExitCode`
 * for observation (`null` when the body left no code) — the telemetry event is a pure
 * function of both ({@link translateExitCode}), so callers needing it recompute rather
 * than widen this shape. Logging is fail-open (PRD §4.3)
 * via {@link appendRecordFailOpen}: a telemetry failure never alters the verdict and
 * never throws. The gate closes; the measurement stays open.
 */
export async function runCovenant(
  spec: RunCovenantSpec,
): Promise<{ exitCode: WrapperExitCode; bodyExitCode: number | null }> {
  const bodyExitCode = await spawnBody(spec.command, spec.args ?? [], spec.stdinPayload);
  const { exitCode, event } = translateExitCode(bodyExitCode, spec.enforce);

  appendRecordFailOpen(spec.telemetryPath, {
    event,
    label: spec.label,
    subject: spec.subject ?? '-',
  });

  return { exitCode, bodyExitCode };
}
