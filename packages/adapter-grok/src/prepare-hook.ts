import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
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
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}
function readPre(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
function rootPath(path: string, cwd: string, root: string): string {
  const target = relative(canonical(root), resolve(canonical(cwd), path));
  if (target === '' || target === '..' || target.startsWith('../') || isAbsolute(target))
    throw new Error('file target is outside the project');
  return target;
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
        toolCalls: (evidence === null
          ? built.value.toolCalls
          : built.value.toolCalls.map((call, index) =>
              index === 0
                ? {
                    ...call,
                    fileChange: {
                      ...evidence,
                      path: rootPath(evidence.path, cwd, spec.repoRoot),
                    },
                  }
                : call,
            )
        ).map((call) =>
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
