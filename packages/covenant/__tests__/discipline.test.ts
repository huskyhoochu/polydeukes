import type { CovenantInput, DisciplineEntry } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
// The pure discipline judge and the registration compiler. `judgeDiscipline` decides one
// entry against a CovenantInput across the delta, path, and command families;
// `compileDisciplineRegistrations` turns validated entries into dispatcher registrations.
import {
  type CompileDisciplinesSpec,
  compileDisciplineRegistrations,
  type JudgeDisciplineSpec,
  judgeDiscipline,
} from '../src/discipline.ts';
import type { CovenantRegistration } from '../src/dispatch.ts';

// No fixture here drives a shell-derived write, so the injected pre-state reader is never
// consulted; `null` — the file is not there — is the answer that would make a create if one
// ever were.
const readPreState = () => null;

const ROOT = '/repo';

const judgeOpts: Omit<JudgeDisciplineSpec, 'entry' | 'input'> = {
  rootDir: ROOT,
  shellTools: ['Bash'],
  commandArgs: ['command'],
  readPreState,
};

/** Build a CovenantInput carrying a single tool call. */
function inputWithToolCall(name: string, args: Record<string, unknown>): CovenantInput {
  return { toolCalls: [{ name, args }], subagentSpawns: [], userMessages: [] };
}

describe('judgeDiscipline — forbidCommand command family', () => {
  const forbidCmd: DisciplineEntry = { id: 'hooks-armed', forbidCommand: 'LEFTHOOK=(0|false)\\b' };

  it('breaks a shell tool call whose command arg matches the pattern', () => {
    const input = inputWithToolCall('Bash', { command: 'LEFTHOOK=0 git push' });

    const verdict = judgeDiscipline({ ...judgeOpts, entry: forbidCmd, input: input });

    expect(verdict.upheld).toBe(false);
    if (verdict.upheld === false) {
      expect(verdict.reason).toContain('hooks-armed');
    }
  });

  it('upholds a shell tool call whose command does not match', () => {
    const input = inputWithToolCall('Bash', { command: 'git status' });

    expect(judgeDiscipline({ ...judgeOpts, entry: forbidCmd, input: input })).toEqual({
      upheld: true,
    });
  });

  it('does not judge a matching command string on a NON-shell tool call', () => {
    // Only tool calls whose name is in opts.shellTools participate: without that filter any
    // tool whose args happen to carry the string would be judged as if it ran one.
    const input = inputWithToolCall('Edit', {
      file_path: 'x',
      old_string: 'a',
      new_string: 'LEFTHOOK=0 make',
    });

    expect(judgeDiscipline({ ...judgeOpts, entry: forbidCmd, input: input })).toEqual({
      upheld: true,
    });
  });
});

