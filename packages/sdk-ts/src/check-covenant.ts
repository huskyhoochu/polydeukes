/**
 * `checkCovenant` — hand one covenant input to `pdks covenant check` and read the verdict.
 *
 * Also the runner every verb of this package goes through: locate the umbrella in the
 * caller's install graph, spawn its bin with the input on stdin, and turn the child's exit
 * status and stderr into a value. Nothing here judges, records a telemetry row, or adds to
 * the input — the branches are whether the umbrella resolved and what status the child left
 * with.
 */

import { spawn as spawnChild } from 'node:child_process';
import type { CovenantInput } from '@polydeukes/core';
import { findUmbrellaBin, UMBRELLA_PACKAGE } from './resolve-umbrella.ts';

/** What the spawn seam is handed: the executable, its arguments, its cwd, and its stdin. */
export type CheckCovenantSpawnSpec = {
  command: string;
  args: string[];
  cwd: string;
  stdin: string;
};

/** `checkCovenant` input. */
export type CheckCovenantSpec = {
  /** The project being judged — config discovery, the child's cwd, and the install graph. */
  repoRoot: string;
  /** The caller's own input. The runner refuses one carrying a `world` key. */
  input: CovenantInput;
  /** The observer's posture for the run. ABSENT is `block`. */
  enforce?: 'advise' | 'block';
  /** A config layer merged over the discovered config; the umbrella resolves it against `repoRoot`. */
  configLayer?: string;
  /** Where the child writes its telemetry rows, ahead of the config's own log path. */
  telemetryPath?: string;
  /** Injected spawn seam — absent, the child runs under this process's node executable. */
  spawn?: (spec: CheckCovenantSpawnSpec) => Promise<{ status: number | null; stderr: string }>;
};

/**
 * What the judge answered.
 *
 * `advisories` and `reason` are the child's stderr verbatim: an unattended caller has no
 * terminal to read it on, so the text comes back as the value and the caller decides where
 * it goes. `unjudged` is every status that is not a verdict — no judgment happened, and
 * reading it as an uphold would let an uninstalled judge pass every call.
 */
export type CheckCovenantVerdict =
  | { verdict: 'upheld'; advisories: string }
  | { verdict: 'blocked'; reason: string }
  | { verdict: 'unjudged'; reason: string };

/** What the shared runner needs from a verb: its input mode, its posture, and its stdin. */
export type RunCheckSpec = {
  repoRoot: string;
  /** What the not-installed reason says would have been judged. */
  subject: string;
  /** `--diff`: the stdin is a unified diff rather than an input IR. */
  diffMode: boolean;
  /** ABSENT is `block`, for every verb. */
  enforce?: 'advise' | 'block';
  /** `--config-layer <path>`, only when defined. */
  configLayer?: string;
  /** `--telemetry-path <path>`, only when defined. */
  telemetryPath?: string;
  /**
   * Called only once the umbrella resolved, inside the spawn's failure branch: a stdin that
   * cannot be produced comes back as `unjudged`, never as a rejection.
   */
  stdin: () => string;
  spawn?: CheckCovenantSpec['spawn'];
};

/**
 * Run the bin under this process's node executable, collect stderr, and discard stdout.
 *
 * No file descriptor is inherited: a caller may hold none of its own, and an inherited
 * stdout that is closed kills the child with EPIPE before it can answer.
 */
function defaultSpawn(spec: CheckCovenantSpawnSpec): Promise<{
  status: number | null;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawnChild(spec.command, spec.args, {
      cwd: spec.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    // Drained and dropped: the judge writes no verdict to stdout, and an unread pipe
    // fills and stalls the child.
    child.stdout.resume();
    child.on('error', reject);
    child.on('close', (status) => {
      resolve({ status, stderr });
    });
    // A child that exits before draining stdin raises EPIPE on this stream; the exit status
    // is the answer, and an unheard stream error would end the caller's process instead.
    child.stdin.on('error', () => {});
    child.stdin.end(spec.stdin);
  });
}

/**
 * Resolve the umbrella under `repoRoot`, spawn `pdks covenant check` with the verb's stdin,
 * and read the child's status as a verdict. Every verb of this package goes through here.
 */
export async function runCheck(spec: RunCheckSpec): Promise<CheckCovenantVerdict> {
  const bin = findUmbrellaBin(spec.repoRoot);
  if (bin === undefined) {
    return {
      verdict: 'unjudged',
      reason: `no ${UMBRELLA_PACKAGE} in the install graph of ${spec.repoRoot}: install it to have ${spec.subject} judged`,
    };
  }

  const spawn = spec.spawn ?? defaultSpawn;
  let status: number | null;
  let stderr: string;
  try {
    ({ status, stderr } = await spawn({
      command: process.execPath,
      args: [
        bin,
        'covenant',
        'check',
        ...(spec.diffMode ? ['--diff'] : []),
        '--enforce',
        spec.enforce ?? 'block',
        ...(spec.configLayer === undefined ? [] : ['--config-layer', spec.configLayer]),
        ...(spec.telemetryPath === undefined ? [] : ['--telemetry-path', spec.telemetryPath]),
      ],
      cwd: spec.repoRoot,
      stdin: spec.stdin(),
    }));
  } catch (error) {
    // No process ran, so no verdict and no row: the failure comes back as the value the
    // caller was promised rather than as an exception it did not sign up for.
    return {
      verdict: 'unjudged',
      reason: `the judge could not be spawned: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (status === 0) return { verdict: 'upheld', advisories: stderr };
  if (status === 2) return { verdict: 'blocked', reason: stderr };
  return {
    verdict: 'unjudged',
    reason:
      status === null
        ? 'the judge was killed by a signal before it answered'
        : `the judge exited with status ${status} instead of a verdict`,
  };
}

/**
 * Judge one input against the covenants of `repoRoot` and return the verdict as a value.
 *
 * The input travels verbatim; this package neither reads nor completes it.
 */
export async function checkCovenant(spec: CheckCovenantSpec): Promise<CheckCovenantVerdict> {
  return runCheck({
    repoRoot: spec.repoRoot,
    subject: 'this input',
    diffMode: false,
    enforce: spec.enforce,
    configLayer: spec.configLayer,
    telemetryPath: spec.telemetryPath,
    stdin: () => JSON.stringify(spec.input),
    spawn: spec.spawn,
  });
}
