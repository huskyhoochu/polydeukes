/**
 * Path-routing dispatcher — the edit-time first-line layer (COVENANT-02).
 *
 * This dispatcher is layer 2 of the three-layer enforcement model: it routes hook
 * input to the covenant bodies whose protected paths are mentioned. Permission-deny
 * (layer 1) and the push gate (layer 3, the second-line regression defence) live
 * outside this code and are neither assumed nor replicated here.
 *
 * Matching is a pure path-mention core (zero I/O); execution reuses {@link runCovenant}
 * (the sole spawner) and {@link appendRecord} (the sole log writer). The dispatcher
 * parses the payload only to decide routing — it never mutates or re-serializes it, so
 * the body receives the original raw stdin verbatim (opaque cargo).
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  appendRecord,
  type CovenantInput,
  EXIT_BREAK_BLOCKING,
  EXIT_UPHOLD,
  parseInput,
} from '@polydeukes/core';
import { runCovenant } from './run-covenant.js';

/**
 * `CovenantRegistration` — one registered covenant (PRD §4.1).
 *
 * `protectedPaths` are literal path strings (the output shape of normalization, not
 * globs); an empty array never matches. `body` is the CORE-01 protocol executable the
 * dispatcher spawns via {@link runCovenant} when a protected path is mentioned.
 */
export type CovenantRegistration = {
  label: string;
  protectedPaths: string[];
  body: { command: string; args?: string[] };
};

/**
 * Recursively test whether any string value inside `value` contains `path` as a
 * substring. Argument names are never inspected — only the string *values* are scanned,
 * keeping the dispatcher agent-neutral.
 */
function mentionsPath(value: unknown, path: string): boolean {
  if (typeof value === 'string') {
    return value.includes(path);
  }
  if (Array.isArray(value)) {
    return value.some((item) => mentionsPath(item, path));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).some((item) => mentionsPath(item, path));
  }
  return false;
}

/**
 * Match registrations against a {@link CovenantInput} by path mention (PRD §4.2, pure).
 *
 * A registration matches when any of its `protectedPaths` appears as a substring of any
 * string value reachable at any depth inside `input.toolCalls[].args`; `subagentSpawns`
 * and `userMessages` never participate. `mentionedPath` is the first protected path (in
 * array order) that mentions. Result preserves registration order, at most one entry per
 * registration.
 */
export function matchRegistrations(
  input: CovenantInput,
  registrations: CovenantRegistration[],
): { registration: CovenantRegistration; mentionedPath: string }[] {
  const argValues = input.toolCalls.map((call) => call.args);
  const matches: { registration: CovenantRegistration; mentionedPath: string }[] = [];

  for (const registration of registrations) {
    const mentionedPath = registration.protectedPaths.find((path) =>
      argValues.some((args) => mentionsPath(args, path)),
    );
    if (mentionedPath !== undefined) {
      matches.push({ registration, mentionedPath });
    }
  }

  return matches;
}

/**
 * Dispatch covenants for a stdin payload (PRD §4.3).
 *
 * fail-closed: an unparseable payload yields exitCode 2, spawns nothing, and appends
 * exactly one `blocked` record for the dispatcher itself. On matches, every matched
 * registration runs sequentially via {@link runCovenant} (run-all, no short-circuit)
 * with the original raw payload forwarded verbatim; the verdict is `2` if any body
 * blocks, else `0`. No matches passes vacuously with zero spawns and zero telemetry.
 */
export async function dispatchCovenants(spec: {
  stdinPayload: string;
  registrations: CovenantRegistration[];
  telemetryPath: string;
  dispatcherLabel?: string;
}): Promise<{ exitCode: 0 | 2; results: { label: string; exitCode: 0 | 2 }[] }> {
  const parsed = parseInput(spec.stdinPayload);
  if (!parsed.ok) {
    try {
      mkdirSync(dirname(spec.telemetryPath), { recursive: true });
      appendRecord(spec.telemetryPath, {
        timestamp: new Date().toISOString(),
        event: 'blocked',
        label: spec.dispatcherLabel ?? 'dispatcher',
        subject: '-',
      });
    } catch {
      // fail-open: a logging problem must not alter the verdict or propagate.
    }
    return { exitCode: EXIT_BREAK_BLOCKING, results: [] };
  }

  const matches = matchRegistrations(parsed.value, spec.registrations);

  const results: { label: string; exitCode: 0 | 2 }[] = [];
  let exitCode: 0 | 2 = EXIT_UPHOLD;
  for (const { registration, mentionedPath } of matches) {
    const { exitCode: bodyVerdict } = await runCovenant({
      command: registration.body.command,
      args: registration.body.args,
      stdinPayload: spec.stdinPayload,
      label: registration.label,
      subject: mentionedPath,
      telemetryPath: spec.telemetryPath,
    });
    results.push({ label: registration.label, exitCode: bodyVerdict });
    if (bodyVerdict === EXIT_BREAK_BLOCKING) {
      exitCode = EXIT_BREAK_BLOCKING;
    }
  }

  return { exitCode, results };
}
