/**
 * Discipline judgment layer + registration compiler.
 *
 * `judgeDiscipline` decides one validated `DisciplineEntry` against a `CovenantInput`
 * across the predicate families: command (`forbidCommand`) and context (`requirePrecedent`);
 * the declaration family is judged by its own compiled registration. `compileDisciplineRegistrations` turns entries into dispatcher
 * registrations — one per entry, content-predicate routed (`matches`), judged by an
 * in-process thunk. Glob matching is bought (picomatch); absolute paths are relativized
 * against the repo root before matching, so a path outside the root never matches — scope
 * is a repo-relative declaration.
 */

import { isAbsolute, posix, relative, resolve } from 'node:path';
import {
  allFileChanges,
  type CanonicalTranscript,
  type CovenantInput,
  type CovenantVerdict,
  type DisciplineEntry,
  type FileChange,
  noopTranscript,
  type SkipReason,
} from '@polydeukes/core';
import picomatch from 'picomatch';
import { tokenizeCommandLine } from './bash-line.js';
import {
  type Break,
  type CompiledDeclaration,
  type ConfigFault,
  compileDeclaration,
  judgeDeclaration,
  type SessionSnapshot,
  scopeAdmits,
  type World,
  witnessOpens,
} from './declaration-engine.js';
import { judgeAddedViolations } from './delta.js';
import type { CovenantRegistration } from './dispatch.js';
import { outcomeFromVerdict, UNJUDGEABLE_OUTCOME } from './run-covenant.js';
import { deriveShellChanges, type ShellChange, type ShellUnjudgeable } from './shell-evidence.js';

/**
 * The shell surface as injected values, never source literals, plus the root the globs
 * relativize against. The routing closures and the judged body share it.
 */
type ShellSurface = {
  rootDir: string;
  shellTools: string[];
  commandArgs: string[];
  /**
   * The file's content before this call runs, `null` when it does not exist (a create), and
   * `undefined` when it cannot be read at all — a permission error or a race is not an empty
   * file. The reader belongs to the surface that observes the change, so this package opens
   * no file; the third state is what keeps an unreadable pre-state from being recorded as a
   * pass.
   */
  readPreState: (location: string) => string | null | undefined;
};

/**
 * `JudgeDisciplineSpec` — one validated entry, the input it is judged against, and the
 * assembly values the judgment needs.
 *
 * `precedentFound` is the context family's evidence verdict, evaluated at assembly time and
 * bound into the judge thunk.
 */
export type JudgeDisciplineSpec = ShellSurface & {
  entry: DisciplineEntry;
  input: CovenantInput;
  precedentFound?: boolean;
};

/**
 * `CompileDisciplinesSpec` — validated entries plus the assembly values baked into each
 * registration's judge thunk and matches closure.
 *
 * `transcript` is the session history the context family's evidence is evaluated against
 * at assembly time. Absent means no evidence CHANNEL, not absent evidence — the entry
 * cannot be judged and skips, whereas an empty-but-present transcript is a session that
 * has said nothing yet and is judged as missing evidence.
 *
 * `evaluatePrecedent` is the seam an adapter fills for its own evidence vocabulary.
 * `undefined` from it means the key belongs to no adapter, so the entry skips rather than
 * being judged on a guess. Assembly does not halt.
 *
 * `observesChangeSet` says whether this surface's input carries the observation unit's whole
 * change set. Absent means true — the declaration judges the change set derived from the
 * input, which is what every surface did before the flag existed.
 */
export type CompileDisciplinesSpec = {
  disciplines: DisciplineEntry[];
  rootDir: string;
  shellTools: string[];
  commandArgs: string[];
  readPreState: (location: string) => string | null | undefined;
  observesChangeSet?: boolean;
  witness?: CovenantRegistration['witness'];
  transcript?: CanonicalTranscript;
  evaluatePrecedent?: (
    evidence: Record<string, unknown>,
    transcript: CanonicalTranscript,
  ) => boolean | undefined;
};

/** Normalize an optional glob field to an array (absent = empty). */
function toGlobs(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return typeof value === 'string' ? [value] : value;
}

/**
 * Relativize a file-change path against the root for glob matching. A relative path passes
 * through; an absolute path outside `rootDir` yields null (never matches — discipline scope
 * is declared repo-relative).
 */
function relativizeForScope(filePath: string, rootDir: string): string | null {
  if (!isAbsolute(filePath)) {
    // A relative spelling normalizes before matching — `./x` and `a/../x` name x, and a
    // spelling that resolves out of the root matches nothing. Matching verbatim instead
    // lets an equivalent spelling escape every scope.
    const normalized = posix.normalize(filePath);
    if (normalized === '.' || normalized.startsWith('..')) return null;
    return normalized;
  }
  const relativized = relative(rootDir, filePath);
  if (relativized.startsWith('..') || isAbsolute(relativized)) return null;
  return relativized;
}

/** The context family's scope predicate over relativized paths: `in` absent = all, `except` subtracts. */
function forbidScopeMatcher(entry: DisciplineEntry): (path: string) => boolean {
  const inGlobs = toGlobs(entry.in);
  const isIn = inGlobs.length === 0 ? () => true : picomatch(inGlobs, { dot: true });
  const exceptGlobs = toGlobs(entry.except);
  const isExcept = exceptGlobs.length === 0 ? () => false : picomatch(exceptGlobs, { dot: true });
  return (path) => isIn(path) && !isExcept(path);
}

/** In-scope file changes for the context family: `in` absent = all, `except` subtracts. */
function forbidScope(
  entry: DisciplineEntry,
  fileChanges: FileChange[],
  rootDir: string,
): { path: string; change: FileChange }[] {
  const isInScope = forbidScopeMatcher(entry);

  const targets: { path: string; change: FileChange }[] = [];
  for (const change of fileChanges) {
    const scoped = relativizeForScope(change.path, rootDir);
    if (scoped === null || !isInScope(scoped)) continue;
    targets.push({ path: scoped, change });
  }
  return targets;
}

