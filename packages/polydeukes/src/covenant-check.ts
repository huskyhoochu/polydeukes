/**
 * `pdks covenant check` — the composition root both surfaces' callers reach through the bin.
 *
 * The judged unit is the input IR the caller hands in; this root opens no repository. Assembly
 * mirrors the session hook — loadConfig → normalizeProtectedPaths → dispatchCovenants — and
 * runs the same judge bodies, so a change receives the verdict a session tool call would.
 * Each toolCall is dispatched as its own input so telemetry stays one row per file.
 *
 * fail-closed: a missing config, an input that could not be produced, or an input carrying its
 * own `world` exits 2 with one blocked record. An input with no toolCalls is an explicit pass
 * with no records.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  appendRecordFailOpen,
  type CanonicalTranscript,
  type CovenantInput,
  DEFAULT_TELEMETRY_LOG_PATH,
  isPlainObject,
  normalizeProtectedPaths,
  transcriptFromSession,
} from '@polydeukes/core';
import { compareBaseline, updateBaseline } from './baseline.ts';
import { relativizeForScope } from './covenant/discipline.ts';
import type { CovenantRegistration } from './covenant/dispatch.ts';
import { type CovenantModule, covenantModule } from './covenant/module.ts';
import { ttlWitness } from './covenant/ttl-witness.ts';
import { STAGED_DELETE, STAGED_WRITE } from './diff-ir.ts';
import { discoverConfigPath, type LoadedConfig, parseConfigSource } from './load-config.ts';
import { sessionPreStateReader, unobservedPreStateReader } from './pre-state-reader.ts';
import { worktreeReader } from './worktree-reader.ts';

/** {@link runCovenantCheck} result — the exit code the check process leaves with. */
export type CovenantCheckOutcome = { exitCode: 0 | 2 };

/**
 * `CovenantSurface` — which observation unit the input is, and so which discipline list
 * stands beside the shared one.
 *
 * `session` is one call the host observed before it ran; `changeSet` is a finished change
 * set. The caller's input mode is the whole answer — the IR's own keys never choose.
 */
export type CovenantSurface = 'session' | 'changeSet';

/** `runCovenantCheck` input. */
export type CovenantCheckSpec = {
  /** Repository root — config discovery and the world axis's disk reads both anchor here. */
  repoRoot: string;
  /**
   * The observation to judge, or a thunk that produces it. A thunk that throws fails the
   * run closed after the config settles, so a caller translating an input of its own leaves
   * the same one blocked row a missing config would.
   */
  input: CovenantInput | (() => CovenantInput);
  /** Which surface this input is an observation of — the caller's input mode says so. */
  surface: CovenantSurface;
  /**
   * Overrides where telemetry is written (tests and assembly injection) — the first term
   * of the precedence, ahead of the config's `telemetry.logPath` and of the default this
   * runner settles before the config loads. Absent, both of those apply in that order.
   */
  telemetryPath?: string;
  /** Overrides the judge module the run assembles against (tests and assembly injection). */
  covenant?: CovenantModule;
  /**
   * The observer's posture for the whole run. ABSENT means `advise`: every break, a
   * protected path included, lands as a row and exit 0 — the change-set surface's default, since
   * a staged gate-file change has already passed the session surface or was made by a human,
   * and this surface has no valve a human could answer. `block` is the caller's opt-in
   * (`--enforce block` on the bin); an entry's own level composes lenient-wins as always.
   */
  enforce?: 'advise' | 'block';
};

/**
 * One blocked record for a run that failed closed before any dispatch could judge.
 * `appendRecordFailOpen` creates the missing `.polydeukes/` of a never-judged repository,
 * and a telemetry failure never softens the exit. An undefined path (non-string
 * `repoRoot`) leaves no root to write under.
 */
function recordFailClosed(telemetryPath: string | undefined): void {
  if (telemetryPath === undefined) return;
  appendRecordFailOpen(telemetryPath, {
    event: 'blocked',
    label: 'covenant-check',
    subject: '-',
  });
}

