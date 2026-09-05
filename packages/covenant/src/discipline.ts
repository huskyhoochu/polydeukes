/**
 * Discipline registration compiler.
 *
 * `compileDisciplineRegistrations` turns validated entries into dispatcher registrations —
 * one per entry, routed by the declaration's own scope (`matches`), judged by an in-process
 * thunk that runs the compiled declaration over each world the input yields. Absolute paths
 * are relativized against the repo root first, so a path outside the root never routes: a
 * declaration's scope is written repo-relative.
 */

import { isAbsolute, posix, relative, resolve } from 'node:path';
import {
  allFileChanges,
  type CanonicalTranscript,
  type CovenantInput,
  type DisciplineEntry,
  type FileChange,
} from '@polydeukes/core';
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
import type { CovenantRegistration } from './dispatch.js';
import { UNJUDGEABLE_OUTCOME } from './run-covenant.js';
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
 * `CompileDisciplinesSpec` — validated entries plus the assembly values baked into each
 * registration's judge thunk and matches closure.
 *
 * `transcript` is the session history a `transcript` binding reads. Absent means no session
 * CHANNEL, not an empty one — the declaration's own `supply` policy disposes of it.
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
};

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

/** One change as one world, under the repo-relative path the declaration's scope reads. */
export type SuppliedWorld = { readonly path: string; readonly world: World };

/**
 * `worldsFromInput` input — one observation, the root its paths are relativized against,
 * and the shell surface that says which of the input's calls is a shell call.
 */
export type WorldsFromInputSpec = {
  input: CovenantInput;
  rootDir: string;
  shellTools: string[];
  commandArgs: string[];
};

/**
 * Turn each observation of the input into one world, in input order.
 *
 * The six source names are fixed: `target.path`, `pre`, `post`, the paired `state`,
 * `changes`, and `command`. A side the change does not carry is an ABSENT key, never a
 * fabricated default — what a missing source means is the declaration's own `supply` policy
 * to state. `state` exists only where both sides do, so a declaration comparing before with
 * after refuses a change that has no before. A path outside the root is dropped, as
 * everywhere else in this module: a declaration's scope is written repo-relative.
 *
 * `changes` is the observation unit's change set, the same array instance in every world so
 * a large commit costs one list rather than one per change. It is derived from this input
 * unless the host supplied its own — a host whose observation is wider than the changes it
 * dispatches at once has a set no derivation here could reach.
 *
 * `command` is the first shell call's command string, carried by every world of the input.
 * A shell call changing no in-scope file is still one observation, so it yields the single
 * CALL WORLD — subject `'-'`, no `target.path`, so a path-scoped declaration finds no string
 * and refuses it. A surface whose shell tools are empty observes no shell call, hence no
 * `command` and no call world.
 */