/** The first of `paths` that relativizes into the entry's scope, or null (routing only). */
function firstScopedPath(entry: DisciplineEntry, paths: string[], rootDir: string): string | null {
  const isInScope = forbidScopeMatcher(entry);
  for (const path of paths) {
    const scoped = relativizeForScope(path, rootDir);
    if (scoped !== null && isInScope(scoped)) return scoped;
  }
  return null;
}

/** One change as one world, under the repo-relative path the declaration's scope reads. */
export type SuppliedWorld = { readonly path: string; readonly world: World };

/** `worldsFromInput` input — one observation and the root its paths are relativized against. */
export type WorldsFromInputSpec = { input: CovenantInput; rootDir: string };

/**
 * Turn each file change into one world, in input order.
 *
 * The five source names are fixed: `target.path`, `pre`, `post`, the paired `state`, and
 * `changes`. A side the change does not carry is an ABSENT key, never a fabricated default
 * — what a missing source means is the declaration's own `supply` policy to state. `state`
 * exists only where both sides do, so a declaration comparing before with after refuses a
 * change that has no before. A path outside the root is dropped, as everywhere else in this
 * module: a declaration's scope is written repo-relative.
 *
 * `changes` is the observation unit's change set, the same array instance in every world so
 * a large commit costs one list rather than one per change. It is derived from this input
 * unless the host supplied its own — a host whose observation is wider than the changes it
 * dispatches at once has a set no derivation here could reach.
 */
export function worldsFromInput(spec: WorldsFromInputSpec): SuppliedWorld[] {
  const { input, rootDir } = spec;
  const scoped: { path: string; change: FileChange }[] = [];
  for (const change of allFileChanges(input)) {
    const path = relativizeForScope(change.path, rootDir);
    if (path !== null) scoped.push({ path, change });
  }
  const changes = input.world?.changes ?? scoped.map((entry) => entry.path);

  const worlds: SuppliedWorld[] = [];
  for (const { path, change } of scoped) {
    const world: Record<string, unknown> = { 'target.path': path, changes };
    // A kind this host does not know (a stale adapter dist) yields no world at all: a key
    // holding `undefined` would satisfy the engine's presence check and skip the supply
    // policy, so the step would run over nothing and could answer pass.
    switch (change.kind) {
      case 'create':
        world.post = change.post;
        break;
      case 'modify':
        world.pre = change.pre;
        world.post = change.post;
        world.state = { pre: change.pre, post: change.post };
        break;
      case 'delete':
        if (change.pre !== undefined) world.pre = change.pre;
        break;
      default:
        continue;
    }
    worlds.push({ path, world });
  }
  return worlds;
}

/**
 * Added-direction verdict for one change, exhaustive over the evidence union. One
 * definition shared by the delta family's judge and the context family's trigger, so the
 * two can never disagree on what a change kind means. A deletion upholds — it adds no
 * content, so the added direction has no violation to find.
 */
function judgeAddedForChange(change: FileChange, pattern: RegExp): CovenantVerdict {
  switch (change.kind) {
    case 'create':
      return judgeAddedViolations({ pre: null, post: change.post }, pattern);
    case 'modify':
      return judgeAddedViolations({ pre: change.pre, post: change.post }, pattern);
    case 'delete':
      return { upheld: true };
    default: {
      // Compiler-enforced exhaustiveness stays (the never assignment breaks the build
      // if a variant goes unhandled); at runtime an unrecognized kind is unjudgeable —
      // throw a legible reason and let the judged body fail closed (exit 2).
      const unhandled: never = change;
      throw new Error(
        `unjudgeable evidence kind ${JSON.stringify(unhandled)} — a stale adapter dist? rebuild with pnpm build`,
      );
    }
  }
}

/** The one shell-surface filter: named args of shell-tool calls, whatever the source. */
function filterShellCalls(
  calls: readonly { name: string; args?: Record<string, unknown> }[],
  shellTools: string[],
  commandArgs: string[],
): { toolName: string; command: string }[] {
  const found: { toolName: string; command: string }[] = [];
  for (const call of calls) {
    if (!shellTools.includes(call.name)) continue;
    for (const argName of commandArgs) {
      const value = call.args?.[argName];
      if (typeof value === 'string') found.push({ toolName: call.name, command: value });
    }
  }
  return found;
}

/** The command strings of shell-tool calls, whatever the source. */
function filterShellCommands(
  calls: readonly { name: string; args?: Record<string, unknown> }[],
  shellTools: string[],
  commandArgs: string[],
): string[] {
  return filterShellCalls(calls, shellTools, commandArgs).map((call) => call.command);
}

/** Shell command strings of the input: values of the named args on shell-tool calls. */
function shellCommands(input: CovenantInput, opts: ShellSurface): string[] {
  return filterShellCommands(input.toolCalls, opts.shellTools, opts.commandArgs);
}

/**
 * True when a command-family pattern matches the command.
 *
 * The match is the union of two units. Each LINE is tested (split on `/\r?\n/`, so a `^`
 * anchor means "start of a line" instead of silently anchoring to the whole string, and a
 * CRLF ending cannot disarm an end-of-line pattern), and the WHOLE string is tested (so a
 * pattern whose match spans a line boundary — a `\s` consuming the newline of a
 * continuation — keeps every match it had before the line unit existed). The union only
 * ever widens the candidate set. Both judgment paths call this, so routing and judgment
 * can never see different units.
 */
function commandLineMatches(command: string, pattern: RegExp): boolean {
  return pattern.test(command) || command.split(/\r?\n/).some((line) => pattern.test(line));
}

/** What the input's shell commands prove, and what they only signal. */
type ShellSignals = {
  evidence: { toolName: string; change: ShellChange }[];
  unjudgeable: ShellUnjudgeable[];
};

/**
 * Derive the shell-delivered signals of an input — the one derivation seam both the routing
 * closures and the judged body consume, so the two can never disagree on what a command
 * proves. Pure: completing the evidence with a pre-state is the body's job, since routing
 * may not consult the reader.
 */
function deriveShellSignals(input: CovenantInput, opts: ShellSurface): ShellSignals {
  const signals: ShellSignals = { evidence: [], unjudgeable: [] };
  for (const call of filterShellCalls(input.toolCalls, opts.shellTools, opts.commandArgs)) {
    const derived = deriveShellChanges(call.command);
    for (const change of derived.evidence) {
      signals.evidence.push({ toolName: call.toolName, change });
    }
    signals.unjudgeable.push(...derived.unjudgeable);
  }
  return signals;
}

