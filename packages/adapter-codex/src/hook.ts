/**
 * `runHook` — the Codex lifecycle entry point: evidence events stay local, while one
 * PreToolUse payload becomes one `pdks covenant check` process and its exit status.
 *
 * This package judges nothing and writes no telemetry row. It records the stable lifecycle
 * evidence the host supplies, builds the agent-neutral IR — translated payload, tool roster,
 * and session history — and hands it to the umbrella's bin on stdin. Every verdict, and
 * every row, is the child's.
 *
 * A failure before the spawn travels IN the spawn: the failure sentence replaces the IR on
 * stdin, the child fails closed on it as non-JSON, and the one row that call earns is
 * written by the one writer. Only an unresolvable `polydeukes` skips the spawn, because
 * then there is no writer at all.
 *
 * Nothing this module runs writes to stdout, the child included. The host parses a hook's
 * stdout as a decision document and treats a field it does not accept as a failed hook,
 * letting the tool call proceed.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CovenantInput, FileChange } from '@polydeukes/core';
import { EXIT_BREAK_BLOCKING, EXIT_UPHOLD, isPlainObject } from '@polydeukes/core';
import { parseApplyPatch } from './apply-patch.ts';
import { parsePayloadEnvelope } from './payload-envelope.ts';
import { findUmbrellaBin, UMBRELLA_PACKAGE } from './resolve-umbrella.ts';
import {
  appendSessionEvidence,
  readSessionEvidence,
  removeSessionEvidence,
  sessionEvidencePath,
} from './session-evidence.ts';
import { COMMAND_ARG, COMMAND_ARGS, MUTATING_TOOLS, SHELL_TOOLS } from './session-vocabulary.ts';

/** The subcommand and posture the session surface always spawns with. */
const CHECK_ARGS = ['covenant', 'check', '--enforce', 'block'];
/** The prefix a pre-spawn failure travels under, so an operator can find it in the log. */
const FAILURE_PREFIX = 'adapter-codex failed before spawn:';
/** Every name this adapter translates, mutating first — the order the refusal lists them in. */
const ROSTER: readonly string[] = [...MUTATING_TOOLS, ...SHELL_TOOLS];
/**
 * The child's three streams. `ignore` on stdout rather than `inherit`: the host parses
 * whatever lands on the hook's stdout as a decision document, so anything the judge prints
 * there marks the hook failed and lets the tool call proceed.
 */
const CHILD_STDIO = ['pipe', 'ignore', 'inherit'] as const;

/** The spawn seam's parameters — what the child is asked to run, where, and on stdin. */
export type RunHookSpawnSpec = {
  command: string;
  args: string[];
  cwd: string;
  stdin: string;
  stdio: readonly [string, string, string];
};

/** {@link runHook} input — the project being judged, the payload, and the spawn seam. */
export type RunHookSpec = {
  /**
   * The project root: the config the child discovers, the install graph `polydeukes` is
   * located in, and the base every carried path is relative to. A delegator derives it from
   * its own location, never from a cwd a host chose.
   */
  repoRoot: string;
  /** Raw hook stdin — one registered lifecycle payload as JSON. Absent reads fd 0. */
  rawPayload?: string;
  /**
   * Injected spawn seam. Absent spawns node on the located bin with the child's stdout
   * discarded and its stderr inherited, so the break reason reaches the host and nothing
   * else does.
   */
  spawn?: (spec: RunHookSpawnSpec) => { status: number | null };
  /** Receive clock for timestamping a human prompt. Absent uses the wall clock. */
  now?: () => number;
};

/** {@link runHook} result — the exit code the hook process leaves with. */
export type RunHookOutcome = { exitCode: 0 | 2 };

/**
 * Real-fs pre-state reader — `null` only for true absence (ENOENT).
 *
 * Any other read failure (permissions, a directory target, fd exhaustion) throws: `null` is
 * the parser's absence answer, and reading a refused file as absent would mark a deletion
 * pre-less and let a discipline over the deleted text see nothing. The caller turns the
 * throw into a failure sentence the child fails closed on.
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
 * A directory's canonical spelling, or the path itself where it cannot be resolved.
 *
 * The two bases below arrive by different routes — the host names `cwd`, the delegator
 * derives `repoRoot` from its own module URL — and Node resolves symlinks on one route and
 * not the other. On macOS that alone makes `/tmp/x` and `/private/tmp/x` name one directory
 * under two spellings, and comparing them verbatim puts every file in the project outside
 * it. Only directories are canonicalised: a patch creates files that do not exist yet.
 */
