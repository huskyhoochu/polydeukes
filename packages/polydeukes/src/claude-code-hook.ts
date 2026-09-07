/**
 * `runClaudeCodeHook` — the assembled session-surface judgment runner.
 *
 * The session counterpart of {@link runCovenantCheck}, and the one place where the Claude
 * Code adapter (tool vocabulary, up-translation) and the judge module (dispatcher + judge
 * bodies) meet. The adapter depends only on core, so their composition lives here, in the
 * umbrella, and the repository's PreToolUse hook shrinks to a delegator that calls this
 * function. That is what makes the session surface installable: a consumer registers a hook
 * that resolves this package instead of copying assembly.
 *
 * The protection-policy data (protectedPaths / disciplines / witness) is read from the root
 * data config through {@link loadConfig}, which also attaches the config file to its own
 * surface.
 *
 * The valve is the TTL witness, judged over the JSONL transcript provider. The judge body
 * always spawns, and only an outcome that translated to blocked consults the witness —
 * `witnessed` rows are would-block only. Its defence is provenance rather than secrecy: only
 * a real human utterance carries the transcript marking `findUserMessages()` admits.
 *
 * fail-closed: ANY failure — an unreadable stdin, a missing or invalid config file — resolves
 * to `{ exitCode: 2 }` with one `blocked` record under the `hook` label. Nothing throws: an
 * uncaught rejection would exit the delegator non-blocking, the cheapest bypass vector there
 * is. Recovery from an unbuilt clone is `pnpm build` (it mentions no protected path, so it is
 * never blocked).
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  COMMAND_ARGS,
  MUTATING_TOOLS,
  runAdapterPath,
  SHELL_TOOLS,
  sessionChannelReader,
  sessionSourceReader,
  transcriptFromJsonlFile,
  transcriptPathFromPayload,
} from '@polydeukes/adapter-claude-code';
import {
  appendRecordFailOpen,
  type CanonicalTranscript,
  DEFAULT_TELEMETRY_LOG_PATH,
  isPlainObject,
  normalizeProtectedPaths,
} from '@polydeukes/core';
import { compareBaseline, comparisonSpec, updateBaseline } from './baseline.ts';
import type { CovenantRegistration } from './covenant/dispatch.ts';
import { type CovenantModule, covenantModule } from './covenant/module.ts';
import { ttlWitness } from './covenant/ttl-witness.ts';
import { loadConfig } from './load-config.ts';
import { sessionPreStateReader } from './pre-state-reader.ts';

/** {@link runClaudeCodeHook} result — the exit code the hook process leaves with. */
export type ClaudeCodeHookOutcome = { exitCode: 0 | 2 };

/** `runClaudeCodeHook` input — the `CovenantCheckSpec` shape, session side. */
export type ClaudeCodeHookSpec = {
  /** Repository root — config discovery and discipline glob scoping both anchor here. */
  repoRoot: string;
  /** One raw PreToolUse payload. ABSENT means read fd 0 (the hook's real stdin). */
  rawPayload?: string;
  /** Overrides the config's telemetry log path (tests and assembly injection). */
  telemetryPath?: string;
  /** Overrides the judge module the run assembles against (tests and assembly injection). */
  covenant?: CovenantModule;
};

/** {@link assembleSessionRegistrations} input — what the session surface's assembly needs. */
export type SessionAssemblySpec = {
  config: ReturnType<typeof loadConfig>['config'];
  rootDir: string;
  /**
   * The judge module the registrations are built from, so what judges a call and what
   * `explain` renders come from one surface.
   */
  covenant: CovenantModule;
  /** The payload's transcript path. ABSENT leaves the transcript-mod registration out. */
  transcriptPath?: string;
  transcript?: CanonicalTranscript;
  witness?: CovenantRegistration['witness'];
};

/**
 * The session surface's registration set. One assembly, two consumers: the runner below
 * dispatches it, `explain` renders it — so what a reader is shown is the table the judgment
 * actually uses, never a second opinion about it.
 */