/**
 * Complete shell-derived evidence with the surface's pre-state and attach it to the input.
 * The hook runs before the tool does, so what the surface observes now IS the pre-state.
 *
 * Two rules. **One evidence, one call element**: `toolCall.fileChange` is singular, so each
 * derived change rides its own element (same tool name, no args) rather than the shell call
 * it came from — an element without args carries nothing into the command family's
 * judgment. **Same-path evidence chains in command order**: only the first write consults
 * the reader, and every later one composes onto its predecessor's post, or a truncate
 * followed by a re-add would be forgiven as pre-existing debt.
 */
function enrichWithShellEvidence(input: CovenantInput, opts: ShellSurface): CovenantInput {
  const derived = deriveShellSignals(input, opts);
  if (derived.evidence.length === 0) return input;

  const composed = new Map<string, string>();
  const proven: CovenantInput['toolCalls'] = [];
  for (const { toolName, change } of derived.evidence) {
    const location = resolve(opts.rootDir, change.path);
    const chained = composed.get(location);
    const pre = chained !== undefined ? chained : opts.readPreState(location);
    if (pre === undefined) {
      // Cannot judge means block: the thunk-level catch turns this throw into the
      // undecidable-structure outcome — never a quiet uphold recorded as `passed`.
      throw new Error(`pre-state of ${change.path} is unreadable`);
    }
    const post = change.mode === 'append' ? `${pre ?? ''}${change.content}` : change.content;
    composed.set(location, post);
    proven.push({
      name: toolName,
      fileChange:
        pre === null
          ? { kind: 'create', path: change.path, post }
          : { kind: 'modify', path: change.path, pre, post },
    });
  }
  return { ...input, toolCalls: [...input.toolCalls, ...proven] };
}

/** Shell-derived targets whose content is computable — routing's half of the derivation. */
function derivedTargets(input: CovenantInput, opts: ShellSurface): string[] {
  return deriveShellSignals(input, opts).evidence.map((derived) => derived.change.path);
}

/**
 * The first computable shell write a declaration's scope admits, judged on what the command
 * text alone decides: the target path and, for a truncating write, the content it puts there.
 *
 * An append composes onto a pre-state only the body may read, so its content is left absent
 * and a scope over `post` cannot admit it here — the write still reaches the body, which
 * builds the real world.
 */
function firstAdmittedShellWrite(
  compiled: CompiledDeclaration,
  input: CovenantInput,
  opts: ShellSurface,
  rootDir: string,
): string | null {
  for (const derived of deriveShellSignals(input, opts).evidence) {
    const path = relativizeForScope(derived.change.path, rootDir);
    if (path === null) continue;
    const world: Record<string, unknown> =
      derived.change.mode === 'truncate'
        ? { 'target.path': path, post: derived.change.content }
        : { 'target.path': path };
    if (scopeAdmits(compiled, world)) return path;
  }
  return null;
}

/**
 * The relativized path of the first change triggering a context entry, or null. One trigger
 * definition, shared by the judge and by routing.
 *
 * With `when`, the trigger is the added direction of the delta layer verbatim, so a
 * `delete` never triggers (deletion adds no content). Without `when`, every in-scope
 * mutation triggers — deletion included, since erasing a covered file without precedent
 * is exactly what such an entry demands evidence for.
 */
function precedentTrigger(
  entry: DisciplineEntry,
  input: CovenantInput,
  rootDir: string,
): string | null {
  const pattern = entry.when === undefined ? null : new RegExp(entry.when);
  for (const target of forbidScope(entry, allFileChanges(input), rootDir)) {
    if (pattern === null) return target.path;
    if (judgeAddedForChange(target.change, pattern).upheld === false) return target.path;
  }
  return null;
}

/**
 * Shell grammar words that can sit in front of a command inside a compound list. The
 * tokenizer splits `for … ; do cmd ; done` on `;` like any other list, so the body's simple
 * command carries `do` as an ordinary first word. These are grammar, not programs — unlike
 * an assignment or a wrapper command such as `sudo`, stepping past them adds no
 * approximation, it just stops mistaking syntax for a command name.
 */
const SHELL_LIST_KEYWORDS = new Set(['do', 'then', 'else', 'elif']);

/**
 * True when the pattern matches at the START of one of the command line's simple commands —
 * the difference between having run a command and having mentioned it. The tokenizer
 * already knows the `&&`/`||`/`;`/pipe boundaries, so a chained `cd pkg && npm view yaml`
 * still qualifies while `echo "npm view yaml"` does not.
 *
 * Only `words` are joined: redirect targets and heredoc bodies are not command positions,
 * and folding them in would let anyone forge evidence by writing the command into a
 * document. A word-less command (a bare redirect) joins to the empty string, which a pattern
 * able to match nothing would anchor at index 0 — index 0 is necessary for evidence, never
 * sufficient, so an empty join is skipped.
 *
 * A line carrying an unread span answers false: this judge cannot say where an unfinished
 * line's commands start. The boolean reads backwards from the rest of the package — here
 * `false` means "evidence missing" — but it resolves the same way every other unread-span
 * site does, toward refusing. Trusting the half that was read would open a discipline gate.
 *
 * A word carrying a space came from quoting, and the tokenizer hands back its text with the
 * quotes removed — so `"npm view yaml"` arrives as ONE word spelling exactly what three
 * separate words would spell, and in the command position nothing precedes it to push the
 * match off index 0. A simple command whose NAME is such a word is therefore refused. Only
 * the name is checked, so quoted ARGUMENTS are untouched and `npm view "some pkg"` still
 * matches.
 *
 * The anchor is a POSITION check on the match, not `'^' + source`: prefixing binds the
 * anchor to the first alternation branch only and leaves every other branch free to match
 * mid-string.
 */
