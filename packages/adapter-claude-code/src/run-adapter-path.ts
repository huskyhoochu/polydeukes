/**
 * `runAdapterPath` — the adapter path's single wiring entry point (ADAPTER-03).
 *
 * Composes translation → injected dispatch → funnel-supplement recording so every
 * adapter-path call leaves exactly one telemetry row when summed with downstream
 * records (PRD §4.3 table is canonical). I/O lives here and only here — the
 * translate layer (index.ts) stays pure.
 */

import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  appendRecord,
  EXIT_BREAK_BLOCKING,
  EXIT_UPHOLD,
  type TelemetryRecord,
} from '@polydeukes/core';
import { collectFileChanges } from './file-changes.js';
import { buildCovenantInput } from './index.js';

/**
 * `DispatchOutcome` — structural mirror of the dispatcher's return (PRD §4.2).
 *
 * Deliberately declared here instead of imported: dependencies are one-way (adapter →
 * core only), so the covenant package is never imported. Contract drift is caught by
 * the assembler's typecheck when the real dispatcher is bound to the seam.
 */
export type DispatchOutcome = {
  exitCode: 0 | 2;
  results: { label: string; exitCode: 0 | 2 }[];
};

/** Default label for adapter-level telemetry records. */
const DEFAULT_ADAPTER_LABEL = 'adapter-claude-code';

/** Real-fs pre-state reader for fileChanges — null when the file cannot be read. */
function readPreStateFromDisk(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Append one telemetry record, timestamping it here; swallow every logging failure.
 *
 * Deliberate local replica of the covenant package's fail-open helper (PRD §7 —
 * sibling imports are forbidden, so the shape is copied, not shared). The mkdir and
 * the append share one try block; a failure of either never alters the verdict.
 */
function appendRecordFailOpen(
  telemetryPath: string,
  record: Omit<TelemetryRecord, 'timestamp'>,
): void {
  try {
    mkdirSync(dirname(telemetryPath), { recursive: true });
    appendRecord(telemetryPath, { timestamp: new Date().toISOString(), ...record });
  } catch {
    // fail-open: a logging problem must not alter the verdict or propagate.
  }
}

/**
 * Run one PreToolUse payload through the adapter path (PRD §4.1).
 *
 * Fail-closed on the verdict axis: an unparseable payload, a classification failure,
 * or a rejecting dispatch all resolve to `{ exitCode: 2 }` with one adapter `blocked`
 * record — never a thrown error (an unhandled rejection would exit the hook
 * non-blocking, a bypass vector). The funnel supplement is the exact rule
 * `exitCode 0 && results.length 0 → one adapter passed record`; every other outcome
 * appends nothing because downstream already recorded (PRD §4.3, no double counting).
 */
export async function runAdapterPath(spec: {
  /** Raw hook stdin — one PreToolUse payload as a JSON string. */
  rawPayload: string;
  telemetryPath: string;
  /** Injected dispatch seam — the assembler binds the real dispatcher here. */
  dispatch: (stdinPayload: string) => Promise<DispatchOutcome>;
  /** Label for adapter-level records. Default: 'adapter-claude-code'. */
  adapterLabel?: string;
}): Promise<{ exitCode: 0 | 2 }> {
  const label = spec.adapterLabel ?? DEFAULT_ADAPTER_LABEL;
  const blockAndRecord = (): { exitCode: 0 | 2 } => {
    appendRecordFailOpen(spec.telemetryPath, { event: 'blocked', label, subject: '-' });
    return { exitCode: EXIT_BREAK_BLOCKING };
  };

  let payload: unknown;
  try {
    payload = JSON.parse(spec.rawPayload);
  } catch {
    return blockAndRecord();
  }

  const built = buildCovenantInput([payload]);
  if (built.ok !== true) {
    return blockAndRecord();
  }

  // Attach pre/post evidence for mutating payloads (COVENANT-10 §4.3). The key is
  // only attached when non-empty — a non-mutating payload keeps the legacy IR shape.
  const fileChanges = collectFileChanges(payload, readPreStateFromDisk);
  const input = fileChanges.length > 0 ? { ...built.value, fileChanges } : built.value;

  let outcome: DispatchOutcome;
  try {
    outcome = await spec.dispatch(JSON.stringify(input));
  } catch {
    return blockAndRecord();
  }

  if (outcome.exitCode === EXIT_UPHOLD && outcome.results.length === 0) {
    appendRecordFailOpen(spec.telemetryPath, { event: 'passed', label, subject: '-' });
  }
  return { exitCode: outcome.exitCode };
}
