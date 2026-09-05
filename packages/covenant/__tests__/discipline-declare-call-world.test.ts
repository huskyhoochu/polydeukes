import type { CovenantInput, DisciplineEntry, FileChange } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
// The call world. A shell call that changes no in-scope file is still one observation, so
// `worldsFromInput` yields one world for it — `{ path: '-', world: { changes: [], command } }`,
// no `target.path`. When the call also changes files, the file worlds are the observation
// and each carries the same `command`; there is no call world beside them. The shell surface
// (`shellTools` · `commandArgs`) is what tells the world builder which call is a shell call:
// an empty surface (the commit root) yields no `command` and no call world. Whether a
// declaration applies to the call world is its scope's decision: a `target.path` scope finds
// no string and refuses, a command-scoped declaration judges it.
//
// Tool names, argument names, patterns, and paths are fixture values.
import {
  type CompileDisciplinesSpec,
  compileDisciplineRegistrations,
  worldsFromInput,
} from '../src/discipline.ts';
import type { CovenantRegistration } from '../src/dispatch.ts';

const ROOT = '/repo';
const SHELL_TOOL = 'Bash';
const COMMAND_ARG = 'command';
const EDIT_TOOL = 'Edit';
const PATH_SOURCE = 'target.path';
const COMMAND_SOURCE = 'command';
const CALL_SUBJECT = '-';
const ID = 'pnpm-only';
const ENTRY = 'no-npm-mutation';
const BANNED_COMMAND = 'npm link --help';
const ALLOWED_COMMAND = 'pnpm add left-pad';
const SECOND_COMMAND = 'ls -la';
const FILE_A: FileChange = { kind: 'create', path: 'lib/a.txt', post: 'a' };
const FILE_B: FileChange = { kind: 'create', path: 'lib/b.txt', post: 'b' };

/** The ban over the command line: matched lines empty, no scope. */
const FORBIDDEN_COMMAND = {
  mechanism: 'forbidden-command',
  scope: { source: COMMAND_SOURCE },
  extract: {
    hits: [
      { op: 'source', of: COMMAND_SOURCE },
      { op: 'lines' },
      { op: 'matches', re: '\\bnpm (install|i|add|link)\\b' },
    ],
  },
  relate: [{ id: ENTRY, relation: { op: 'empty', of: 'hits' }, message: '{value}' }],
};

/** A path-scoped declaration reading nothing but the path. */
const PATH_SCOPED = {
  mechanism: 'naming',
  scope: { source: PATH_SOURCE, include: ['^lib/'] },
  extract: {
    outside: [
      { op: 'source', of: PATH_SOURCE },
      { op: 'matches', re: '^(?!lib/)' },
    ],
  },
  relate: [{ id: 'placed', relation: { op: 'empty', of: 'outside' }, message: '{value}' }],
};

/** A declaration scoped on the command line itself, breaking on every call it admits. */
const COMMAND_SCOPED = {
  mechanism: 'forbidden-command',
  scope: { source: COMMAND_SOURCE, include: ['\\bnpm\\b'] },
  extract: {
    hits: [{ op: 'source', of: COMMAND_SOURCE }, { op: 'lines' }],
  },
  relate: [{ id: ENTRY, relation: { op: 'empty', of: 'hits' }, message: '{value}' }],
};

/** A shell call, optionally carrying the file change the surface derived from it. */
function shellCall(command: string, fileChange?: FileChange) {
  return {
    name: SHELL_TOOL,
    args: { [COMMAND_ARG]: command },
    ...(fileChange !== undefined && { fileChange }),
  };
}

/** An edit call carrying its file change. */
function editCall(fileChange: FileChange) {
  return { name: EDIT_TOOL, args: { file_path: fileChange.path }, fileChange };
}

function inputOf(...toolCalls: CovenantInput['toolCalls']): CovenantInput {
  return { toolCalls, subagentSpawns: [], userMessages: [] };
}

/** The shell surface every case uses unless it states an empty one. */
const SHELL_SURFACE = { shellTools: [SHELL_TOOL], commandArgs: [COMMAND_ARG] };

