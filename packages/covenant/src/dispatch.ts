/**
 * Path-routing dispatcher — the edit-time first-line layer (COVENANT-02).
 *
 * This dispatcher is layer 2 of the three-layer enforcement model: it routes hook
 * input to the covenant bodies whose protected paths are mentioned. Permission-deny
 * (layer 1) and the push gate (layer 3, the second-line regression defence) live
 * outside this code and are neither assumed nor replicated here.
 *
 * Matching is a pure path-mention core (zero I/O); execution reuses {@link runCovenant}
 * (the sole spawner) and {@link appendRecordFailOpen} (the sole log seam). The dispatcher
 * parses the payload only to decide routing — it never mutates or re-serializes it, so
 * the body receives the original raw stdin verbatim (opaque cargo).
 */

import {
  type CanonicalTranscript,
  type CovenantInput,
  EXIT_BREAK_BLOCKING,
  EXIT_UPHOLD,
  noopTranscript,
  parseInput,
} from '@polydeukes/core';
import { tokenizeCommandLine } from './bash-line.js';
import { pathCandidates, pathMatchesProtected } from './mention.js';
import { runCovenant } from './run-covenant.js';
import { appendRecordFailOpen } from './telemetry-fail-open.js';

/**
 * `CovenantRegistration` — one registered covenant (PRD §4.1).
 *
 * `protectedPaths` are literal path strings (the output shape of normalization, not
 * globs); an empty array never matches, and empty-string entries are ignored (an
 * empty `''` would match every input). `body` is the CORE-01 protocol
 * executable the dispatcher spawns via {@link runCovenant} when a protected path is
 * mentioned. `escapeHatch`, when present, is evaluated only for a *matched*
 * registration, receiving the injected transcript seam as its second argument
 * (CORE-04): a `true` return bypasses the spawn (measured as `bypassed`).
 */
export type CovenantRegistration = {
  label: string;
  protectedPaths: string[];
  body: { command: string; args?: string[] };
  escapeHatch?: (input: CovenantInput, transcript: CanonicalTranscript) => boolean;
};

/**
 * Collect path candidates from every string value inside `value` (PRD §4.2). Each string is
 * tokenized quote-aware (via the shared tokenizer) so quote/escape splits collapse to the
 * word the shell would see; each resulting word text is a candidate. A tokenize failure
 * surfaces as `failed = true` so the caller can route fail-closed rather than fall back to a
 * raw-substring scan.
 */
function collectPathCandidates(value: unknown): { candidates: string[]; failed: boolean } {
  const candidates: string[] = [];
  let failed = false;

  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      const result = tokenizeCommandLine(node);
      if (!result.ok) {
        failed = true;
        return;
      }
      for (const command of result.commands) {
        // Split each tokenized word the same way mentionsPath does, so a path fused to
        // another lexeme (`--dest=path`) still surfaces as its own candidate.
        for (const word of command.words) candidates.push(...pathCandidates(word.text));
        for (const redirect of command.redirects) {
          candidates.push(...pathCandidates(redirect.target.text));
        }
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node === 'object' && node !== null) {
      for (const item of Object.values(node)) walk(item);
    }
  };

  walk(value);
  return { candidates, failed };
}

/**
 * Match registrations against a {@link CovenantInput} by path mention (PRD §4.2, pure).
 *
 * A registration matches when any of its `protectedPaths` is an ancestor/descendant/equal of
 * a path candidate extracted from any string value reachable at any depth inside
 * `input.toolCalls[].args`; candidates are quote-aware tokenizer words, so a quote-split
 * write still routes. A tokenize failure with a non-empty `protectedPaths` routes fail-closed
 * (the registration matches on its first protected path) rather than silently miss.
 * `subagentSpawns` and `userMessages` never participate. `mentionedPath` is the first
 * protected path (in array order) that mentions. Result preserves registration order, at most
 * one entry per registration.
 */
