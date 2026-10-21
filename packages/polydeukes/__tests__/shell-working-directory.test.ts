import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CovenantInput, DisciplineEntry } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileDisciplineRegistrations } from '../src/covenant/discipline.ts';
import { runCovenantCheck } from '../src/covenant-check.ts';
import { telemetryRows, writeConfigAt } from './helpers.ts';

const SHELL_TOOL = 'fixture-shell';
const WRITE_TOOL = 'fixture-write';
const COMMAND_ARG = 'command';
const SUBDIRECTORY = 'sub';
const PROTECTED_PATH = `${SUBDIRECTORY}/gate.txt`;
const ORDINARY_PATH = 'ordinary.txt';
const TRANSCRIPT_PATH = `${SUBDIRECTORY}/session.jsonl`;
const DECLARATION_ID = 'no-new-lantern';
const BANNED_WORD = 'lantern';
const TOOLS = { mutating: [WRITE_TOOL], shell: [SHELL_TOOL], commandArgs: [COMMAND_ARG] };
let repoRoot: string;
let telemetryPath: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'pdks-shell-cwd-'));
  telemetryPath = join(repoRoot, 'roi.log');
  mkdirSync(join(repoRoot, SUBDIRECTORY));
  writeConfigAt(repoRoot, telemetryPath, { protectedPaths: [PROTECTED_PATH] });
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
});
afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function input(command: string, cwd: string | undefined = SUBDIRECTORY): CovenantInput {
  const call = {
    name: SHELL_TOOL,
    args: { [COMMAND_ARG]: command },
    ...(cwd === undefined ? {} : { cwd }),
  };
  return {
    toolCalls: [call],
    subagentSpawns: [],
    userMessages: [],
    tools: TOOLS,
    session: { toolCalls: [], userMessages: [] },
  };
}
function judge(observation: CovenantInput) {
  return runCovenantCheck({
    surface: 'session',
    repoRoot,
    telemetryPath,
    input: observation,
    enforce: 'block',
  });
}
function write(path: string, text: string) {
  mkdirSync(dirname(join(repoRoot, path)), { recursive: true });
  writeFileSync(join(repoRoot, path), text);
}

