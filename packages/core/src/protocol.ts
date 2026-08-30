/**
 * protocol — the covenant protocol: the input IR, the verdict, and the two directions
 * (parse stdin-JSON in, map a verdict to an exit code out).
 */

import { EXIT_BREAK_BLOCKING, EXIT_BREAK_NON_BLOCKING, EXIT_UPHOLD } from './exit-codes.js';
import { isPlainObject } from './is-plain-object.js';
import type { TelemetryEvent } from './telemetry.js';

/**
 * `FileChange` — one file's mutation evidence around the judged call.
 *
 * Agent-neutral, discriminated by `kind`: a deletion is first-class evidence rather
 * than an unrepresentable case, and impossible states (a deletion with resulting
 * content, a creation with a baseline) cannot be written down. Adapters fill this from
 * their own sources (virtual apply, git blobs) — the core only transports it.
 * `delete.pre` is the readable text baseline when one exists — absent for a binary
 * blob, because a deletion needs no content to be judged.
 */
export type FileChange =
  | { kind: 'create'; path: string; post: string }
  | { kind: 'modify'; path: string; pre: string; post: string }
  | { kind: 'delete'; path: string; pre?: string };

/**
 * `CovenantInput` — the agent-neutral input IR a covenant judges.
 *
 * Adapters up-translate their own agent payloads into this shape and pipe it as
 * stdin-JSON. The vocabulary carries no agent/tool literals; concrete tool or
 * subagent names are *values* an adapter fills in, never part of the core's type.
 * Evidence has exactly one home, the call element it belongs to: `fileChange` absent
 * means "this call is unproven", and no sibling call's evidence can stand in for it.
 */
export type CovenantInput = {
  toolCalls: { name: string; args?: Record<string, unknown>; fileChange?: FileChange }[];
  subagentSpawns: { kind: string }[];
  userMessages: { text: string }[];
  /**
   * The world axis: files a supply layer read for the judgment (key = repo-relative path,
   * an absent key = an absent file, never `null` — that is `FileChange.pre`'s creation
   * marker), and the observation unit's change set when the host sees wider than the
   * changes this input carries.
   */
  world?: { files?: Record<string, string>; changes?: string[] };
};

/**
 * `CovenantVerdict` — the result a covenant body produces.
 *
 * Either the promise was upheld, or it was broken with a human-readable reason.
 * Maps to an exit code via {@link verdictToExitCode}.
 */
export type CovenantVerdict = { upheld: true } | { upheld: false; reason: string };

/**
 * `DispatchOutcome` — the protocol-level result of one dispatch over many covenants.
 *
 * The blocking exit code plus one entry per judged covenant: `label` names which covenant
 * produced the entry, and `event` is the telemetry word the wrapper already recorded for
 * it. The event rides on the entry rather than being recomputed by a reader — the witness
 * valve is impure, so recomputing would consult it a second time for one verdict.
 */
export type DispatchOutcome = {
  exitCode: 0 | 2;
  results: { label: string; exitCode: 0 | 2; event: TelemetryEvent }[];
};

/**
 * Whether a value is the world axis: a plain object carrying nothing but a `files` record
 * of strings and a `changes` list of strings.
 *
 * Closed at two fields, and both shape-checked: a supplier writing under a misspelt key
 * supplies nothing while looking like a supply, and a `null` under a path would pass the
 * engine's key-presence test as a supplied file whose text is missing.
 */
function isWorld(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  for (const key of Object.keys(value)) {
    if (key !== 'files' && key !== 'changes') return false;
  }
  const { files, changes } = value;
  if (files !== undefined) {
    if (!isPlainObject(files)) return false;
    if (!Object.values(files).every((text) => typeof text === 'string')) return false;
  }
  if (changes !== undefined) {
    if (!Array.isArray(changes)) return false;
    if (!changes.every((path) => typeof path === 'string')) return false;
  }
  return true;
}

/**
 * Deserialize stdin-JSON into a {@link CovenantInput} (the protocol's reverse direction).
 *
 * fail-closed: this never throws. Any failure — unparseable JSON, an empty
 * payload, a parsed value that is not an object, a missing required collection, or a
 * malformed world axis — resolves to a blocking `{ ok: false, exitCode: 2 }`. "Cannot
 * judge" means block, so an unjudgeable input can never be mistaken for a valid one.
 */
export function parseInput(
  stdinJson: string,
): { ok: true; value: CovenantInput } | { ok: false; exitCode: 2 } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdinJson);
  } catch {
    return { ok: false, exitCode: EXIT_BREAK_BLOCKING };
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, exitCode: EXIT_BREAK_BLOCKING };
  }

  const candidate = parsed;
  if (
    !Array.isArray(candidate.toolCalls) ||
    !Array.isArray(candidate.subagentSpawns) ||
    !Array.isArray(candidate.userMessages)
  ) {
    return { ok: false, exitCode: EXIT_BREAK_BLOCKING };
  }

  if (candidate.world !== undefined && !isWorld(candidate.world)) {
    return { ok: false, exitCode: EXIT_BREAK_BLOCKING };
  }

  return { ok: true, value: candidate as CovenantInput };
}

/**
 * Flatten every call's evidence into one array in call order.
 *
 * The one traversal for consumers that need no attribution (discipline scope, delta
 * judging): calls without evidence are skipped, never substituted for.
 */
export function allFileChanges(input: CovenantInput): FileChange[] {
  const changes: FileChange[] = [];
  for (const call of input.toolCalls) {
    if (call.fileChange !== undefined) changes.push(call.fileChange);
  }
  return changes;
}

/**
 * Map a {@link CovenantVerdict} to an exit code (the protocol's forward direction).
 *
 * Responsibility boundary: the body emits `0` when upheld and `1` when
 * broken — never the blocking `2`. Translating `1` into `2` is the wrapper's policy.
 */
export function verdictToExitCode(verdict: CovenantVerdict): 0 | 1 {
  return verdict.upheld ? EXIT_UPHOLD : EXIT_BREAK_NON_BLOCKING;
}
