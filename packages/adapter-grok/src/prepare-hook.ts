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
function canonical(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}
function readPre(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw error;
  }
}
function isDanglingLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}
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
function targetPaths(path: string, cwd: string, root: string): string[] {
  const realRoot = canonical(root);
  const absolute = resolve(canonical(cwd), path);
  const spelled = nameBelow(absolute, realRoot);
  const real = canonicalTarget(absolute);
  if (real === null) return [spelled];
  const realName = nameBelow(real, realRoot);
  return realName === spelled ? [spelled] : [spelled, realName];
}

import { collectFileChanges } from './file-changes.ts';
import { buildCovenantInput } from './up-translate.ts';

/** Translate one complete host event without starting a process. */
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
    const wireEvent = payload.hook_event_name ?? payload.hookEventName;
    const event =
      wireEvent === 'user_prompt_submit'
        ? 'UserPromptSubmit'
        : wireEvent === 'post_tool_use'
          ? 'PostToolUse'
          : wireEvent === 'session_end'
            ? 'SessionEnd'
            : wireEvent;
    if (event === 'UserPromptSubmit' || event === 'PostToolUse' || event === 'SessionEnd')
      return { outcome: 'recorded' };
    if (event !== 'PreToolUse' && event !== 'pre_tool_use')
      throw new Error('unsupported hook event');
    const built = buildCovenantInput(payload);
    if (!built.ok) throw new Error(built.reason);
    if (payload.cwd !== undefined && typeof payload.cwd !== 'string')
      throw new Error('payload cwd must be a string');
    const cwd = typeof payload.cwd === 'string' ? payload.cwd : spec.repoRoot;
    const evidence = collectFileChanges(payload, (path) => readPre(resolve(canonical(cwd), path)));
    const session = undefined;
    return {
      outcome: 'check',
      input: {
        ...built.value,
        toolCalls: built.value.toolCalls
          .flatMap((call, index) =>
            index === 0 && evidence !== null
              ? targetPaths(evidence.path, cwd, spec.repoRoot).map((path) => ({
                  ...call,
                  fileChange: { ...evidence, path },
                }))
              : [call],
          )
          .map((call) =>
            SHELL_TOOLS.includes(call.name)
              ? { ...call, cwd: relative(canonical(spec.repoRoot), canonical(cwd)) || '.' }
              : call,
          ),
        ...(session === undefined ? {} : { session }),
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
