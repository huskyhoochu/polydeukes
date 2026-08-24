/**
 * `judgeTranscriptModification` — the transcript-mod covenant's pure judge (COVENANT-07c,
 * zero I/O) plus the registration factory that routes on it.
 *
 * The transcript is judged by whole-path equality on one file, never as an ancestor, so
 * home-directory spellings (`~`, `$HOME`, `${HOME}`, `~<user>`) are closed by the injected
 * `home` value rather than by protecting home itself. Out-of-repo ancestor destruction is
 * outside observation scope and passes here by design. The Bash axis follows shell-mod's
 * ladder without the opaque-mention clause (reading a session never needs a witness); the
 * tool axis judges proven `fileChange` targets and falls back to the `args` traversal.
 */

import type { CovenantInput, CovenantVerdict } from '@polydeukes/core';
import { isNestedShellCommand, type SimpleCommand, tokenizeCommandLine } from './bash-line.js';
import type { CovenantRegistration } from './dispatch.js';
import {
  pathCandidates,
  pathSegments,
  provenChangePath,
  resolveDotSegments,
  someStringValue,
  untokenizableLineCandidates,
} from './mention.js';
import { commandBasename, redirectWriteRule, sedInPlaceRule, teeRule } from './mutation-rules.js';
import { DEFAULT_READ_ONLY_COMMANDS, matchesReadOnlyEntry } from './shell-mod.js';

/**
 * `TranscriptModificationSpec` — the injected axes of the judge (PRD §2). Empty-string
 * entries in every list are ignored.
 */
export type TranscriptModificationSpec = {
  /** the one file this covenant owns */
  transcriptPath: string;
  /** directory whose spellings are closed; absent or malformed leaves them open */
  home?: string;
  shellToolNames: string[];
  commandArgNames: string[];
  mutatingToolNames: string[];
  /** read-only allowlist entries in shell-mod's format */
  readOnlyCommands: string[];
};

// The fixed rule set, assembled exactly as shell-mod assembles it (COVENANT-04d §4.2):
// rule-selection injection stays closed, since dropping one would be a detection hole.
const MUTATION_RULES = [redirectWriteRule, teeRule, sedInPlaceRule];

/** The transcript's axes once resolved: the canonical target, the home forms, the allowlist. */
type ResolvedTranscript = {
  /** The one segment run every spelling must resolve to: absolute, dot-resolved, canonical. */
  target: string[];
  /** Leading segments that stand for the home directory (`~`, `$HOME`, `${HOME}`, `~<user>`). */
  homePrefixes: string[];
  /** Home's own segments, substituted for a prefix before dots are resolved. */
  homeSegments: string[];
  /** The canonical absolute path: the only spelling a break reason or a match ever reports. */
  path: string;
  readOnlyEntries: string[][];
};

/** True iff two segment runs are the same path — length and every segment's text. */
function segmentsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((segment, i) => segment === b[i]);
}

/**
 * Normalize the injected home value, or return `null` when it is not an absolute path
 * naming a directory — expanding such a value would manufacture matches (`''` turns `~/x`
 * into `/x`).
 */
function normalizeHome(home: string | undefined): { path: string; user: string } | null {
  if (home === undefined || !home.startsWith('/')) return null;
  const path = home.replace(/\/+$/, '');
  const user = pathSegments(path).at(-1);
  if (user === undefined) return null;
  return { path, user };
}

/**
 * Resolve the transcript's axes, or return `null` for a degenerate `transcriptPath` (the
 * covenant goes inert rather than matching everything). Home forms are recognized only when
 * the transcript lives under the given home.
 */
function resolveTranscript(spec: TranscriptModificationSpec): ResolvedTranscript | null {
  const segments = pathSegments(spec.transcriptPath);
  if (!segments.some((segment) => segment !== '.')) return null;

  const home = normalizeHome(spec.home);
  const underHome = home !== null && spec.transcriptPath.startsWith(`${home.path}/`);
  return {
    target: resolveDotSegments(segments),
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional shell expansion spelling
    homePrefixes: underHome && home !== null ? ['~', '$HOME', '${HOME}', `~${home.user}`] : [],
    homeSegments: home === null ? [] : pathSegments(home.path),
    path: spec.transcriptPath,
    readOnlyEntries: spec.readOnlyCommands
      .map((entry) => entry.split(/\s+/).filter((word) => word !== ''))
      .filter((entry) => entry.length > 0),
  };
}