/** {@link assembleCheckRegistrations} input — what this runner's assembly needs. */
export type CheckAssemblySpec = {
  config: LoadedConfig['config'];
  rootDir: string;
  /**
   * The judge module the registrations are built from, so what judges a change and what
   * `explain` renders come from one surface.
   */
  covenant: CovenantModule;
  /**
   * Which surface these registrations judge for: `disciplines` plus `sessionDisciplines`
   * on `session`, `disciplines` plus `changeSetDisciplines` on `changeSet`.
   */
  surface: CovenantSurface;
  /** The host's tool roster. ABSENT leaves the staged names as the mutating roster. */
  tools?: CovenantInput['tools'];
  /** The host's session evidence. ABSENT is the absence of a session. */
  session?: CovenantInput['session'];
  /** The session flattened for a `transcript` binding — the runner derives it once from `session`. */
  transcript?: CanonicalTranscript;
  witness?: CovenantRegistration['witness'];
};

/**
 * This runner's registration set — one assembly that the runner dispatches and `explain`
 * renders.
 *
 * The surface picks the discipline lists; the two IR keys shape the meta-covenants and
 * nothing else — the roster says which names route to which meta-covenant, and the session
 * says whether there is history to protect, to bind, and to read pre-state from disk for.
 */
export function assembleCheckRegistrations(spec: CheckAssemblySpec): CovenantRegistration[] {
  const { config, rootDir, covenant, surface, tools, session, transcript, witness } = spec;
  const protectedPaths = normalizeProtectedPaths({ protectedPaths: config.protectedPaths ?? [] });
  // The shared list first, so both surfaces read the same prefix in the rows and in
  // `pdks explain`.
  const surfaceDisciplines =
    surface === 'session' ? config.sessionDisciplines : config.changeSetDisciplines;
  const disciplines = [...(config.disciplines ?? []), ...(surfaceDisciplines ?? [])];
  const shellTools = tools?.shell ?? [];
  const commandArgs = tools?.commandArgs ?? [];
  const evidencePath = session?.evidencePath;

  // An EMPTY roster is a host that declared it has no mutating tool, so only an ABSENT
  // `tools` falls back to the staged names — a length check would route names no host call
  // carries. The declared emptiness leaves no tool axis to register, the same way an empty
  // shell roster leaves no shell axis.
  const mutatingToolNames = tools?.mutating ?? [STAGED_WRITE, STAGED_DELETE];

  const registrations: CovenantRegistration[] = [
    ...(mutatingToolNames.length === 0
      ? []
      : [covenant.selfModRegistration({ protectedPaths, mutatingToolNames, witness })]),
    // No shell tool is no shell axis, not a shell axis over nothing: registering it with an
    // empty roster would judge a command line the host said it has no tool for.
    ...(shellTools.length === 0
      ? []
      : [covenant.shellModRegistration({ protectedPaths, shellTools, commandArgs, witness })]),
    // The evidence file is what the witness and every history declaration read, so a call
    // rewriting it could forge its own permission. Nothing to protect where the host named
    // no evidence path.
    ...(evidencePath === undefined
      ? []
      : [
          covenant.transcriptModRegistration({
            transcriptPath: evidencePath,
            // The env value first, since that is what the judged shell expands `~` and
            // `$HOME` from; `homedir()` reads the same passwd entry bash falls back to when
            // HOME is unset.
            home: process.env.HOME ?? homedir(),
            shellTools,
            commandArgs,
            mutatingTools: mutatingToolNames,
            witness,
          }),
        ]),
    ...covenant.compileDisciplineRegistrations({
      disciplines,
      rootDir,
      shellTools,
      commandArgs,
      // A session call is judged before its tool runs, so the working tree IS the pre-state;
      // without one the input carries the pre its own observation saw.
      readPreState: session === undefined ? unobservedPreStateReader : sessionPreStateReader,
      // That reader answers nothing, so the surface has no pre-state channel to complete a
      // shell write's evidence with. Saying so keeps the absence an environment fact: a
      // reader that answers `undefined` per location means that location failed, which
      // blocks, and a shell call would then decide entries that never read its evidence.
      observesPreState: session !== undefined,
      // A diff-translated change carries the hunk's added lines as `post`, never the whole
      // file, so a `file` binding on a staged path reads the tree — the state the change
      // set left. A session call's `post` is the whole text it is about to write.
      postIsWholeFile: surface === 'session',
      witness,
      // The session itself, injected rather than its path: a declaration reading a
      // `transcript` binding sees it flattened, and its absence is the absence of a session.
      transcript,
    }),
  ];

  return registrations;
}

