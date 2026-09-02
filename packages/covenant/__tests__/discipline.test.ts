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

/**
 * Build a CovenantInput whose evidence rides its own tool-call element. Flat pre/post pairs
 * are tagged for the caller: `pre === null` is a create, else a modify.
 */
function inputWithFileChanges(
  fileChanges: { path: string; pre: string | null; post: string }[],
): CovenantInput {
  return {
    toolCalls: fileChanges.map(({ path, pre, post }, index) => ({
      name: `call-${index}`,
      args: { file_path: path },
      fileChange:
        pre === null ? { kind: 'create', path, post } : { kind: 'modify', path, pre, post },
    })),
    subagentSpawns: [],
    userMessages: [],
  };
}

/** Build a CovenantInput carrying a single tool call. */
function inputWithToolCall(name: string, args: Record<string, unknown>): CovenantInput {
  return { toolCalls: [{ name, args }], subagentSpawns: [], userMessages: [] };
}

describe('judgeDiscipline — forbid delta family', () => {
  const forbidHex: DisciplineEntry = { id: 'no-hex', in: ['src/**'], forbid: '#[0-9a-f]{6}' };

  it('breaks when an in-scope edit ADDS a new match, naming the id and the added text', () => {
    // The reason must cite both the discipline id and the newly matched string.
    const input = inputWithFileChanges([
      { path: 'src/a.css', pre: 'a: 0;', post: 'a: 0;\nb: #123456;' },
    ]);

    const verdict = judgeDiscipline({ ...judgeOpts, entry: forbidHex, input: input });

    expect(verdict.upheld).toBe(false);
    if (verdict.upheld === false) {
      expect(verdict.reason).toContain('no-hex');
      expect(verdict.reason).toContain('#123456');
    }
  });

  it('upholds a debt-only edit that adds no new match (added semantics)', () => {
    // Judgment is on the added delta, not on presence in post: otherwise every edit to a
    // debt-bearing file blocks.
    const input = inputWithFileChanges([
      { path: 'src/a.css', pre: 'a: #123456;', post: 'a: #123456;\nmargin: 0;' },
    ]);

    expect(judgeDiscipline({ ...judgeOpts, entry: forbidHex, input: input })).toEqual({
      upheld: true,
    });
  });

  it('upholds a violation added to an out-of-scope file (in scope excludes it)', () => {
    // Ignoring the `in` glob turns a scoped discipline into a global one.
    const input = inputWithFileChanges([
      { path: 'docs/a.css', pre: 'a: 0;', post: 'a: 0;\nb: #123456;' },
    ]);

    expect(judgeDiscipline({ ...judgeOpts, entry: forbidHex, input: input })).toEqual({
      upheld: true,
    });
  });

  it('upholds a violation added to an except-matched file (except wins over in)', () => {
    // `except` subtracts from `in`, rather than being OR-combined with it.
    const scoped: DisciplineEntry = {
      id: 'no-hex',
      in: ['src/**'],
      except: ['src/vendor/**'],
      forbid: '#[0-9a-f]{6}',
    };
    const input = inputWithFileChanges([
      { path: 'src/vendor/a.css', pre: 'a: 0;', post: 'a: 0;\nb: #123456;' },
    ]);

    expect(judgeDiscipline({ ...judgeOpts, entry: scoped, input: input })).toEqual({
      upheld: true,
    });
  });

  it('judges every file change when `in` is absent (absent = all)', () => {
    // An absent `in` means every file change, never "match nothing".
    const noScope: DisciplineEntry = { id: 'no-hex', forbid: '#[0-9a-f]{6}' };
    const input = inputWithFileChanges([
      { path: 'anywhere/a.css', pre: 'a: 0;', post: 'a: 0;\nb: #123456;' },
    ]);

    expect(judgeDiscipline({ ...judgeOpts, entry: noScope, input: input }).upheld).toBe(false);
  });

  it('relativizes an absolute in-scope path against rootDir before matching', () => {
    // An absolute path under rootDir must be relativized before the glob sees it: matched
    // raw it never matches, and the discipline goes silently inert.
    const input = inputWithFileChanges([
      { path: '/repo/src/a.css', pre: 'a: 0;', post: 'a: 0;\nb: #123456;' },
    ]);

    expect(judgeDiscipline({ ...judgeOpts, entry: forbidHex, input: input }).upheld).toBe(false);
  });

  it('upholds when an absolute path is outside rootDir (never matches)', () => {
    // A path outside the repo root is out of scope by declaration: a relativization
    // producing `../…` must not be fed to the glob, or files outside the repo get judged.
    const input = inputWithFileChanges([
      { path: '/elsewhere/src/a.css', pre: 'a: 0;', post: 'a: 0;\nb: #123456;' },
    ]);

    expect(judgeDiscipline({ ...judgeOpts, entry: forbidHex, input: input })).toEqual({
      upheld: true,
    });
  });

  it('breaks a new file (pre=null) whose post contains a match (all post is added)', () => {
    // A newly created in-scope file has no debt to forgive: coercing a null pre to a
    // post-equal baseline forgives brand-new violations.
    const input = inputWithFileChanges([{ path: 'src/new.css', pre: null, post: 'b: #123456;' }]);

    expect(judgeDiscipline({ ...judgeOpts, entry: forbidHex, input: input }).upheld).toBe(false);
  });

  it('produces the same verdict for the string shorthand and the { added } object form', () => {
    // The two forms must not route to different judgment paths, leaving only one of them
    // enforcing the pattern.
    const stringForm: DisciplineEntry = { id: 'no-hex', in: ['src/**'], forbid: '#[0-9a-f]{6}' };
    const objectForm: DisciplineEntry = {
      id: 'no-hex',
      in: ['src/**'],
      forbid: { added: '#[0-9a-f]{6}' },
    };
    const input = inputWithFileChanges([
      { path: 'src/a.css', pre: 'a: 0;', post: 'a: 0;\nb: #123456;' },
    ]);

    expect(judgeDiscipline({ ...judgeOpts, entry: stringForm, input: input })).toEqual(
      judgeDiscipline({ ...judgeOpts, entry: objectForm, input: input }),
    );
  });

  it('upholds when there are no file changes at all (defensive re-check)', () => {
    // Routing would not have matched, but the judge must uphold rather than throw when
    // there is no file-change evidence at all.
    const noFc: CovenantInput = { toolCalls: [], subagentSpawns: [], userMessages: [] };

    expect(judgeDiscipline({ ...judgeOpts, entry: forbidHex, input: noFc })).toEqual({
      upheld: true,
    });
  });
});

