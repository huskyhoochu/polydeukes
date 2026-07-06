/**
 * `runCovenant` — the covenant execution wrapper (COVENANT-01).
 *
 * Spawns a covenant body, pipes the opaque stdin payload verbatim, translates the
 * body's exit code by policy (1 → blocking 2), and appends exactly one ROI telemetry
 * record per call via {@link appendRecord} — the sole collector (no local logger).
 * Process I/O is confined to this file; {@link translateExitCode} is pure.
 */

import { spawn } from 'node:child_process';
import { appendRecord, type TelemetryEvent } from '@polydeukes/core';

/** The wrapper's final verdict — `1` never escapes: a break becomes the blocking `2`. */
type WrapperExitCode = 0 | 2;

/**
 * `runCovenant` specification (PRD §4.1).
 *
 * `stdinPayload` is opaque cargo — piped to the body's stdin verbatim, never parsed or
 * validated (that is the body's fail-closed `parseInput`). `subject` defaults to the
 * `-` sentinel in telemetry when absent. `telemetryPath` is always an explicit argument.
 */
export type RunCovenantSpec = {
  command: string;
  args?: string[];
  stdinPayload: string;
  label: string;
  subject?: string;
  telemetryPath: string;
};

/**
 * Translate a body outcome into the wrapper verdict and telemetry event (PRD §4.2, pure).
 *
 * `bodyExitCode === 0` (uphold) passes; every other outcome — a break report (`1`), the
 * body's own fail-closed (`2`), any uninterpretable code (`3+`), or a spawn failure /
 * signal termination (`null`) — is fail-closed to the blocking `2` / `blocked`. This is
 * the CORE-03 evolution seam: the unconditional 1→2 translation lives here, isolated.
 */
export function translateExitCode(bodyExitCode: number | null): {
  exitCode: WrapperExitCode;
  event: TelemetryEvent;
} {
  if (bodyExitCode === 0) {
    return { exitCode: 0, event: 'passed' };
  }
  return { exitCode: 2, event: 'blocked' };
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
 * for observation (`null` when the body left no code). Logging is fail-open (PRD §4.3):
 * a telemetry failure — {@link appendRecord}'s `{ ok: false }` or any other problem —
 * never alters the verdict and never throws. The gate closes; the measurement stays open.
 */
export async function runCovenant(
  spec: RunCovenantSpec,
): Promise<{ exitCode: WrapperExitCode; bodyExitCode: number | null }> {
  const bodyExitCode = await spawnBody(spec.command, spec.args ?? [], spec.stdinPayload);
  const { exitCode, event } = translateExitCode(bodyExitCode);

  try {
    appendRecord(spec.telemetryPath, {
      timestamp: new Date().toISOString(),
      event,
      label: spec.label,
      subject: spec.subject ?? '-',
    });
  } catch {
    // fail-open: a logging problem must not alter the verdict or propagate.
  }

  return { exitCode, bodyExitCode };
}