function canonicalDir(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/**
 * The repoRoot-relative form of a patch path, which the patch spelled relative to the
 * call's `cwd`.
 *
 * Two bases meet here: a patch path is resolved against `cwd`, and the judge reads
 * `fileChange.path` against the project root. Carried verbatim, a subdirectory call's
 * `inner.txt` is compared against the protection list as `inner.txt` rather than as
 * `gate/inner.txt`. A path resolving outside the root has no repo-relative form at all, and
 * an element carrying one lands in no scope — judged over nothing, and passed.
 */
function relativizeToRepoRoot(patchPath: string, cwd: string, repoRoot: string): string {
  const absolute = isAbsolute(patchPath)
    ? resolve(patchPath)
    : resolve(canonicalDir(cwd), patchPath);
  const repoRelative = relative(canonicalDir(repoRoot), absolute);
  if (repoRelative === '' || repoRelative.startsWith('..') || isAbsolute(repoRelative)) {
    throw new PreSpawnFailure(`the patch targets '${patchPath}', which is outside the project`);
  }
  return repoRelative;
}

/**
 * The file changes one `apply_patch` command proves, each carrying its repoRoot-relative
 * path.
 *
 * The parser reads a pre-state at the cwd-resolved absolute path and answers with the path
 * the patch spelled; the rebasing happens after, so the two bases never cross.
 */
function patchFileChanges(command: string, cwd: string, repoRoot: string): FileChange[] {
  let parsed: ReturnType<typeof parseApplyPatch>;
  try {
    const base = canonicalDir(cwd);
    parsed = parseApplyPatch(command, (path) =>
      readPreStateFromDisk(isAbsolute(path) ? path : resolve(base, path)),
    );
  } catch (error) {
    throw new PreSpawnFailure(
      `the pre-state of a patch target could not be read (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  if (parsed.ok !== true) {
    throw new PreSpawnFailure(`the patch text is not one this adapter can read: ${parsed.reason}`);
  }
  return parsed.value.map((change) => ({
    ...change,
    path: relativizeToRepoRoot(change.path, cwd, repoRoot),
  }));
}

/**
 * Build the IR one payload proves, as the JSON text the child reads from stdin.
 *
 * Throws {@link PreSpawnFailure} naming the step that failed. The steps fail for different
 * reasons and need different repairs, so each names itself rather than sharing one sentence.
 *
 * The session comes only from adapter-owned lifecycle records; the unstable host transcript
 * path is never opened. No `actor` or `channels` are synthesized because the events prove
 * neither.
 */
function buildStdin(
  payload: unknown,
  repoRoot: string,
): { stdin: string; hasUserEvidence: boolean } {
  // The roster is the one list the envelope admits and the router reads, so a third
  // category added to the vocabulary is refused here until the router learns it.
  const envelope = parsePayloadEnvelope(payload, ROSTER);
  if (envelope.ok !== true) {
    throw new PreSpawnFailure(envelope.reason);
  }

  const sessionId = isPlainObject(payload) ? payload.session_id : undefined;
  if (typeof sessionId !== 'string') {
    throw new PreSpawnFailure('the payload session_id is not a string');
  }
  let session: NonNullable<CovenantInput['session']>;
  try {
    session = readSessionEvidence(sessionEvidencePath(repoRoot, sessionId));
  } catch (error) {
    throw new PreSpawnFailure(error instanceof Error ? error.message : String(error));
  }

  // One element per file, in patch order, on one spawn: the judge sees every file only if
  // every file rides the IR, and a process per file would expose the set to config and disk
  // changes between them.
  const toolCalls: CovenantInput['toolCalls'] = MUTATING_TOOLS.includes(envelope.toolName)
    ? patchFileChanges(envelope.command, envelope.cwd, repoRoot).map((fileChange) => ({
        name: envelope.toolName,
        fileChange,
      }))
    : [{ name: envelope.toolName, args: { [COMMAND_ARG]: envelope.command } }];

  return {
    stdin: JSON.stringify({
      toolCalls,
      subagentSpawns: [],
      userMessages: [],
      session,
      tools: { mutating: MUTATING_TOOLS, shell: SHELL_TOOLS, commandArgs: COMMAND_ARGS },
    } satisfies CovenantInput),
    hasUserEvidence: session.userMessages.length > 0,
  };
}

type LifecycleEvent = 'UserPromptSubmit' | 'PostToolUse' | 'SessionEnd';

function lifecycleEvent(payload: unknown): LifecycleEvent | undefined {
  if (!isPlainObject(payload)) return undefined;
  const event = payload.hook_event_name;
  return event === 'UserPromptSubmit' || event === 'PostToolUse' || event === 'SessionEnd'
    ? event
    : undefined;
}

function handleLifecycle(
  payload: unknown,
  event: LifecycleEvent,
  repoRoot: string,
  now: () => number,
): RunHookOutcome {
  try {
    if (!isPlainObject(payload) || typeof payload.session_id !== 'string') {
      throw new Error('lifecycle payload session_id is not a string');
    }
    const path = sessionEvidencePath(repoRoot, payload.session_id);
    if (event === 'SessionEnd') {
      removeSessionEvidence(path);
    } else if (event === 'UserPromptSubmit') {
      if (typeof payload.prompt !== 'string') {
        throw new Error('UserPromptSubmit payload prompt is not a string');
      }
      appendSessionEvidence(path, { kind: 'user', text: payload.prompt, timestampMs: now() });
    } else {
      if (typeof payload.tool_name !== 'string' || !('tool_input' in payload)) {
        throw new Error('PostToolUse payload tool_name or tool_input is invalid');
      }
      appendSessionEvidence(
        path,
        isPlainObject(payload.tool_input)
          ? { kind: 'tool', name: payload.tool_name, args: payload.tool_input }
          : { kind: 'tool', name: payload.tool_name },
      );
    }
  } catch (error) {
    process.stderr.write(
      `adapter-codex session evidence ${event} failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
  return { exitCode: EXIT_UPHOLD };
}

function configuredWitnessToken(repoRoot: string): string | undefined {
  try {
    // The schema is the umbrella's public data entry point. Its sibling loader is the
    // canonical discovery, YAML decoding, and validation path the spawned judge uses.
    // Node 24 can synchronously require this ESM module, which keeps `runHook` synchronous.
    const schemaPath = fileURLToPath(import.meta.resolve('polydeukes/schema.json'));
    const loaderPath = join(dirname(schemaPath), '..', 'load-config.js');
    const loader = createRequire(import.meta.url)(loaderPath) as {
      loadConfig(spec: { rootDir: string }): {
        config: { witness?: { token: string; ttlMinutes: number } };
      };
    };
    return loader.loadConfig({ rootDir: repoRoot }).config.witness?.token;
  } catch {
    // Recovery text is advisory. The child already emitted the authoritative config or
    // verdict diagnostic, so failure to load a token degrades to the terminal fallback.
    return undefined;
  }
}

function writeBlockedRecovery(repoRoot: string, hasUserEvidence: boolean): void {
  if (!hasUserEvidence) {
    process.stderr.write(
      'recovery: no UserPromptSubmit evidence was recorded, so witness cannot release this call; use the user terminal\n',
    );
    return;
  }
  const token = configuredWitnessToken(repoRoot);
  if (token === undefined) {
    process.stderr.write('recovery: no witness is configured; use the user terminal\n');
    return;
  }
  process.stderr.write(
    `recovery: enter '${token}' alone on the first line and retry within its configured window; if it remains blocked, use the user terminal\n`,
  );
}

/**
 * The default seam: node on the located bin, its stderr reaching the host and its stdout
 * discarded — the host reads a hook's stdout as a decision, so the child may not write there.
 */
function spawnCovenantCheck(spec: RunHookSpawnSpec): { status: number | null } {
  return spawnSync(spec.command, spec.args, {
    cwd: spec.cwd,
    input: spec.stdin,
    stdio: [...CHILD_STDIO],
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
  const rawPayload = spec.rawPayload ?? readFileSync(0, 'utf-8');
  let payload: unknown;
  try {
    payload = JSON.parse(rawPayload);
  } catch (error) {
    payload = new PreSpawnFailure(
      `the payload is not JSON (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  const event = lifecycleEvent(payload);
  if (event !== undefined) {
    return handleLifecycle(payload, event, spec.repoRoot, spec.now ?? Date.now);
  }

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

  let stdin: string;
  let validIr = false;
  let hasUserEvidence = false;
  try {
    if (payload instanceof PreSpawnFailure) throw payload;
    const built = buildStdin(payload, spec.repoRoot);
    stdin = built.stdin;
    validIr = true;
    hasUserEvidence = built.hasUserEvidence;
  } catch (error) {
    stdin = `${FAILURE_PREFIX} ${error instanceof Error ? error.message : String(error)}\n`;
    // The child fails closed on this line as non-JSON, but its own stderr names only the
    // parse failure. The reason reaches the operator from here.
    process.stderr.write(stdin);
  }

  const spawn = spec.spawn ?? spawnCovenantCheck;
  const { status } = spawn({
    command: process.execPath,
    args: [bin, ...CHECK_ARGS],
    cwd: spec.repoRoot,
    stdin,
    stdio: CHILD_STDIO,
  });
  if (status !== EXIT_UPHOLD && status !== EXIT_BREAK_BLOCKING) {
    // Not a verdict: the judge crashed or was signalled, so no row was written. Exit 2 is
    // still right for the host; the line is what tells the operator this was not a break.
    process.stderr.write(
      `covenant hook failed closed: the judge exited with status ${String(status)} before a verdict\n`,
    );
  }
  if (status === EXIT_BREAK_BLOCKING && validIr) {
    writeBlockedRecovery(spec.repoRoot, hasUserEvidence);
  }
  return { exitCode: status === EXIT_UPHOLD ? EXIT_UPHOLD : EXIT_BREAK_BLOCKING };
}
