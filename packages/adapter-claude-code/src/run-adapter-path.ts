/**
 * `runAdapterPath` — the adapter path's single wiring entry point.
 *
 * Composes translation → injected dispatch → funnel-supplement recording so every
 * adapter-path call leaves exactly one telemetry row when summed with downstream
 * records. I/O lives here and only here — the translation modules stay pure.
 */

import { readFileSync } from 'node:fs';
import {
  appendRecordFailOpen,
  type DispatchOutcome,
  EXIT_BREAK_BLOCKING,
  EXIT_UPHOLD,
} from '@polydeukes/core';
import { collectFileChanges } from './file-changes.js';
import { buildCovenantInput } from './up-translate.js';

/**
 * The part of a dispatch result this path reads — a structural view, not a second protocol.
 *
 * Derived from core's `DispatchOutcome` by `Pick`, so it cannot drift from the protocol type:
 * a field renamed there stops compiling here. It is narrower on purpose — the entries carry
 * a telemetry word this path never reads, and demanding it would make every dispatcher the
 * adapter accepts name a core type its own consumers may not be able to resolve.
 */
export type DispatchAdapterView = {
  exitCode: DispatchOutcome['exitCode'];
  results: readonly unknown[];
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

/** {@link runAdapterPath} input — one payload, where to record, and the dispatch seam. */
export type RunAdapterPathSpec = {
  /** Raw hook stdin — one PreToolUse payload as a JSON string. */
  rawPayload: string;
  /** Where adapter-level records append. */
  telemetryPath: string;
  /**
   * Injected dispatch seam — the assembler binds the real dispatcher here.
   *
   * Typed by what this path reads, not by what the dispatcher returns: the supplement rule
   * below needs the exit code and whether any covenant produced an entry. A dispatcher
   * carrying more per entry — core's `DispatchOutcome`, which adds the telemetry word the
   * wrapper already recorded — satisfies this structurally, so binding one costs no cast.
   */
  dispatch: (stdinPayload: string) => Promise<DispatchAdapterView>;
  /** Label for adapter-level records. Default: 'adapter-claude-code'. */
  adapterLabel?: string;
};

/** {@link runAdapterPath} result — the exit code the hook process leaves with. */
export type AdapterPathOutcome = { exitCode: 0 | 2 };

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
export async function runAdapterPath(spec: RunAdapterPathSpec): Promise<AdapterPathOutcome> {
  const label = spec.adapterLabel ?? DEFAULT_ADAPTER_LABEL;
  const blockAndRecord = (): AdapterPathOutcome => {
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

  let outcome: DispatchAdapterView;
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
