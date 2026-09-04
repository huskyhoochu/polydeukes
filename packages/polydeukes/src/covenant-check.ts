/**
 * `pdks covenant check` — the commit surface's composition root.
 *
 * Assembly mirrors the session hook — loadConfig → normalizeProtectedPaths → collect →
 * dispatchCovenants — and spawns the same covenant dist bodies, so a change receives the
 * verdict a session tool call would. Each change is dispatched as its own input so
 * telemetry stays one row per file. The witness valve is a `/dev/tty` prompt that only
 * the staged domain assembles; the other domains open no commit.
 *
 * fail-closed: a missing config, an unbuilt body, or a collector failure exits 2 with one
 * blocked record. An empty domain is an explicit pass with no records.
 */

import { resolve } from 'node:path';
import {
  collectRangeChanges,
  collectStagedChanges,
  collectWorktreeChanges,
  covenantInputFromStagedChanges,
  type Observation,
  observationSourceReader,
  resolveGitAdapterSettings,
  STAGED_DELETE,
  STAGED_WRITE,
  type StagedChange,
} from '@polydeukes/adapter-git';
import {
  appendRecordFailOpen,
  DEFAULT_TELEMETRY_LOG_PATH,
  normalizeProtectedPaths,
} from '@polydeukes/core';
import type { CovenantRegistration } from '@polydeukes/covenant';
import { type CovenantModule, loadCovenantModule, resolveCovenantDist } from './covenant-module.js';
import { loadConfig } from './load-config.js';
import { unobservedPreStateReader } from './pre-state-reader.js';

/**
 * Which observation of the commit surface a run judges. Only the collector differs between
 * them; the IR, the assembly, and the dispatcher are one path.
 *
 * The adapter that owns the git grammar owns the type: its supply body reads a path the way
 * each observation sees the tree, and this root names the same fact for its callers.
 */
export type CheckDomain = Observation;

/** `runCovenantCheck` input. */
export type CovenantCheckSpec = {
  /** Repository root — config discovery and staged collection both anchor here. */
  repoRoot: string;
  /**
   * Overrides where telemetry is written (tests and assembly injection) — the first term
   * of the precedence, ahead of the config's `telemetry.logPath` and of the default this
   * runner settles before the config loads. Absent, both of those apply in that order.
   */
  telemetryPath?: string;
  /** Overrides the resolved covenant dist directory (tests and assembly injection). */
  covenantDist?: string;
  /**
   * TTY valve seam: writes the given prompt and returns the line a human typed, or null
   * for no input. ABSENT means a non-TTY environment — the valve never opens, which is
   * what keeps it human-only.
   */
  ttyPrompt?: (prompt: string) => string | null;
  /** Which observation to judge. ABSENT means `staged`. */
  domain?: CheckDomain;
};

/**
 * The TTY witness predicate, or undefined when no valve can exist (no witness configured
 * or no TTY seam). It fires on the first registration that broke, names it from the
 * dispatcher's context, and caches the answer: one commit, at most one prompt, full-token
 * equality. Both sides are trimmed like the session valve, since config validation accepts
 * a padded token. The cache latches closed before the seam is consulted so a throwing seam
 * never re-prompts.
 */
function ttyWitnessValve(
  witness: { token: string } | undefined,
  ttyPrompt: ((prompt: string) => string | null) | undefined,
): CovenantRegistration['witness'] | undefined {
  if (witness === undefined || ttyPrompt === undefined) return undefined;
  const token = witness.token.trim();
  let verdict: boolean | undefined;
  return (_input, _transcript, context) => {
    if (verdict === undefined) {
      const prompt =
        `covenant: '${context.label}' broke on the staged change matching '${context.subject}'.\n` +
        'answering opens the valve for the whole commit, not just this change.\n' +
        'type the agreed token in full to open it (enter to refuse): ';
      verdict = false;
      const answer = ttyPrompt(prompt);
      verdict = answer !== null && answer.trim() === token;
    }
    return verdict;
  };
}

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

