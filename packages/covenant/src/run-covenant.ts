/**
 * `runCovenant` — the covenant execution wrapper.
 *
 * Calls an in-process judge thunk the assembly has already bound its payload and options
 * into, translates the thunk's exit-code equivalent by policy (1 → blocking 2), writes the
 * break reason to stderr, and appends exactly one telemetry record per call via
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
import type { Break } from './declaration-engine.js';

/** The wrapper's final verdict — `1` never escapes: a break becomes the blocking `2`. */
type WrapperExitCode = typeof EXIT_UPHOLD | typeof EXIT_BREAK_BLOCKING;

/**
 * What a judge thunk answers: `0` uphold, `1` break, `2` unjudgeable, and `reason` naming
 * the break for the agent that has to read it. `witnesses` carries the elements a
 * declaration's break was found on; the body answers with values and the wrapper turns
 * them into the row's fifth field.
 */
export type JudgeOutcome = { exitCode: number; reason?: string; witnesses?: readonly Break[] };

/**
 * How many witness elements one break contributes to a telemetry row. A relation over a
 * large file can return thousands, and the row is one line — the true count rides beside
 * the truncated list rather than being lost with it.
 */
const WITNESSES_PER_BREAK = 8;

/**
 * How many characters of one witness value the row keeps. A witness over a bare `source`
 * step is the whole file, and the row is one line — the value is cut with its true length
 * beside it rather than dropped.
 */
const WITNESS_VALUE_CHARS = 200;

/** A witness whose serialized value fits the row; a longer one is cut and says so. */
function boundedWitness(witness: Break['witnesses'][number]): Record<string, unknown> {
  const serialized = JSON.stringify(witness.value);
  if (serialized === undefined || serialized.length <= WITNESS_VALUE_CHARS) return witness;
  return {
    ...witness,
    value: serialized.slice(0, WITNESS_VALUE_CHARS),
    truncated: serialized.length,
  };
}

/**
 * Serialize a body's breaks into the row's fifth field: id, capped witnesses, true total —
 * or nothing when a value cannot be serialized. Telemetry is fail-open, so a witness
 * carrying a value `JSON.stringify` refuses costs the row its fifth field, never the verdict.
 */
function serializeWitnesses(breaks: readonly Break[]): string | undefined {
  try {
    return JSON.stringify(
      breaks.map((entry) => ({
        id: entry.id,
        witnesses: entry.witnesses.slice(0, WITNESSES_PER_BREAK).map(boundedWitness),
        total: entry.witnesses.length,
      })),
    );
  } catch {
    return undefined;
  }
}

/**
 * `runCovenant` specification.
 *
 * `body` is an in-process judge thunk with the payload and its options already bound by
 * the assembly; it is the only judgment this wrapper performs. `subject` defaults to the
 * `-` sentinel in telemetry when absent. `telemetryPath` is always an explicit argument.
 * `enforce` selects the translation column: absent defaults to `block`. `witness` is the
 * valve axis — a zero-arg thunk whose arguments the caller has already bound, consulted
 * only once the body has run and its outcome translated to `blocked`.
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
 * Translate a body outcome into the wrapper verdict and telemetry event (pure).
 *
 * `bodyExitCode === 0` (uphold) passes; every other outcome — a break report (`1`), the
 * body's own fail-closed (`2`), any uninterpretable code (`3+`), or a body that answered
 * nothing interpretable (`null`) — is fail-closed to the blocking `2` / `blocked`. The
 * unconditional 1→2 translation lives here, isolated, so it has one place to evolve in.
 *
 * `enforce` relaxes ONLY the verdict cell: under `advise` a break report (`1`) becomes
 * `0` / `advised` — recorded, not blocking. Every unjudgeable outcome (`2`, `3+`, `null`)
 * stays `2` / `blocked` regardless of level.
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
 * Run the judge thunk and normalize what it answers.
 *
 * A throw is the body-crash cell, so crash isolation is this try/catch. A resolution that
 * is not the outcome shape (a stale dist answering an older contract) is uninterpretable
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

/** Turn a pure judge's verdict into the outcome a thunk answers. */
export function outcomeFromVerdict(verdict: CovenantVerdict): JudgeOutcome {
  return verdict.upheld
    ? { exitCode: EXIT_UPHOLD }
    : { exitCode: EXIT_BREAK_NON_BLOCKING, reason: verdict.reason };
}

/** The unjudgeable outcome: a misassembly or an input no judge could read (`2`, no reason). */
export const UNJUDGEABLE_OUTCOME: JudgeOutcome = { exitCode: EXIT_BREAK_BLOCKING };

/** Consult the valve, counting a throw as closed — an uncertain valve never opens. */
function witnessOpens(witness: () => boolean): boolean {
  try {
    return witness() === true;
  } catch {
    return false;
  }
}

/** What one wrapped judgment answers — the final exit code and the telemetry event recorded. */
export type RunCovenantVerdict = {
  exitCode: typeof EXIT_UPHOLD | typeof EXIT_BREAK_BLOCKING;
  event: TelemetryEvent;
};

/**
 * Run a covenant body through the wrapper.
 *
 * The order is judge → translate → valve: the body always runs, and only a `blocked`
 * translation has anything for the valve to relax into `0` / `witnessed`. Whatever that
 * leaves is recorded ONCE — one call, one row — so a witnessed break never leaves a
 * `blocked` row beside its `witnessed` one.
 *
 * The break reason goes to stderr whenever the thunk carried one, whatever the level and
 * whatever the final event: gating it on the verdict would leave `advised` mute and the
 * valve silent about what it opened.
 *
 * Resolves with the wrapper's final `exitCode` (`0` or `2`) and the telemetry `event` that
 * was recorded. The event is surfaced rather than left to callers: the valve is impure, so
 * recomputing the event would consult it a second time. Logging is fail-open
 * via {@link appendRecordFailOpen}: a telemetry failure never alters the verdict and never
 * throws. The gate closes; the measurement stays open.
 */
export async function runCovenant(spec: RunCovenantSpec): Promise<RunCovenantVerdict> {
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

  const serialized = Array.isArray(outcome.witnesses)
    ? serializeWitnesses(outcome.witnesses)
    : undefined;
  appendRecordFailOpen(spec.telemetryPath, {
    event,
    label: spec.label,
    subject: spec.subject ?? '-',
    ...(serialized !== undefined && { witnesses: serialized }),
  });

  return { exitCode, event };
}