/**
 * The name `explain` renders the change-set surface from — the same assembly, called with
 * `surface: 'changeSet'` and neither IR key.
 */
export const assembleChangeSetRegistrations = assembleCheckRegistrations;

/** The message a thrown value carries, for a stderr line. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * One stage's failure disposition: the stderr line, the recorded row, and exit 2. `suffix`
 * is appended to the message, for a caller that can name the one call which would clear the
 * failure.
 */
function failClosed(
  telemetryPath: string | undefined,
  error: unknown,
  suffix?: string,
): { exitCode: 2 } {
  process.stderr.write(`covenant check failed closed: ${messageOf(error)}${suffix ?? ''}\n`);
  recordFailClosed(telemetryPath);
  return { exitCode: 2 };
}

/** The observation, from the caller's value or from the thunk that produces it. */
function readInput(spec: CovenantCheckSpec): CovenantInput {
  return typeof spec.input === 'function' ? spec.input() : spec.input;
}

/**
 * Settle the telemetry path and load the config once, or fail closed. The provisional
 * path is settled before the load so a config that never loads still has somewhere to
 * write its blocked row; both terms use `resolve` so a relative `repoRoot` cannot send
 * them to different files. The provisional term sits inside the try because `resolve`
 * throws on a non-string `repoRoot`.
 *
 * The load runs as its three steps rather than through `loadConfig`, so a failure carries
 * how far it got: which file was discovered, and the bytes that file held.
 */
function settleConfig(spec: CovenantCheckSpec):
  | { settled: true; telemetryPath: string; config: LoadedConfig['config'] }
  | {
      settled: false;
      telemetryPath: string | undefined;
      error: unknown;
      /** The one discovered file, when discovery succeeded and the failure was its load. */
      configPath?: string;
      /** The text that file held, when it was read and the failure was its parse. */
      source?: string;
    } {
  let telemetryPath: string | undefined;
  let configPath: string | undefined;
  let source: string | undefined;
  try {
    // The environment variable sits between the caller's path and the config's, matching
    // what the baseline comparison in this same process already resolves — the two write
    // to one log, so they must agree on which one. It is how a test run collects its own
    // rows without editing the config it is measuring.
    const envPath = process.env.POLYDEUKES_TELEMETRY_PATH;
    telemetryPath =
      spec.telemetryPath ?? envPath ?? resolve(spec.repoRoot, DEFAULT_TELEMETRY_LOG_PATH);
    configPath = discoverConfigPath({ rootDir: spec.repoRoot });
    source = readFileSync(join(spec.repoRoot, configPath), 'utf-8');
    const { config } = parseConfigSource({ source, configPath });
    telemetryPath =
      spec.telemetryPath ?? envPath ?? resolve(spec.repoRoot, config.telemetry.logPath);
    return { settled: true, telemetryPath, config };
  } catch (error) {
    return {
      settled: false,
      telemetryPath,
      error,
      ...(configPath === undefined ? {} : { configPath }),
      ...(source === undefined ? {} : { source }),
    };
  }
}

/**
 * The observation's change set: the paths of the input's toolCalls that carry file-change
 * evidence, in input order.
 *
 * The same definition the judge derives its own set from, so both surfaces name the same
 * changes. A deletion carries evidence and stays; a binary blob, which arrives as a call
 * with no evidence, produces no world of its own — listing it would hand the change-set
 * relations a path no world can ever answer for.
 */
