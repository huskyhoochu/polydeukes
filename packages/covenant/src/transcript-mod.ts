/**
 * `judgeTranscriptModification` — the transcript-mod covenant's pure judge (COVENANT-07c,
 * zero I/O) plus the registration factory that routes on it.
 *
 * The session transcript is the TTL waiver's evidence source, so a write to it must break.
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
 * and passes — reading a session must never need a waiver. The tool axis reads the call's own
 * `fileChange` evidence when it proves a target, and falls back to self-mod's conservative
 * `args` traversal when it does not. Tool names and arg names are injected values, never
 * source literals.
 */

import type { CovenantInput, CovenantVerdict } from '@polydeukes/core';
import { isNestedShellCommand, type SimpleCommand, tokenizeCommandLine } from './bash-line.js';
import type { CovenantRegistration } from './dispatch.js';
import { pathCandidates, pathSegments, resolveDotSegments } from './mention.js';
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

/** The transcript's axes once resolved: every spelling of it, plus the read-only allowlist. */
type ResolvedTranscript = {
  /** Segment spellings that all name the same file — the absolute form plus closed home forms. */
  spellings: string[][];
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
 * Every spelling that names the transcript, as segment runs (PRD §2).
 *
 * The absolute path always counts. The home forms are added only when the transcript really
 * lives under the given home — home and the transcript path arrive from different sources and
 * can disagree, and a tail sliced blindly out of a disagreement would close nothing but
 * garbage. `~<user>` derives its user from the home value's own last segment, so another
 * user's `~other` closes nothing.
 *
 * An empty result means a degenerate `transcriptPath` (zero segments that name a file): the
 * covenant goes inert, the repo convention for an empty protected-path entry. Matching every
 * candidate against nothing would be a total lock-up out of one empty string.
 */
function transcriptSpellings(spec: TranscriptModificationSpec): string[][] {
  const absolute = pathSegments(spec.transcriptPath);
  if (!absolute.some((segment) => segment !== '.')) return [];

  const spellings = [absolute];
  const home = normalizeHome(spec.home);
  if (home !== null && spec.transcriptPath.startsWith(`${home.path}/`)) {
    const tail = spec.transcriptPath.slice(home.path.length + 1);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional shell expansion spelling
    const prefixes = ['~', '$HOME', '${HOME}', `~${home.user}`];
    for (const prefix of prefixes) {
      spellings.push(pathSegments(`${prefix}/${tail}`));
    }
  }
  return spellings;
}

/**
 * True iff one path candidate names the transcript. Equality only — never an ancestor, a
 * descendant, or an embedded run at an offset, which is what removes the home ancestor at the
 * root. Raw segments are compared first and dot-resolved segments second (COVENANT-07b's
 * union), so `~/.claude/../<tail>` is the same file while `<tail>.bak` is not.
 */
function namesTranscript(candidate: string, spellings: string[][]): boolean {
  const raw = pathSegments(candidate);
  const resolved = resolveDotSegments(raw);
  return spellings.some(
    (spelling) => segmentsEqual(raw, spelling) || segmentsEqual(resolved, spelling),
  );
}

/** True iff any path candidate inside one token names the transcript. */
function tokenNamesTranscript(token: string, spellings: string[][]): boolean {
  return pathCandidates(token).some((candidate) => namesTranscript(candidate, spellings));
}

/** True iff any string value inside `value`, at any depth, names the transcript. */
function argsNameTranscript(value: unknown, spellings: string[][]): boolean {
  if (typeof value === 'string') {
    return tokenNamesTranscript(value, spellings);
  }
  if (Array.isArray(value)) {
    return value.some((item) => argsNameTranscript(item, spellings));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).some((item) => argsNameTranscript(item, spellings));
  }
  return false;
}

/**
 * Judge one simple command (PRD §3, order normative). Returns the break reason, or null when
 * the command contributes to uphold.
 */
function judgeCommand(command: SimpleCommand, transcript: ResolvedTranscript): string | null {
  const { spellings } = transcript;

  // (a) Precise rules: a detected mutation whose target is the transcript breaks.
  for (const rule of MUTATION_RULES) {
    for (const target of rule.detect(command)) {
      if (tokenNamesTranscript(target.path, spellings)) {
        return `${target.rule} targets the session transcript ${transcript.path}`;
      }
    }
  }

  // (b) Mention scan over word texts and redirect target texts. Opaque tokens are read too:
  // this ladder has no opaque-mention clause, so their text must still register a mention for
  // the backstop to answer. No mention: nothing left to judge.
  const tokens = [...command.words, ...command.redirects.map((redirect) => redirect.target)];
  if (!tokens.some((token) => tokenNamesTranscript(token.text, spellings))) return null;

  // (d) An opaque write target could resolve to the transcript itself — unprovable, so it
  // breaks even for an allowlisted reader (order over (e) is the invariant).
  if (command.redirects.some((r) => r.operator.includes('>') && r.target.opaque)) {
    return `opaque redirect target alongside the session transcript ${transcript.path}`;
  }

  // (e) Read-only allowlist: a proven read absolves the mention, in every spelling — but a
  // nested shell (`eval`/`sh -c …`) re-parses its string args, so it is never provably a read.
  const first = command.words[0];
  const firstBasename = first !== undefined ? commandBasename(first) : '';
  if (
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
  const lines = commandArgNames
    .map((name) => call.args?.[name])
    .filter((value): value is string => typeof value === 'string');
  if (lines.length === 0) {
    return `unjudgeable shell call ${call.name}: no command string under any command-arg name`;
  }

  for (const line of lines) {
    const result = tokenizeCommandLine(line);
    if (!result.ok) {
      // Tokenize failed: the shell would still remove quotes, so strip them before the
      // segment comparison — otherwise the very quoting that broke tokenization defeats the
      // fallback. Over-joining unrelated words only ever widens what breaks, never a hole.
      if (tokenNamesTranscript(line.replace(/['"]/g, ''), transcript.spellings)) {
        return `untokenizable command line names the session transcript ${transcript.path}`;
      }
      continue;
    }
    for (const command of result.commands) {
      const reason = judgeCommand(command, transcript);
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
    return namesTranscript(changePath, transcript.spellings)
      ? `${call.name} would modify the session transcript ${changePath}`
      : null;
  }
  return argsNameTranscript(call.args, transcript.spellings)
    ? `${call.name} would modify the session transcript ${transcript.path}`
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
  const spellings = transcriptSpellings(spec);
  if (spellings.length === 0) {
    return { upheld: true };
  }
  const transcript: ResolvedTranscript = {
    spellings,
    path: spec.transcriptPath,
    readOnlyEntries: spec.readOnlyCommands
      .map((entry) => entry.split(/\s+/).filter((word) => word !== ''))
      .filter((entry) => entry.length > 0),
  };
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
 * `mutatingTools` are the surfaces, serialized into its argv; `escapeHatch` is the TTL waiver
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
  escapeHatch?: CovenantRegistration['escapeHatch'];
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
    ...(spec.escapeHatch !== undefined ? { escapeHatch: spec.escapeHatch } : {}),
  };
}
