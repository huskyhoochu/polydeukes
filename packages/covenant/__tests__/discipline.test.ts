import type { CovenantInput, DisciplineEntry } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
// COVENANT-10 §4.5 / AC §5.2–5.5 — the pure discipline judge and the registration
// compiler. `judgeDiscipline` decides one DisciplineEntry against a CovenantInput
// (delta / path / command families); `compileDisciplineRegistrations` turns validated
// entries into dispatcher registrations (one per entry, matches closure + serialized
// body args). Neither module exists yet, so this file is RED by construction.
import {
  type CompileDisciplinesSpec,
  compileDisciplineRegistrations,
  type DisciplineJudgeOptions,
  judgeDiscipline,
} from '../src/discipline.ts';
import type { CovenantRegistration } from '../src/dispatch.ts';

// ---------------------------------------------------------------------------
// Fixtures. `guard|harness|kb` appears only inside a discipline's forbid pattern —
// that is the discipline DATA under test (AC §5.7 exempts pattern literals from the
// vocabulary gate). Judge options default to a fixed repo root and shell surface.
// ---------------------------------------------------------------------------

const ROOT = '/repo';

const judgeOpts: DisciplineJudgeOptions = {
  rootDir: ROOT,
  shellTools: ['Bash'],
  commandArgs: ['command'],
};

/** Build a CovenantInput carrying only fileChanges (no toolCalls). */
function inputWithFileChanges(
  fileChanges: { path: string; pre: string | null; post: string }[],
): CovenantInput {
  return { toolCalls: [], subagentSpawns: [], userMessages: [], fileChanges };
}

/** Build a CovenantInput carrying a single tool call. */
function inputWithToolCall(name: string, args: Record<string, unknown>): CovenantInput {
  return { toolCalls: [{ name, args }], subagentSpawns: [], userMessages: [] };
}

// ===========================================================================
// AC §5.2 — delta family `forbid`
// ===========================================================================