function changedPaths(input: CovenantInput): string[] {
  const paths: string[] = [];
  for (const call of input.toolCalls) {
    if (call.fileChange !== undefined) paths.push(call.fileChange.path);
  }
  return paths;
}

/**
 * Assemble the registrations and dispatch every toolCall. Any throw here (a
 * registration-build failure) is unjudgeable: block and leave one record.
 */
async function judgeInput(
  spec: CovenantCheckSpec,
  telemetryPath: string,
  config: LoadedConfig['config'],
  input: CovenantInput,
): Promise<CovenantCheckOutcome> {
  try {
    // The umbrella's own judge module, so this runner runs the judges the session
    // hook does; a test injects a module with one member replaced.
    const covenant = spec.covenant ?? covenantModule;

    let blocked = false;
    let advisedCount = 0;
    const { tools, session } = input;
    // One witness predicate shared by every registration: a witness is a session-wide
    // permission the human granted, not a per-covenant one. It exists only where a session
    // does — the valve reads human utterances, and an input with no session has none to
    // read — so a session-free input assembles exactly the registrations it did before.
    const witness =
      config.witness === undefined || session === undefined
        ? undefined
        : ttlWitness({
            token: config.witness.token,
            // Minutes are the human-facing unit in config; the predicate takes milliseconds.
            ttlMs: config.witness.ttlMinutes * 60_000,
          });
    const transcript = session === undefined ? undefined : transcriptFromSession(session);
    // Assembled ONCE for the run, not per call: a judge takes its call set as an argument,
    // so the table is payload-free. Recompiling per file would repeat every compile-time
    // side effect — the stderr line a config-faulted discipline names itself with would
    // print once per staged file rather than once.
    const registrations = assembleCheckRegistrations({
      config,
      rootDir: spec.repoRoot,
      covenant,
      surface: spec.surface,
      tools,
      session,
      transcript,
      witness,
    });

    // One plan and one supply for the run: the per-call loop shares them, so the tree is
    // read once per named file rather than once per change. The change set carries the whole
    // observation because this surface dispatches one call at a time to keep telemetry at
    // one row per file — a set no judge could derive from the input it is handed.
    const { files } = covenant.supplySources({
      plan: covenant.planSources({ registrations }),
      read: worktreeReader({ repoRoot: spec.repoRoot }),
    });
    // The session's channels ride into the world here rather than through a reader: the
    // host already observed them, and this root opens no file the input did not name. An
    // input with no session carries no channels key at all — an absent channel is a
    // different fact from a channel that observed nothing.
    const channels = session?.channels;
    const world = {
      files,
      changes: changedPaths(input),
      ...(channels === undefined ? {} : { channels }),
    };

    for (const call of input.toolCalls) {
      const { exitCode, results } = await covenant.dispatchCovenants({
        stdinPayload: JSON.stringify({
          toolCalls: [call],
          subagentSpawns: input.subagentSpawns,
          userMessages: input.userMessages,
          // Neither the roster nor the session travels with the call: the roster is spent at
          // assembly (no judge body reads it), and the session is injected as the transcript,
          // because a dispatch's input is one judged unit rather than the session it happened in.
          ...(input.actor === undefined ? {} : { actor: input.actor }),
        }),
        registrations,
        telemetryPath,
        dispatcherLabel: 'covenant-check',
        enforce: spec.enforce ?? 'advise',
        transcript,
        world,
      });
      if (exitCode === 2) blocked = true;
      advisedCount += results.filter((result) => result.event === 'advised').length;
      // One call, one record: a call no registration routed leaves no row of its own, so
      // the runner writes the pass under its label — the session surface does the same.
      if (exitCode === 0 && results.length === 0) {
        const subject = call.args?.file_path;
        appendRecordFailOpen(telemetryPath, {
          event: 'passed',
          label: 'covenant-check',
          subject: typeof subject === 'string' ? subject : '-',
        });
      }
    }
    // Names no level: the commit's fate is read from the run.
    if (advisedCount > 0) {
      const outcome = blocked ? 'commit blocked by another verdict' : 'commit allowed';
      process.stderr.write(
        `covenant advisory: ${advisedCount} verdict(s) recorded as advised, ${outcome}\n`,
      );
    }
    return { exitCode: blocked ? 2 : 0 };
  } catch (error) {
    return failClosed(telemetryPath, error);
  }
}

