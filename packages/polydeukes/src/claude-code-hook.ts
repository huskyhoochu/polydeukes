/**
 * `runClaudeCodeHook` — the assembled session-surface judgment runner.
 *
 * The session counterpart of {@link runCovenantCheck}, and the one place where the Claude
 * Code adapter (tool vocabulary, up-translation) and the covenant package (dispatcher +
 * judge bodies) meet. Packages stay one-way — each depends only on core — so their
 * composition lives here, in the umbrella, and the repository's PreToolUse hook shrinks to
 * a delegator that calls this function. That is what makes the session surface installable:
 * a consumer registers a hook that resolves this package instead of copying assembly.
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
 * fail-closed: ANY failure — an unbuilt judge body, an unreadable stdin, a missing or
 * invalid config file — resolves to `{ exitCode: 2 }` with one `blocked` record under the
 * `hook` label. Nothing throws: an uncaught rejection would exit the delegator non-blocking,
 * the cheapest bypass vector there is. Recovery from an unbuilt clone is `pnpm build` (it
 * mentions no protected path, so it is never blocked).
 */

import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  COMMAND_ARGS,
  evaluatePrecedent,
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
  readRecords,
} from '@polydeukes/core';
import {
  type CovenantRegistration,
  findUnattributed,
  readBaseline,
  snapshotBaseline,
  ttlWitness,
  writeBaseline,
} from '@polydeukes/covenant';
import { type CovenantModule, loadCovenantModule, resolveCovenantDist } from './covenant-module.js';
import { loadConfig } from './load-config.js';

/** `runClaudeCodeHook` input — the `CovenantCheckSpec` shape, session side. */
export type ClaudeCodeHookSpec = {
  /** Repository root — config discovery and discipline glob scoping both anchor here. */
  repoRoot: string;
  /** One raw PreToolUse payload. ABSENT means read fd 0 (the hook's real stdin). */
  rawPayload?: string;
  /** Overrides the config's telemetry log path (tests and assembly injection). */
  telemetryPath?: string;
  /** Overrides the resolved covenant dist directory (tests and assembly injection). */
  covenantDist?: string;
};

/** The label every post-hoc state comparison row carries. */
const BASELINE_LABEL = 'baseline';

/**
 * Compare the protected entries' on-disk state against the stored baseline and record what
 * moved with no judgment explaining it.
 *
 * Runs at hook call START, before this call's own judgment rows land, so the window it reads
 * is the one the previous comparison left open. Returns the record count as of right now —
 * where the NEXT window opens, which {@link updateBaseline} persists at call end.
 *
 * The comparison records, it never blocks: no row it writes and no failure it hits changes
 * a verdict or an exit code, which is why every caller keeps it outside the judgment path.
 */
function compareBaseline(spec: {
  repoRoot: string;
  telemetryPath: string;
  entries: string[];
}): void {
  const baselinePath = join(spec.repoRoot, '.polydeukes', 'baseline.json');
  // Read before any row of this comparison lands, so the rows this call is about to write
  // cannot fall inside the window they would then explain away.
  const { records } = readRecords(spec.telemetryPath);
  const stored = readBaseline(baselinePath);

  if (stored === null) {
    // Absence and corruption are the same signal. The baseline file is NOT on the protection
    // list — protecting it would need a comparison of its own — so its disappearance has to
    // stay legible in the log instead.
    appendRecordFailOpen(spec.telemetryPath, {
      event: 'unattributed',
      label: BASELINE_LABEL,
      subject: baselinePath,
    });
    return;
  }

  const changed = findUnattributed({
    previous: stored.entries,
    current: snapshotBaseline({ rootDir: spec.repoRoot, entries: spec.entries }),
    records,
    // The cut travels with the hashes it belongs to, from the one read above. Rows older
    // than it were already spent explaining the state that snapshot recorded.
    cutAt: stored.cutAt,
  });

  // One row per changed entry — an aggregate row could not say WHICH gate definition moved.
  for (const entry of changed) {
    appendRecordFailOpen(spec.telemetryPath, {
      event: 'unattributed',
      label: BASELINE_LABEL,
      subject: entry,
    });
  }
}

