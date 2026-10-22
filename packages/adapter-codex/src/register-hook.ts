import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { isPlainObject } from '@polydeukes/core';
import { GENERATED_HOOK, HOOK_COMMAND } from './registration-artifacts.ts';
import { MUTATING_TOOLS, SHELL_TOOLS } from './session-vocabulary.ts';

/** The project and literal process command to register. */
export type RegisterHookSpec = {
  projectRoot: string;
  command: { executable: string; args: readonly string[] };
  beforeWrite?: (ownedPaths: readonly string[]) => void;
};
/** Files created, changed, retained, and protected by this registration. */
export type RegisterHookOutcome = {
  created: string[];
  updated: string[];
  unchanged: string[];
  preserved: string[];
  ownedPaths: string[];
};
const HOST = 'codex';
const SETTINGS = '.codex/hooks.json';
const LEGACY = '.codex/hooks/covenant-pretooluse.mjs';
const EVENTS = ['PreToolUse', 'UserPromptSubmit', 'PostToolUse', 'SessionEnd'] as const;
function quote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
function shellWords(command: string): string[] | undefined {
  const words: string[] = [];
  let position = 0;
  while (position < command.length) {
    if (command[position] !== "'") return undefined;
    position++;
    let word = '';
    while (position < command.length) {
      if (command.startsWith("'\"'\"'", position)) {
        word += "'";
        position += 5;
      } else if (command[position] === "'") {
        position++;
        break;
      } else {
        word += command[position];
        position++;
      }
    }
    words.push(word);
    if (position === command.length) break;
    if (command[position++] !== ' ') return undefined;
  }
  return words;
}
function isOwned(handler: unknown): boolean {
  if (!isPlainObject(handler) || typeof handler.command !== 'string') return false;
  const command = handler.command.replace(/ \|\| exit 2$/, '');
  if (command === HOOK_COMMAND || command === `node ${LEGACY}`) return true;
  const words = Array.isArray(handler.args) ? [command, ...handler.args] : shellWords(command);
  if (
    words === undefined ||
    words.length < 6 ||
    typeof words[0] !== 'string' ||
    !isAbsolute(words[0])
  )
    return false;
  const tail = words.slice(-5);
  return (
    tail[0] === 'adapter' &&
    tail[1] === HOST &&
    tail[2] === 'hook' &&
    tail[3] === '--project-root' &&
    typeof tail[4] === 'string' &&
    isAbsolute(tail[4])
  );
}
/** Merge owned lifecycle handlers while retaining owner configuration. */
export function registerHook(spec: RegisterHookSpec): RegisterHookOutcome {
  if (
    !isAbsolute(spec.projectRoot) ||
    !isAbsolute(spec.command.executable) ||
    ![spec.command.executable, ...spec.command.args, spec.projectRoot].every(
      (part) => typeof part === 'string' && !part.includes('\0'),
    )
  ) {
    throw new Error(
      'registration requires an absolute project root and executable with literal arguments',
    );
  }
  const path = join(spec.projectRoot, SETTINGS);
  const before = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  const existing: unknown = before === undefined ? {} : JSON.parse(before);
  if (!isPlainObject(existing) || (existing.hooks !== undefined && !isPlainObject(existing.hooks)))
    throw new Error(`${SETTINGS} must contain a hooks object`);
  const hooks: Record<string, unknown> = isPlainObject(existing.hooks) ? { ...existing.hooks } : {};
  const args = [...spec.command.args, 'adapter', HOST, 'hook', '--project-root', spec.projectRoot];
  for (const event of EVENTS) {
    if (hooks[event] !== undefined && !Array.isArray(hooks[event]))
      throw new Error(`${event} must be an array`);
    const entries: unknown[] = (hooks[event] as unknown[] | undefined) ?? [];
    const retained: unknown[] = [];
    for (const entry of entries) {
      if (!isPlainObject(entry) || !Array.isArray(entry.hooks)) {
        retained.push(entry);
        continue;
      }
      const siblings = entry.hooks.filter((handler: unknown) => !isOwned(handler));
      if (siblings.length === entry.hooks.length || siblings.length > 0)
        retained.push({ ...entry, hooks: siblings });
    }
    const timeout = event === 'PreToolUse' ? 60 : event === 'SessionEnd' ? 5 : 30;
    const command = [spec.command.executable, ...args].map(quote).join(' ');
    const handler = {
      type: 'command',
      command: event === 'PreToolUse' ? `${command} || exit 2` : command,
      timeout,
    };
    retained.push(
      event === 'PreToolUse' || event === 'PostToolUse'
        ? { matcher: [...MUTATING_TOOLS, ...SHELL_TOOLS].join('|'), hooks: [handler] }
        : { hooks: [handler] },
    );
    hooks[event] = retained;
  }
  const text = `${JSON.stringify({ ...existing, hooks }, null, 2)}\n`;
  const report: RegisterHookOutcome = {
    created: [],
    updated: [],
    unchanged: [],
    preserved: [],
    ownedPaths: [SETTINGS],
  };
  const legacyPath = join(spec.projectRoot, LEGACY);
  const legacy = existsSync(legacyPath) ? readFileSync(legacyPath, 'utf8') : undefined;
  spec.beforeWrite?.(report.ownedPaths);
  if (before === text) report.unchanged.push(SETTINGS);
  else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    (before === undefined ? report.created : report.updated).push(SETTINGS);
  }
  if (legacy !== undefined) {
    if (legacy === GENERATED_HOOK) rmSync(legacyPath);
    else report.preserved.push(LEGACY);
  }

  return report;
}