export function assembleSessionRegistrations(spec: SessionAssemblySpec): CovenantRegistration[] {
  const { config, rootDir, covenant, transcriptPath, transcript, witness } = spec;
  // The live transcript is the session a history declaration reads AND the one the witness
  // reads, so erasing or forging it disables every history discipline while opening or
  // shutting the human valve on the same file. It must NOT join this list: it lives deep
  // under HOME, and a path entry makes every ancestor protected — which measured as an
  // over-block refusing `cd /home/<user>`, `echo $HOME`, and every edit whose content
  // carried a bare `~`. The dedicated `transcript-mod` registration below covers that one
  // file instead: equality-only, never an ancestor. Ancestor destruction outside the
  // repository is out of observation scope — the agent's own deny policy owns what no
  // repo-scoped judge can reach.
  const protectedPaths = normalizeProtectedPaths({
    protectedPaths: config.protectedPaths ?? [],
  });

  const disciplines = config.disciplines ?? [];

  const registrations: CovenantRegistration[] = [
    covenant.selfModRegistration({
      protectedPaths,
      mutatingToolNames: MUTATING_TOOLS,
      witness,
    }),
    covenant.shellModRegistration({
      protectedPaths,
      shellTools: SHELL_TOOLS,
      commandArgs: COMMAND_ARGS,
      witness,
    }),
    // Routing is the matches predicate, never path mention, so the home directory cannot
    // become a protected ancestor. No transcript in the payload means nothing to protect —
    // the valve and every history declaration already forfeited on the same absence.
    ...(transcriptPath === undefined
      ? []
      : [
          covenant.transcriptModRegistration({
            transcriptPath,
            // The env value first, since that is what the judged shell expands `~` and
            // `$HOME` from. `homedir()` reads the same passwd entry bash falls back to when
            // HOME is unset, so a hook spawned without an environment (a service manager,
            // `env -i`) keeps judging the home spellings instead of silently going
            // absolute-only — an inert spelling closure looks identical to a passing call.
            home: process.env.HOME ?? homedir(),
            shellTools: SHELL_TOOLS,
            commandArgs: COMMAND_ARGS,
            mutatingTools: MUTATING_TOOLS,
            witness,
          }),
        ]),
    ...covenant.compileDisciplineRegistrations({
      disciplines,
      rootDir,
      shellTools: SHELL_TOOLS,
      commandArgs: COMMAND_ARGS,
      readPreState: sessionPreStateReader,
      // One PreToolUse call is the whole observation, so the derived change set is a
      // singleton and a change-set declaration cannot be judged here — it records `skipped`,
      // the shape the commit surface gives a history declaration.
      observesChangeSet: false,
      witness,
      // The session itself, injected rather than its path: a declaration reading a
      // `transcript` binding sees it flattened, and passing a path would leak JSONL
      // knowledge into covenant.
      transcript,
    }),
  ];

  return registrations;
}

/**
 * This runtime's mutating+shell roster, rewritten onto the Claude vocabulary the adapter
 * already judges. Claude names are not keys, so an existing Write/Edit/Bash envelope
 * passes through. A name outside the table is left alone — that is a declared limit,
 * recorded as the adapter's funnel pass, never a parse fault. The map lives here, not in
 * the adapter, so the adapter stays Claude-vocabulary-only.
 */
const GROK_TOOL_NAME_MAP: Record<string, string> = {
  write: 'Write',
  search_replace: 'Edit',
  run_terminal_command: 'Bash',
};

/**
 * Rewrite Grok tool names in a raw PreToolUse payload. Invalid JSON is left as the original
 * string so the existing fail-closed path still runs — this function must not throw.
 */
function rewriteGrokToolNames(rawPayload: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPayload);
  } catch {
    return rawPayload;
  }
  if (!isPlainObject(parsed)) return rawPayload;

  for (const key of ['tool_name', 'toolName']) {
    const value = parsed[key];
    if (typeof value !== 'string') continue;
    const mapped = GROK_TOOL_NAME_MAP[value];
    if (mapped !== undefined) parsed[key] = mapped;
  }
  return JSON.stringify(parsed);
}

/**
 * Judge one declared tool call before it runs. Async because the dispatcher spawns covenant
 * bodies — a synchronous runner would mean reimplementing the judge, which the
 * single-dispatcher principle forbids.
 */