/**
 * Reject an input whose roster or session evidence this runner cannot judge.
 *
 * A shape it cannot read is a block, never a default: folding a missing collection into
 * `[]` or a bare string into a one-element list would judge an input nobody wrote. A key
 * whose value is `undefined` reads as absent — a JSON round-trip drops it, so only an
 * in-process caller can even write that shape.
 */
function assertJudgeableShape(input: CovenantInput): void {
  const { tools, session } = input;
  if (tools !== undefined) {
    if (!isPlainObject(tools)) throw new Error('input carries a tools key that is not an object');
    for (const key of ['mutating', 'shell', 'commandArgs'] as const) {
      const names = tools[key];
      if (!Array.isArray(names)) throw new Error(`input carries no tools.${key} array`);
      // A roster names tools; a non-string entry is a name no call could ever carry, and
      // routing on it would silently leave that slot of the roster unjudged.
      if (!names.every((name) => typeof name === 'string')) {
        throw new Error(`input carries a non-string name in tools.${key}`);
      }
    }
    // A shell tool with no argument key is a roster the shell judge cannot read: every
    // routed call would land unjudgeable, which no posture softens. Refuse the run instead.
    if (tools.shell.length > 0 && tools.commandArgs.length === 0) {
      throw new Error('input carries tools.shell without a tools.commandArgs key to read');
    }
  }
  if (session === undefined) return;
  if (!isPlainObject(session)) {
    throw new Error('input carries a session key that is not an object');
  }
  for (const key of ['userMessages', 'toolCalls'] as const) {
    if (!Array.isArray(session[key])) throw new Error(`input carries no session.${key} array`);
  }
  if (session.evidencePath !== undefined && typeof session.evidencePath !== 'string') {
    throw new Error('input carries a session.evidencePath that is not a string');
  }
  if (session.channels !== undefined && !isPlainObject(session.channels)) {
    throw new Error('input carries a session.channels that is not an object');
  }
  const sidecar = session.channels?.sidecar;
  if (sidecar !== undefined && typeof sidecar !== 'string') {
    throw new Error('input carries a session.channels.sidecar that is not text');
  }
}

/**
 * The disposition of a run whose config never loaded.
 *
 * While the one discovered file does not load there is no assembly to judge against, so the
 * session surface admits exactly one shape: a single tool call whose file-change evidence
 * modifies that file, starting from the bytes the loader read, and whose `post` is a text the
 * loader accepts. That call is judged — its result loads — and lands as one `advised` row
 * naming the config path, so the next call's baseline comparison reads the change as
 * explained. Everything else fails closed, and where a single file was discovered the line
 * says which call would repair it.
 *
 * This branch reads no posture: the session hook always spawns with `--enforce block`, so a
 * repair that blocked under that posture would never run anywhere.
 */
function settleLoadFailure(
  spec: CovenantCheckSpec,
  failure: {
    telemetryPath: string | undefined;
    error: unknown;
    configPath?: string;
    source?: string;
  },
): CovenantCheckOutcome {
  const { telemetryPath, error, configPath } = failure;
  if (configPath === undefined || spec.surface !== 'session') {
    return failClosed(telemetryPath, error);
  }

  let input: CovenantInput;
  try {
    input = readInput(spec);
  } catch (inputError) {
    return failClosed(telemetryPath, inputError);
  }

  const loaded = repairs(input, failure, spec.repoRoot);
  if (loaded !== null) {
    // The repaired config's own log path, under the precedence `settleConfig` uses, so the
    // next call's baseline comparison reads this row where it looks for it.
    const rowPath =
      spec.telemetryPath ??
      process.env.POLYDEUKES_TELEMETRY_PATH ??
      resolve(spec.repoRoot, loaded.config.telemetry.logPath);
    appendRecordFailOpen(rowPath, {
      event: 'advised',
      label: 'covenant-check',
      subject: configPath,
    });
    process.stderr.write(
      `covenant check: ${configPath} does not load (${messageOf(error)}) — this call rewrites it into one that does; advised, not judged\n`,
    );
    return { exitCode: 0 };
  }

  return failClosed(
    telemetryPath,
    error,
    ` — fix ${configPath} in one Edit or Write whose result loads; every other call stays blocked until it does`,
  );
}

