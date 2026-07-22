/**
 * `pdks covenant check` — the assembled commit-surface judgment runner (ADAPTER-git §4.3).
 *
 * This is the commit-surface counterpart of the session hook's composition root: the one
 * umbrella-owned place where the git adapter (staged-diff vocabulary), the covenant
 * dispatcher, and the config loader meet. Assembly order mirrors the session hook —
 * loadConfig → normalizeProtectedPaths → collect/translate → dispatchCovenants — and the
 * judge bodies it spawns are the very same covenant dist executables, so a staged change
 * receives the same verdict a session tool call would (AC-4 same-judge).
 *
 * Each staged change is dispatched as its own single-change input: one staged file is
 * the commit surface's analogue of one session tool call, so telemetry stays N:N (AC-6)
 * and `gain` reads a per-file subject rather than one opaque batch line.
 *
 * The valve is a TTY prompt (PRD §4.4 decision A): the injected `ttyPrompt` seam returns
 * the line a human typed at the terminal, compared against the config waiver token in
 * FULL (COVENANT-15 — substring acceptance is forbidden). The seam's absence models a
 * non-interactive environment (CI, an AI-spawned git commit): no prompt, no bypass —
 * the valve is structurally reachable only by a human at a terminal, which is the
 * commit-surface translation of "only a human utterance opens the session valve". The
 * answer is cached so one commit prompts at most once, and nothing is ever persisted —
 * a state file would be an agent-forgeable surface (PRD §7).
 *
 * fail-closed: a missing/invalid config, or a collector failure, exits 2 with one
 * blocked record when a telemetry path is known. An empty staging area is an explicit
 * pass (nothing to judge — the dispatcher precedent of zero matches, zero records).
 */

import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import {
  collectStagedChanges,
  covenantInputFromStagedChanges,
  STAGED_DELETE,
  STAGED_WRITE,
} from '@polydeukes/adapter-git';
import { appendRecord, normalizeProtectedPaths } from '@polydeukes/core';
import {
  type CovenantRegistration,
  compileDisciplineRegistrations,
  dispatchCovenants,
} from '@polydeukes/covenant';
import { loadConfig } from './index.js';

/** `runCovenantCheck` input (ADAPTER-git §4.3 — the contract covenant-check tests pin). */
export type CovenantCheckSpec = {
  /** Repository root — config discovery and staged collection both anchor here. */
  repoRoot: string;
  /** Overrides the config's telemetry log path (tests and assembly injection). */
  telemetryPath?: string;
  /**
   * TTY valve seam: returns the line a human typed, or null for no input. ABSENT means
   * a non-TTY environment — the valve never opens (AC-3 human-only arming).
   */
  ttyPrompt?: () => string | null;
};

/**
 * Build the escape-hatch predicate for the TTY valve, or undefined when no valve can
 * exist (no waiver configured, or no TTY seam — both leave the dispatcher with no
 * bypass path at all). The prompt fires lazily on the first matched registration and
 * its verdict is cached: one commit, at most one prompt, full-token equality only.
 */
function ttyValveHatch(
  waiver: { token: string } | undefined,
  ttyPrompt: (() => string | null) | undefined,
): CovenantRegistration['escapeHatch'] | undefined {
  if (waiver === undefined || ttyPrompt === undefined) return undefined;
  let verdict: boolean | undefined;
  return () => {
    if (verdict === undefined) {
      verdict = ttyPrompt() === waiver.token;
    }
    return verdict;
  };
}

/** One blocked record for a run that failed closed before any dispatch could judge. */
function recordFailClosed(telemetryPath: string | undefined): void {
  if (telemetryPath === undefined) return;
  try {
    appendRecord(telemetryPath, {
      timestamp: new Date().toISOString(),
      event: 'blocked',
      label: 'covenant-check',
      subject: '-',
    });
  } catch {
    // A telemetry failure must never soften the blocking exit (session-hook precedent).
  }
}

/**
 * Judge the staged changes of `repoRoot` exactly as the session surface would
 * (ADAPTER-git §4.3). Async because the dispatcher spawns covenant bodies (CORE-01) —
 * a synchronous runner would mean reimplementing the judge, which the single-dispatcher
 * principle forbids.
 */
export async function runCovenantCheck(spec: CovenantCheckSpec): Promise<{ exitCode: 0 | 2 }> {
  let config: ReturnType<typeof loadConfig>['config'];
  try {
    ({ config } = loadConfig(spec.repoRoot));
  } catch (error) {
    process.stderr.write(
      `covenant check failed closed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    recordFailClosed(spec.telemetryPath);
    return { exitCode: 2 };
  }
  const telemetryPath = spec.telemetryPath ?? resolve(spec.repoRoot, config.telemetry.logPath);

  let changes: ReturnType<typeof collectStagedChanges>;
  try {
    changes = collectStagedChanges(spec.repoRoot);
  } catch (error) {
    process.stderr.write(
      `covenant check failed closed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    recordFailClosed(telemetryPath);
    return { exitCode: 2 };
  }
  if (changes.length === 0) {
    return { exitCode: 0 };
  }

  // Everything from here on is judgment assembly and dispatch: any throw (an unbuilt or
  // unresolvable covenant dist, a registration-build failure) is unjudgeable and must
  // both block AND leave one blocked record — the session hook's one-call-one-record
  // invariant, which an unrecorded propagation to the bin's catch would narrow
  // (review F5).
  try {
    const protectedPaths = normalizeProtectedPaths({
      protectedPaths: config.protectedPaths,
    });

    // The judge bodies are the covenant package's dist executables — resolved through
    // the real package (never a test alias), so the commit surface spawns the same
    // judges the session hook does.
    const covenantDist = dirname(createRequire(import.meta.url).resolve('@polydeukes/covenant'));
    const escapeHatch = ttyValveHatch(config.waiver, spec.ttyPrompt);

    const registrations: CovenantRegistration[] = [
      {
        label: 'self-mod',
        protectedPaths,
        body: {
          command: process.execPath,
          args: [
            join(covenantDist, 'self-mod-body.js'),
            ...protectedPaths.flatMap((path) => ['--protected-path', path]),
            ...[STAGED_WRITE, STAGED_DELETE].flatMap((tool) => ['--mutating-tool', tool]),
          ],
        },
        escapeHatch,
      },
      // Command-family entries are excluded: the commit surface has no shell axis (a
      // staged diff carries no commands), so registering them would be spawn waste by
      // design (PRD §2). Path and delta families judge the staged fileChanges as-is.
      ...compileDisciplineRegistrations({
        disciplines: (config.disciplines ?? []).filter(
          (entry) => entry.forbidCommand === undefined,
        ),
        rootDir: spec.repoRoot,
        bodyCommand: process.execPath,
        bodyModulePath: join(covenantDist, 'discipline-body.js'),
        shellTools: [],
        commandArgs: [],
        escapeHatch,
      }),
    ];

    let blocked = false;
    for (const change of changes) {
      const input = covenantInputFromStagedChanges([change]);
      const { exitCode } = await dispatchCovenants({
        stdinPayload: JSON.stringify(input),
        registrations,
        telemetryPath,
        dispatcherLabel: 'covenant-check',
      });
      if (exitCode === 2) blocked = true;
    }
    return { exitCode: blocked ? 2 : 0 };
  } catch (error) {
    process.stderr.write(
      `covenant check failed closed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    recordFailClosed(telemetryPath);
    return { exitCode: 2 };
  }
}