describe('judgeDiscipline — forbid delta family (AC §5.2)', () => {
  const forbidHex: DisciplineEntry = { id: 'no-hex', in: ['src/**'], forbid: '#[0-9a-f]{6}' };

  it('breaks when an in-scope edit ADDS a new match, naming the id and the added text', () => {
    // P0 core purpose (roadmap AC verbatim): a genuinely new in-scope match blocks, and the
    // reason cites both the discipline id and the newly matched string. Mutation caught: the
    // added-direction check inverted, or the reason built without id / without the added text.
    const input = inputWithFileChanges([
      { path: 'src/a.css', pre: 'a: 0;', post: 'a: 0;\nb: #123456;' },
    ]);

    const verdict = judgeDiscipline(forbidHex, input, judgeOpts);

    expect(verdict.upheld).toBe(false);
    if (verdict.upheld === false) {
      expect(verdict.reason).toContain('no-hex');
      expect(verdict.reason).toContain('#123456');
    }
  });

  it('upholds a debt-only edit that adds no new match (added semantics)', () => {
    // P0 debt amnesty (roadmap AC verbatim): a file that already carries a match, edited
    // without adding a new one, must pass. Mutation caught: judging on presence in post
    // instead of the added delta — that would block every edit to a debt-bearing file.
    const input = inputWithFileChanges([
      { path: 'src/a.css', pre: 'a: #123456;', post: 'a: #123456;\nmargin: 0;' },
    ]);

    expect(judgeDiscipline(forbidHex, input, judgeOpts)).toEqual({ upheld: true });
  });

  it('upholds a violation added to an out-of-scope file (in scope excludes it)', () => {
    // P0 scoping: `in: ['src/**']` must not judge a docs/ file. Mutation caught: the in
    // glob ignored (every path judged), turning a scoped discipline into a global one.
    const input = inputWithFileChanges([
      { path: 'docs/a.css', pre: 'a: 0;', post: 'a: 0;\nb: #123456;' },
    ]);

    expect(judgeDiscipline(forbidHex, input, judgeOpts)).toEqual({ upheld: true });
  });

  it('upholds a violation added to an except-matched file (except wins over in)', () => {
    // P0 scoping precedence: `except` subtracts from `in`. Mutation caught: except not
    // applied, or in and except OR-combined instead of in-minus-except.
    const scoped: DisciplineEntry = {
      id: 'no-hex',
      in: ['src/**'],
      except: ['src/vendor/**'],
      forbid: '#[0-9a-f]{6}',
    };
    const input = inputWithFileChanges([
      { path: 'src/vendor/a.css', pre: 'a: 0;', post: 'a: 0;\nb: #123456;' },
    ]);

    expect(judgeDiscipline(scoped, input, judgeOpts)).toEqual({ upheld: true });
  });

  it('judges every file change when `in` is absent (absent = all)', () => {
    // P1 default scope: no `in` means the discipline applies to every file change.
    // Mutation caught: an absent `in` defaulting to "match nothing" instead of "match all".
    const noScope: DisciplineEntry = { id: 'no-hex', forbid: '#[0-9a-f]{6}' };
    const input = inputWithFileChanges([
      { path: 'anywhere/a.css', pre: 'a: 0;', post: 'a: 0;\nb: #123456;' },
    ]);

    expect(judgeDiscipline(noScope, input, judgeOpts).upheld).toBe(false);
  });

  it('relativizes an absolute in-scope path against rootDir before matching', () => {
    // P0 path relativization (PRD §4.5, segment-prefix lesson): an absolute path under
    // rootDir must be relativized so `src/**` matches it. Mutation caught: absolute paths
    // matched raw against the relative glob (they never match → discipline silently skipped).
    const input = inputWithFileChanges([
      { path: '/repo/src/a.css', pre: 'a: 0;', post: 'a: 0;\nb: #123456;' },
    ]);

    expect(judgeDiscipline(forbidHex, input, judgeOpts).upheld).toBe(false);
  });

  it('upholds when an absolute path is outside rootDir (never matches)', () => {
    // P0 scope boundary: a path outside the repo root is out of scope by declaration.
    // Mutation caught: a relativization that produces `../…` still being fed to the glob
    // and matching, judging files outside the repo.
    const input = inputWithFileChanges([
      { path: '/elsewhere/src/a.css', pre: 'a: 0;', post: 'a: 0;\nb: #123456;' },
    ]);

    expect(judgeDiscipline(forbidHex, input, judgeOpts)).toEqual({ upheld: true });
  });

  it('breaks a new file (pre=null) whose post contains a match (all post is added)', () => {
    // P0 creation (roadmap AC): a newly created in-scope file with a match has no debt to
    // forgive. Mutation caught: pre=null coerced to a post-equal baseline (would forgive
    // brand-new violations in a created file).
    const input = inputWithFileChanges([{ path: 'src/new.css', pre: null, post: 'b: #123456;' }]);

    expect(judgeDiscipline(forbidHex, input, judgeOpts).upheld).toBe(false);
  });

  it('produces the same verdict for the string shorthand and the { added } object form', () => {
    // P0 equivalence (roadmap AC): string shorthand ≡ { added } on the same fixture.
    // Mutation caught: the two forms routed to different judgment paths, so only one
    // enforces the pattern.
    const stringForm: DisciplineEntry = { id: 'no-hex', in: ['src/**'], forbid: '#[0-9a-f]{6}' };
    const objectForm: DisciplineEntry = {
      id: 'no-hex',
      in: ['src/**'],
      forbid: { added: '#[0-9a-f]{6}' },
    };
    const input = inputWithFileChanges([
      { path: 'src/a.css', pre: 'a: 0;', post: 'a: 0;\nb: #123456;' },
    ]);

    expect(judgeDiscipline(stringForm, input, judgeOpts)).toEqual(
      judgeDiscipline(objectForm, input, judgeOpts),
    );
  });

  it('upholds when there are no file changes at all (defensive re-check)', () => {
    // P1 no-evidence: routing would not have matched, but the judge must uphold rather than
    // throw when fileChanges is absent. Mutation caught: an undefined fileChanges deref.
    const noFc: CovenantInput = { toolCalls: [], subagentSpawns: [], userMessages: [] };

    expect(judgeDiscipline(forbidHex, noFc, judgeOpts)).toEqual({ upheld: true });
  });
});

