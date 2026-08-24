/**
 * `pdks covenant check` — the commit surface's composition root (ADAPTER-git §4.3).
 *
 * Assembly mirrors the session hook — loadConfig → normalizeProtectedPaths → collect →
 * dispatchCovenants — and spawns the same covenant dist bodies, so a change receives the
 * verdict a session tool call would. Each change is dispatched as its own input so
 * telemetry stays one row per file. The witness valve is a `/dev/tty` prompt that only
 * the staged domain assembles (DIAG-01 §4.3); the other domains open no commit.
 *
 * fail-closed: a missing config, an unbuilt body, or a collector failure exits 2 with one
 * blocked record. An empty domain is an explicit pass with no records.
 */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import {
  collectRangeChanges,
  collectStagedChanges,
  collectWorktreeChanges,
  covenantInputFromStagedChanges,
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
import {
  type CovenantRegistration,
  compileDisciplineRegistrations,
  dispatchCovenants,
} from '@polydeukes/covenant';
import { loadConfig } from './load-config.js';

/**
 * Which observation of the commit surface a run judges (DIAG-01 §4.2). Only the collector
 * differs between them; the IR, the assembly, and the dispatcher are one path.
 *
 * `range` names its two refs. `ancestry: 'merge-base'` selects the `A...B` reading, whose
 * base is the two refs' common ancestor rather than `A` itself; the adapter that owns the
 * range grammar resolves it.
 */
export type CheckDomain =
  | { kind: 'staged' }
  | { kind: 'worktree' }
  | { kind: 'range'; base: string; head: string; ancestry?: 'merge-base' };

/** `runCovenantCheck` input (ADAPTER-git §4.3 — the contract covenant-check tests pin). */
export type CovenantCheckSpec = {
  /** Repository root — config discovery and staged collection both anchor here. */
  repoRoot: string;
  /**
   * Overrides where telemetry is written (tests and assembly injection) — the first term
   * of the precedence, ahead of the config's `telemetry.logPath` and of the default this
   * runner settles before the config loads (ADAPTER-git-b §4.1). Absent, both of those
   * apply in that order.
   */
  telemetryPath?: string;
  /** Overrides the resolved covenant dist directory (tests and assembly injection). */
  covenantDist?: string;
  /**
   * TTY valve seam: writes the given prompt and returns the line a human typed, or null
   * for no input. ABSENT means a non-TTY environment — the valve never opens (AC-3
   * human-only arming).
   */
  ttyPrompt?: (prompt: string) => string | null;
  /** Which observation to judge. ABSENT means `staged`. */
  domain?: CheckDomain;
};

/**
 * The TTY witness predicate, or undefined when no valve can exist (no witness configured
 * or no TTY seam). It fires on the first registration that broke, names it from the
 * dispatcher's context (COVENANT-17 §4.5), and caches the answer: one commit, at most one
 * prompt, full-token equality. Both sides are trimmed like the session valve, since config
 * validation accepts a padded token. The cache latches closed before the seam is consulted
 * so a throwing seam never re-prompts.
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
 * A judge body's module path, proven to exist before the spawn (CONFIG-06b §4.2): an
 * absent module exits 1, the same code as a break verdict, and nothing downstream can
 * tell the two apart.
 */
function provenBodyPath(distDir: string, fileName: string): string {
  const modulePath = join(distDir, fileName);
  if (!existsSync(modulePath)) {
    throw new Error(`judge body ${modulePath} is missing — run 'pnpm build' to rebuild it`);
  }
  return modulePath;
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
  covenantDist: string;
  witness?: CovenantRegistration['witness'];
};

/**
 * The commit surface's registration set (CLI-01 §7 invariant 1) — one assembly that the
 * runner dispatches and `explain` renders.
 */
export function assembleCommitRegistrations(spec: CommitAssemblySpec): CovenantRegistration[] {
  const { config, rootDir, covenantDist, witness } = spec;
  const { protectedPaths: gitAdditivePaths } = resolveGitAdapterSettings(config.adapters?.git);

  // Union of the common list and the git-additive one (CONFIG-08 §4.2), common first so
  // first-occurrence dedupe is deterministic. The session hook reads the common list alone.
  const protectedPaths = normalizeProtectedPaths({
    protectedPaths: [...(config.protectedPaths ?? []), ...gitAdditivePaths],
  });

  const disciplines = config.disciplines ?? [];

  const registrations: CovenantRegistration[] = [
    {
      label: 'self-mod',
      protectedPaths,
      body: {
        command: process.execPath,
        args: [
          provenBodyPath(covenantDist, 'self-mod-body.js'),
          ...protectedPaths.flatMap((path) => ['--protected-path', path]),
          ...[STAGED_WRITE, STAGED_DELETE].flatMap((tool) => ['--mutating-tool', tool]),
        ],
      },
      witness,
    },
    // No shell axis here, so command-family entries are left out. Context-family entries
    // stay in: with no transcript the compiler gives them skip registrations, which record
    // `skipped` on a match (COVENANT-13 §4.5). The body path is a thunk so the existence
    // proof fires only where a body is actually composed (CONFIG-06b §4.2).
    ...compileDisciplineRegistrations({
      disciplines: disciplines.filter((entry) => entry.forbidCommand === undefined),
      rootDir,
      bodyCommand: process.execPath,
      bodyModulePath: () => provenBodyPath(covenantDist, 'discipline-body.js'),
      shellTools: [],
      commandArgs: [],
      witness,
    }),
  ];

  // A covenant dist older than the lazy body-path convention hands back the thunk itself
  // where a string belongs; refuse that table rather than use it.
  for (const registration of registrations) {
    if (registration.body !== undefined && typeof registration.body.args?.[0] !== 'string') {
      throw new Error(
        `covenant dist predates the lazy body-path convention (registration '${registration.label}') — run 'pnpm build'`,
      );
    }
  }
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
 * write its blocked row (ADAPTER-git-b §4.1); both terms use `resolve` so a relative
 * `repoRoot` cannot send them to different files. The provisional term sits inside the
 * try because `resolve` throws on a non-string `repoRoot`.
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
 * Collect the changes of one domain (DIAG-01 §4.1). The three collectors return the same
 * shape, so everything downstream of this dispatch is one path.
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
    // Inside the try so an invalid adapter namespace fails closed (CONFIG-06 §4.2).
    const { enforce } = resolveGitAdapterSettings(config.adapters?.git);

    // Real Node resolution of the covenant package, so the commit surface spawns the same
    // judges the session hook does; tests inject a directory instead.
    const covenantDist =
      spec.covenantDist ?? dirname(createRequire(import.meta.url).resolve('@polydeukes/covenant'));
    // No valve under advise (nothing to witness) and none outside `staged` (DIAG-01 §4.3).
    const witness =
      enforce === 'advise' || domain.kind !== 'staged'
        ? undefined
        : ttyWitnessValve(config.witness, spec.ttyPrompt);

    const registrations = assembleCommitRegistrations({
      config,
      rootDir: spec.repoRoot,
      covenantDist,
      witness,
    });

    let blocked = false;
    let advisedCount = 0;
    for (const change of changes) {
      const input = covenantInputFromStagedChanges([change]);
      const { exitCode, results } = await dispatchCovenants({
        stdinPayload: JSON.stringify(input),
        registrations,
        telemetryPath,
        dispatcherLabel: 'covenant-check',
        enforce,
      });
      if (exitCode === 2) blocked = true;
      advisedCount += results.filter((result) => result.event === 'advised').length;
    }
    // Names no level: surface-level and entry-level advice mix in one run (CONFIG-11), so
    // the commit's fate is read from the run.
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
 * Judge one observation of `repoRoot` exactly as the session surface would
 * (ADAPTER-git §4.3, DIAG-01 §4.2) — the staged diff by default, the working tree or a
 * ref range on request. Async because the dispatcher spawns covenant bodies (CORE-01).
 * An empty domain is an explicit pass: nothing to judge, no records.
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
