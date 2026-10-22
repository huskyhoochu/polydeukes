import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { type CovenantInput, isPlainObject } from '@polydeukes/core';
import { COMMAND_ARGS, MUTATING_TOOLS, SHELL_TOOLS } from './session-vocabulary.ts';
/** One raw host event and the project it belongs to. */
export type PrepareHookSpec = { repoRoot: string; rawPayload: string };
/** A proved observation, a recorded lifecycle event, or an unavailable observation. */
export type PrepareHookOutcome =
  | { outcome: 'check'; input: CovenantInput }
  | { outcome: 'recorded' }
  | { outcome: 'unavailable'; reason: string };
function readPre(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw error;
  }
}

import type { FileChange } from '@polydeukes/core';
import { parseApplyPatch } from './apply-patch.ts';
import {
  appendSessionEvidence,
  readSessionEvidence,
  removeSessionEvidence,
  sessionEvidencePath,
} from './session-evidence.ts';

function canonicalDir(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

function isDanglingLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Resolve an absolute path through the nearest ancestor that exists. */
function canonicalTarget(path: string): string | null {
  const missing: string[] = [];
  let current = resolve(path);
  for (;;) {
    try {
      return join(realpathSync.native(current), ...missing.reverse());
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOTDIR') return null;
      if (code !== 'ENOENT') {
        throw new Error(`cannot resolve the real path of ${path}: ${code}`);
      }
      if (isDanglingLink(current)) {
        throw new Error(`target path crosses a dangling symbolic link: ${path}`);
      }
      const parent = dirname(current);
      if (parent === current) return resolve(path);
      missing.push(basename(current));
      current = parent;
    }
  }
}

function nameBelow(path: string, root: string): string {
  const inside = relative(root, path);
  return inside === '' || inside === '..' || inside.startsWith('../') || isAbsolute(inside)
    ? path
    : inside;
}

/**
 * The repoRoot-relative forms of a patch path, which the patch spelled relative to the
 * call's `cwd`, and its real path when that differs.
 *
 * Two bases meet here: a patch path is resolved against `cwd`, and the judge reads
 * `fileChange.path` against the project root. Carried verbatim, a subdirectory call's
 * `inner.txt` is compared against the protection list as `inner.txt` rather than as
 * `gate/inner.txt`. An outside path stays absolute so the protection list's segment match
 * still sees a host configuration file under the home directory.
 */
function patchTargetPaths(patchPath: string, cwd: string, repoRoot: string): string[] {
  const realRoot = canonicalDir(repoRoot);
  const absolute = isAbsolute(patchPath)
    ? resolve(patchPath)
    : resolve(canonicalDir(cwd), patchPath);
  const spelled = nameBelow(absolute, realRoot);
  const real = canonicalTarget(absolute);
  if (real === null) return [spelled];
  const realName = nameBelow(real, realRoot);
  return realName === spelled ? [spelled] : [spelled, realName];
}

/**
 * The file changes one `apply_patch` command proves, each carrying the paths
 * `patchTargetPaths` gives it.
 *
 * The parser reads a pre-state at the cwd-resolved absolute path and answers with the path
 * the patch spelled; the rebasing happens after, so the two bases never cross.
 */
function patchFileChanges(command: string, cwd: string, repoRoot: string): FileChange[] {
  let parsed: ReturnType<typeof parseApplyPatch>;
  try {
    const base = canonicalDir(cwd);
    parsed = parseApplyPatch(command, (path) =>
      readPre(isAbsolute(path) ? path : resolve(base, path)),
    );
  } catch (error) {
    throw new Error(
      `the pre-state of a patch target could not be read (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  if (parsed.ok !== true) {
    throw new Error(`the patch text is not one this adapter can read: ${parsed.reason}`);
  }
  return parsed.value.flatMap((change) => {
    let resolved: FileChange = change;
    if (change.kind === 'create') {
      const pre = readPre(resolve(canonicalDir(cwd), change.path));
      if (pre !== null) {
        resolved = { kind: 'modify', path: change.path, pre, post: change.post };
      }
    }
    return patchTargetPaths(change.path, cwd, repoRoot).map((path) => ({ ...resolved, path }));
  });
}

/** Translate one complete Codex event and maintain its isolated lifecycle evidence. */
export function prepareHook(spec: PrepareHookSpec): PrepareHookOutcome {
  try {
    const payload: unknown = JSON.parse(spec.rawPayload);
    if (!isPlainObject(payload)) throw new Error('payload must be an object');
    if (
      [
        'truncated',
        'toolInputTruncated',
        'tool_input_truncated',
        'inputTruncated',
        'input_truncated',
      ].some((key) => payload[key] === true)
    )
      throw new Error('host payload is truncated');
    if (typeof payload.session_id !== 'string' || payload.session_id.length === 0)
      throw new Error('payload session_id must be a nonempty string');
    if (
      payload.agent_id !== undefined &&
      (typeof payload.agent_id !== 'string' || payload.agent_id.length === 0)
    )
      throw new Error('payload agent_id must be a nonempty string');
    const identity =
      typeof payload.agent_id === 'string'
        ? JSON.stringify([payload.session_id, payload.agent_id])
        : payload.session_id;
    const path = sessionEvidencePath(spec.repoRoot, identity);
    const event = payload.hook_event_name;
    if (event === 'SessionEnd') {
      removeSessionEvidence(path);
      return { outcome: 'recorded' };
    }
    if (event === 'UserPromptSubmit') {
      if (typeof payload.prompt !== 'string') throw new Error('prompt must be a string');
      readSessionEvidence(path);
      return { outcome: 'recorded' };
    }
    if (event === 'PostToolUse') {
      if (typeof payload.tool_name !== 'string' || !isPlainObject(payload.tool_input))
        throw new Error('post-tool payload must name a tool and object input');
      readSessionEvidence(path);
      appendSessionEvidence(path, {
        kind: 'tool',
        name: payload.tool_name,
        args: payload.tool_input,
        ...(typeof payload.success === 'boolean' ? { succeeded: payload.success } : {}),
      });
      return { outcome: 'recorded' };
    }
    if (event !== 'PreToolUse') throw new Error('unsupported hook event');
    if (
      typeof payload.cwd !== 'string' ||
      typeof payload.tool_name !== 'string' ||
      !isPlainObject(payload.tool_input) ||
      typeof payload.tool_input.command !== 'string'
    )
      throw new Error('invalid pre-tool envelope');
    if (![...MUTATING_TOOLS, ...SHELL_TOOLS].includes(payload.tool_name))
      throw new Error(`unsupported tool ${payload.tool_name}`);
    const session = { ...readSessionEvidence(path), userMessages: [] };
    const toolCalls = MUTATING_TOOLS.includes(payload.tool_name)
      ? patchFileChanges(payload.tool_input.command, payload.cwd, spec.repoRoot).map(
          (fileChange) => ({ name: payload.tool_name as string, fileChange }),
        )
      : [
          {
            name: payload.tool_name,
            args: payload.tool_input,
            cwd: relative(canonicalDir(spec.repoRoot), canonicalDir(payload.cwd)) || '.',
          },
        ];
    return {
      outcome: 'check',
      input: {
        toolCalls,
        subagentSpawns: [],
        userMessages: [],
        session,
        tools: { mutating: MUTATING_TOOLS, shell: SHELL_TOOLS, commandArgs: COMMAND_ARGS },
      },
    };
  } catch (error) {
    return {
      outcome: 'unavailable',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