function commandAnchors(command: string, pattern: RegExp): boolean {
  const tokenized = tokenizeCommandLine(command);
  if (tokenized.unread.length > 0) return false;
  return tokenized.commands.some((simple) => {
    const words = simple.words.map((word) => word.text);
    while (words.length > 0 && SHELL_LIST_KEYWORDS.has(words[0])) words.shift();
    if (words.length === 0 || words[0].includes(' ')) return false;
    const joined = words.join(' ');
    return pattern.exec(joined)?.index === 0;
  });
}

/**
 * Append an entry's rationale to a break reason.
 *
 * The reason is one line an agent reads off stderr, so a `why` spanning several lines — a YAML
 * block scalar writes exactly that — folds to spaces before it is appended. Every line break
 * folds, CR included and not only the CRLF pair: a lone CR reaching a terminal returns the
 * cursor to column zero, so it would repaint the rationale over the discipline id and path this
 * reason has already named. A run of breaks folds to one space, which is what a block scalar's
 * blank line and trailing newline produce. Emptiness is decided AFTER folding: a why of only
 * breaks or spaces carries no rationale, and appending the separator alone would leave a
 * dangling ` — why: `. Nothing about a verdict is decided here; the caller has already judged.
 */
function withWhy(reason: string, why: string | undefined): string {
  const folded = why?.replace(/[\r\n]+/g, ' ').trim();
  return folded === undefined || folded === '' ? reason : `${reason} — why: ${folded}`;
}

/** Describe the evidence an entry requires, for the break reason. */
function describePrecedent(requirePrecedent: Record<string, unknown>): string {
  return Object.entries(requirePrecedent)
    .map(([key, value]) => `${key} ${JSON.stringify(value)}`)
    .join(', ');
}

/**
 * Judge one discipline entry against a covenant input (pure).
 *
 * Command family: a shell-tool command matching the pattern breaks. Context family: an
 * in-scope mutation with no prior session evidence breaks. No file changes / no targets
 * uphold — a defensive re-check of what routing would not have matched.
 *
 * Every break reason carries the entry's `why` when it has one, appended by {@link withWhy}
 * once the verdict is settled, so the rationale reaches the agent reading stderr without
 * ever entering the judgment.
 *
 * An entry whose predicate no family judges throws, and the compiled body folds that into
 * unjudgeable (exit 2) — never `upheld`. A caller outside that body owns the catch.
 *
 * @throws Error - when no family judges the entry's predicate (core admitted a key this
 *   judge has no branch for); validated data never reaches it.
 */
export function judgeDiscipline(spec: JudgeDisciplineSpec): CovenantVerdict {
  const { entry, input } = spec;

  if (entry.forbidCommand !== undefined) {
    const pattern = new RegExp(entry.forbidCommand);
    for (const command of shellCommands(input, spec)) {
      if (commandLineMatches(command, pattern)) {
        return {
          upheld: false,
          reason: withWhy(
            `discipline '${entry.id}' broken: command matches forbidden pattern`,
            entry.why,
          ),
        };
      }
    }
    return { upheld: true };
  }

  if (entry.requirePrecedent !== undefined) {
    const triggered = precedentTrigger(entry, input, spec.rootDir);
    // Absent evidence is missing evidence: only an explicit true opens the gate.
    if (triggered !== null && spec.precedentFound !== true) {
      return {
        upheld: false,
        // The reason names the recovery path, not just the requirement. Because evidence
        // is an execution, a user who DID run the command can still land here — the line
        // failed as a whole, or the match sat somewhere other than a command's start.
        // Without the hint those cases are indistinguishable from never having run it, and
        // the natural next move is the witness.
        reason: withWhy(
          `discipline '${entry.id}' broken on ${triggered}: requires prior session evidence (${describePrecedent(entry.requirePrecedent)}). only a call that ran and succeeded counts, matched at the start of a simple command — if it was part of a chain or a compound that failed, run it on its own`,
          entry.why,
        ),
      };
    }
    return { upheld: true };
  }

  // Validated data always carries one predicate, so this line is reached only when core
  // admits a family covenant does not judge yet. That is unjudgeable, never upheld.
  throw new Error(`discipline '${entry.id}': no judged predicate key`);
}

/** Build the family-specific routing predicate for one entry. */
function buildMatches(
  entry: DisciplineEntry,
  spec: CompileDisciplinesSpec,
): (input: CovenantInput) => string | null {
  const opts: ShellSurface = {
    rootDir: spec.rootDir,
    shellTools: spec.shellTools,
    commandArgs: spec.commandArgs,
    readPreState: spec.readPreState,
  };
  if (entry.forbidCommand !== undefined) {
    const pattern = new RegExp(entry.forbidCommand);
    return (input) =>
      shellCommands(input, opts).some((c) => commandLineMatches(c, pattern)) ? '-' : null;
  }
  // The context family is what remains: the command family answered above, and a
  // declaration entry never reaches here — it compiles to its own registration.
  //
  // Routing is evidence-blind: a trigger with evidence still spawns the body and records
  // `passed` — "the gate checked, and the evidence was there" is the context family's
  // measurement value, not wasted judgment.
  //
  // A shell-derived target routes `when`-blind: no pre exists at routing time, so the
  // added direction cannot be asked here. Precision is the body's.
  return (input) =>
    precedentTrigger(entry, input, spec.rootDir) ??
    firstScopedPath(entry, derivedTargets(input, opts), spec.rootDir);
}

/**
 * The three results of asking whether session evidence preceded a mutation.
 *
 * `unjudgeable` is not a verdict — it reports that the question could not be asked.
 * `configFault` separates an author's mistake, which must name itself on stderr, from an
 * environment fact such as an absent session, which must not: warning on every sessionless
 * assembly would train the reader to ignore the channel carrying the real faults.
 */
type EvidenceOutcome =
  | { kind: 'found' }
  | { kind: 'missing' }
  | { kind: 'unjudgeable'; reason: string; configFault: boolean };

/**
 * Evaluate a context entry's evidence against the session at assembly time — the compiled
 * thunk judges one input and holds no transcript.
 *
 * Vocabulary is layered: `command` is the core's own, evaluated here against the shell
 * surface with the same filter the command family judges by; every other key is adapter
 * vocabulary delegated to the injected seam. Nothing throws — an evidence spec that
 * cannot be resolved yields `unjudgeable`, which the compiler turns into a skip
 * registration rather than a failure outliving the entry that caused it.
 */
