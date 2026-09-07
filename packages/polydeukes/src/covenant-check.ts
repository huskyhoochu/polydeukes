/**
 * `pdks covenant check` — the commit surface's composition root.
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

import { resolve } from 'node:path';
import {
  appendRecordFailOpen,
  type CovenantInput,
  DEFAULT_TELEMETRY_LOG_PATH,
  normalizeProtectedPaths,
} from '@polydeukes/core';
import type { CovenantRegistration } from './covenant/dispatch.ts';
import { type CovenantModule, covenantModule } from './covenant/module.ts';
import { STAGED_DELETE, STAGED_WRITE } from './diff-ir.ts';
import { loadConfig } from './load-config.ts';
import { unobservedPreStateReader } from './pre-state-reader.ts';
import { worktreeReader } from './worktree-reader.ts';

/** {@link runCovenantCheck} result — the exit code the check process leaves with. */
export type CovenantCheckOutcome = { exitCode: 0 | 2 };

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
   * protected path included, lands as a row and exit 0 — the commit surface's default, since
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

/** {@link assembleCommitRegistrations} input — what the commit surface's assembly needs. */
export type CommitAssemblySpec = {
  config: ReturnType<typeof loadConfig>['config'];
  rootDir: string;
  /**
   * The judge module the registrations are built from, so what judges a change and what
   * `explain` renders come from one surface.
   */
  covenant: CovenantModule;
};

/**
 * The commit surface's registration set — one assembly that the runner dispatches and
 * `explain` renders.
 */
export function assembleCommitRegistrations(spec: CommitAssemblySpec): CovenantRegistration[] {
  const { config, rootDir, covenant } = spec;
  const protectedPaths = normalizeProtectedPaths({ protectedPaths: config.protectedPaths ?? [] });
  const disciplines = config.disciplines ?? [];

  const registrations: CovenantRegistration[] = [
    covenant.selfModRegistration({
      protectedPaths,
      mutatingToolNames: [STAGED_WRITE, STAGED_DELETE],
    }),
    ...covenant.compileDisciplineRegistrations({
      disciplines,
      rootDir,
      shellTools: [],
      commandArgs: [],
      readPreState: unobservedPreStateReader,
      observesChangeSet: true,
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
    const { config } = loadConfig({ rootDir: spec.repoRoot });
    telemetryPath = spec.telemetryPath ?? resolve(spec.repoRoot, config.telemetry.logPath);
    return { settled: true, telemetryPath, config };
  } catch (error) {
    return { settled: false, ...failClosed(telemetryPath, error) };
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
  config: ReturnType<typeof loadConfig>['config'],
  input: CovenantInput,
): Promise<CovenantCheckOutcome> {
  try {
    // The umbrella's own judge module, so the commit surface runs the judges the session
    // hook does; a test injects a module with one member replaced.
    const covenant = spec.covenant ?? covenantModule;

    let blocked = false;
    let advisedCount = 0;
    // Assembled ONCE for the run, not per call: a judge takes its call set as an argument,
    // so the table is payload-free. Recompiling per file would repeat every compile-time
    // side effect — the stderr line a config-faulted discipline names itself with would
    // print once per staged file rather than once.
    const registrations = assembleCommitRegistrations({
      config,
      rootDir: spec.repoRoot,
      covenant,
    });

    // One plan and one supply for the run: the per-call loop shares them, so the tree is
    // read once per named file rather than once per change. The change set carries the whole
    // observation because this surface dispatches one call at a time to keep telemetry at
    // one row per file — a set no judge could derive from the input it is handed.
    const { files } = covenant.supplySources({
      plan: covenant.planSources({ registrations }),
      read: worktreeReader({ repoRoot: spec.repoRoot }),
    });
    const world = { files, changes: changedPaths(input) };

    for (const call of input.toolCalls) {
      const { exitCode, results } = await covenant.dispatchCovenants({
        stdinPayload: JSON.stringify({
          toolCalls: [call],
          subagentSpawns: input.subagentSpawns,
          userMessages: input.userMessages,
        }),
        registrations,
        telemetryPath,
        dispatcherLabel: 'covenant-check',
        enforce: spec.enforce ?? 'advise',
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
 * Judge one observation of `repoRoot` exactly as the session surface would, from the IR the
 * caller hands in. Async because the dispatcher spawns covenant bodies. An input with no
 * toolCalls is an explicit pass: nothing to judge, no records.
 */
export async function runCovenantCheck(spec: CovenantCheckSpec): Promise<CovenantCheckOutcome> {
  const settlement = settleConfig(spec);
  if (!settlement.settled) return { exitCode: settlement.exitCode };
  const { telemetryPath, config } = settlement;

  let input: CovenantInput;
  try {
    input = typeof spec.input === 'function' ? spec.input() : spec.input;
    // The world axis is this root's to fill. An input that supplies its own would let a
    // caller choose the files the judge reads.
    if ('world' in input) {
      throw new Error('input carries a world key: the world axis is the runner’s');
    }
    if (!Array.isArray(input.toolCalls)) throw new Error('input carries no toolCalls array');
  } catch (error) {
    return failClosed(telemetryPath, error);
  }
  if (input.toolCalls.length === 0) return { exitCode: 0 };

  return judgeInput(spec, telemetryPath, config, input);
}
