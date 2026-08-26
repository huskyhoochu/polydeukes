/**
 * `runCovenant` — the covenant execution wrapper (COVENANT-01, DISPATCH-01 §4.1).
 *
 * Calls an in-process judge thunk the assembly has already bound its payload and options
 * into, translates the thunk's exit-code equivalent by policy (1 → blocking 2), writes the
 * break reason to stderr, and appends exactly one ROI telemetry record per call via
 * {@link appendRecordFailOpen} (the core's fail-open wrapper around its sole collector —
 * no local logger). {@link translateExitCode} is pure.
 */

import {
  appendRecordFailOpen,
  type CovenantVerdict,
  type EnforceLevel,
  EXIT_BREAK_BLOCKING,
  EXIT_BREAK_NON_BLOCKING,
  EXIT_UPHOLD,
  type TelemetryEvent,
} from '@polydeukes/core';

/** The wrapper's final verdict — `1` never escapes: a break becomes the blocking `2`. */
type WrapperExitCode = typeof EXIT_UPHOLD | typeof EXIT_BREAK_BLOCKING;

/**
 * What a judge thunk answers (DISPATCH-01 §4.1) — the shape the body CLIs used to report
 * as an exit code plus a line on stderr: `0` uphold, `1` break, `2` unjudgeable, and
 * `reason` naming the break for the agent that has to read it.
 */
export type JudgeOutcome = { exitCode: number; reason?: string };

/**
 * `runCovenant` specification (PRD §4.1, DISPATCH-01 §4.1).
 *
 * `body` is an in-process judge thunk with the payload and its options already bound by
 * the assembly; it is the only judgment this wrapper performs. `subject` defaults to the
 * `-` sentinel in telemetry when absent. `telemetryPath` is always an explicit argument.
 * `enforce` selects the translation column (CONFIG-06): absent defaults to `block`.
 * `witness` is the valve axis (COVENANT-17 §4.3) — a zero-arg thunk whose arguments the
 * caller has already bound, consulted only once the body has run and its outcome
 * translated to `blocked`.
 */
export type RunCovenantSpec = {
  body: () => Promise<JudgeOutcome>;
  label: string;
  subject?: string;
  telemetryPath: string;
  enforce?: EnforceLevel;
  witness?: () => boolean;
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
  enforce: EnforceLevel = 'block',
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

/**
 * Run the judge thunk and normalize what it answers (DISPATCH-01 §4.1).
 *
 * A throw is the body-crash cell — the same `2` a crashed spawn reported — so crash
 * isolation moves from the process boundary to this try/catch. A resolution that is not
 * the outcome shape (an old covenant dist answering the spawn contract) is uninterpretable
 * and lands in the same cell: `null` routes to the translation table's fail-closed row
 * without that table learning a new code.
 */
async function runBody(body: RunCovenantSpec['body']): Promise<JudgeOutcome> {
  let outcome: unknown;
  try {
    outcome = await body();
  } catch {
    return { exitCode: EXIT_BREAK_BLOCKING };
  }
  if (typeof outcome !== 'object' || outcome === null) {
    return { exitCode: EXIT_BREAK_BLOCKING };
  }
  return outcome as JudgeOutcome;
}

/**
 * Turn a pure judge's verdict into the outcome a thunk answers (DISPATCH-01 §4.1) — the
 * translation the body CLIs did with `verdictToExitCode` plus a write to stderr.
 */
export function outcomeFromVerdict(verdict: CovenantVerdict): JudgeOutcome {
  return verdict.upheld
    ? { exitCode: EXIT_UPHOLD }
    : { exitCode: EXIT_BREAK_NON_BLOCKING, reason: verdict.reason };
}

/** The unjudgeable outcome: a misassembly or an input no judge could read (`2`, no reason). */
export const UNJUDGEABLE_OUTCOME: JudgeOutcome = { exitCode: EXIT_BREAK_BLOCKING };

/** Consult the valve, counting a throw as closed — an uncertain valve never opens (PRD §7-3). */
function witnessOpens(witness: () => boolean): boolean {
  try {
    return witness() === true;
  } catch {
    return false;
  }
}

/**
 * Run a covenant body through the wrapper (PRD §4, DISPATCH-01 §4.1).
 *
 * The order is judge → translate → valve (COVENANT-17 §4.3): the body always runs, and
 * only a `blocked` translation has anything for the valve to relax into
 * `0` / `witnessed`. Whatever that leaves is recorded ONCE — one call, one row — so a
 * witnessed break never leaves a `blocked` row beside its `witnessed` one.
 *
 * The break reason goes to stderr whenever the thunk carried one, whatever the level and
 * whatever the final event: this write replaces the inherited fd the spawned bodies used,
 * so gating it on the verdict would leave `advised` mute and the valve silent about what
 * it opened.
 *
 * Resolves with the wrapper's final `exitCode` (`0` or `2`), the raw `bodyExitCode` for
 * observation (`null` when the body answered no interpretable code), and the telemetry
 * `event` that was recorded. The event is surfaced rather than left to callers: the valve
 * is impure, so recomputing the event would consult it a second time. Logging is fail-open
 * (PRD §4.3) via {@link appendRecordFailOpen}: a telemetry failure never alters the verdict
 * and never throws. The gate closes; the measurement stays open.
 */
export async function runCovenant(
  spec: RunCovenantSpec,
): Promise<{ exitCode: WrapperExitCode; bodyExitCode: number | null; event: TelemetryEvent }> {
  const outcome = await runBody(spec.body);
  // A code the outcome does not carry as a number is uninterpretable, and `null` is the
  // table's existing cell for exactly that — no new row in translateExitCode.
  const bodyExitCode = typeof outcome.exitCode === 'number' ? outcome.exitCode : null;
  if (typeof outcome.reason === 'string' && outcome.reason !== '') {
    process.stderr.write(`${outcome.reason}\n`);
  }
  const verdict = translateExitCode(bodyExitCode, spec.enforce);
  const { exitCode, event }: { exitCode: WrapperExitCode; event: TelemetryEvent } =
    verdict.event === 'blocked' && spec.witness !== undefined && witnessOpens(spec.witness)
      ? { exitCode: EXIT_UPHOLD, event: 'witnessed' }
      : verdict;

  appendRecordFailOpen(spec.telemetryPath, {
    event,
    label: spec.label,
    subject: spec.subject ?? '-',
  });

  return { exitCode, bodyExitCode, event };
}