describe('compileDisciplineRegistrations — registration shape', () => {
  const declareEntry = {
    id: 'no-hex',
    declare: {
      mechanism: 'added-only',
      scope: { source: 'target.path', include: ['^src/'] },
      supply: { pre: 'empty', post: 'empty' },
      extract: {
        before: [
          { op: 'source', of: 'pre' },
          { op: 'lines' },
          { op: 'keyByPattern', re: '(#[0-9a-f]{6})' },
        ],
        after: [
          { op: 'source', of: 'post' },
          { op: 'lines' },
          { op: 'keyByPattern', re: '(#[0-9a-f]{6})' },
        ],
        added: [{ op: 'onlyIn', of: 'after', notIn: 'before' }],
      },
      relate: [
        { id: 'nothing-added', relation: { op: 'empty', of: 'added' }, message: 'adds {key}' },
      ],
    },
  } as unknown as DisciplineEntry;
  const cmdEntry: DisciplineEntry = { id: 'hooks-armed', forbidCommand: 'LEFTHOOK=(0|false)\\b' };

  function specWith(disciplines: DisciplineEntry[], input?: CovenantInput): CompileDisciplinesSpec {
    return {
      disciplines,
      rootDir: ROOT,
      ...(input === undefined ? {} : { input }),
      shellTools: ['Bash'],
      commandArgs: ['command'],
      readPreState,
    };
  }

  it('emits one registration per entry with label=id, empty protectedPaths, and a judging thunk', async () => {
    // Each entry becomes one registration whose label is the id and whose protectedPaths is
    // empty, since routing is by the matches closure rather than path mention. The entry and
    // the assembly values reach the judge by closure, so the wiring is proven by judging an
    // input only THIS entry breaks on.
    const violating: CovenantInput = {
      toolCalls: [
        { name: 'Write', fileChange: { kind: 'create', path: 'src/a.ts', post: '#abcdef\n' } },
      ],
      subagentSpawns: [],
      userMessages: [],
    };
    const regs = compileDisciplineRegistrations(specWith([declareEntry, cmdEntry]));

    // Two judged registrations, then the declaration's shell skip arm and the common
    // shell-unjudgeable backstop.
    expect(regs).toHaveLength(4);
    expect(regs[0].label).toBe('no-hex');
    expect(regs[0].protectedPaths).toEqual([]);
    expect(typeof regs[0].body).toBe('function');

    const outcome = await regs[0].body?.(violating);
    expect(outcome?.exitCode).toBe(1);
    expect(outcome?.reason).toContain('no-hex');
    expect(outcome?.reason).toContain('src/a.ts');

    // The sibling command entry is judged on its own axis, so the same input upholds it.
    expect(regs[1].label).toBe('hooks-armed');
    expect((await regs[1].body?.(violating))?.exitCode).toBe(0);
  });

  it('passes the witness through to each registration when provided', () => {
    // The per-entry registration is the seat of a per-discipline witness: dropping the field
    // during compilation silently hardens every discipline past its configuration.
    const witness: NonNullable<CovenantRegistration['witness']> = () => false;
    const regs = compileDisciplineRegistrations({ ...specWith([cmdEntry]), witness: witness });

    expect(regs[0].witness).toBe(witness);
  });

  it('compiles a non-compilable pattern into a skip registration instead of throwing', () => {
    // A broken pattern halting assembly takes every sibling registration and the witness
    // valve with it, leaving no way to edit the config that caused it. It skips alone
    // instead, and routes to nothing, since the pattern that would define its matches is
    // the broken one.
    const [reg] = compileDisciplineRegistrations(specWith([{ id: 'bad', forbidCommand: '(' }]));

    expect(reg.skip).toBeDefined();
    expect(reg.body).toBeUndefined();
    expect(reg.matches?.({ toolCalls: [], subagentSpawns: [], userMessages: [] })).toBeNull();
  });
});

describe('compileDisciplineRegistrations — matches closure', () => {
  const cmdEntry: DisciplineEntry = { id: 'hooks-armed', forbidCommand: 'LEFTHOOK=(0|false)\\b' };

  function compileOne(entry: DisciplineEntry): CovenantRegistration {
    const [reg] = compileDisciplineRegistrations({
      disciplines: [entry],
      rootDir: ROOT,
      shellTools: ['Bash'],
      commandArgs: ['command'],
      readPreState,
    });
    return reg;
  }

  it('forbidCommand matches returns "-" when a shell command matches the pattern', () => {
    // A command match has no path, so it surfaces the non-path subject '-' rather than
    // failing to route at all.
    const reg = compileOne(cmdEntry);
    const input = inputWithToolCall('Bash', { command: 'LEFTHOOK=0 git push' });

    expect(reg.matches?.(input)).toBe('-');
  });

  it('forbidCommand matches returns null when no shell command matches', () => {
    const reg = compileOne(cmdEntry);
    const input = inputWithToolCall('Bash', { command: 'git status' });

    expect(reg.matches?.(input)).toBeNull();
  });
});

describe('discipline extensibility — a fresh entry works with no other setup', () => {
  it('compiles and judges an arbitrary third discipline through the same code path', () => {
    // Adding a discipline is data, not code: an entry the source never saw must compile
    // into a working registration and judge correctly, so any per-id special-casing in the
    // compiler or judge would leave an unregistered id inert.
    const fresh: DisciplineEntry = { id: 'no-todo', forbidCommand: '\\bTODO\\b' };

    const [reg] = compileDisciplineRegistrations({
      disciplines: [fresh],
      rootDir: ROOT,
      shellTools: ['Bash'],
      commandArgs: ['command'],
      readPreState,
    });
    const input = inputWithToolCall('Bash', { command: 'echo TODO fix' });

    expect(reg.label).toBe('no-todo');
    expect(reg.matches?.(input)).toBe('-');
    const verdict = judgeDiscipline({ ...judgeOpts, entry: fresh, input: input });
    expect(verdict.upheld).toBe(false);
    if (verdict.upheld === false) {
      expect(verdict.reason).toContain('no-todo');
      expect(verdict.reason).toContain('command matches forbidden pattern');
    }
  });
});