// ===========================================================================
// AC §5.3 — path family `immutable`
// ===========================================================================

describe('judgeDiscipline — immutable path family (AC §5.3)', () => {
  const immutable: DisciplineEntry = { id: 'lockfile', immutable: ['config/*.lock'] };

  it('breaks a modification (pre !== null) of a glob-matching file, naming id and path', () => {
    // P0 (roadmap AC verbatim): editing an existing immutable file is forbidden. Mutation
    // caught: the pre!==null condition dropped, or the reason omitting id/path.
    const input = inputWithFileChanges([{ path: 'config/a.lock', pre: 'old', post: 'new' }]);

    const verdict = judgeDiscipline(immutable, input, judgeOpts);

    expect(verdict.upheld).toBe(false);
    if (verdict.upheld === false) {
      expect(verdict.reason).toContain('lockfile');
      expect(verdict.reason).toContain('config/a.lock');
    }
  });

  it('upholds creation (pre === null) of a glob-matching file', () => {
    // P0 across-boundary (roadmap AC verbatim): creating the file is allowed; only mutation
    // is forbidden. Mutation caught: pre===null also treated as a break (blocks first
    // authoring), or the pre check ignored entirely.
    const input = inputWithFileChanges([{ path: 'config/a.lock', pre: null, post: 'seed' }]);

    expect(judgeDiscipline(immutable, input, judgeOpts)).toEqual({ upheld: true });
  });

  it('upholds a modification of a non-matching path', () => {
    // P0 scope: a path outside the immutable glob is not judged. Mutation caught: the glob
    // ignored so every modification breaks.
    const input = inputWithFileChanges([{ path: 'src/a.ts', pre: 'old', post: 'new' }]);

    expect(judgeDiscipline(immutable, input, judgeOpts)).toEqual({ upheld: true });
  });
});

// ===========================================================================
// AC §5.4 — command family `forbidCommand`
// ===========================================================================

describe('judgeDiscipline — forbidCommand command family (AC §5.4)', () => {
  const forbidCmd: DisciplineEntry = { id: 'hooks-armed', forbidCommand: 'LEFTHOOK=(0|false)\\b' };

  it('breaks a shell tool call whose command arg matches the pattern', () => {
    // P0 (roadmap AC verbatim): a matching command on a shell tool blocks. Mutation caught:
    // the pattern not tested against the named command arg, or the shell-tool filter
    // inverted so nothing is judged.
    const input = inputWithToolCall('Bash', { command: 'LEFTHOOK=0 git push' });

    const verdict = judgeDiscipline(forbidCmd, input, judgeOpts);

    expect(verdict.upheld).toBe(false);
    if (verdict.upheld === false) {
      expect(verdict.reason).toContain('hooks-armed');
    }
  });

  it('upholds a shell tool call whose command does not match', () => {
    // P0 across-boundary: an unrelated command passes. Mutation caught: a match function
    // that always reports a break.
    const input = inputWithToolCall('Bash', { command: 'git status' });

    expect(judgeDiscipline(forbidCmd, input, judgeOpts)).toEqual({ upheld: true });
  });

  it('does not judge a matching command string on a NON-shell tool call', () => {
    // P0 (roadmap AC §5.4): only tool calls whose name is in opts.shellTools participate.
    // A matching string sitting in a non-shell tool's args must be ignored. Mutation caught:
    // the shell-tool name filter dropped, so any tool carrying the string would be judged.
    const input = inputWithToolCall('Edit', {
      file_path: 'x',
      old_string: 'a',
      new_string: 'LEFTHOOK=0 make',
    });

    expect(judgeDiscipline(forbidCmd, input, judgeOpts)).toEqual({ upheld: true });
  });
});