function evaluateEvidence(entry: DisciplineEntry, spec: CompileDisciplinesSpec): EvidenceOutcome {
  const evidence = entry.requirePrecedent as Record<string, unknown>;
  const command = evidence.command;
  const noSession = {
    kind: 'unjudgeable',
    reason: 'no session transcript to read',
    configFault: false,
  } as const;

  if (typeof command === 'string') {
    let pattern: RegExp;
    try {
      pattern = new RegExp(command);
    } catch {
      return {
        kind: 'unjudgeable',
        reason: `requirePrecedent.command is not a compilable pattern (${command})`,
        configFault: true,
      };
    }
    if (spec.transcript === undefined) return noSession;
    // A transcript with no shell surface can never satisfy command evidence. The question
    // is unanswerable, not answered "no" — reporting `missing` would forge a universal
    // block with no legitimate pass path.
    if (spec.shellTools.length === 0 || spec.commandArgs.length === 0) {
      return {
        kind: 'unjudgeable',
        reason: 'command evidence needs a shell surface (shellTools/commandArgs)',
        configFault: true,
      };
    }
    let found: boolean;
    try {
      // Only a call the provider saw run and succeed is evidence: a blocked, refused, or
      // failed call did not do the work the discipline demands, and an absent outcome means
      // the provider cannot tell — including the input-backed provider, whose calls are the
      // very ones being judged.
      const calls = spec.transcript.findToolCalls().filter((call) => call.succeeded === true);
      found = filterShellCommands(calls, spec.shellTools, spec.commandArgs).some((c) =>
        commandAnchors(c, pattern),
      );
    } catch {
      // An injected transcript that throws is an unusable channel, not an answer — the
      // same reason the evaluator seam below is wrapped.
      return {
        kind: 'unjudgeable',
        reason: 'the injected transcript threw while being queried',
        configFault: true,
      };
    }
    return found ? { kind: 'found' } : { kind: 'missing' };
  }

  // Vocabulary is settled BEFORE the session is. Both facts can be true at once, and
  // answering "no session" for a misspelled key files the author's mistake under an
  // environment fact — on the commit surface, which never injects a transcript, that
  // would hide it for the life of the config.
  if (spec.evaluatePrecedent === undefined) {
    // An environment fact, not an author's mistake: a surface that does not speak adapter
    // vocabulary correctly declines to supply an evaluator, and the commit surface never
    // does. Announcing it would put a line on stderr for every commit. A misspelled key is
    // the loud case — the evaluator is present and answers `undefined` for it, below.
    return {
      kind: 'unjudgeable',
      reason: `no precedent evaluator injected for evidence ${JSON.stringify(evidence)}`,
      configFault: false,
    };
  }
  let answer: boolean | undefined;
  try {
    answer = spec.evaluatePrecedent(evidence, spec.transcript ?? noopTranscript);
  } catch {
    // An injected seam that throws is an unusable evaluator, not a verdict. Letting it
    // escape would brick assembly exactly as the throws this function replaced did — the
    // dispatcher wraps `matches` and `witness` for the same reason.
    return {
      kind: 'unjudgeable',
      reason: `precedent evaluator threw on evidence ${JSON.stringify(evidence)}`,
      configFault: true,
    };
  }
  if (answer === undefined) {
    return {
      kind: 'unjudgeable',
      reason: `unrecognized precedent evidence ${JSON.stringify(evidence)}`,
      configFault: true,
    };
  }
  if (spec.transcript === undefined) return noSession;
  return answer ? { kind: 'found' } : { kind: 'missing' };
}

/** The declaration compiler's fault value, distinguished from a compiled declaration. */
function isFault(value: CompiledDeclaration | ConfigFault): value is ConfigFault {
  return (value as { kind?: unknown }).kind === 'config-fault';
}

/** Compile a declare entry's block, the entry's id supplying the declaration's name. */
function compileEntryDeclaration(entry: DisciplineEntry): CompiledDeclaration | ConfigFault {
  return compileDeclaration({
    declaration: {
      discipline: entry.id,
      ...(entry.declare as NonNullable<DisciplineEntry['declare']>),
    },
  });
}

/**
 * The first of `paths` the declaration's scope admits, judged as a world of that path alone.
 *
 * A shell line delivers a path and nothing else, so only a scope over `target.path` can be
 * tested here. A scope over any other source admits every path: the write may be in scope
 * and this layer cannot tell, which is exactly what the skip row is for.
 */
function firstAdmittedPath(
  compiled: CompiledDeclaration,
  paths: string[],
  rootDir: string,
): string | null {
  const testable = compiled.scope === undefined || compiled.scope.source === 'target.path';
  for (const path of paths) {
    const scoped = relativizeForScope(path, rootDir);
    if (scoped === null) continue;
    if (!testable || scopeAdmits(compiled, { 'target.path': scoped })) return scoped;
  }
  return null;
}

/**
 * Describe the first pattern on an entry that does not compile, or `undefined` when all of
 * them do. Both pattern-bearing families are covered: containing only the context family
 * would leave the command family able to take down the whole assembly through the same door.
 */
function patternFault(entry: DisciplineEntry): string | undefined {
  const sources: [string, string | undefined][] = [
    ['forbidCommand', entry.forbidCommand],
    ['when', entry.when],
  ];
  for (const [key, source] of sources) {
    if (source === undefined) continue;
    try {
      new RegExp(source);
    } catch {
      return `${key} is not a compilable pattern (${source})`;
    }
  }
  return undefined;
}

/**
 * True for the families whose shell-delivered writes are attributable to one entry: context
 * and declaration. A command entry's axis is the string itself, so it gains no skip arm. An
 * entry whose pattern is broken gains none either — a broken pattern defines no match.
 */
function hasShellSkipArm(entry: DisciplineEntry, spec: CompileDisciplinesSpec): boolean {
  // No shell surface, no shell writes to detect: the arm's own matches predicate could
  // never fire, so registering it would only misreport the entry as unjudgeable there.
  if (spec.shellTools.length === 0 || spec.commandArgs.length === 0) return false;
  if (patternFault(entry) !== undefined) return false;
  if (entry.declare !== undefined) return !isFault(compileEntryDeclaration(entry));
  return entry.requirePrecedent !== undefined;
}

