import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerHook } from '../src/register-hook.ts';

const HOST: string = 'grok';
const SETTINGS = '.grok/hooks/covenant-pretooluse.json';
const FOREIGN = 'printf user-owned-handler';
let projectRoot: string;
beforeEach(() => {
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "pdks-register-quote' space-")));
});
afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});
function install(executable = join(projectRoot, "bin's space", 'pdks')) {
  return registerHook({ projectRoot, command: { executable, args: [] } });
}
function writeSettings(value: unknown) {
  mkdirSync(dirname(join(projectRoot, SETTINGS)), { recursive: true });
  writeFileSync(join(projectRoot, SETTINGS), JSON.stringify(value));
}
function settings() {
  return readFileSync(join(projectRoot, SETTINGS), 'utf8');
}
function ownedHandlers(text = settings()): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
    } else if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (
        typeof record.command === 'string' &&
        (record.command.includes('pdks') ||
          (Array.isArray(record.args) &&
            record.args.some(
              (argument) => typeof argument === 'string' && argument.includes('pdks'),
            ))) &&
        !record.command.includes(FOREIGN)
      )
        result.push(record);
      for (const child of Object.values(record)) visit(child);
    }
  }
  visit(JSON.parse(text));
  return result;
}

describe('registerHook direct executable contract', () => {
  it('executes the registered literal root and executable through the host command form', () => {
    // Lost shell quoting turns apostrophes or spaces into extra arguments or shell syntax.
    const executable = join(projectRoot, "bin's space", 'pdks');
    mkdirSync(dirname(executable), { recursive: true });
    writeFileSync(
      executable,
      `#!${process.execPath}\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)))\n`,
    );
    chmodSync(executable, 0o755);
    install(executable);
    const handler = ownedHandlers()[0];
    if (!handler || typeof handler.command !== 'string') throw new Error('missing direct hook');
    const result = Array.isArray(handler.args)
      ? spawnSync(handler.command, handler.args as string[], { encoding: 'utf8' })
      : spawnSync('/bin/sh', ['-c', handler.command], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([
      'adapter',
      HOST,
      'hook',
      '--project-root',
      projectRoot,
    ]);
  });

  it('reports its real registration path and pins every handler to this project', () => {
    // A PATH command can silently run a different installed judge after PATH changes.
    const result = install();
    expect(result.ownedPaths).toContain(SETTINGS);
    const handlers = ownedHandlers();
    expect(handlers.length).toBeGreaterThan(0);
    for (const handler of handlers) {
      const invocation = `${handler.command} ${JSON.stringify(handler.args ?? [])}`;
      expect(invocation).toContain('adapter');
      expect(invocation).toContain(HOST);
      expect(invocation).toContain('--project-root');
      expect(invocation).not.toMatch(/(?:^|\s)node(?:\s|$)|covenant-pretooluse\.mjs/);
    }
    expect(settings()).toContain('pdks');
  });
  it('keeps registration bytes stable on reinstallation and reports no rewritten file', () => {
    // A changed byte invalidates host trust and repeated handlers judge a call twice.
    install();
    const before = settings();
    const result = install();
    expect(settings()).toBe(before);
    expect(result.created).toEqual([]);
    expect(result.updated).toEqual([]);
  });
  it('preserves a sibling handler and user configuration during merging', () => {
    // Replacing the hook array discards the owner's other enforcement tools.
    writeSettings({
      permissions: { allow: ['user-choice'] },
      hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: FOREIGN }] }] },
    });
    install();
    const value = JSON.parse(settings());
    expect(value.permissions).toEqual({ allow: ['user-choice'] });
    expect(settings().split(FOREIGN)).toHaveLength(2);
    expect(ownedHandlers().length).toBeGreaterThan(0);
  });
  it('refuses malformed registration before creating any new adapter artifact', () => {
    // Repairing parse errors by replacement loses owner configuration.
    mkdirSync(dirname(join(projectRoot, SETTINGS)), { recursive: true });
    const broken = '{"hooks":';
    writeFileSync(join(projectRoot, SETTINGS), broken);
    expect(() => install()).toThrow();
    expect(settings()).toBe(broken);
    expect(existsSync(join(projectRoot, '.polydeukes'))).toBe(false);
  });
  it('replaces an owned executable location while keeping only one PreToolUse handler', () => {
    // Reinstallation after moving pdks must not retain the broken old invocation.
    install(join(projectRoot, 'old-location', 'pdks'));
    install(join(projectRoot, 'new-location', 'pdks'));
    expect(settings()).not.toContain('old-location');
    expect(settings()).toContain('new-location');
    const value = JSON.parse(settings());
    const pre = value.hooks.PreToolUse;
    const all = JSON.stringify(pre);
    expect((all.match(/new-location/g) ?? []).length).toBe(1);
  });
  it('preserves a user-modified legacy delegator while migrating its registration', () => {
    // Deleting a modified generated file destroys consumer code even after unregistration.
    const legacy = `.${HOST === 'claude-code' ? 'claude' : HOST}/hooks/covenant-pretooluse.mjs`;
    mkdirSync(dirname(join(projectRoot, legacy)), { recursive: true });
    const custom = '// user customized execution\n';
    writeFileSync(join(projectRoot, legacy), custom);
    writeSettings({
      hooks: {
        PreToolUse: [
          {
            matcher: '*',
            hooks: [
              { type: 'command', command: `node ${legacy}` },
              { type: 'command', command: FOREIGN },
            ],
          },
        ],
      },
    });
    const result = install();
    expect(readFileSync(join(projectRoot, legacy), 'utf8')).toBe(custom);
    expect(result.preserved).toContain(legacy);
    expect(settings()).not.toContain(`node ${legacy}`);
    expect(settings()).toContain(FOREIGN);
  });
});

