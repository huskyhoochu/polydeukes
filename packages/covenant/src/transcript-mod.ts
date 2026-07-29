/**
 * `judgeTranscriptModification` — the transcript-mod covenant's pure judge (COVENANT-07c,
 * zero I/O) plus the registration factory that routes on it.
 *
 * The session transcript is the TTL witness's evidence source, so a write to it must break.
 * Declaring it a protected path did that, but it also made its home directory a protected
 * *ancestor*, and every daily spelling that passes through home (`cd ~`, `cd /home/<user>`,
 * an edit whose content merely carries a bare `~`) broke with it (PRD §1). This judge is the
 * §2 answer: the transcript is judged by a dedicated predicate on **one file, whole-path
 * equality**, so there is no ancestor direction left to grow back. A descendant, an
 * ancestor, and a foreign root that merely embeds the transcript's segment run are all
 * upheld by construction. Out-of-repo ancestor destruction (`rm -rf ~/.claude/projects`) is
 * declared outside Polydeukes observation scope (§2 scope principle) and left to agent deny
 * policy — it passes here by design, not by omission.
 *
 * The home value arrives as data (`home`), never from the environment: it is what closes the
 * `~`, `$HOME`, `${HOME}`, and `~<user>` spellings of that one file, and its shape is
 * validated per call (§3) so a home naming no directory closes nothing instead of expanding
 * into garbage. Every comparison unions the raw and dot-resolved segments, the COVENANT-07b
 * shape.
 *
 * Both axes are judged, since this covenant is the sole registrant for its subject. The Bash
 * axis walks shell-mod's ladder per simple command, with one deliberate divergence: there is
 * **no opaque-mention clause** here, so `cat $HOME/<tail>` reaches the read-only allowlist
 * and passes — reading a session must never need a witness. The tool axis reads the call's own
 * `fileChange` evidence when it proves a target, and falls back to self-mod's conservative
 * `args` traversal when it does not. Tool names and arg names are injected values, never
 * source literals.
 */

import type { CovenantInput, CovenantVerdict } from '@polydeukes/core';
import { isNestedShellCommand, type SimpleCommand, tokenizeCommandLine } from './bash-line.js';
import type { CovenantRegistration } from './dispatch.js';
import {
  pathCandidates,
  pathSegments,
  resolveDotSegments,
  untokenizableLineCandidates,
} from './mention.js';
import { commandBasename, redirectWriteRule, sedInPlaceRule, teeRule } from './mutation-rules.js';
import { DEFAULT_READ_ONLY_COMMANDS, matchesReadOnlyEntry } from './shell-mod.js';

/**
 * `TranscriptModificationSpec` — the injected axes of the judge (PRD §2).
 *
 * `transcriptPath` is the one file this covenant owns; `home` is the directory whose
 * spellings it closes (absent or malformed leaves them open, §3); `shellToolNames` /
 * `commandArgNames` name the Bash surface and `mutatingToolNames` the tool surface;
 * `readOnlyCommands` are allowlist entries in shell-mod's format. Empty-string entries in
 * every list are ignored (an unchecked `''` would match every tool / arg / command).
 */
