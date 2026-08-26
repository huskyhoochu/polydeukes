/**
 * Shared covenant test helpers (COVENANT-10 REVIEW — the COVENANT-06 §8 carry-over's
 * trigger condition fired: a third file duplicated all three). Not a test file itself.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import type { CovenantInput } from '@polydeukes/core';

/** A minimal CovenantInput with one tool call carrying the given args. */
export function inputWithArgs(args: Record<string, unknown>): CovenantInput {
  return {
    toolCalls: [{ name: 'some-tool', args }],
    subagentSpawns: [],
    userMessages: [],
  };
}

/** A judge thunk answering a fixed exit-code equivalent, judging nothing. */
export function exitThunk(code: number): () => Promise<{ exitCode: number }> {
  return async () => ({ exitCode: code });
}

/**
 * A judge thunk that touches `outFile` and answers `exitCode` — proves the judge actually
 * ran (a missing outFile means it never did), the observation the spawned marker-file body
 * used to carry. `reason` rides along on a break so stderr assertions have something to
 * read (DISPATCH-01 §4.1).
 */
export function markerThunk(
  outFile: string,
  exitCode = 0,
  reason?: string,
): () => Promise<{ exitCode: number; reason?: string }> {
  return async () => {
    writeFileSync(outFile, String(exitCode));
    return reason === undefined ? { exitCode } : { exitCode, reason };
  };
}

/** Read the telemetry log and return its non-empty lines. */
export function readTelemetryLines(path: string): string[] {
  return readFileSync(path, 'utf-8')
    .split('\n')
    .filter((l) => l.length > 0);
}