/** {@link assembleCommitRegistrations} input — what the commit surface's assembly needs. */
export type CommitAssemblySpec = {
  config: ReturnType<typeof loadConfig>['config'];
  rootDir: string;
  /**
   * The covenant surface the registrations are built from — the module the caller loaded
   * from the resolved dist, so what judges a change is what that dist carries, and what
   * `explain` renders is what would judge it.
   */
  covenant: CovenantModule;
  witness?: CovenantRegistration['witness'];
};

/**
 * The commit surface's registration set — one assembly that the runner dispatches and
 * `explain` renders.
 */
export function assembleCommitRegistrations(spec: CommitAssemblySpec): CovenantRegistration[] {
  const { config, rootDir, covenant, witness } = spec;
  const { protectedPaths: gitAdditivePaths } = resolveGitAdapterSettings(config.adapters?.git);

  // Union of the common list and the git-additive one, common first so first-occurrence
  // dedupe is deterministic. The session hook reads the common list alone.
  const protectedPaths = normalizeProtectedPaths({
    protectedPaths: [...(config.protectedPaths ?? []), ...gitAdditivePaths],
  });

  const disciplines = config.disciplines ?? [];

  const registrations: CovenantRegistration[] = [
    covenant.selfModRegistration({
      protectedPaths,
      mutatingToolNames: [STAGED_WRITE, STAGED_DELETE],
      witness,
    }),
    // No shell axis here, so command-family entries are left out. Context-family entries
    // stay in: with no transcript the compiler gives them skip registrations, which record
    // `skipped` on a match.
    ...covenant.compileDisciplineRegistrations({
      disciplines: disciplines.filter((entry) => entry.forbidCommand === undefined),
      rootDir,
      shellTools: [],
      commandArgs: [],
      readPreState: unobservedPreStateReader,
      observesChangeSet: true,
      witness,
    }),
  ];

  return registrations;
}

