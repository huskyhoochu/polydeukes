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
  type SkipReason,
} from '@polydeukes/core';
import { tokenizeCommandLine } from './bash-line.ts';
import { pathCandidates, pathMatchesProtected } from './mention.ts';
import { type JudgeOutcome, runCovenant } from './run-covenant.ts';

/**
 * `WitnessPredicate` — the valve a registration offers, asked after a blocking judgment:
 * the observation, the transcript, and the registration's own label with the matched subject.
 */
export type WitnessPredicate = (
  input: CovenantInput,
  transcript: CanonicalTranscript,
  context: { label: string; subject: string },
) => boolean;

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
 * valve with it. `reason` is the sentence the author reads; `kind` is the token the row
 * carries, so the measurement separates an environment fact from a config fault.
 *
 * `enforce` is the AUTHOR's level for this one registration, distinct from the observer's
 * dispatch-wide level; absence means the registration inherits whatever the dispatch
 * carries.
 *
 * `sources` are what outside the target this registration's declaration names, each element
 * carrying its own kind — a repo-relative file, a channel the surface supplies, or the
 * session's conversation history. They are the supply layer's only input; a family that
 * names nothing carries no key.
 */
export type CovenantRegistration = {
  label: string;
  protectedPaths: string[];
  enforce?: EnforceLevel;
  sources?: readonly (
    | { name: string; file: string }
    | { name: string; sidecar: true }
    | { name: string; transcript: true }
  )[];
  witness?: WitnessPredicate;
  matches?: (input: CovenantInput) => string | null;
} & (
  | { body: (input: CovenantInput) => Promise<JudgeOutcome>; skip?: never }
  | { body?: never; skip: { reason: string; kind: SkipReason } }
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

/** A registration assembled by a meta-covenant: one that always carries a judgeable body. */
export type MetaCovenantRegistration = CovenantRegistration & {
  body: NonNullable<CovenantRegistration['body']>;
};

/** `dispatchCovenants` input — the payload, the registration table, and the dispatch posture. */
export type DispatchCovenantsSpec = {
  stdinPayload: string;
  registrations: CovenantRegistration[];
  telemetryPath: string;
  dispatcherLabel?: string;
  transcript?: CanonicalTranscript;
  enforce?: EnforceLevel;
  world?: CovenantInput['world'];
};

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
 * World: `spec.world` is the supply layer's result, attached to the parsed input before
 * routing so the body, the routing predicate, and the valve all judge one world. A world
 * the payload itself carries stands only when the spec names none.
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
export async function dispatchCovenants(spec: DispatchCovenantsSpec): Promise<DispatchOutcome> {
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

  // The world the supply layer built, spliced onto the parsed input here so a composition
  // root never reopens the payload string its adapter path produced. Without one the key
  // stays absent rather than holding `undefined`: the judge derives the change set from
  // the field's absence, and an empty object would read as "supplied nothing".
  const input: CovenantInput =
    spec.world === undefined ? parsed.value : { ...parsed.value, world: spec.world };

  let matches: ReturnType<typeof matchRegistrations>;
  try {
    matches = matchRegistrations(input, spec.registrations);
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
        reason: registration.skip.kind,
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
      body: () => body(input),
      label: registration.label,
      subject: mentionedPath,
      telemetryPath: spec.telemetryPath,
      enforce: effectiveEnforce,
      ...(witness !== undefined
        ? {
            witness: () =>
              witness(input, transcript, {
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