// ===========================================================================
// AC §5.5 — the registration compiler
// ===========================================================================

describe('compileDisciplineRegistrations — registration shape (AC §5.5)', () => {
  const forbidEntry: DisciplineEntry = { id: 'no-hex', in: ['src/**'], forbid: '#[0-9a-f]{6}' };
  const cmdEntry: DisciplineEntry = { id: 'hooks-armed', forbidCommand: 'LEFTHOOK=(0|false)\\b' };

  function specWith(disciplines: DisciplineEntry[]): CompileDisciplinesSpec {
    return {
      disciplines,
      rootDir: ROOT,
      bodyCommand: '/usr/bin/node',
      bodyModulePath: '/repo/discipline-body.js',
      shellTools: ['Bash'],
      commandArgs: ['command'],
    };
  }

  it('emits one registration per entry with label=id, empty protectedPaths, and the serialized body args', () => {
    // P0 compiler contract: each entry becomes exactly one registration whose label is the
    // id, whose protectedPaths is [] (routing is by the matches closure, not path mention),
    // and whose body serializes the entry + assembly values as CLI args. Mutation caught:
    // the arg vector built in the wrong order / missing the --discipline JSON / dropping the
    // repeated --shell-tool / --command-arg pairs.
    const regs = compileDisciplineRegistrations(specWith([forbidEntry, cmdEntry]));

    expect(regs).toHaveLength(2);
    expect(regs[0].label).toBe('no-hex');
    expect(regs[0].protectedPaths).toEqual([]);
    expect(regs[0].body.command).toBe('/usr/bin/node');
    expect(regs[0].body.args).toEqual([
      '/repo/discipline-body.js',
      '--discipline',
      JSON.stringify(forbidEntry),
      '--root-dir',
      ROOT,
      '--shell-tool',
      'Bash',
      '--command-arg',
      'command',
    ]);
    expect(regs[1].label).toBe('hooks-armed');
  });

  it('passes the escapeHatch through to each registration when provided', () => {
    // P1: the per-entry registration is the natural seat for a per-discipline hatch. Mutation
    // caught: the escapeHatch field dropped during compilation (would strip a configured
    // bypass and silently harden every discipline).
    const hatch: NonNullable<CovenantRegistration['escapeHatch']> = () => false;
    const regs = compileDisciplineRegistrations({ ...specWith([forbidEntry]), escapeHatch: hatch });

    expect(regs[0].escapeHatch).toBe(hatch);
  });

  it('throws (fail-fast assembly) on a structurally invalid entry (non-compilable regex)', () => {
    // P0 fail-fast: a broken pattern must halt assembly, never produce a registration whose
    // body would later crash. Mutation caught: the compilability probe dropped from the
    // compiler, deferring the crash to judge time.
    expect(() => compileDisciplineRegistrations(specWith([{ id: 'bad', forbid: '(' }]))).toThrow();
  });
});