// Each command resolves to the protected file through a distinct lexical path boundary.
describe('shell paths use the neutral tool-call working directory', () => {
  it.each([
    ['local redirect', 'printf changed > gate.txt', SUBDIRECTORY],
    ['parent traversal', `printf changed > ../${PROTECTED_PATH}`, SUBDIRECTORY],
    ['absolute target', undefined, SUBDIRECTORY],
    ['legacy root context', `printf changed > ${PROTECTED_PATH}`, undefined],
    ['explicit root context', `printf changed > ${PROTECTED_PATH}`, '.'],
  ] as const)(
    'blocks the protected %s with a shell-mod judgment about that path',
    async (_name, command, cwd) => {
      // Dropping cwd or normalizing the wrong base misses a real protected write.
      const observation = input(
        command ?? `printf changed > ${join(repoRoot, PROTECTED_PATH)}`,
        cwd,
      );
      if (cwd === undefined) delete (observation.toolCalls[0] as { cwd?: string }).cwd;
      const outcome = await judge(observation);
      expect(outcome.exitCode).toBe(2);
      expect(telemetryRows(telemetryPath)).toContainEqual(['blocked', 'shell-mod', PROTECTED_PATH]);
    },
  );

  it.each([
    ['protected reader', 'cat gate.txt', SUBDIRECTORY],
    ['unrelated write', `printf changed > ${ORDINARY_PATH}`, SUBDIRECTORY],
    ['absent context', 'printf changed > gate.txt', undefined],
  ] as const)('allows the %s without inventing a protected write', async (_name, command, cwd) => {
    // A broad prefix match or unconditional cwd application would block unrelated work.
    const observation = input(command);
    if (cwd === undefined) delete (observation.toolCalls[0] as { cwd?: string }).cwd;
    else Object.assign(observation.toolCalls[0] as object, { cwd });
    const outcome = await judge(observation);
    expect(outcome.exitCode).toBe(0);
    const rows = telemetryRows(telemetryPath);
    expect(rows.some(([event]) => event === 'blocked')).toBe(false);
    expect(rows.some(([event]) => event === 'passed')).toBe(true);
    expect(observation.toolCalls[0]?.args?.[COMMAND_ARG]).toBe(command);
  });

  it('allows a sibling directory sharing the protected directory prefix', async () => {
    // A string-prefix comparison treats sub2 as a descendant of sub.
    writeConfigAt(repoRoot, telemetryPath, { protectedPaths: [SUBDIRECTORY] });
    const observation = input('printf changed > gate.txt', `${SUBDIRECTORY}2`);
    const outcome = await judge(observation);
    expect(outcome.exitCode).toBe(0);
    expect(telemetryRows(telemetryPath).some(([event]) => event === 'blocked')).toBe(false);
  });

  it('keeps an attached fileChange root relative instead of adding cwd twice', async () => {
    // File evidence was already normalized by its producer, unlike command text.
    const call = {
      name: WRITE_TOOL,
      cwd: SUBDIRECTORY,
      args: { file_path: 'gate.txt' },
      fileChange: { kind: 'create' as const, path: PROTECTED_PATH, post: 'changed' },
    };
    const observation = input('unused');
    observation.toolCalls = [call];
    const outcome = await judge(observation);
    expect(outcome.exitCode).toBe(2);
    expect(telemetryRows(telemetryPath)).toContainEqual(['blocked', 'self-mod', PROTECTED_PATH]);
  });

  it.each([
    ['append', 'printf forged >> session.jsonl', 2],
    ['read', 'cat session.jsonl', 0],
  ] as const)(
    'judges transcript-relative %s against the session evidence file',
    async (_name, command, exitCode) => {
      // Transcript equality must use the same cwd as protected-path routing.
      write(TRANSCRIPT_PATH, '{}\n');
      const observation = input(command);
      observation.session = {
        toolCalls: [],
        userMessages: [],
        evidencePath: join(repoRoot, TRANSCRIPT_PATH),
      };
      const outcome = await judge(observation);
      expect(outcome.exitCode).toBe(exitCode);
      expect(telemetryRows(telemetryPath)).toContainEqual([
        exitCode === 2 ? 'blocked' : 'passed',
        'transcript-mod',
        join(repoRoot, TRANSCRIPT_PATH),
      ]);
    },
  );
});

const SCOPED_PATH = `${SUBDIRECTORY}/note.txt`;
const ADDED_ONLY_ENTRY = {
  id: DECLARATION_ID,
  enforce: 'block',
  declare: {
    mechanism: 'added-only',
    scope: { source: 'target.path', include: [`^${SUBDIRECTORY}/`] },
    supply: { pre: 'empty', post: 'empty' },
    extract: {
      before: [
        { op: 'source', of: 'pre' },
        { op: 'lines' },
        { op: 'keyByPattern', re: `\\b(${BANNED_WORD})\\b` },
      ],
      after: [
        { op: 'source', of: 'post' },
        { op: 'lines' },
        { op: 'keyByPattern', re: `\\b(${BANNED_WORD})\\b` },
      ],
      added: [{ op: 'onlyIn', of: 'after', notIn: 'before' }],
    },
    relate: [{ id: 'clean', relation: { op: 'empty', of: 'added' }, message: 'adds {key}' }],
  },
};

describe('declaration scope and pre-state use shell cwd together', () => {
  it.each([
    ['new occurrence', 'clean\n', `${BANNED_WORD} old\n`, 2],
    ['existing occurrence', `${BANNED_WORD} old\n`, 'clean\n', 0],
  ] as const)(
    'judges the %s using the subdirectory file rather than a root namesake',
    async (_name, actualPre, rootPre, exitCode) => {
      // Both directions distinguish the right disk pre from a same-named file under the root.
      writeConfigAt(repoRoot, telemetryPath, { disciplines: [ADDED_ONLY_ENTRY] });
      write(SCOPED_PATH, actualPre);
      write('note.txt', rootPre);
      const command = `echo '${BANNED_WORD}' >> note.txt`;
      const observation = input(command);
      const outcome = await judge(observation);
      expect(outcome.exitCode).toBe(exitCode);
      expect(telemetryRows(telemetryPath)).toContainEqual([
        exitCode === 2 ? 'blocked' : 'passed',
        DECLARATION_ID,
        SCOPED_PATH,
      ]);
      expect(observation.toolCalls[0]?.args?.[COMMAND_ARG]).toBe(command);
    },
  );
});

