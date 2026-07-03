/**
 * @polydeukes/core — the thin, domain- and agent-agnostic core.
 *
 * Pre-alpha. The covenant protocol (CORE-01) landed first, then the ROI telemetry
 * collector (CORE-02); the config loader (CONFIG-01) follows. Pure types and functions,
 * except telemetry's two confined I/O functions (appendRecord / readRecords).
 * See https://github.com/huskyhoochu/polydeukes
 */

export const version = '0.0.1';

export {
  aggregateGain,
  appendRecord,
  formatRecordLine,
  type GainSummary,
  parseRecordLine,
  readRecords,
  runGain,
  type TelemetryEvent,
  type TelemetryRecord,
} from './telemetry.js';

/**
 * exit-code semantics of the covenant protocol (PRD §4.1).
 *
 * The three codes are distinct and ordered by severity. The covenant *body* only
 * ever emits `0` (uphold) or `1` (break, non-blocking); translating a break into the
 * blocking `2` is the wrapper's job (COVENANT-01), never the core's. The sole place
 * the core itself reaches for `2` is the fail-closed parse path below.
 */

/** Promise upheld — no violation, the edit/push passes. */
export const EXIT_UPHOLD = 0;

/** Violation reported as a non-blocking signal. The covenant body's break code. */
export const EXIT_BREAK_NON_BLOCKING = 1;

/** Violation blocked — the edit/push is refused. Reserved for the wrapper / fail-closed. */
export const EXIT_BREAK_BLOCKING = 2;

/**
 * `CovenantInput` — the agent-neutral input IR a covenant judges (PRD §4.2).
 *
 * Adapters up-translate their own agent payloads into this shape and pipe it as
 * stdin-JSON. The vocabulary carries no agent/tool literals; concrete tool or
 * subagent names are *values* an adapter fills in, never part of the core's type.
 */
export type CovenantInput = {
  toolCalls: { name: string; args?: Record<string, unknown> }[];
  subagentSpawns: { kind: string }[];
  userMessages: { text: string }[];
};

/**
 * `CovenantVerdict` — the result a covenant body produces (PRD §4.3).
 *
 * Either the promise was upheld, or it was broken with a human-readable reason.
 * Maps to an exit code via {@link verdictToExitCode}.
 */
export type CovenantVerdict = { upheld: true } | { upheld: false; reason: string };

/**
 * Deserialize stdin-JSON into a {@link CovenantInput} (the protocol's reverse direction).
 *
 * fail-closed (PRD §5.2): this never throws. Any failure — unparseable JSON, an empty
 * payload, a parsed value that is not an object, or a missing required collection —
 * resolves to a blocking `{ ok: false, exitCode: 2 }`. "Cannot judge" means block,
 * so an unjudgeable input can never be mistaken for a valid one.
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

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, exitCode: EXIT_BREAK_BLOCKING };
  }

  const candidate = parsed as Record<string, unknown>;
  if (
    !Array.isArray(candidate.toolCalls) ||
    !Array.isArray(candidate.subagentSpawns) ||
    !Array.isArray(candidate.userMessages)
  ) {
    return { ok: false, exitCode: EXIT_BREAK_BLOCKING };
  }

  return { ok: true, value: candidate as CovenantInput };
}

/**
 * Map a {@link CovenantVerdict} to an exit code (the protocol's forward direction).
 *
 * Responsibility boundary (PRD §4.1): the body emits `0` when upheld and `1` when
 * broken — never the blocking `2`. Translating `1` into `2` is the wrapper's policy.
 */
export function verdictToExitCode(verdict: CovenantVerdict): 0 | 1 {
  return verdict.upheld ? EXIT_UPHOLD : EXIT_BREAK_NON_BLOCKING;
}