/**
 * Re-establish the baseline at hook call END.
 *
 * At call end rather than right after the comparison: refreshing at comparison time would
 * miss whatever this call's own judged writes changed, leaving detection permanently one
 * call behind.
 *
 * The cut is stamped HERE, beside the snapshot, not at the comparison that opened the call.
 * Both describe the same instant — everything this call did is already folded into the
 * hashes — so the rows explaining it belong before the cut. Stamping the earlier instant
 * instead would re-admit this call's own judgment rows into the next window, where they
 * would attribute a change they had nothing to do with: a call that merely MENTIONED a
 * protected entry would then absolve any tamper that followed it.
 */
function updateBaseline(spec: { repoRoot: string; entries: string[] }): void {
  const dotDir = join(spec.repoRoot, '.polydeukes');
  mkdirSync(dotDir, { recursive: true });
  writeBaseline(
    join(dotDir, 'baseline.json'),
    snapshotBaseline({ rootDir: spec.repoRoot, entries: spec.entries }),
    new Date().toISOString(),
  );
}

/**
 * Where the comparison writes and what it observes, or `undefined`.
 *
 * The domain is derived from config rather than enumerated here, and the telemetry path is
 * resolved by the same precedence the judgment uses so both land in one log. A config that
 * does not load leaves NO domain, so there is nothing to compare and nothing to re-establish
 * — the judgment path already answers that failure fail-closed, and a comparison row on top
 * of it would report the same absence twice under a label that judges nothing.
 */
function comparisonSpec(
  spec: ClaudeCodeHookSpec,
): { repoRoot: string; telemetryPath: string; entries: string[] } | undefined {
  let config: ReturnType<typeof loadConfig>['config'];
  try {
    config = loadConfig(spec.repoRoot).config;
  } catch {
    return undefined;
  }

  return {
    repoRoot: spec.repoRoot,
    telemetryPath:
      spec.telemetryPath ??
      process.env.POLYDEUKES_TELEMETRY_PATH ??
      resolve(spec.repoRoot, config.telemetry.logPath),
    entries: normalizeProtectedPaths({ protectedPaths: config.protectedPaths }),
  };
}

/** {@link assembleSessionRegistrations} input — what the session surface's assembly needs. */
export type SessionAssemblySpec = {
  config: ReturnType<typeof loadConfig>['config'];
  rootDir: string;
  /**
   * The covenant surface the registrations are built from — the module the caller loaded
   * from the resolved dist, so what judges a call is what that dist carries, and what
   * `explain` renders is what would judge it.
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
  // The live transcript is the evidence channel the context family reads AND the one the
  // witness reads, so erasing or forging it disables every context discipline while opening
  // or shutting the human valve on the same file. It must NOT join this list: it lives deep
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
    // the valve and the context family already forfeited on the same absence.
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
      witness,
      // Context-family evidence is evaluated here, at assembly: a spawned body cannot hold
      // a transcript, and passing a path would leak JSONL knowledge into covenant. The
      // adapter brings the evaluator for its own `subagent`/`tool` vocabulary; core owns
      // `command`, which the compiler judges directly.
      transcript,
      evaluatePrecedent,
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
async function judgeHookCall(spec: ClaudeCodeHookSpec): Promise<{ exitCode: 0 | 2 }> {
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
    const { config } = loadConfig(spec.repoRoot);
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
    const transcriptPath = transcriptPathFromPayload(rawPayload);
    const transcript =
      transcriptPath === undefined ? undefined : transcriptFromJsonlFile(transcriptPath);

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

    // The judges are the covenant package's built barrel — resolved through the real
    // package (never a test alias), so the session surface runs the same judges the commit
    // surface does. An injected directory overrides that resolution, which is how a fixture
    // reaches a dist that real Node resolution would never land on. Awaited HERE, before
    // any registration is composed: a dist the barrel cannot load throws now, into the
    // fail-closed catch, instead of leaving a half-judged table behind.
    const covenantDist = spec.covenantDist ?? resolveCovenantDist();
    const covenant = await loadCovenantModule(covenantDist);

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
export async function runClaudeCodeHook(spec: ClaudeCodeHookSpec): Promise<{ exitCode: 0 | 2 }> {
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