export function matchRegistrations(
  input: CovenantInput,
  registrations: CovenantRegistration[],
): { registration: CovenantRegistration; mentionedPath: string }[] {
  const { candidates, failed } = collectPathCandidates(input.toolCalls.map((call) => call.args));
  const matches: { registration: CovenantRegistration; mentionedPath: string }[] = [];

  for (const registration of registrations) {
    const paths = registration.protectedPaths.filter((path) => path !== '');
    const mentionedPath =
      paths.find((path) => candidates.some((candidate) => pathMatchesProtected(candidate, path))) ??
      (failed ? paths[0] : undefined);
    if (mentionedPath !== undefined) {
      matches.push({ registration, mentionedPath });
    }
  }

  return matches;
}

/**
 * Dispatch covenants for a stdin payload (PRD §4.3).
 *
 * fail-closed: an unjudgeable payload — unparseable JSON (core `parseInput`) or a
 * parseable one whose structure defeats the matching traversal (a null toolCalls
 * element, adversarially deep nesting) — yields exitCode 2, spawns nothing, and appends
 * exactly one `blocked` record for the dispatcher itself. "Cannot judge" means block;
 * it never means throw, because an uncaught rejection exits the hook with a
 * non-blocking code and becomes a bypass vector. On matches, every matched
 * registration runs sequentially via {@link runCovenant} (run-all, no short-circuit)
 * with the original raw payload forwarded verbatim; the verdict is `2` if any body
 * blocks, else `0`. No matches passes vacuously with zero spawns and zero telemetry.
 *
 * escape hatch (PRD §4.3): for a matched registration whose `escapeHatch` predicate
 * returns `true`, the spawn is skipped, one `bypassed` record is appended, and the
 * registration contributes `0` — run-all is preserved (the remaining matches still run).
 * The hatch receives the injected `spec.transcript` (CORE-04 seam, `noopTranscript`
 * when omitted) as its second argument. A predicate that throws counts as no bypass
 * (the body spawns normally): an uncertain hatch never leaks toward fail-open.
 */
export async function dispatchCovenants(spec: {
  stdinPayload: string;
  registrations: CovenantRegistration[];
  telemetryPath: string;
  dispatcherLabel?: string;
  transcript?: CanonicalTranscript;
}): Promise<{ exitCode: 0 | 2; results: { label: string; exitCode: 0 | 2 }[] }> {
  const blockedByDispatcher = (): { exitCode: 2; results: [] } => {
    appendRecordFailOpen(spec.telemetryPath, {
      event: 'blocked',
      label: spec.dispatcherLabel ?? 'dispatcher',
      subject: '-',
    });
    return { exitCode: EXIT_BREAK_BLOCKING, results: [] };
  };

  const parsed = parseInput(spec.stdinPayload);
  if (!parsed.ok) {
    return blockedByDispatcher();
  }

  let matches: ReturnType<typeof matchRegistrations>;
  try {
    matches = matchRegistrations(parsed.value, spec.registrations);
  } catch {
    // Structurally unjudgeable input (parseInput's element shapes are intentionally
    // unvalidated — a CORE-01 boundary) — fail-closed, same as an unparseable payload.
    return blockedByDispatcher();
  }

  const transcript = spec.transcript ?? noopTranscript;
  const results: { label: string; exitCode: 0 | 2 }[] = [];
  for (const { registration, mentionedPath } of matches) {
    let bypass = false;
    try {
      bypass = registration.escapeHatch?.(parsed.value, transcript) === true;
    } catch {
      // A throwing hatch counts as no bypass — the body spawns normally (fail-closed).
      bypass = false;
    }
    if (bypass) {
      appendRecordFailOpen(spec.telemetryPath, {
        event: 'bypassed',
        label: registration.label,
        subject: mentionedPath,
      });
      results.push({ label: registration.label, exitCode: EXIT_UPHOLD });
      continue;
    }

    const { exitCode } = await runCovenant({
      command: registration.body.command,
      args: registration.body.args,
      stdinPayload: spec.stdinPayload,
      label: registration.label,
      subject: mentionedPath,
      telemetryPath: spec.telemetryPath,
    });
    results.push({ label: registration.label, exitCode });
  }

  const exitCode = results.some((result) => result.exitCode === EXIT_BREAK_BLOCKING)
    ? EXIT_BREAK_BLOCKING
    : EXIT_UPHOLD;
  return { exitCode, results };
}