function specWith(
  declare: Record<string, unknown>,
  extra: Partial<CompileDisciplinesSpec> = {},
): CompileDisciplinesSpec {
  return {
    disciplines: [{ id: ID, declare } as unknown as DisciplineEntry],
    rootDir: ROOT,
    ...SHELL_SURFACE,
    readPreState: () => null,
    ...extra,
  };
}

function bodyRegOf(regs: CovenantRegistration[]): CovenantRegistration {
  const reg = regs.find((r) => r.label === ID && r.skip === undefined);
  if (reg === undefined) throw new Error(`no body registration compiled for ${ID}`);
  return reg;
}

type BodyOutcome = {
  exitCode: number;
  reason?: string;
  witnesses?: readonly { id: string; witnesses: readonly { key: string; value: unknown }[] }[];
};

describe('worldsFromInput — the call world', () => {
  it('a shell call with no file change yields one world at subject `-` carrying changes and command, no target.path', () => {
    // A builder that yields worlds from file changes alone answers `[]` here, and every
    // shell call passes with no row. The exact key set forbids a fabricated `target.path`
    // — an empty string under it would satisfy a `target.path` scope's regex `^` and route
    // every path declaration onto the call.
    const worlds = worldsFromInput({
      input: inputOf(shellCall(BANNED_COMMAND)),
      rootDir: ROOT,
      ...SHELL_SURFACE,
    });

    expect(worlds).toEqual([
      { path: CALL_SUBJECT, world: { changes: [], [COMMAND_SOURCE]: BANNED_COMMAND } },
    ]);
  });

  it('a shell call beside a file change yields the file world alone — no world at `-`', () => {
    // Two worlds for one observation would leave two rows per call, and the call world's
    // empty `changes` would let a change-set declaration judge an observation that has one.
    const worlds = worldsFromInput({
      input: inputOf(editCall(FILE_A), shellCall(BANNED_COMMAND)),
      rootDir: ROOT,
      ...SHELL_SURFACE,
    });

    expect(worlds.map((entry) => entry.path)).toEqual([FILE_A.path]);
  });

  it('every file world carries the FIRST shell call’s command string', () => {
    // A builder that attaches `command` to the first world only leaves a ban silent on the
    // second file; one that reads the last shell call judges a command the declaration
    // never gated on.
    const worlds = worldsFromInput({
      input: inputOf(shellCall(BANNED_COMMAND, FILE_A), shellCall(SECOND_COMMAND, FILE_B)),
      rootDir: ROOT,
      ...SHELL_SURFACE,
    });

    expect(worlds.map((entry) => entry.world)).toEqual([
      {
        [PATH_SOURCE]: FILE_A.path,
        post: FILE_A.post,
        changes: [FILE_A.path, FILE_B.path],
        [COMMAND_SOURCE]: BANNED_COMMAND,
      },
      {
        [PATH_SOURCE]: FILE_B.path,
        post: FILE_B.post,
        changes: [FILE_A.path, FILE_B.path],
        [COMMAND_SOURCE]: BANNED_COMMAND,
      },
    ]);
  });

  it('an empty shell surface yields no call world and no command on a file world', () => {
    // The commit root injects no shell tools. A builder that recognises a shell call by the
    // tool name it knows (rather than the surface it was given) hands the commit surface a
    // `command` it never observed, and a `-` world for a staged change it never dispatched.
    const bare = worldsFromInput({
      input: inputOf(shellCall(BANNED_COMMAND)),
      rootDir: ROOT,
      shellTools: [],
      commandArgs: [],
    });
    const beside = worldsFromInput({
      input: inputOf(shellCall(BANNED_COMMAND, FILE_A)),
      rootDir: ROOT,
      shellTools: [],
      commandArgs: [],
    });

    expect(bare).toEqual([]);
    expect(beside.map((entry) => entry.path)).toEqual([FILE_A.path]);
    expect(beside[0]?.world).not.toHaveProperty(COMMAND_SOURCE);
  });
});

