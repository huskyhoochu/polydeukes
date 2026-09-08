/**
 * `runHook` — the session surface's entry point: one PreToolUse payload in, one
 * `pdks covenant check` process out, its status back as the exit code.
 *
 * This package judges nothing and writes no telemetry row. It builds the agent-neutral IR
 * — the translated payload, this host's tool roster, the file-change evidence, the session
 * evidence — and hands it to the umbrella's bin on stdin. Every verdict, and every row, is
 * the child's.
 *
 * A failure before the spawn travels IN the spawn: the failure sentence replaces the IR on
 * stdin, the child fails closed on it as non-JSON, and the one row that call earns is
 * written by the one writer. Only an unresolvable `polydeukes` skips the spawn, because
 * then there is no writer at all.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { EXIT_BREAK_BLOCKING, EXIT_UPHOLD } from '@polydeukes/core';
import { collectFileChanges } from './file-changes.ts';
import { findUmbrellaBin, UMBRELLA_PACKAGE } from './resolve-umbrella.ts';
import { sessionEvidenceFromPayload } from './session-evidence.ts';
import { COMMAND_ARGS, MUTATING_TOOLS, SHELL_TOOLS } from './session-vocabulary.ts';
import { buildCovenantInput } from './up-translate.ts';

/** The subcommand and posture the session surface always spawns with. */
const CHECK_ARGS = ['covenant', 'check', '--enforce', 'block'];
/** The prefix a pre-spawn failure travels under, so an operator can find it in the log. */
const FAILURE_PREFIX = 'adapter-claude-code failed before spawn:';

/** The spawn seam's parameters — what the child is asked to run, where, and on stdin. */
export type RunHookSpawnSpec = {
  command: string;
  args: string[];
  cwd: string;
  stdin: string;
};

/** {@link runHook} input — the project being judged, the payload, and the spawn seam. */
export type RunHookSpec = {
  /**
   * The project root: the config the child discovers, and the install graph `polydeukes`
   * is located in. A delegator derives it from its own location, never from a cwd a host
   * chose.
   */
  repoRoot: string;
  /** Raw hook stdin — one PreToolUse payload as JSON. Absent reads fd 0. */
  rawPayload?: string;
  /**
   * Injected spawn seam. Absent spawns node on the located bin with stdout and stderr
   * inherited, so the child's break reason reaches the host.
   */
  spawn?: (spec: RunHookSpawnSpec) => { status: number | null };
};

/** {@link runHook} result — the exit code the hook process leaves with. */
export type RunHookOutcome = { exitCode: 0 | 2 };

/**
 * Real-fs pre-state reader for file changes — `null` only for true absence (ENOENT).
 *
 * Any other read failure (permissions, a directory target, fd exhaustion) throws: `null` is
 * the IR's creation sentinel, and a poisoned `pre: null` on an existing file would let a
 * path-family discipline uphold the overwrite. The caller turns the throw into a failure
 * sentence the child fails closed on.
 */
function readPreStateFromDisk(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** A pre-spawn failure carrying the step that produced it — the operator's only trace. */
class PreSpawnFailure extends Error {}

/**
 * Build the IR one payload proves, as the JSON text the child reads from stdin.
 *
 * Throws {@link PreSpawnFailure} naming the step that failed. The four steps fail for
 * different reasons and need different repairs, so each names itself rather than sharing
 * one sentence.
 */
function buildStdin(rawPayload: string): string {
  let payload: unknown;
  try {
    payload = JSON.parse(rawPayload);
  } catch (error) {
    throw new PreSpawnFailure(
      `the payload is not JSON (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  const built = buildCovenantInput([payload]);
  if (built.ok !== true) {
    throw new PreSpawnFailure('the payload is not a PreToolUse envelope this adapter translates');
  }

  // Attached to the call it belongs to: this path translates exactly one payload, so the
  // one evidence rides toolCalls[0]. Left ABSENT rather than null when unprovable — the
  // protocol refuses a null fileChange, and a call the judge should fall back on would
  // fail closed instead.
  let evidence: ReturnType<typeof collectFileChanges>;
  try {
    evidence = collectFileChanges(payload, readPreStateFromDisk);
  } catch (error) {
    throw new PreSpawnFailure(
      `the pre-state of the target could not be read (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  let session: ReturnType<typeof sessionEvidenceFromPayload>;
  try {
    session = sessionEvidenceFromPayload({ rawPayload });
  } catch (error) {
    throw new PreSpawnFailure(
      `the session evidence could not be gathered (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  return JSON.stringify({
    ...built.value,
    toolCalls:
      evidence === null
        ? built.value.toolCalls
        : built.value.toolCalls.map((call, index) =>
            index === 0 ? { ...call, fileChange: evidence } : call,
          ),
    tools: { mutating: MUTATING_TOOLS, shell: SHELL_TOOLS, commandArgs: COMMAND_ARGS },
    ...(session === undefined ? {} : { session }),
  });
}

/** The default seam: node on the located bin, the child's own output reaching the host. */
function spawnCovenantCheck(spec: RunHookSpawnSpec): { status: number | null } {
  return spawnSync(spec.command, spec.args, {
    cwd: spec.cwd,
    input: spec.stdin,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
}

/**
 * Judge one PreToolUse payload by spawning the umbrella's judge over its IR.
 *
 * Only a child status of 0 passes through as 0. A crashed child (1) or a signalled one
 * (null) is not a verdict, and forwarding either as-is would let the host read a non-2 as
 * "not blocked".
 */
export function runHook(spec: RunHookSpec): RunHookOutcome {
  const bin = findUmbrellaBin(spec.repoRoot);
  if (bin === undefined) {
    // The one outcome with no row anywhere: nothing to spawn means no writer exists. The
    // line names the package because installing it is the operator's next action.
    process.stderr.write(
      `covenant hook failed closed: cannot use '${UMBRELLA_PACKAGE}' from ${spec.repoRoot} — ` +
        'install or update it there, then try again\n',
    );
    return { exitCode: EXIT_BREAK_BLOCKING };
  }

  const rawPayload = spec.rawPayload ?? readFileSync(0, 'utf-8');
  let stdin: string;
  try {
    stdin = buildStdin(rawPayload);
  } catch (error) {
    stdin = `${FAILURE_PREFIX} ${error instanceof Error ? error.message : String(error)}\n`;
  }

  const spawn = spec.spawn ?? spawnCovenantCheck;
  const { status } = spawn({
    command: process.execPath,
    args: [bin, ...CHECK_ARGS],
    cwd: spec.repoRoot,
    stdin,
  });
  return { exitCode: status === EXIT_UPHOLD ? EXIT_UPHOLD : EXIT_BREAK_BLOCKING };
}