describe('registerHook write ordering and command prefix', () => {
  it.each(['invalid settings', 'callback failure'])(
    'leaves the registration tree intact after %s',
    (failure) => {
      // Validation must precede scaffold, and failed scaffold must precede any registration edit.
      mkdirSync(dirname(join(projectRoot, SETTINGS)), { recursive: true });
      const original =
        failure === 'invalid settings'
          ? '{"hooks":'
          : '{ "permissions": { "allow": ["user-choice"] } }\n';
      writeFileSync(join(projectRoot, SETTINGS), original);
      const before = readdirSync(projectRoot, { recursive: true }).sort();
      const seen: (readonly string[])[] = [];
      const attempt = () =>
        registerHook({
          projectRoot,
          command: { executable: join(projectRoot, 'pdks'), args: [] },
          beforeWrite: (ownedPaths: readonly string[]) => {
            seen.push([...ownedPaths]);
            throw new Error('scaffold refused');
          },
        });
      if (failure === 'invalid settings') {
        expect(attempt).toThrow();
        expect(seen).toEqual([]);
      } else {
        expect(attempt).toThrow('scaffold refused');
        expect(seen).toHaveLength(1);
        expect(seen[0]).toContain(SETTINGS);
      }
      expect(settings()).toBe(original);
      expect(readdirSync(projectRoot, { recursive: true }).sort()).toEqual(before);
    },
  );
  it('preserves literal command prefix arguments before adapter arguments', () => {
    // Development execution needs Node plus the current CLI entry, in that order.
    const entry = join(projectRoot, "pdks entry's space.cjs");
    writeFileSync(entry, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))\n');
    registerHook({
      projectRoot,
      command: { executable: process.execPath, args: [entry, 'literal prefix'] },
    });
    const handler = ownedHandlers()[0];
    if (!handler || typeof handler.command !== 'string') throw new Error('missing direct hook');
    const result = Array.isArray(handler.args)
      ? spawnSync(handler.command, handler.args as string[], { encoding: 'utf8' })
      : spawnSync('/bin/sh', ['-c', handler.command], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([
      'literal prefix',
      'adapter',
      HOST,
      'hook',
      '--project-root',
      projectRoot,
    ]);
  });
});

const EVENTS = ['PreToolUse', 'UserPromptSubmit', 'PostToolUse', 'SessionEnd'] as const;
const TOOL_EVENT = 'PreToolUse';
const OBSERVE_ONLY_EVENTS = ['UserPromptSubmit', 'PostToolUse', 'SessionEnd'] as const;