/**
 * True iff a path candidate names the transcript by whole-path equality. A home prefix is
 * substituted before dots are resolved, matching the shell's expansion order.
 */
function namesTranscript(candidate: string, transcript: ResolvedTranscript): boolean {
  const segments = pathSegments(candidate);
  const head = segments[0];
  const expanded =
    head !== undefined && transcript.homePrefixes.includes(head)
      ? [...transcript.homeSegments, ...segments.slice(1)]
      : segments;
  return segmentsEqual(resolveDotSegments(expanded), transcript.target);
}

/**
 * The path forms one candidate can carry: itself, plus the rooted suffix behind a glued
 * prefix (`curl -o/abs`, `host:/abs`, `>>/abs`), which whole-path equality would otherwise
 * miss.
 */
function pathForms(candidate: string): string[] {
  if (/^[/~$]/.test(candidate)) return [candidate];
  const rooted = /[/~$]/.exec(candidate);
  return rooted === null ? [candidate] : [candidate, candidate.slice(rooted.index)];
}

/** True iff any path candidate inside one token names the transcript. */
function tokenNamesTranscript(token: string, transcript: ResolvedTranscript): boolean {
  return pathCandidates(token)
    .flatMap(pathForms)
    .some((candidate) => namesTranscript(candidate, transcript));
}

/** True iff any string value inside `value`, at any depth, names the transcript. */
function argsNameTranscript(value: unknown, transcript: ResolvedTranscript): boolean {
  return someStringValue(value, (token) => tokenNamesTranscript(token, transcript));
}

/**
 * Judge one simple command (PRD §3, order normative). Returns the break reason, or null when
 * the command contributes to uphold. `lineFullyRead` is false when the line carried a span
 * the tokenizer could not read, which withholds clause (e).
 */
function judgeCommand(
  command: SimpleCommand,
  transcript: ResolvedTranscript,
  lineFullyRead: boolean,
): string | null {
  // (a) Precise rules: a detected mutation whose target is the transcript breaks.
  for (const rule of MUTATION_RULES) {
    for (const target of rule.detect(command)) {
      if (tokenNamesTranscript(target.path, transcript)) {
        return `${target.rule} targets the session transcript ${transcript.path}`;
      }
    }
  }

  // (b) Mention scan over word texts and redirect target texts. Opaque tokens are read too:
  // this ladder has no opaque-mention clause, so their text must still register a mention for
  // the backstop to answer. No mention: nothing left to judge.
  const tokens = [...command.words, ...command.redirects.map((redirect) => redirect.target)];
  if (!tokens.some((token) => tokenNamesTranscript(token.text, transcript))) return null;

  // (d) An opaque write target could resolve to the transcript itself — unprovable, so it
  // breaks even for an allowlisted reader (order over (e) is the invariant).
  if (command.redirects.some((r) => r.operator.includes('>') && r.target.opaque)) {
    return `opaque redirect target alongside the session transcript ${transcript.path}`;
  }

  // (e) Read-only allowlist: a proven read absolves the mention, in every spelling — but a
  // nested shell (`eval`/`sh -c …`) re-parses its string args, so it is never provably a read.
  // A line carrying an unread span is refused the same way: reading the session is free, but
  // only on a line we finished reading (COVENANT-18 §2-b B3).
  const first = command.words[0];
  const firstBasename = first !== undefined ? commandBasename(first) : '';
  if (
    lineFullyRead &&
    !isNestedShellCommand(firstBasename) &&
    transcript.readOnlyEntries.some((entry) => matchesReadOnlyEntry(command, entry))
  ) {
    return null;
  }

  // (f) Backstop — mention + unproven = block.
  return `${first?.text ?? ''} names the session transcript ${transcript.path} without read-only proof`;
}