async function judgeHookCall(spec: ClaudeCodeHookSpec): Promise<ClaudeCodeHookOutcome> {
  // Env-first telemetry precedence, settled BEFORE any failure branch: a config that never
  // loads still has somewhere to write its one blocked row. The config value applies after
  // the load succeeds.
  //
  // Computed INSIDE the try even though it must run first, because `join` throws on a
  // non-string repoRoot and this function's contract is that nothing escapes it — a rejection
  // would exit a delegator non-blocking, which is the cheapest bypass there is. A throw here
  // leaves `telemetryPath` undefined, which the catch tolerates: there is no root to write a
  // row under anyway.
  let telemetryPath: string | undefined;
  try {
    const envTelemetryPath = process.env.POLYDEUKES_TELEMETRY_PATH;
    telemetryPath =
      spec.telemetryPath ?? envTelemetryPath ?? join(spec.repoRoot, DEFAULT_TELEMETRY_LOG_PATH);

    // Discovery + parse + validation are the loader's job; a throw here (absent, ambiguous,
    // unparseable, or invalid config) falls into the fail-closed catch.
    const { config } = loadConfig({ rootDir: spec.repoRoot });
    telemetryPath =
      spec.telemetryPath ?? envTelemetryPath ?? resolve(spec.repoRoot, config.telemetry.logPath);
    // Settled for the rest of the happy path. The `let` above exists so the catch can still
    // record when a failure lands before this point; a closure cannot narrow it, so the
    // dispatch seam below takes this const instead.
    const logPath = telemetryPath;

    const rawPayload = rewriteGrokToolNames(spec.rawPayload ?? readFileSync(0, 'utf-8'));

    // The transcript path travels in the raw payload only — up-translation drops it, so the
    // adapter reads it from the string. Every failure narrows to `undefined`, which leaves
    // the dispatcher on its `noopTranscript` default: lost evidence closes the valve rather
    // than opening it.
    const transcriptPath = transcriptPathFromPayload({ rawPayload });
    const transcript =
      transcriptPath === undefined ? undefined : transcriptFromJsonlFile({ path: transcriptPath });

    // One witness predicate shared by every registration: a witness is a session-wide
    // permission the human granted, not a per-covenant one. Absent `witness` config leaves
    // this undefined, and no verdict can be witnessed open at all. The predicate receives
    // the transcript as its second argument from the dispatcher, which is why the transcript
    // is injected below rather than captured here.
    const witness =
      config.witness === undefined
        ? undefined
        : ttlWitness({
            token: config.witness.token,
            // Minutes are the human-facing unit in config; the predicate takes milliseconds.
            // Core passes the value through verbatim, so the conversion belongs to assembly.
            ttlMs: config.witness.ttlMinutes * 60_000,
          });

    // The umbrella's own judge module, so the session surface runs the judges the commit
    // surface does; a test injects a module with one member replaced.
    const covenant = spec.covenant ?? covenantModule;

    // Assembled HERE, outside the dispatch seam: a judge takes its call set as an argument,
    // so assembly needs no payload, and an assembly throw belongs to this function's own
    // fail-closed catch — `hook` label, `covenant hook failed closed:` on stderr. Composed
    // inside the dispatch closure it would land in `runAdapterPath`'s catch instead, which
    // records the adapter's label and says nothing about what broke.
    const registrations = assembleSessionRegistrations({
      config,
      rootDir: spec.repoRoot,
      covenant,
      transcriptPath,
      transcript,
      witness,
    });

    // The world axis: files read from disk under the repository root, channels read beside
    // the session's transcript. The disk is the pre-edit state on this surface; the rule
    // that the judged change's own `post` overrides it belongs to the judge, so the root
    // supplies what it read and nothing more. No `changes` list either — one PreToolUse call
    // is the whole observation, and the judge derives that set from the input.
    const { files, channels } = covenant.supplySources({
      plan: covenant.planSources({ registrations }),
      read: sessionSourceReader({ repoRoot: spec.repoRoot }),
      readChannel: sessionChannelReader({ transcriptPath }),
    });

    return await runAdapterPath({
      rawPayload,
      telemetryPath: logPath,
      dispatch: (stdinPayload) =>
        covenant.dispatchCovenants({
          stdinPayload,
          registrations,
          telemetryPath: logPath,
          transcript,
          world: { files, channels },
        }),
    });
  } catch (error) {
    process.stderr.write(
      `covenant hook failed closed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    // Honor the one-call-one-record invariant with a blocked record under the assembly's own
    // label — never a judge's, since no judge answered. `undefined` means the failure landed
    // before a path could even be composed (a non-string repoRoot), where there is nowhere
    // to write and nothing to attribute the row to.
    if (telemetryPath !== undefined) {
      appendRecordFailOpen(telemetryPath, { event: 'blocked', label: 'hook', subject: '-' });
    }
    return { exitCode: 2 };
  }
}

/**
 * The session-surface entry point: the post-hoc state comparison wrapped around the judgment.
 *
 * The comparison sits OUTSIDE {@link judgeHookCall}'s fail-closed try on both ends. Inside
 * it, a comparison failure would become a blocked call — the opposite of a mechanism whose
 * whole purpose is to record rather than stop — so each side carries its own catch and
 * neither can reach the verdict. Observation is fail-open, the direction
 * `appendRecordFailOpen` already established: the worst outcome is a missing datum.
 *
 * Order is the contract. The comparison runs first, so it reads the window the previous call
 * left and its rows land ahead of this call's judgment; the re-establishment runs last, so
 * this call's own judged writes are folded in rather than alarmed on next time.
 */
export async function runClaudeCodeHook(spec: ClaudeCodeHookSpec): Promise<ClaudeCodeHookOutcome> {
  let comparison: ReturnType<typeof comparisonSpec>;
  try {
    comparison = comparisonSpec(spec);
    if (comparison !== undefined) {
      compareBaseline(comparison);
    }
  } catch {
    // fail-open: a comparison that could not run leaves the judgment exactly as it was.
  }

  const result = await judgeHookCall(spec);

  try {
    if (comparison !== undefined) {
      updateBaseline(comparison);
    }
  } catch {
    // fail-open: an unwritable baseline costs the next call's detection, never this verdict.
  }

  return result;
}