/**
 * The per-entry skip registration: a detected write in this entry's scope whose result
 * cannot be computed records one `skipped` under the entry's own label, keeping the gain
 * aggregation in one group instead of falling to the common backstop.
 */
function shellSkipArm(entry: DisciplineEntry, spec: CompileDisciplinesSpec): CovenantRegistration {
  const opts: ShellSurface = {
    rootDir: spec.rootDir,
    shellTools: spec.shellTools,
    commandArgs: spec.commandArgs,
    readPreState: spec.readPreState,
  };
  // A declaration's scope is its own; every other family reads the entry-level globs. This
  // arm carries the UNCOMPUTABLE writes only — a computable one becomes a file change the
  // judging arm sees, so admitting it here would leave one call two rows.
  const compiled = entry.declare === undefined ? undefined : compileEntryDeclaration(entry);
  const uncomputable = (input: CovenantInput): string[] =>
    deriveShellSignals(input, opts).unjudgeable.flatMap((signal) => signal.path ?? []);
  const scoped =
    compiled === undefined || isFault(compiled)
      ? (input: CovenantInput) => firstScopedPath(entry, uncomputable(input), spec.rootDir)
      : (input: CovenantInput) => firstAdmittedPath(compiled, uncomputable(input), spec.rootDir);

  return {
    label: entry.id,
    protectedPaths: [],
    matches: scoped,
    skip: {
      reason: 'a shell write in scope whose result this layer cannot compute',
      kind: 'no-observation',
    },
  };
}

/**
 * The one common shell-axis skip registration. A write whose target itself is unknowable
 * belongs to no entry's scope, so leaving N rows under N labels would trade one silent pass
 * for a fabricated attribution — one row, one subject `'-'`.
 */
function shellUnjudgeableRegistration(spec: CompileDisciplinesSpec): CovenantRegistration {
  const opts: ShellSurface = {
    rootDir: spec.rootDir,
    shellTools: spec.shellTools,
    commandArgs: spec.commandArgs,
    readPreState: spec.readPreState,
  };
  return {
    label: 'shell-unjudgeable',
    protectedPaths: [],
    matches: (input) =>
      deriveShellSignals(input, opts).unjudgeable.some((signal) => signal.path === undefined)
        ? '-'
        : null,
    skip: {
      reason: 'a shell command whose write target this layer cannot determine',
      kind: 'no-observation',
    },
  };
}

/**
 * Flatten a session into the plain snapshot a declaration reads.
 *
 * `index` is the observation ordinal within its own list, and `observedAtMs` is the clock at
 * supply time — the only moment the age of a turn can be measured against, since the engine
 * itself reads no clock.
 */
function snapshotOf(transcript: CanonicalTranscript): SessionSnapshot {
  return {
    observedAtMs: Date.now(),
    userMessages: transcript
      .findUserMessages()
      .map((message, index) => ({ index, text: message.text, timestampMs: message.timestampMs })),
    toolCalls: transcript.findToolCalls().map((call, index) => ({
      index,
      name: call.name,
      args: call.args,
      succeeded: call.succeeded,
    })),
  };
}

/**
 * The `sources` bindings of a declare entry, in declaration order; none is an empty list.
 *
 * Each file path is normalized once, here, so the plan, the supplied keys, and the match
 * against the change set all see one spelling: a `./locales/en.json` an author wrote is
 * otherwise read under one name and looked up under another, and the change's own text never
 * wins. A channel or transcript binding carries its kind instead — neither is a path.
 */
function sourceBindings(entry: DisciplineEntry): SourceBinding[] {
  return Object.entries(entry.declare?.sources ?? {}).map(([name, source]) => {
    if ('sidecar' in source) return { name, sidecar: true as const };
    if ('transcript' in source) return { name, transcript: true as const };
    return { name, file: posix.normalize(source.file) };
  });
}

/**
 * One compiled `sources` binding: a repo-relative file, a channel of the world axis, or the
 * session's conversation history.
 */
type SourceBinding =
  | { name: string; file: string }
  | { name: string; sidecar: true }
  | { name: string; transcript: true };

/**
 * What each named source is worth on this input: for a file, the change's own `post` when it
 * is one this input changes and the host-supplied text otherwise; for a channel, the text the
 * surface supplied; for a transcript, the injected session flattened into a plain snapshot.
 * Absent when none exists.
 *
 * The change set wins over the supplied text because the two surfaces read the tree at
 * different moments — a session call is judged while the disk still holds the pre-edit
 * state — and the change carries the state the call will produce. A deletion leaves the
 * key absent, since after it there is no file for the declaration's `supply` policy to
 * dispose of by any other reading. That rule never reaches a channel: a channel has no path,
 * so it can never overlap the change set. A transcript has no path either, and its absence
 * is the absence of the injected session — never anything the world axis carries.
 */
function sourceValues(
  bindings: readonly SourceBinding[],
  worlds: readonly SuppliedWorld[],
  world: CovenantInput['world'],
  transcript: CanonicalTranscript | undefined,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const binding of bindings) {
    if ('transcript' in binding) {
      // An injected transcript that throws is an unusable channel, not an answer — the
      // same reading the precedent path gives it. Leaving the key absent hands the case
      // to the declaration's `supply` policy instead of the dispatcher's routing failure,
      // which would block an advised entry.
      if (transcript !== undefined) {
        try {
          values[binding.name] = snapshotOf(transcript);
        } catch {
          // absent
        }
      }
      continue;
    }
    if ('sidecar' in binding) {
      const text = world?.channels?.sidecar;
      if (text !== undefined) values[binding.name] = text;
      continue;
    }
    const { name, file } = binding;
    const changed = worlds.find((supplied) => supplied.path === file);
    if (changed !== undefined) {
      if ('post' in changed.world) values[name] = changed.world.post;
      continue;
    }
    const supplied = world?.files?.[file];
    if (supplied !== undefined) values[name] = supplied;
  }
  return values;
}