/**
 * The loaded config a single call would leave behind, or null when this observation is not
 * that call: exactly one call carrying a plain object, its evidence a modification of the
 * discovered config file (relativized against the root, since a host names its paths
 * absolutely), starting from the bytes the loader read, and leaving a `post` the loader
 * accepts. Requiring the pre to be those bytes keeps a partial view of the file — one
 * notebook cell, or evidence a caller composed — out of the branch.
 */
function repairs(
  input: CovenantInput,
  failure: { configPath?: string; source?: string },
  repoRoot: string,
): LoadedConfig | null {
  const { configPath, source } = failure;
  if (configPath === undefined || source === undefined) return null;
  if (!Array.isArray(input.toolCalls) || input.toolCalls.length !== 1) return null;
  const call = input.toolCalls[0];
  if (!isPlainObject(call)) return null;
  const { fileChange } = call;
  if (fileChange === undefined || fileChange.kind !== 'modify') return null;
  if (relativizeForScope(fileChange.path, repoRoot) !== configPath) return null;
  if (fileChange.pre !== source) return null;
  const post = fileChange.post;
  if (typeof post !== 'string') return null;
  try {
    return parseConfigSource({ source: post, configPath });
  } catch {
    return null;
  }
}

/**
 * Judge one observation of `repoRoot` exactly as the session surface would, from the IR the
 * caller hands in. Async because the dispatcher spawns covenant bodies. An input with no
 * toolCalls is an explicit pass: nothing to judge, no records.
 *
 * An input carrying a session is one call of a live agent session, so the post-hoc state
 * comparison wraps the judgment: it runs first, reading the window the previous call left,
 * and the re-establishment runs last, folding this call's own judged writes in. Both sides
 * sit OUTSIDE the judgment with their own catch — a mechanism whose purpose is to record
 * rather than stop may never reach an exit code.
 */
export async function runCovenantCheck(spec: CovenantCheckSpec): Promise<CovenantCheckOutcome> {
  const settlement = settleConfig(spec);
  if (!settlement.settled) return settleLoadFailure(spec, settlement);
  const { telemetryPath, config } = settlement;

  let input: CovenantInput;
  try {
    input = readInput(spec);
    // The world axis is this root's to fill. An input that supplies its own would let a
    // caller choose the files the judge reads.
    if ('world' in input) {
      throw new Error('input carries a world key: the world axis is the runner’s');
    }
    if (!Array.isArray(input.toolCalls)) throw new Error('input carries no toolCalls array');
    assertJudgeableShape(input);
  } catch (error) {
    return failClosed(telemetryPath, error);
  }
  // The comparison reads and writes the log the judgment writes — the settled path, never
  // a second resolution — and observes the protected entries the settled config names.
  // A session call with nothing judgeable still compares and re-establishes: the window it
  // opens is what the next call reads, and a skipped call would leave it stale.
  let comparison: Parameters<typeof compareBaseline>[0] | undefined;
  if (input.session !== undefined) {
    try {
      comparison = {
        repoRoot: spec.repoRoot,
        telemetryPath,
        entries: normalizeProtectedPaths({ protectedPaths: config.protectedPaths }),
      };
      compareBaseline(comparison);
    } catch {
      // fail-open: a comparison that could not run leaves the judgment exactly as it was.
    }
  }

  const result =
    input.toolCalls.length === 0
      ? { exitCode: 0 as const }
      : await judgeInput(spec, telemetryPath, config, input);

  try {
    if (comparison !== undefined) updateBaseline(comparison);
  } catch {
    // fail-open: an unwritable baseline costs the next call's detection, never this verdict.
  }

  return result;
}