export type TranscriptModificationSpec = {
  transcriptPath: string;
  home?: string;
  shellToolNames: string[];
  commandArgNames: string[];
  mutatingToolNames: string[];
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
 * The injected home value normalized, or `null` when its shape closes no spelling (PRD §3).
 *
 * Trailing slashes are stripped; a value that is not absolute, or that names no directory
 * once stripped (`''`, `'/'`, `'///'`), is refused. Expanding such a value would manufacture
 * matches out of garbage (`''` turning `~/x` into `/x`), and the absolute spelling stays
 * judged either way, so refusing costs no defence.
 */
function normalizeHome(home: string | undefined): { path: string; user: string } | null {
  if (home === undefined || !home.startsWith('/')) return null;
  const path = home.replace(/\/+$/, '');
  const user = pathSegments(path).at(-1);
  if (user === undefined) return null;
  return { path, user };
}

/**
 * Resolve the transcript's axes, or `null` when there is nothing to protect (PRD §2).
 *
 * The target is the transcript's own segments, dot-resolved once, so a non-canonical
 * `transcript_path` (`/home/u/./x/../<tail>`) is compared in the same form every candidate is.
 * Home forms are recognized only when the transcript really lives under the given home — home
 * and the transcript path arrive from different sources and can disagree, and a tail sliced
 * blindly out of a disagreement would close nothing but garbage. `~<user>` derives its user
 * from the home value's own last segment, so another user's `~other` closes nothing.
 *
 * `null` means a degenerate `transcriptPath` (zero segments that name a file): the covenant
 * goes inert, the repo convention for an empty protected-path entry. Matching every candidate
 * against nothing would be a total lock-up out of one empty string.
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
 * True iff one path candidate names the transcript. Equality only — never an ancestor, a
 * descendant, or a run embedded at an offset, which is what removes the home ancestor at the
 * root, so `<tail>.bak` and a foreign root that merely ends in the same segments both uphold.
 *
 * A home prefix is substituted BEFORE dots are resolved, because the shell expands in that
 * order too: `~/../u/<tail>` is the transcript, and resolving first would cancel the `~` itself
 * against the `..` and compare a path that names nothing.
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
 * The path forms one candidate string can carry: itself, plus the rooted suffix hiding behind a
 * glued prefix. A shell word joins a path to a flag or an operator with no separator the
 * candidate splitter recognizes (`curl -o/abs`, `wget -O/abs`, `host:/abs`, `>>/abs`), and under
 * whole-path equality such a candidate names nothing at all — the offset-tolerant comparison
 * that used to catch it is exactly what this judge gives up. Re-reading from the first root
 * marker restores those spellings without restoring the ancestor direction: an extra form can
 * only ever add a match, and every form is still compared for equality.
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
  if (typeof value === 'string') {
    return tokenNamesTranscript(value, transcript);
  }
  if (Array.isArray(value)) {
    return value.some((item) => argsNameTranscript(item, transcript));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).some((item) => argsNameTranscript(item, transcript));
  }
  return false;
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
  // A shell call carrying no command string is not judged here. Shell-mod answers that
  // misassembly with a break, but it is reached only after a protected path routed the call;
  // in this covenant the judge IS the router, so the same clause would block every malformed
  // payload and stamp `roi.log` with the transcript as the subject of a call that never named
  // it — the misattribution PRD §3 forbids. The misassembly it defends against already goes
  // silently inert on shell-mod's own axis for any command that mentions no protected path.
  const lines = commandArgNames
    .map((name) => call.args?.[name])
    .filter((value): value is string => typeof value === 'string');

  for (const line of lines) {
    const { commands, unread } = tokenizeCommandLine(line);
    // Each unread span keeps the conservative treatment the whole line used to get, and only
    // the span gets it (COVENANT-18 §2-b B3): the shell would still remove quotes and
    // backslash escapes, so strip both before the comparison, or the very escaping that
    // stopped the scan defeats the scan that replaces it. Over-joining unrelated words only
    // ever widens what breaks, never a hole. The fallback-only decomposition then covers the
    // metachar-glued spellings (`<transcript>;echo x`) that no tokenizer was left to cut
    // apart (COVENANT-07d) — narrowing the span must not narrow the extraction.
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

/**
 * Judge one mutating tool call. Returns the break reason, or null.
 *
 * Evidence that proves a target (a recognized kind and a path with segments, COVENANT-09) is
 * judged alone: `args` are never consulted there, so a transcript path quoted inside an
 * edit's content is a mention rather than a target. Without such evidence the conservative
 * `args` traversal stands — an evidence-free producer must not pass unjudged.
 */
function judgeMutatingCall(
  call: CovenantInput['toolCalls'][number],
  transcript: ResolvedTranscript,
): string | null {
  const evidence = call.fileChange;
  const changePath = evidence?.path;
  if (
    typeof changePath === 'string' &&
    pathSegments(changePath).some((segment) => segment !== '.') &&
    (evidence?.kind === 'create' || evidence?.kind === 'modify' || evidence?.kind === 'delete')
  ) {
    return namesTranscript(changePath, transcript)
      ? `${call.name} would modify the session transcript ${changePath}`
      : null;
  }
  // No target is proven on this branch, so the reason says what was actually observed: the
  // call names the transcript somewhere in its arguments. Claiming it "would modify" the file
  // would send an author whose real problem is elsewhere (a stale `old_string`, so the apply
  // produced no evidence) hunting a write their call never makes.
  return argsNameTranscript(call.args, transcript)
    ? `${call.name} names the session transcript ${transcript.path} with no proven target`
    : null;
}

/**
 * Judge a {@link CovenantInput} against the transcript-mod spec (pure).
 *
 * A call whose `name` is exactly a non-empty `shellToolNames` entry is judged on the Bash
 * axis: every string under a non-empty `commandArgNames` key is analyzed per simple command,
 * and a shell call with zero such strings breaks (a misassembled arg name must not degrade
 * into universal uphold). A call whose `name` is a non-empty `mutatingToolNames` entry is
 * judged on the tool axis. Every other call, `subagentSpawns`, and `userMessages` are never
 * judged. A degenerate `transcriptPath` upholds everything — inert, never a lock-up.
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

/**
 * `TranscriptModRegistrationSpec` — the assembly values baked into the registration (PRD §2).
 *
 * `bodyCommand` / `bodyModulePath` locate the CLI body; `shellTools`, `commandArgs`, and
 * `mutatingTools` are the surfaces, serialized into its argv; `witness` is the TTL witness
 * valve, passed through untouched. `home` is optional — an absent one is simply not
 * transported, leaving the body to judge the absolute spelling only.
 */
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
 * Build the transcript-mod registration (PRD §2).
 *
 * `protectedPaths` is EMPTY on purpose: an entry there would re-enter path-mention routing
 * and re-create the home ancestor this ticket removes. Routing is the `matches` predicate
 * instead — the judge itself, run with the default read-only allowlist so a session read
 * never routes — and it reports the canonical absolute path as the telemetry subject. A
 * degenerate `transcriptPath` therefore yields an inert registration: the judge upholds
 * everything, so nothing ever routes.
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