/**
 * Whether any pipeline of a compiled declaration — body or witness — reads `changes`.
 *
 * A combinator-headed pipeline names the extractions it combines, and those are pipelines of
 * the same map, so reading each pipeline's own head answers for all of them.
 */
function readsChangeSet(compiled: CompiledDeclaration): boolean {
  const heads = [...compiled.pipelines.values(), ...(compiled.witness?.pipelines.values() ?? [])];
  return heads.some(
    (pipeline) =>
      pipeline.steps[0]?.op === 'source' &&
      (pipeline.steps[0] as { of?: unknown }).of === 'changes',
  );
}

/** The first non-pass world of one input, or pass — what the body reports and the valve reads. */
/**
 * Judge one declaration over the worlds an input admits, first non-pass world wins.
 *
 * A supply-passed world does not stop the loop — a later world may still break, and a break
 * outranks a skip. `supply-pass` is the answer only when no world was judged at all: exit 0
 * with a `passed` row would read as a covenant upheld.
 */
function judgeAdmitted(
  compiled: CompiledDeclaration,
  worlds: readonly SuppliedWorld[],
): DeclareJudgment {
  let suppliedPast = false;
  let judgedAny = false;
  for (const supplied of worlds) {
    const verdict = judgeDeclaration({ compiled, world: supplied.world });
    if (verdict.kind === 'broken') return { kind: 'broken', supplied, breaks: verdict.breaks };
    if (verdict.kind === 'supply-error') {
      return { kind: 'unjudgeable', supplied, source: verdict.source, reason: verdict.reason };
    }
    if (verdict.kind === 'not-applicable' && verdict.reason === 'supply-pass') {
      suppliedPast = true;
    } else if (verdict.kind === 'pass') {
      judgedAny = true;
    }
  }
  return suppliedPast && !judgedAny ? { kind: 'supply-pass' } : { kind: 'pass' };
}

type DeclareJudgment =
  | { readonly kind: 'pass' }
  | { readonly kind: 'supply-pass' }
  | { readonly kind: 'broken'; readonly supplied: SuppliedWorld; readonly breaks: readonly Break[] }
  | {
      readonly kind: 'unjudgeable';
      readonly supplied: SuppliedWorld;
      readonly source: string;
      readonly reason: string;
    };

/**
 * Compile one declaration entry into its registration.
 *
 * An assembly fault is the author's mistake, so it becomes a skip that names its location
 * on stderr and routes nothing: a declaration that could never judge must not record a
 * `skipped` row per change as though the call were at fault. Otherwise routing and judging
 * share the declaration's own scope — the subject is the first world it admits, and the
 * body walks every admitted world in input order, reporting the first that breaks.
 *
 * The declaration's `witness` block joins the injected valve with OR: either the human's
 * pass condition or the declaration's own opens a blocked verdict — the declaration's on
 * the very world the body reported broken, never on an unjudgeable one.
 */
function declareRegistration(
  entry: DisciplineEntry,
  spec: CompileDisciplinesSpec,
  witness: { witness?: CovenantRegistration['witness'] },
  nameFault: (reason: string) => void,
): CovenantRegistration {
  const compiled = compileEntryDeclaration(entry);
  if (isFault(compiled)) {
    const reason = `${compiled.location}: ${compiled.reason}`;
    nameFault(reason);
    return {
      label: entry.id,
      protectedPaths: [],
      matches: () => null,
      ...witness,
      skip: { reason, kind: 'config-fault' },
    };
  }

  const bindings = sourceBindings(entry);
  const opts: ShellSurface = {
    rootDir: spec.rootDir,
    shellTools: spec.shellTools,
    commandArgs: spec.commandArgs,
    readPreState: spec.readPreState,
  };

  // One derivation per input, shared by routing, the body, and the valve: the valve must
  // see the same first non-pass world the body reported — a valve that re-judged on its
  // own could open on a later break while the body had stopped at an unjudgeable world.
  //
  // The input is enriched first, so a computable shell write reaches the declaration as an
  // ordinary file change: without it a Bash call carries no world and the write passes with
  // no row. An unreadable pre-state throws out of here and the body turns it into the
  // cannot-judge exit, never a quiet pass.
  //
  // The named sources join the world here rather than in `worldsFromInput`: what a source
  // name means is this declaration's own binding, and the fixed world knows none of them.
  const admittedOf = new WeakMap<CovenantInput, SuppliedWorld[]>();
  const admitted = (input: CovenantInput): SuppliedWorld[] => {
    const cached = admittedOf.get(input);
    if (cached !== undefined) return cached;
    const fixed = worldsFromInput({
      input: enrichWithShellEvidence(input, opts),
      rootDir: spec.rootDir,
    });
    const values = sourceValues(bindings, fixed, input.world, spec.transcript);
    const worlds = fixed
      .map((supplied) => ({ path: supplied.path, world: { ...supplied.world, ...values } }))
      .filter((supplied) => scopeAdmits(compiled, supplied.world));
    admittedOf.set(input, worlds);
    return worlds;
  };
  // Routing never consults the pre-state reader: it answers a subject, and the reader is
  // the body's channel — asking here would read the disk once per routing pass as well.
  // File-change evidence already carries its own worlds, and a shell write contributes the
  // path it names; whether that write is in scope is settled from `target.path` alone.
  const route = (input: CovenantInput): string | null => {
    const fixed = worldsFromInput({ input, rootDir: spec.rootDir });
    const values = sourceValues(bindings, fixed, input.world, spec.transcript);
    return (
      fixed.find((supplied) => scopeAdmits(compiled, { ...supplied.world, ...values }))?.path ??
      firstAdmittedShellWrite(compiled, input, opts, spec.rootDir)
    );
  };

  // A surface that dispatches its whole observation at once derives a one-element change
  // set, and a judgment over it reports every scoped change as unpaired. Routing is kept so
  // the limit is recorded per change; it is an environment fact, so no fault is named.
  if (spec.observesChangeSet === false && readsChangeSet(compiled)) {
    return {
      label: entry.id,
      protectedPaths: [],
      ...(entry.declare?.sources !== undefined && { sources: bindings }),
      matches: route,
      ...witness,
      skip: {
        reason: 'a change set needs a surface that observes more than one change',
        kind: 'no-observation',
      },
    };
  }

  const judgedOf = new WeakMap<CovenantInput, DeclareJudgment>();
  const judged = (input: CovenantInput): DeclareJudgment => {
    const cached = judgedOf.get(input);
    if (cached !== undefined) return cached;
    const result = judgeAdmitted(compiled, admitted(input));
    judgedOf.set(input, result);
    return result;
  };

  return {
    label: entry.id,
    protectedPaths: [],
    ...(entry.declare?.sources !== undefined && { sources: bindings }),
    matches: route,
    enforce: entry.enforce ?? 'advise',
    witness: (input, transcript, ctx) => {
      if (spec.witness?.(input, transcript, ctx) === true) return true;
      const judgment = judged(input);
      return (
        judgment.kind === 'broken' && witnessOpens({ compiled, world: judgment.supplied.world })
      );
    },
    body: async (input: CovenantInput) => {
      try {
        const judgment = judged(input);
        if (judgment.kind === 'broken') {
          return {
            exitCode: 1,
            reason: withWhy(
              `discipline '${entry.id}' broken on ${judgment.supplied.path}: ${judgment.breaks[0]?.message}`,
              entry.why,
            ),
            witnesses: judgment.breaks,
          };
        }
        if (judgment.kind === 'unjudgeable') {
          process.stderr.write(
            `discipline '${entry.id}' cannot judge ${judgment.supplied.path}: ${judgment.source} — ${judgment.reason}\n`,
          );
          return UNJUDGEABLE_OUTCOME;
        }
        if (judgment.kind === 'supply-pass') {
          return { exitCode: 0, skipped: 'supply-pass' };
        }
        return { exitCode: 0 };
      } catch {
        // An input no supply layer could read is unjudgeable, like every other body here.
        return UNJUDGEABLE_OUTCOME;
      }
    },
  };
}

