/**
 * Path-routing dispatcher — routes an input to the covenant bodies whose protected paths
 * it mentions.
 *
 * Matching is a pure path-mention core (zero I/O); execution reuses {@link runCovenant}
 * (the sole judgment wrapper) and {@link appendRecordFailOpen} (the sole log seam). The
 * dispatcher parses the payload once, to decide routing and to hand the judge thunks the
 * one parsed call set they judge.
 */

import {
  appendRecordFailOpen,
  type CanonicalTranscript,
  type CovenantInput,
  type DispatchOutcome,
  type EnforceLevel,
  EXIT_BREAK_BLOCKING,
  EXIT_UPHOLD,
  noopTranscript,
  parseInput,
} from '@polydeukes/core';
import { tokenizeCommandLine } from './bash-line.js';
import { pathCandidates, pathMatchesProtected } from './mention.js';
import { type JudgeOutcome, runCovenant } from './run-covenant.js';

/**
 * `CovenantRegistration` — one registered covenant.
 *
 * `protectedPaths` are literal path strings (the output shape of normalization, not
 * globs); an empty array never matches, and empty-string entries are ignored (an empty
 * `''` would match every input). `body` is the in-process judge: assembly binds its
 * options into it, and the dispatcher supplies the parsed call set as its argument when a
 * protected path is mentioned. Assembly therefore never needs the payload, so one compiled
 * registration set judges every call.
 *
 * `witness`, when present, is consulted only after a *matched* registration's body has run
 * and broken, receiving the injected transcript seam as its second argument and a
 * `{ label, subject }` context naming what broke as its third: a `true` return relaxes
 * that block (measured as `witnessed`).
 *
 * `matches`, when present, replaces path-mention routing with a content predicate: a
 * non-null return routes (the string becomes the telemetry subject), null does not, and a
 * throw is a fail-closed match with subject `'-'`.
 *
 * A registration carries EITHER a `body` or a `skip`. `skip` means assembly could not
 * produce a judgeable body — the evidence channel is absent, or the declared evidence
 * vocabulary could not be resolved — so a match records one `skipped` and upholds instead
 * of judging. Judging it anyway would block every matched input with no legitimate pass
 * path; throwing at assembly would take down every sibling registration and the witness
 * valve with it.
 *
 * `enforce` is the AUTHOR's level for this one registration, distinct from the observer's
 * dispatch-wide level; absence means the registration inherits whatever the dispatch
 * carries.
 */
export type CovenantRegistration = {
  label: string;
  protectedPaths: string[];
  enforce?: EnforceLevel;
  witness?: (
    input: CovenantInput,
    transcript: CanonicalTranscript,
    context: { label: string; subject: string },
  ) => boolean;
  matches?: (input: CovenantInput) => string | null;
} & (
  | { body: (input: CovenantInput) => Promise<JudgeOutcome>; skip?: never }
  | { body?: never; skip: { reason: string } }
);

/**
 * Collect path candidates from every string value inside `value`. Each string is tokenized
 * quote-aware (via the shared tokenizer) so quote/escape splits collapse to the word the
 * shell would see; each resulting word text is a candidate. An unread span surfaces as
 * `failed = true` so the caller can route fail-closed rather than fall back to a
 * raw-substring scan — the candidates the same line's read commands contribute add routing
 * precision, they never withdraw that flag.
 */