describe('compileDisciplineRegistrations — the call world through a declaration', () => {
  it('a command-scoped declaration routes a bare shell call to `-` and breaks on the matched line', async () => {
    // The whole path: the world is built, the command scope admits it, the ban
    // judges the command string. A route that answers null for a call with no file change
    // leaves the forbidden command with no row.
    const reg = bodyRegOf(compileDisciplineRegistrations(specWith(FORBIDDEN_COMMAND)));
    const input = inputOf(shellCall(BANNED_COMMAND));

    expect(reg.matches?.(input)).toBe(CALL_SUBJECT);
    const outcome = (await reg.body?.(input)) as BodyOutcome;
    expect(outcome.exitCode).toBe(1);
    expect(outcome.reason).toContain(ID);
    expect(outcome.witnesses?.map((w) => w.witnesses.map((x) => x.value))).toEqual([
      [BANNED_COMMAND],
    ]);
  });

  it('a command-scoped declaration passes a shell call the pattern does not match', async () => {
    // The other direction: the call world routes, and the judgment is a judgment — a body
    // that breaks on every call world (say, an absent `command` read as a match) pushes
    // every shell call to the valve.
    const reg = bodyRegOf(compileDisciplineRegistrations(specWith(FORBIDDEN_COMMAND)));
    const input = inputOf(shellCall(ALLOWED_COMMAND));

    expect(reg.matches?.(input)).toBe(CALL_SUBJECT);
    const outcome = (await reg.body?.(input)) as BodyOutcome;
    expect(outcome.exitCode).toBe(0);
  });

  it('a command-scoped declaration admits the shell call its include matches and refuses the one it does not', async () => {
    // The scope reads `command` as a string like any other fixed source: the live history
    // declarations (`merge-is-the-users-call`, `branches-come-from-a-ticket`) stand on this
    // path. A scope that only validates but never admits leaves them with no row at all.
    const reg = bodyRegOf(compileDisciplineRegistrations(specWith(COMMAND_SCOPED)));

    expect(reg.matches?.(inputOf(shellCall(SECOND_COMMAND)))).toBeNull();
    const input = inputOf(shellCall(BANNED_COMMAND));
    expect(reg.matches?.(input)).toBe(CALL_SUBJECT);
    const outcome = (await reg.body?.(input)) as BodyOutcome;
    expect(outcome.exitCode).toBe(1);
  });

  it('a command-scoped declaration compiles no shell skip arm — an uncomputable write in the same call is not its row', () => {
    // The ban judges the command line in its own world; a skip arm would admit the first
    // uncomputable path of the same call and mint a second row under the ban's label.
    const regs = compileDisciplineRegistrations(specWith(FORBIDDEN_COMMAND));

    expect(regs.filter((r) => r.label === ID && r.skip !== undefined)).toEqual([]);
    expect(
      regs
        .find((r) => r.label === ID)
        ?.matches?.(inputOf(shellCall('sed -i s/a/b/ notes.txt && npm link x'))),
    ).toBe(CALL_SUBJECT);
  });

  it('a target.path-scoped declaration does not route a bare shell call — the scope finds no string', () => {
    // No special case for the call world: the scope decides. A route that admits a world
    // lacking the scope's source (absence read as "no exclusion applies") hands every
    // path declaration a subject `-` and judges a path that is not there.
    const reg = bodyRegOf(compileDisciplineRegistrations(specWith(PATH_SCOPED)));

    expect(reg.matches?.(inputOf(shellCall(BANNED_COMMAND)))).toBeNull();
  });

  it('under an empty shell surface a command-reading declaration does not route a shell call', () => {
    // The commit root's assembly: no shell tools, so the call is not a shell call and there
    // is no call world. A route that still answers `-` here leaves the commit surface a row
    // for a command it cannot observe.
    const reg = bodyRegOf(
      compileDisciplineRegistrations(
        specWith(FORBIDDEN_COMMAND, { shellTools: [], commandArgs: [] }),
      ),
    );

    expect(reg.matches?.(inputOf(shellCall(BANNED_COMMAND)))).toBeNull();
  });
});