/** Judge one shell-tool call's command lines. Returns the break reason, or null. */
function judgeShellCall(
  call: CovenantInput['toolCalls'][number],
  commandArgNames: string[],
  transcript: ResolvedTranscript,
): string | null {
  // A shell call with no command string is not judged: this judge is also the router, so
  // breaking here would record the transcript as the subject of a call that never named it.
  const lines = commandArgNames
    .map((name) => call.args?.[name])
    .filter((value): value is string => typeof value === 'string');

  for (const line of lines) {
    const { commands, unread } = tokenizeCommandLine(line);
    // An unread span gets the conservative treatment (COVENANT-18 §2-b B3): quotes and
    // escapes are stripped as the shell would, and metachar-glued spellings are decomposed.
    for (const span of unread) {
      const candidates = untokenizableLineCandidates(span.text.replace(/['"\\]/g, ''));
      if (candidates.some((candidate) => tokenNamesTranscript(candidate, transcript))) {
        return `untokenizable command line names the session transcript ${transcript.path}`;
      }
    }
    for (const command of commands) {
      const reason = judgeCommand(command, transcript, unread.length === 0);
      if (reason !== null) return reason;
    }
  }
  return null;
}

/** Judge one mutating tool call on its proven target, else on its `args`. Returns the break reason, or null. */
function judgeMutatingCall(
  call: CovenantInput['toolCalls'][number],
  transcript: ResolvedTranscript,
): string | null {
  const changePath = provenChangePath(call);
  if (changePath !== null) {
    return namesTranscript(changePath, transcript)
      ? `${call.name} would modify the session transcript ${changePath}`
      : null;
  }
  // No target is proven here, so the reason reports the observation, not a write.
  return argsNameTranscript(call.args, transcript)
    ? `${call.name} names the session transcript ${transcript.path} with no proven target`
    : null;
}

/**
 * Judge a {@link CovenantInput} against the transcript-mod spec (pure).
 *
 * Shell-tool calls are judged on the Bash axis per simple command, mutating-tool calls on
 * the tool axis; every other call is never judged. A degenerate `transcriptPath` upholds
 * everything.
 *
 * @param input - The call set to judge
 * @param spec - The injected axes; empty strings are ignored
 * @returns A break naming what touched the transcript, or an uphold
 */
export function judgeTranscriptModification(
  input: CovenantInput,
  spec: TranscriptModificationSpec,
): CovenantVerdict {
  const transcript = resolveTranscript(spec);
  if (transcript === null) {
    return { upheld: true };
  }
  const shellToolNames = spec.shellToolNames.filter((name) => name !== '');
  const commandArgNames = spec.commandArgNames.filter((name) => name !== '');
  const mutatingToolNames = spec.mutatingToolNames.filter((name) => name !== '');

  for (const call of input.toolCalls) {
    if (shellToolNames.includes(call.name)) {
      const reason = judgeShellCall(call, commandArgNames, transcript);
      if (reason !== null) return { upheld: false, reason };
      continue;
    }
    if (mutatingToolNames.includes(call.name)) {
      const reason = judgeMutatingCall(call, transcript);
      if (reason !== null) return { upheld: false, reason };
    }
  }

  return { upheld: true };
}

/** `TranscriptModRegistrationSpec` — the assembly values baked into the registration (PRD §2). */
export type TranscriptModRegistrationSpec = {
  transcriptPath: string;
  home?: string;
  bodyCommand: string;
  bodyModulePath: string;
  shellTools: string[];
  commandArgs: string[];
  mutatingTools: string[];
  witness?: CovenantRegistration['witness'];
};

/**
 * Build the transcript-mod registration (PRD §2). Routing is the judge itself as a `matches`
 * predicate — `protectedPaths` stays empty so no home ancestor re-enters path-mention
 * routing — and the telemetry subject is the canonical absolute path.
 */
export function transcriptModRegistration(
  spec: TranscriptModRegistrationSpec,
): CovenantRegistration {
  const judgeSpec: TranscriptModificationSpec = {
    transcriptPath: spec.transcriptPath,
    home: spec.home,
    shellToolNames: spec.shellTools,
    commandArgNames: spec.commandArgs,
    mutatingToolNames: spec.mutatingTools,
    readOnlyCommands: DEFAULT_READ_ONLY_COMMANDS,
  };
  return {
    label: 'transcript-mod',
    protectedPaths: [],
    matches: (input) =>
      judgeTranscriptModification(input, judgeSpec).upheld ? null : spec.transcriptPath,
    body: {
      command: spec.bodyCommand,
      args: [
        spec.bodyModulePath,
        '--transcript-path',
        spec.transcriptPath,
        ...(spec.home !== undefined ? ['--home', spec.home] : []),
        ...spec.shellTools.flatMap((tool) => ['--shell-tool', tool]),
        ...spec.commandArgs.flatMap((arg) => ['--command-arg', arg]),
        ...spec.mutatingTools.flatMap((tool) => ['--mutating-tool', tool]),
      ],
    },
    ...(spec.witness !== undefined ? { witness: spec.witness } : {}),
  };
}
