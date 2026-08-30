/**
 * `runAdapterPath` — the adapter path's single wiring entry point.
 *
 * Composes translation → injected dispatch → funnel-supplement recording so every
 * adapter-path call leaves exactly one telemetry row when summed with downstream
 * records. I/O lives here and only here — the translate layer (index.ts) stays pure.
 */

import { readFileSync } from 'node:fs';
import { appendRecordFailOpen, EXIT_BREAK_BLOCKING, EXIT_UPHOLD } from '@polydeukes/core';
import { collectFileChanges } from './file-changes.js';
import { buildCovenantInput } from './up-translate.js';

/**
 * `DispatchOutcome` — the part of the dispatcher's return this path reads.
 *
 * Declared here rather than imported: dependencies run one way (adapter → core only), so
 * the covenant package is never imported. The real dispatcher carries more per entry; a
 * wider return satisfies this shape structurally, so the assembler's typecheck bites when
 * the dispatcher stops carrying a field named here, not when it starts carrying a new one.
 */
export type DispatchOutcome = {
  exitCode: 0 | 2;
  results: { label: string; exitCode: 0 | 2 }[];
};

/** Default label for adapter-level telemetry records. */
const DEFAULT_ADAPTER_LABEL = 'adapter-claude-code';

/**
 * Real-fs pre-state reader for fileChanges — `null` only for true absence (ENOENT).
 *
 * Any other read failure (permissions, a directory target, fd exhaustion) throws:
 * `null` is the IR's creation sentinel, and a poisoned `pre: null` on an existing
 * file would let a path-family discipline uphold the overwrite (fail-open). The
 * caller converts the throw into one adapter `blocked` record.
 */
function readPreStateFromDisk(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Run one PreToolUse payload through the adapter path.
 *
 * Fail-closed on the verdict axis: an unparseable payload, a classification failure,
 * or a rejecting dispatch all resolve to `{ exitCode: 2 }` with one adapter `blocked`
 * record — never a thrown error (an unhandled rejection would exit the hook
 * non-blocking, a bypass vector). The funnel supplement is the exact rule
 * `exitCode 0 && results.length 0 → one adapter passed record`; every other outcome
 * appends nothing because downstream already recorded, so nothing double-counts.
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

  // Attach pre/post evidence to the call it belongs to — this path translates
  // exactly one payload, so the one evidence rides toolCalls[0]. Attached
  // only when provable: a non-mutating payload leaves its call unproven. A pre-state
  // read failure that is not absence blocks: evidence that cannot be gathered must not
  // dispatch a shape that reads as creation.
  let evidence: ReturnType<typeof collectFileChanges>;
  try {
    evidence = collectFileChanges(payload, readPreStateFromDisk);
  } catch {
    return blockAndRecord();
  }
  const input =
    evidence === null
      ? built.value
      : {
          ...built.value,
          toolCalls: built.value.toolCalls.map((call, index) =>
            index === 0 ? { ...call, fileChange: evidence } : call,
          ),
        };

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