/**
 * Compile validated discipline entries into dispatcher registrations.
 *
 * One registration per entry: `label` = id (per-discipline telemetry), `protectedPaths`
 * = [] (routing is the matches closure, not path mention), `body` = the judge thunk with
 * the entry and the assembly values bound in. Context and declaration entries gain a second,
 * body-less registration for their shell axis, and one common `shell-unjudgeable`
 * registration is appended last whatever the entry count.
 *
 * An entry whose evidence cannot be evaluated compiles to a **skip registration** instead:
 * routing is kept, so the no-op stays visible in `gain`, but there is no thunk to run.
 * Assembly never throws — one bad entry taking down its siblings, the meta-covenants, and
 * the witness valve would leave no way to fix the config that caused it.
 *
 * A non-compilable pattern also skips, but routes to nothing: the pattern IS the definition
 * of what the entry matches, so a broken one leaves no match to record. Its only signal is
 * the stderr line, and in production it is unreachable anyway — the validator refuses such
 * a config before assembly is ever called.
 */
export function compileDisciplineRegistrations(
  spec: CompileDisciplinesSpec,
): CovenantRegistration[] {
  const judged = spec.disciplines.map((entry): CovenantRegistration => {
    const witness = spec.witness !== undefined ? { witness: spec.witness } : {};

    // A silent skip is how a discipline goes inert while its verdict still reads passed.
    const nameFault = (reason: string): void => {
      process.stderr.write(`discipline '${entry.id}': ${reason} — skipped, not judged\n`);
    };

    // A broken pattern is judged before routing is built, because `buildMatches` compiles
    // that same pattern eagerly. It also routes to nothing: a pattern is what defines
    // which inputs the entry is about, so a broken one leaves no match to record. That
    // separates it from unevaluable evidence below, whose trigger is intact.
    if (entry.declare !== undefined) {
      return declareRegistration(entry, spec, witness, nameFault);
    }

    const fault = patternFault(entry);
    if (fault !== undefined) {
      nameFault(fault);
      return {
        label: entry.id,
        protectedPaths: [],
        matches: () => null,
        ...witness,
        skip: { reason: fault, kind: 'config-fault' },
      };
    }

    const routing = {
      label: entry.id,
      protectedPaths: [],
      matches: buildMatches(entry, spec),
      ...witness,
    };

    const outcome =
      entry.requirePrecedent === undefined ? undefined : evaluateEvidence(entry, spec);

    if (outcome?.kind === 'unjudgeable') {
      if (outcome.configFault) nameFault(outcome.reason);
      const kind: SkipReason = outcome.configFault === true ? 'config-fault' : 'no-observation';
      return { ...routing, skip: { reason: outcome.reason, kind } };
    }

    const opts: Omit<JudgeDisciplineSpec, 'entry' | 'input'> = {
      rootDir: spec.rootDir,
      shellTools: spec.shellTools,
      commandArgs: spec.commandArgs,
      readPreState: spec.readPreState,
      ...(outcome === undefined ? {} : { precedentFound: outcome.kind === 'found' }),
    };

    return {
      ...routing,
      // The entry's own level rides only on the body-bearing arm: the skip arms record the
      // absence of a judgment, which is outside the level axis. Absence means advise, and
      // it is decided here, so the level is always present on this arm; explicit `block` is
      // the promotion an author opts into.
      enforce: entry.enforce ?? 'advise',
      body: async (input: CovenantInput) => {
        // The misassembly gate: a command-family entry with no shell surface would uphold
        // everything, so it fails closed at either level rather than degrading into a
        // universal pass.
        if (
          entry.forbidCommand !== undefined &&
          (spec.shellTools.length === 0 || spec.commandArgs.length === 0)
        ) {
          return UNJUDGEABLE_OUTCOME;
        }
        try {
          return outcomeFromVerdict(
            judgeDiscipline({ ...opts, entry, input: enrichWithShellEvidence(input, opts) }),
          );
        } catch {
          // A structurally unjudgeable input, an unreadable pre-state, or a broken pattern
          // that slipped past assembly: cannot judge means block.
          return UNJUDGEABLE_OUTCOME;
        }
      },
    };
  });

  const skipArms = spec.disciplines
    .filter((entry) => hasShellSkipArm(entry, spec))
    .map((entry) => shellSkipArm(entry, spec));
  return [...judged, ...skipArms, shellUnjudgeableRegistration(spec)];
}