describe('judgeDiscipline — immutable path family', () => {
  const immutable: DisciplineEntry = { id: 'lockfile', immutable: ['config/*.lock'] };

  it('breaks a modification (pre !== null) of a glob-matching file, naming id and path', () => {
    // The reason must name both the id and the path.
    const input = inputWithFileChanges([{ path: 'config/a.lock', pre: 'old', post: 'new' }]);

    const verdict = judgeDiscipline({ ...judgeOpts, entry: immutable, input: input });

    expect(verdict.upheld).toBe(false);
    if (verdict.upheld === false) {
      expect(verdict.reason).toContain('lockfile');
      expect(verdict.reason).toContain('config/a.lock');
    }
  });

  it('upholds creation (pre === null) of a glob-matching file', () => {
    // Creating the file is allowed; only mutation is forbidden, or the file could never be
    // authored in the first place.
    const input = inputWithFileChanges([{ path: 'config/a.lock', pre: null, post: 'seed' }]);

    expect(judgeDiscipline({ ...judgeOpts, entry: immutable, input: input })).toEqual({
      upheld: true,
    });
  });

  it('upholds a modification of a non-matching path', () => {
    const input = inputWithFileChanges([{ path: 'src/a.ts', pre: 'old', post: 'new' }]);

    expect(judgeDiscipline({ ...judgeOpts, entry: immutable, input: input })).toEqual({
      upheld: true,
    });
  });
});

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
  const forbidEntry: DisciplineEntry = { id: 'no-hex', in: ['src/**'], forbid: '#[0-9a-f]{6}' };
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
    const regs = compileDisciplineRegistrations(specWith([forbidEntry, cmdEntry]));

    // Two judged registrations, then the delta entry's shell skip arm and the common
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
    const regs = compileDisciplineRegistrations({ ...specWith([forbidEntry]), witness: witness });

    expect(regs[0].witness).toBe(witness);
  });

  it('compiles a non-compilable pattern into a skip registration instead of throwing', () => {
    // A broken pattern halting assembly takes every sibling registration and the witness
    // valve with it, leaving no way to edit the config that caused it. It skips alone
    // instead, and routes to nothing, since the pattern that would define its matches is
    // the broken one.
    const [reg] = compileDisciplineRegistrations(specWith([{ id: 'bad', forbid: '(' }]));

    expect(reg.skip).toBeDefined();
    expect(reg.body).toBeUndefined();
    expect(reg.matches?.({ toolCalls: [], subagentSpawns: [], userMessages: [] })).toBeNull();
  });
});

describe('compileDisciplineRegistrations — matches closure', () => {
  const forbidEntry: DisciplineEntry = { id: 'no-hex', in: ['src/**'], forbid: '#[0-9a-f]{6}' };
  const immutableEntry: DisciplineEntry = { id: 'lockfile', immutable: ['config/*.lock'] };
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

  it('forbid matches returns the relativized in-scope path for a matching file change', () => {
    // A matched forbid entry routes with its RELATIVIZED path as the telemetry subject;
    // the raw absolute path is subject noise.
    const reg = compileOne(forbidEntry);
    const input = inputWithFileChanges([
      { path: '/repo/src/a.css', pre: 'a: 0;', post: 'a: 0;\nb: #123456;' },
    ]);

    expect(reg.matches?.(input)).toBe('src/a.css');
  });

  it('forbid matches returns null for an out-of-scope file change', () => {
    const reg = compileOne(forbidEntry);
    const input = inputWithFileChanges([{ path: 'docs/a.css', pre: 'a: 0;', post: 'b: #123456;' }]);

    expect(reg.matches?.(input)).toBeNull();
  });

  it('immutable matches returns the relativized in-scope path for a matching change', () => {
    const reg = compileOne(immutableEntry);
    const input = inputWithFileChanges([{ path: '/repo/config/a.lock', pre: 'x', post: 'y' }]);

    expect(reg.matches?.(input)).toBe('config/a.lock');
  });

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
    const fresh: DisciplineEntry = { id: 'no-todo', in: ['app/**'], forbid: '\\bTODO\\b' };

    const [reg] = compileDisciplineRegistrations({
      disciplines: [fresh],
      rootDir: ROOT,
      shellTools: ['Bash'],
      commandArgs: ['command'],
      readPreState,
    });
    const input = inputWithFileChanges([
      { path: 'app/x.ts', pre: 'const a = 1;', post: 'const a = 1; // TODO fix' },
    ]);

    expect(reg.label).toBe('no-todo');
    expect(reg.matches?.(input)).toBe('app/x.ts');
    const verdict = judgeDiscipline({ ...judgeOpts, entry: fresh, input: input });
    expect(verdict.upheld).toBe(false);
    if (verdict.upheld === false) {
      expect(verdict.reason).toContain('no-todo');
      expect(verdict.reason).toContain('TODO');
    }
  });
});