it('reads a shell-derived declaration pre-state once at its cwd-resolved absolute location', async () => {
  // Routing must not perform a second read or hand the reader a root namesake.
  const absolute = join(repoRoot, SCOPED_PATH);
  const readPreState = vi.fn((location: string) =>
    location === absolute ? `${BANNED_WORD} old\n` : null,
  );
  const registrations = compileDisciplineRegistrations({
    disciplines: [ADDED_ONLY_ENTRY as unknown as DisciplineEntry],
    rootDir: repoRoot,
    shellTools: [SHELL_TOOL],
    commandArgs: [COMMAND_ARG],
    readPreState,
  });
  const registration = registrations.find(
    (entry) => entry.label === DECLARATION_ID && entry.skip === undefined,
  );
  if (registration?.body === undefined) throw new Error('expected declaration body');
  const observation = input(`echo '${BANNED_WORD}' >> note.txt`);
  expect(registration.matches?.(observation)).toBe(SCOPED_PATH);
  expect(readPreState).not.toHaveBeenCalled();
  const outcome = await registration.body(observation);
  expect(outcome.exitCode).toBe(0);
  expect(readPreState.mock.calls).toEqual([[absolute]]);
});

it('allows a command with no path argument while its cwd is protected', async () => {
  // Prefixing the command head with cwd would invent a mention of the protected directory.
  writeConfigAt(repoRoot, telemetryPath, { protectedPaths: [SUBDIRECTORY] });
  const outcome = await judge(input('printf hello'));
  expect(outcome.exitCode).toBe(0);
  expect(telemetryRows(telemetryPath)).toContainEqual(['passed', 'covenant-check', '-']);
  expect(telemetryRows(telemetryPath).some(([event]) => event === 'blocked')).toBe(false);
});

it('supplies the exact original command to a command-scoped declaration', async () => {
  // A synthetic cd wrapper changes what an anchored command declaration sees.
  const id = 'literal-command';
  const command = "printf 'literal ../text'";
  writeConfigAt(repoRoot, telemetryPath, {
    sessionDisciplines: [
      {
        id,
        enforce: 'block',
        declare: {
          mechanism: 'forbidden-command',
          scope: { source: 'command' },
          extract: {
            hits: [
              { op: 'source', of: 'command' },
              { op: 'lines' },
              { op: 'matches', re: "^printf 'literal \\.\\./text'$" },
            ],
          },
          relate: [{ id: 'literal', relation: { op: 'empty', of: 'hits' }, message: '{value}' }],
        },
      },
    ],
  });
  const observation = input(command);
  const outcome = await judge(observation);
  expect(outcome.exitCode).toBe(2);
  expect(telemetryRows(telemetryPath)).toContainEqual(['blocked', id, '-']);
  expect(observation.toolCalls[0]?.args?.[COMMAND_ARG]).toBe(command);
});

it('uses the cwd of each shell call in one observation', async () => {
  // Reusing the first context misses the second write under its protected directory.
  const command = 'printf changed > gate.txt';
  const observation = input(command, `${SUBDIRECTORY}2`);
  observation.toolCalls.push(...input(command, SUBDIRECTORY).toolCalls);
  const outcome = await judge(observation);
  expect(outcome.exitCode).toBe(2);
  expect(telemetryRows(telemetryPath).filter(([event]) => event === 'blocked')).toEqual([
    ['blocked', 'shell-mod', PROTECTED_PATH],
  ]);
});