function ownedHandlersFor(event: string): Record<string, unknown>[] {
  const groups = (JSON.parse(settings()) as { hooks?: Record<string, unknown> }).hooks?.[event];
  if (!Array.isArray(groups)) return [];
  const result: Record<string, unknown>[] = [];
  for (const group of groups) {
    const handlers = (group as { hooks?: unknown }).hooks;
    if (!Array.isArray(handlers)) continue;
    for (const handler of handlers) {
      if (!handler || typeof handler !== 'object') continue;
      const record = handler as Record<string, unknown>;
      const command = typeof record.command === 'string' ? record.command : '';
      const args = Array.isArray(record.args) ? record.args : [];
      const owned =
        command.includes('pdks') ||
        args.some((argument) => typeof argument === 'string' && argument.includes('pdks'));
      if (owned && !command.includes(FOREIGN)) result.push(record);
    }
  }
  return result;
}

describe('registerHook failure conversion through the registered shell command', () => {
  function ownedCommand(event: string): string {
    const handler = ownedHandlersFor(event)[0];
    if (!handler || typeof handler.command !== 'string') throw new Error('missing owned command');
    return handler.command;
  }
  function run(command: string) {
    return spawnSync('/bin/sh', ['-c', command], { input: '{}' });
  }
  function writeExitScript(code: number): string {
    const executable = join(projectRoot, `exit-${code}.sh`);
    writeFileSync(executable, `#!/bin/sh\nexit ${code}\n`);
    chmodSync(executable, 0o755);
    return executable;
  }

  it('turns a missing executable into status 2 for PreToolUse and leaves an observe-only event non-2', () => {
    // A launch failure before the judge runs must stop the tool call, but the same failure
    // on a prompt event must not lock the session; a shared suffix or none at all breaks
    // one side of that split.
    install(join(projectRoot, 'missing', 'pdks'));

    const pre = run(ownedCommand(TOOL_EVENT));
    expect(pre.status, String(pre.stderr)).toBe(2);

    const observe = run(ownedCommand('UserPromptSubmit'));
    expect(observe.status, String(observe.stderr)).not.toBe(2);
  });

  it.each([
    [0, 0],
    [2, 2],
    [3, 2],
  ])('maps executable exit %i through PreToolUse to status %i', (code, expected) => {
    // The wrapper must preserve the judge's pass and block (0, 2) and fold every other
    // failure (3, signals) into 2; a bare command would leave exit 3 unconverted.
    install(writeExitScript(code));

    const result = run(ownedCommand(TOOL_EVENT));
    expect(result.status, String(result.stderr)).toBe(expected);
  });
});

describe('registerHook failure conversion', () => {
  it('blocks a failed PreToolUse launch while leaving observe-only events unblocked', () => {
    // A judge that cannot start must still stop the tool call, but converting a failed
    // prompt or session-end event into a block locks a session nobody can recover inside.
    install();
    const pre = ownedHandlersFor(TOOL_EVENT);
    expect(pre).toHaveLength(1);
    expect(pre[0]?.command).toMatch(/ \|\| exit 2$/);
    for (const event of OBSERVE_ONLY_EVENTS) {
      const handlers = ownedHandlersFor(event);
      expect(handlers).toHaveLength(1);
      expect(handlers[0]?.command).not.toMatch(/\|\| exit 2/);
    }
  });

  it('migrates a previously owned PreToolUse handler without stacking a second one', () => {
    // The older registration form has no failure exit; re-running init must replace it, or
    // the owned handler count grows by one on every install.
    install();
    const value = JSON.parse(settings());
    for (const group of value.hooks[TOOL_EVENT] ?? []) {
      for (const handler of group.hooks ?? []) {
        if (typeof handler.command === 'string') {
          handler.command = handler.command.replace(/ \|\| exit 2$/, '');
        }
      }
    }
    writeFileSync(join(projectRoot, SETTINGS), JSON.stringify(value));
    install();
    for (const event of EVENTS) expect(ownedHandlersFor(event)).toHaveLength(1);
    expect(ownedHandlersFor(TOOL_EVENT)[0]?.command).toMatch(/ \|\| exit 2$/);
  });
});