describe('compileDisciplineRegistrations — matches closure (AC §5.5, PRD §4.4)', () => {
  const forbidEntry: DisciplineEntry = { id: 'no-hex', in: ['src/**'], forbid: '#[0-9a-f]{6}' };
  const immutableEntry: DisciplineEntry = { id: 'lockfile', immutable: ['config/*.lock'] };
  const cmdEntry: DisciplineEntry = { id: 'hooks-armed', forbidCommand: 'LEFTHOOK=(0|false)\\b' };

  function compileOne(entry: DisciplineEntry): CovenantRegistration {
    const [reg] = compileDisciplineRegistrations({
      disciplines: [entry],
      rootDir: ROOT,
      bodyCommand: '/usr/bin/node',
      bodyModulePath: '/repo/discipline-body.js',
      shellTools: ['Bash'],
      commandArgs: ['command'],
    });
    return reg;
  }

  it('forbid matches returns the relativized in-scope path for a matching file change', () => {
    // P0 content-predicate routing (PRD §4.4): a matched forbid entry routes with its
    // relativized path as the telemetry subject. Mutation caught: matches returning the raw
    // absolute path (subject noise) or null (route missed, discipline never spawns).
    const reg = compileOne(forbidEntry);
    const input = inputWithFileChanges([
      { path: '/repo/src/a.css', pre: 'a: 0;', post: 'a: 0;\nb: #123456;' },
    ]);

    expect(reg.matches?.(input)).toBe('src/a.css');
  });

  it('forbid matches returns null for an out-of-scope file change', () => {
    // P0 routing filter: an out-of-scope change must not route (no wasted spawn). Mutation
    // caught: matches returning non-null regardless of scope (routes every input).
    const reg = compileOne(forbidEntry);
    const input = inputWithFileChanges([{ path: 'docs/a.css', pre: 'a: 0;', post: 'b: #123456;' }]);

    expect(reg.matches?.(input)).toBeNull();
  });

  it('immutable matches returns the relativized in-scope path for a matching change', () => {
    // P1 path-family routing: an immutable-glob match routes with its path subject.
    const reg = compileOne(immutableEntry);
    const input = inputWithFileChanges([{ path: '/repo/config/a.lock', pre: 'x', post: 'y' }]);

    expect(reg.matches?.(input)).toBe('config/a.lock');
  });

  it('forbidCommand matches returns "-" when a shell command matches the pattern', () => {
    // P0 command-family routing (PRD §4.4): a content pre-match on the command surfaces a
    // non-path subject '-'. Mutation caught: matches returning null despite a matching
    // command (the command discipline would never route — the routing-gap this ticket fixes).
    const reg = compileOne(cmdEntry);
    const input = inputWithToolCall('Bash', { command: 'LEFTHOOK=0 git push' });

    expect(reg.matches?.(input)).toBe('-');
  });

  it('forbidCommand matches returns null when no shell command matches', () => {
    // P0 across-boundary: an unrelated command must not route. Mutation caught: the pattern
    // test dropped so every Bash call routes.
    const reg = compileOne(cmdEntry);
    const input = inputWithToolCall('Bash', { command: 'git status' });

    expect(reg.matches?.(input)).toBeNull();
  });
});

// ===========================================================================
// AC §5.5 — data-only extensibility (adding a discipline is data, not code)
// ===========================================================================

describe('discipline extensibility — a fresh entry works with no other setup (AC §5.5)', () => {
  it('compiles and judges an arbitrary third discipline through the same code path', () => {
    // P0 (roadmap AC "규율 추가는 데이터만"): an entirely new entry the code never saw must
    // compile into a working registration AND its judge/matches must behave — proving zero
    // core edits are needed to add a discipline. Mutation caught: any per-id special-casing
    // in the compiler or judge that would make an unregistered id inert.
    const fresh: DisciplineEntry = { id: 'no-todo', in: ['app/**'], forbid: '\\bTODO\\b' };

    const [reg] = compileDisciplineRegistrations({
      disciplines: [fresh],
      rootDir: ROOT,
      bodyCommand: '/usr/bin/node',
      bodyModulePath: '/repo/discipline-body.js',
      shellTools: ['Bash'],
      commandArgs: ['command'],
    });
    const input = inputWithFileChanges([
      { path: 'app/x.ts', pre: 'const a = 1;', post: 'const a = 1; // TODO fix' },
    ]);

    expect(reg.label).toBe('no-todo');
    expect(reg.matches?.(input)).toBe('app/x.ts');
    const verdict = judgeDiscipline(fresh, input, judgeOpts);
    expect(verdict.upheld).toBe(false);
    if (verdict.upheld === false) {
      expect(verdict.reason).toContain('no-todo');
      expect(verdict.reason).toContain('TODO');
    }
  });
});