function collectPathCandidates(value: unknown): { candidates: string[]; failed: boolean } {
  const candidates: string[] = [];
  let failed = false;

  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      const result = tokenizeCommandLine(node);
      if (result.unread.length > 0) failed = true;
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
 * Match registrations against a {@link CovenantInput} by path mention (pure).
 *
 * A registration matches when any of its `protectedPaths` is an ancestor/descendant/equal of
 * a path candidate extracted from any string value reachable at any depth inside
 * `input.toolCalls[].args`; candidates are quote-aware tokenizer words, so a quote-split
 * write still routes. An unread span with a non-empty `protectedPaths` routes fail-closed
 * (the registration matches on its first protected path) rather than silently miss.
 * `subagentSpawns` and `userMessages` never participate. `mentionedPath` is the first
 * protected path (in array order) that mentions. Result preserves registration order, at most
 * one entry per registration.
 *
 * A registration carrying a `matches` predicate routes on it exclusively, path mention
 * skipped for it: non-null return → included with that string as `mentionedPath`; null →
 * skipped; a throw → fail-closed inclusion with `'-'` (caught per registration, never
 * bubbling to the dispatcher-level catch).
 */
export function matchRegistrations(
  input: CovenantInput,
  registrations: CovenantRegistration[],
): { registration: CovenantRegistration; mentionedPath: string; routingFailed?: boolean }[] {
  const { candidates, failed } = collectPathCandidates(input.toolCalls.map((call) => call.args));
  const matches: {
    registration: CovenantRegistration;
    mentionedPath: string;
    routingFailed?: boolean;
  }[] = [];

  for (const registration of registrations) {
    if (registration.matches !== undefined) {
      let subject: string | null;
      let routingFailed = false;
      try {
        subject = registration.matches(input);
      } catch {
        // An uncertain predicate must not leak fail-open — route with subject '-'. The
        // flag travels with the match because a skip registration has no body to carry
        // that verdict out, and answering `skipped` there would turn the fail-closed
        // routing into a pass.
        subject = '-';
        routingFailed = true;
      }
      if (subject !== null) {
        matches.push({ registration, mentionedPath: subject, routingFailed });
      }
      continue;
    }

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
 * Dispatch covenants for a stdin payload.
 *
 * Fail-closed: an unjudgeable payload — unparseable JSON, or a parseable one whose
 * structure defeats the matching traversal (a null toolCalls element, adversarially deep
 * nesting) — yields exitCode 2, judges nothing, and appends exactly one `blocked` record
 * for the dispatcher itself. "Cannot judge" means block; it never means throw, because an
 * uncaught rejection exits the hook with a non-blocking code and becomes a bypass vector.
 * On matches, every matched registration runs sequentially via {@link runCovenant}
 * (run-all, no short-circuit); the verdict is `2` if any body blocks, else `0`. No matches
 * passes vacuously with zero judgments and zero telemetry.
 *
 * Witness: the dispatcher only BINDS the witness's arguments — the parsed input, the
 * injected `spec.transcript` (`noopTranscript` when omitted), and a `{ label, subject }`
 * context naming the registration and its matched path — and hands the thunk to
 * {@link runCovenant}, which consults it after the judgment and only when the body's
 * outcome translated to `blocked`. So the body always runs: a matched registration that
 * upholds is never witnessed, and a `true` return relaxes a real break into
 * `0` / `witnessed`. A predicate that throws opens nothing: an uncertain witness never
 * leaks toward fail-open.
 *
 * Enforce: the level has two owners — `spec.enforce` is the observer's posture for the
 * whole dispatch, `registration.enforce` the author's for one entry — and the dispatcher
 * composes them per registration with the lenient side winning, then threads the effective
 * level into {@link runCovenant}, where the translation table lives. Lenient-wins keeps an
 * explicit `block` entry from raising a surface the observer lowered, and lets one entry
 * lower itself under a block surface. The dispatcher's own fail-closed is outside that axis
 * and outside the valve too (nothing judged, so no verdict to relax). Each results entry
 * surfaces the telemetry `event` the wrapper recorded, never a recomputed one — the valve
 * is impure, and a recompute would consult it twice for one verdict.
 */
export async function dispatchCovenants(spec: {
  stdinPayload: string;
  registrations: CovenantRegistration[];
  telemetryPath: string;
  dispatcherLabel?: string;
  transcript?: CanonicalTranscript;
  enforce?: EnforceLevel;
}): Promise<DispatchOutcome> {
  const blockedByDispatcher = (): DispatchOutcome => {
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
    // Structurally unjudgeable input (parseInput validates the collection shapes, not the
    // element ones) — fail-closed, same as an unparseable payload.
    return blockedByDispatcher();
  }

  const transcript = spec.transcript ?? noopTranscript;
  const results: DispatchOutcome['results'] = [];
  for (const { registration, mentionedPath, routingFailed } of matches) {
    if (registration.skip !== undefined) {
      if (routingFailed === true) {
        // The routing predicate could not answer, which matchRegistrations already
        // resolved fail-closed. A body-bearing registration would carry that verdict out
        // by judging and blocking; a skip has no body, so the block is recorded here
        // rather than softened into a pass. Outside the enforce axis, like every
        // unjudgeable outcome.
        appendRecordFailOpen(spec.telemetryPath, {
          event: 'blocked',
          label: registration.label,
          subject: mentionedPath,
        });
        results.push({
          label: registration.label,
          exitCode: EXIT_BREAK_BLOCKING,
          event: 'blocked',
        });
        continue;
      }
      // Nothing to judge and nothing to witness — the valve exists for a verdict, and a
      // skip has none. Recording it keeps the no-op visible in `gain`.
      appendRecordFailOpen(spec.telemetryPath, {
        event: 'skipped',
        label: registration.label,
        subject: mentionedPath,
      });
      results.push({ label: registration.label, exitCode: EXIT_UPHOLD, event: 'skipped' });
      continue;
    }

    // Bound here, consulted in the wrapper: the context is what the umbrella prompt
    // needs to name what broke. The local alias exists for TypeScript narrowing — a
    // property access cannot stay narrowed inside the closure below.
    const witness = registration.witness;
    // Absence stays absent: the block default lives in the wrapper, not restated here.
    // A routing that could not answer is outside the level axis on this arm too (the skip
    // arm above already is): the body judges against subject '-' and its break must land
    // blocked whatever level the entry or the surface declared. Every compiled entry
    // carries a level, so without this the unjudgeable call would advise.
    const effectiveEnforce: EnforceLevel | undefined =
      routingFailed === true
        ? undefined
        : registration.enforce === 'advise'
          ? 'advise'
          : spec.enforce;
    // The parsed call set is handed to the judge HERE rather than baked in at assembly:
    // the dispatcher is the one place that has it, so assembly stays payload-free and one
    // compiled registration set serves every payload.
    const body = registration.body;
    const { exitCode, event } = await runCovenant({
      body: () => body(parsed.value),
      label: registration.label,
      subject: mentionedPath,
      telemetryPath: spec.telemetryPath,
      enforce: effectiveEnforce,
      ...(witness !== undefined
        ? {
            witness: () =>
              witness(parsed.value, transcript, {
                label: registration.label,
                subject: mentionedPath,
              }),
          }
        : {}),
    });
    results.push({ label: registration.label, exitCode, event });
  }

  const exitCode = results.some((result) => result.exitCode === EXIT_BREAK_BLOCKING)
    ? EXIT_BREAK_BLOCKING
    : EXIT_UPHOLD;
  return { exitCode, results };
}