/** One stage's failure disposition: the stderr line, the recorded row, and exit 2. */
function failClosed(telemetryPath: string | undefined, error: unknown): { exitCode: 2 } {
  process.stderr.write(
    `covenant check failed closed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  recordFailClosed(telemetryPath);
  return { exitCode: 2 };
}

/**
 * Settle the telemetry path and load the config once, or fail closed. The provisional
 * path is settled before the load so a config that never loads still has somewhere to
 * write its blocked row; both terms use `resolve` so a relative `repoRoot` cannot send
 * them to different files. The provisional term sits inside the try because `resolve`
 * throws on a non-string `repoRoot`.
 */
function settleConfig(
  spec: CovenantCheckSpec,
):
  | { settled: true; telemetryPath: string; config: ReturnType<typeof loadConfig>['config'] }
  | { settled: false; exitCode: 2 } {
  let telemetryPath: string | undefined;
  try {
    telemetryPath = spec.telemetryPath ?? resolve(spec.repoRoot, DEFAULT_TELEMETRY_LOG_PATH);
    const { config } = loadConfig(spec.repoRoot);
    telemetryPath = spec.telemetryPath ?? resolve(spec.repoRoot, config.telemetry.logPath);
    return { settled: true, telemetryPath, config };
  } catch (error) {
    return { settled: false, ...failClosed(telemetryPath, error) };
  }
}

/**
 * Collect the changes of one domain. The three collectors return the same shape, so
 * everything downstream of this dispatch is one path.
 */
function collectDomain(repoRoot: string, domain: CheckDomain): StagedChange[] {
  if (domain.kind === 'worktree') return collectWorktreeChanges(repoRoot);
  if (domain.kind === 'range') {
    const separator = domain.ancestry === 'merge-base' ? '...' : '..';
    return collectRangeChanges(repoRoot, `${domain.base}${separator}${domain.head}`);
  }
  return collectStagedChanges(repoRoot);
}

/**
 * The observation's change set: the paths of the collected changes that carry file-change
 * evidence, in collection order.
 *
 * The same definition the judge derives its own set from, so both surfaces name the same
 * changes. A deletion carries evidence and stays; a binary blob, which the collector gives
 * a call with no evidence, produces no world of its own — listing it would hand the
 * change-set relations a path no world can ever answer for.
 */
function changedPaths(changes: StagedChange[]): string[] {
  const paths: string[] = [];
  for (const call of covenantInputFromStagedChanges(changes).toolCalls) {
    if (call.fileChange !== undefined) paths.push(call.fileChange.path);
  }
  return paths;
}

/**
 * Assemble the registrations and dispatch every collected change. Any throw here (an
 * unbuilt dist, a registration-build failure) is unjudgeable: block and leave one record.
 */
async function judgeChanges(
  spec: CovenantCheckSpec,
  domain: CheckDomain,
  telemetryPath: string,
  config: ReturnType<typeof loadConfig>['config'],
  changes: StagedChange[],
): Promise<{ exitCode: 0 | 2 }> {
  try {
    // Inside the try so an invalid adapter namespace fails closed.
    const { enforce } = resolveGitAdapterSettings(config.adapters?.git);

    // Real Node resolution of the covenant package, so the commit surface runs the same
    // judges the session hook does; tests inject a directory instead. Awaited before any
    // registration is composed, so a dist the barrel cannot load fails the run closed here
    // rather than leaving a half-judged table behind.
    const covenantDist = spec.covenantDist ?? resolveCovenantDist();
    const covenant = await loadCovenantModule(covenantDist);
    // No valve under advise (nothing to witness) and none outside `staged`.
    const witness =
      enforce === 'advise' || domain.kind !== 'staged'
        ? undefined
        : ttyWitnessValve(config.witness, spec.ttyPrompt);

    let blocked = false;
    let advisedCount = 0;
    // Assembled ONCE for the run, not per change: a judge takes its call set as an argument,
    // so the table is payload-free. Recompiling per file would repeat every compile-time
    // side effect — the stderr line a config-faulted discipline names itself with would
    // print once per staged file rather than once.
    const registrations = assembleCommitRegistrations({
      config,
      rootDir: spec.repoRoot,
      covenant,
      witness,
    });

    // One plan and one supply for the run: the per-change loop shares them, so the tree is
    // read once per named file rather than once per change. `changes` carries the whole
    // observation because this surface dispatches one change at a time to keep telemetry at
    // one row per file — a set no judge could derive from the input it is handed.
    const { files } = covenant.supplySources({
      plan: covenant.planSources({ registrations }),
      read: observationSourceReader({ repoRoot: spec.repoRoot, observation: domain }),
    });
    const world = { files, changes: changedPaths(changes) };

    for (const change of changes) {
      const input = covenantInputFromStagedChanges([change]);
      const { exitCode, results } = await covenant.dispatchCovenants({
        stdinPayload: JSON.stringify(input),
        registrations,
        telemetryPath,
        dispatcherLabel: 'covenant-check',
        enforce,
        world,
      });
      if (exitCode === 2) blocked = true;
      advisedCount += results.filter((result) => result.event === 'advised').length;
    }
    // Names no level: surface-level and entry-level advice mix in one run, so the commit's
    // fate is read from the run.
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
 * Judge one observation of `repoRoot` exactly as the session surface would — the staged
 * diff by default, the working tree or a ref range on request. Async because the dispatcher
 * spawns covenant bodies. An empty domain is an explicit pass: nothing to judge, no records.
 */
export async function runCovenantCheck(spec: CovenantCheckSpec): Promise<{ exitCode: 0 | 2 }> {
  const settlement = settleConfig(spec);
  if (!settlement.settled) return { exitCode: settlement.exitCode };
  const { telemetryPath, config } = settlement;

  const domain: CheckDomain = spec.domain ?? { kind: 'staged' };
  let changes: StagedChange[];
  try {
    changes = collectDomain(spec.repoRoot, domain);
  } catch (error) {
    return failClosed(telemetryPath, error);
  }
  if (changes.length === 0) return { exitCode: 0 };

  return judgeChanges(spec, domain, telemetryPath, config, changes);
}