export function worldsFromInput(spec: WorldsFromInputSpec): SuppliedWorld[] {
  const { input, rootDir } = spec;
  const command = filterShellCommands(input.toolCalls, spec.shellTools, spec.commandArgs)[0];
  const scoped: { path: string; change: FileChange }[] = [];
  for (const change of allFileChanges(input)) {
    const path = relativizeForScope(change.path, rootDir);
    if (path !== null) scoped.push({ path, change });
  }
  const changes = input.world?.changes ?? scoped.map((entry) => entry.path);

  const worlds: SuppliedWorld[] = [];
  for (const { path, change } of scoped) {
    const world: Record<string, unknown> = { 'target.path': path, changes };
    if (command !== undefined) world.command = command;
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
  if (worlds.length === 0 && command !== undefined)
    return [{ path: '-', world: { changes, command } }];
  return worlds;
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
 * it came from. **Same-path evidence chains in command order**: only the first write consults
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

/**
 * The paths a command writes in a way this layer cannot compute. The skip arm owns them: a
 * computable write to the same path in the same command composes onto a state the
 * uncomputable one then changes, so no world the body could build is the one the call leaves
 * on disk.
 */
function uncomputablePaths(signals: ShellSignals, rootDir: string): Set<string> {
  const owned = new Set<string>();
  for (const signal of signals.unjudgeable) {
    const path = signal.path === undefined ? null : relativizeForScope(signal.path, rootDir);
    if (path !== null) owned.add(path);
  }
  return owned;
}

/**
 * The first computable shell write a declaration's scope admits, judged on what the command
 * text alone decides: the target path. A scope over any other source needs the world only
 * the body can build (an append's content composes onto a pre-state the reader holds), so
 * such a write is admitted here and the body settles it — routing to nothing would leave a
 * write the body could break on with no row at all.
 */
function firstAdmittedShellWrite(
  compiled: CompiledDeclaration,
  input: CovenantInput,
  opts: ShellSurface,
  rootDir: string,
): string | null {
  const signals = deriveShellSignals(input, opts);
  const owned = uncomputablePaths(signals, rootDir);
  const testable = compiled.scope === undefined || compiled.scope.source === 'target.path';
  for (const derived of signals.evidence) {
    const path = relativizeForScope(derived.change.path, rootDir);
    if (path === null || owned.has(path)) continue;
    if (!testable || scopeAdmits(compiled, { 'target.path': path })) return path;
  }
  return null;
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
 * Whether an entry's shell-delivered writes are attributable to it — a declaration that
 * compiles has a scope to attribute them by, and one that does not compile defines no match.
 */
function hasShellSkipArm(entry: DisciplineEntry, spec: CompileDisciplinesSpec): boolean {
  // No shell surface, no shell writes to detect: the arm's own matches predicate could
  // never fire, so registering it would only misreport the entry as unjudgeable there.
  if (spec.shellTools.length === 0 || spec.commandArgs.length === 0) return false;
  const compiled = compileEntryDeclaration(entry);
  if (isFault(compiled)) return false;
  // A declaration scoped on the command line owns no path: the shell call it judges is the
  // world its body already saw, so an uncomputable write in the same call is not its row.
  return compiled.scope?.source !== 'command';
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
  // This arm carries the UNCOMPUTABLE writes only — a computable one becomes a file change
  // the judging arm sees, so admitting it here would leave one call two rows.
  const compiled = compileEntryDeclaration(entry);
  const uncomputable = (input: CovenantInput): string[] =>
    deriveShellSignals(input, opts).unjudgeable.flatMap((signal) => signal.path ?? []);
  const scoped = isFault(compiled)
    ? () => null
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
    // Same-path shell writes chain in command order and each carries its own world, so the
    // last one at the path is the state the call leaves.
    let changed: SuppliedWorld | undefined;
    for (const supplied of worlds) if (supplied.path === file) changed = supplied;
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
  enrich: (input: CovenantInput) => CovenantInput,
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
  // no row. A path the same command also writes uncomputably is the skip arm's, so its
  // derived world is dropped here. An unreadable pre-state throws out of here and the body
  // turns it into the cannot-judge exit, never a quiet pass.
  //
  // The named sources join the world here rather than in `worldsFromInput`: what a source
  // name means is this declaration's own binding, and the fixed world knows none of them.
  const admittedOf = new WeakMap<CovenantInput, SuppliedWorld[]>();
  const admitted = (input: CovenantInput): SuppliedWorld[] => {
    const cached = admittedOf.get(input);
    if (cached !== undefined) return cached;
    const owned = uncomputablePaths(deriveShellSignals(input, opts), spec.rootDir);
    const fixed = worldsFromInput({
      input: enrich(input),
      rootDir: spec.rootDir,
      shellTools: spec.shellTools,
      commandArgs: spec.commandArgs,
    }).filter((supplied) => !owned.has(supplied.path));
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
    const fixed = worldsFromInput({
      input,
      rootDir: spec.rootDir,
      shellTools: spec.shellTools,
      commandArgs: spec.commandArgs,
    });
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
 * the entry and the assembly values bound in. Each entry gains a second, body-less
 * registration for its shell axis, and one common `shell-unjudgeable` registration is
 * appended last whatever the entry count.
 *
 * An entry whose declaration does not compile becomes a **skip registration** that routes
 * nothing and names its location on stderr. Assembly never throws — one bad entry taking
 * down its siblings, the meta-covenants, and the witness valve would leave no way to fix
 * the config that caused it.
 */
export function compileDisciplineRegistrations(
  spec: CompileDisciplinesSpec,
): CovenantRegistration[] {
  // One enrichment per input, shared by every declaration: the pre-state reader is opened
  // once for a call however many entries judge it, and they all judge the same world.
  const shell: ShellSurface = {
    rootDir: spec.rootDir,
    shellTools: spec.shellTools,
    commandArgs: spec.commandArgs,
    readPreState: spec.readPreState,
  };
  const enrichedOf = new WeakMap<CovenantInput, CovenantInput>();
  const enrich = (input: CovenantInput): CovenantInput => {
    const cached = enrichedOf.get(input);
    if (cached !== undefined) return cached;
    const enriched = enrichWithShellEvidence(input, shell);
    enrichedOf.set(input, enriched);
    return enriched;
  };

  const judged = spec.disciplines.map((entry): CovenantRegistration => {
    const witness = spec.witness !== undefined ? { witness: spec.witness } : {};

    // A silent skip is how a discipline goes inert while its verdict still reads passed.
    const nameFault = (reason: string): void => {
      process.stderr.write(`discipline '${entry.id}': ${reason} — skipped, not judged\n`);
    };

    return declareRegistration(entry, spec, witness, nameFault, enrich);
  });

  const skipArms = spec.disciplines
    .filter((entry) => hasShellSkipArm(entry, spec))
    .map((entry) => shellSkipArm(entry, spec));
  return [...judged, ...skipArms, shellUnjudgeableRegistration(spec)];
}
