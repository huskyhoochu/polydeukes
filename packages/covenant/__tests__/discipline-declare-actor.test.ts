import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CovenantInput, DisciplineEntry, FileChange } from '@polydeukes/core';
import { readRecords } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// The actor in the worlds. `worldsFromInput` puts the input's `actor` object under the key
// `actor` in every world it builds — the file worlds and the call world — and leaves the
// key absent when the input carries none. The same actor value then reaches the same
// verdict through both surfaces' compile paths (`observesChangeSet` true and false): an
// actor declaration reads no change set, so neither flag skips it.
//
// Tool names, argument names, agent names, paths, and command lines are fixture values.
import {
  type CompileDisciplinesSpec,
  compileDisciplineRegistrations,
  worldsFromInput,
} from '../src/discipline.ts';
import { dispatchCovenants } from '../src/dispatch.ts';

const ROOT = '/repo';
const SHELL_TOOL = 'Bash';
const COMMAND_ARG = 'command';
const EDIT_TOOL = 'Edit';
const ACTOR = 'actor';
const PATH_SOURCE = 'target.path';
const COMMAND_SOURCE = 'command';
const CALL_SUBJECT = '-';
const IMPLEMENTER = 'tdd-implementer';
const TEST_FILE = 'packages/core/__tests__/x.test.ts';
const OTHER_TEST_FILE = 'packages/covenant/__tests__/y.test.ts';
const COMMIT = 'git commit -m x';
const SHELL_SURFACE = { shellTools: [SHELL_TOOL], commandArgs: [COMMAND_ARG] };
const NO_SHELL = { shellTools: [], commandArgs: [] };

const TESTS_ID = 'tests-are-the-writers';
const TESTS_ENTRY = 'not-the-implementer';
/** The live declaration: a test file is not the implementer subagent's output. */
const TESTS_ARE_THE_WRITERS = {
  mechanism: 'producer-owned',
  scope: { source: PATH_SOURCE, include: ['^packages/[^/]+/__tests__/.*\\.test\\.ts$'] },
  supply: { [ACTOR]: 'pass' },
  extract: {
    implementer: [
      { op: 'source', of: ACTOR },
      { op: 'select', path: 'agentType' },
      { op: 'matches', re: '^tdd-implementer$' },
    ],
  },
  relate: [
    {
      id: TESTS_ENTRY,
      relation: { op: 'empty', of: 'implementer' },
      message: 'the implementer subagent wrote a test file',
    },
  ],
};

const COMMITS_ID = 'commits-come-from-the-main-session';
const COMMITS_ENTRY = 'main-session-only';
/** The live declaration: a commit command is the main session's. */
const COMMITS_FROM_MAIN = {
  mechanism: 'actor-scope',
  scope: {
    source: COMMAND_SOURCE,
    include: ['(^|[;&|(]\\s*)(git\\s+(commit|push)|tea\\s+pr\\s+merge)\\b'],
  },
  supply: { [ACTOR]: 'pass' },
  extract: {
    subagent: [
      { op: 'source', of: ACTOR },
      { op: 'select', path: 'agentType' },
    ],
  },
  relate: [
    {
      id: COMMITS_ENTRY,
      relation: { op: 'empty', of: 'subagent' },
      message: 'subagent {value} ran a commit command',
    },
  ],
};

const CREATE_TEST: FileChange = { kind: 'create', path: TEST_FILE, post: 'export {};\n' };
const CREATE_OTHER_TEST: FileChange = {
  kind: 'create',
  path: OTHER_TEST_FILE,
  post: 'export {};\n',
};

function editCall(fileChange: FileChange) {
  return { name: EDIT_TOOL, args: { file_path: fileChange.path }, fileChange };
}

function shellCall(command: string) {
  return { name: SHELL_TOOL, args: { [COMMAND_ARG]: command } };
}

/** An input of the given calls, with the actor beside them when one is given. */
function inputOf(
  toolCalls: CovenantInput['toolCalls'],
  actor?: CovenantInput['actor'],
): CovenantInput {
  return {
    toolCalls,
    subagentSpawns: [],
    userMessages: [],
    ...(actor !== undefined && { actor }),
  };
}

function declareEntry(declare: Record<string, unknown>, id: string): DisciplineEntry {
  return { id, declare } as unknown as DisciplineEntry;
}

function specWith(
  disciplines: DisciplineEntry[],
  extra: Partial<CompileDisciplinesSpec> = {},
): CompileDisciplinesSpec {
  return {
    disciplines,
    rootDir: ROOT,
    ...SHELL_SURFACE,
    readPreState: () => null,
    ...extra,
  };
}

/** Every telemetry row under `label` as `{ event, subject, reason, values }`. */
function rowsOf(telemetryPath: string, label: string) {
  return readRecords(telemetryPath)
    .records.filter((record) => record.label === label)
    .map((record) => ({
      event: record.event,
      subject: record.subject,
      reason: record.reason,
      values:
        record.witnesses === undefined
          ? undefined
          : (JSON.parse(record.witnesses) as { witnesses: { value: unknown }[] }[]).map((b) =>
              b.witnesses.map((w) => w.value),
            ),
    }));
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pdks-declare-actor-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('worldsFromInput — the actor key', () => {
  it('every file world of a two-change input carries the input actor under `actor`', () => {
    // A builder attaching the actor to the first world alone leaves the second test file
    // judged as the main session's; one keying it under `agentType` leaves the fixed
    // source `actor` absent and the declaration supply-passes on a proven subagent.
    const actor = { agentType: IMPLEMENTER };
    const worlds = worldsFromInput({
      input: inputOf([editCall(CREATE_TEST), editCall(CREATE_OTHER_TEST)], actor),
      rootDir: ROOT,
      ...NO_SHELL,
    });

    expect(worlds.map((entry) => entry.world[ACTOR])).toEqual([actor, actor]);
  });

  it('the call world of a bare shell call carries the actor beside changes and command', () => {
    // The exact key set: the call world is built on its own path, and a builder that adds
    // the actor in the file-world loop alone leaves every commit command actor-less.
    const actor = { agentType: IMPLEMENTER };
    const worlds = worldsFromInput({
      input: inputOf([shellCall(COMMIT)], actor),
      rootDir: ROOT,
      ...SHELL_SURFACE,
    });

    expect(worlds).toStrictEqual([
      {
        path: CALL_SUBJECT,
        world: { changes: [], [COMMAND_SOURCE]: COMMIT, [ACTOR]: actor },
      },
    ]);
  });

  it('the empty actor {} is carried as {} — the main session is a value, not an absence', () => {
    // The degenerate form: a truthiness or key-count test (`Object.keys(actor).length`)
    // drops `{}`, and the main session lands `skipped supply-pass` on every edit instead
    // of `passed`. `toStrictEqual` so a key holding `undefined` fails too.
    const worlds = worldsFromInput({
      input: inputOf([editCall(CREATE_TEST)], {}),
      rootDir: ROOT,
      ...NO_SHELL,
    });

    expect(worlds.map((entry) => entry.world)).toStrictEqual([
      { [PATH_SOURCE]: TEST_FILE, post: CREATE_TEST.post, changes: [TEST_FILE], [ACTOR]: {} },
    ]);
  });

  it('an input without actor yields worlds without the key — file world and call world alike', () => {
    // Absence is the supply policy's to dispose of. A builder defaulting to `{}` makes the
    // commit surface, which proves no actor, pass every commit as the main session's.
    const fileWorlds = worldsFromInput({
      input: inputOf([editCall(CREATE_TEST)]),
      rootDir: ROOT,
      ...NO_SHELL,
    });
    const callWorlds = worldsFromInput({
      input: inputOf([shellCall(COMMIT)]),
      rootDir: ROOT,
      ...SHELL_SURFACE,
    });

    expect(fileWorlds[0]?.world).not.toHaveProperty(ACTOR);
    expect(callWorlds[0]?.world).not.toHaveProperty(ACTOR);
  });
});

describe('two surfaces, one verdict — the actor declarations under observesChangeSet true and false', () => {
  const FLAGS = [true, false] as const;

  /** Dispatch `input` through `entry` under the flag; the events and rows under its id. */
  async function dispatchUnder(
    observesChangeSet: boolean,
    entry: DisciplineEntry,
    input: CovenantInput,
    telemetry: string,
  ) {
    const regs = compileDisciplineRegistrations(specWith([entry], { observesChangeSet }));
    const { exitCode, results } = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: regs,
      telemetryPath: telemetry,
    });
    return {
      exitCode,
      events: results.filter((r) => r.label === entry.id).map((r) => r.event),
      rows: rowsOf(telemetry, entry.id),
    };
  }

  it.each(
    FLAGS,
  )('observesChangeSet %s: the implementer creating a test file lands advised with the agent type as witness', async (flag) => {
    // Who answered, not only what: an `advised` row under the id with the agent type as
    // the witness. A compiler that skips every declaration on the flag's false end, or
    // a merge that drops the actor on the true end, leaves this row `skipped` or
    // `passed` on one surface and the exit criterion fails.
    const outcome = await dispatchUnder(
      flag,
      declareEntry(TESTS_ARE_THE_WRITERS, TESTS_ID),
      inputOf([editCall(CREATE_TEST)], { agentType: IMPLEMENTER }),
      join(dir, `tests-${flag}.log`),
    );

    expect(outcome.exitCode).toBe(0);
    expect(outcome.events).toEqual(['advised']);
    expect(outcome.rows).toEqual([
      { event: 'advised', subject: TEST_FILE, reason: undefined, values: [[IMPLEMENTER]] },
    ]);
  });

  it.each(
    FLAGS,
  )('observesChangeSet %s: the main session ({}) creating a test file lands passed', async (flag) => {
    // The other end: a body that breaks whenever an actor is present, rather than when
    // the actor is the implementer, pushes every main-session test edit to advised.
    const outcome = await dispatchUnder(
      flag,
      declareEntry(TESTS_ARE_THE_WRITERS, TESTS_ID),
      inputOf([editCall(CREATE_TEST)], {}),
      join(dir, `main-${flag}.log`),
    );

    expect(outcome.events).toEqual(['passed']);
    expect(outcome.rows).toEqual([
      { event: 'passed', subject: TEST_FILE, reason: undefined, values: undefined },
    ]);
  });

  it.each(
    FLAGS,
  )('observesChangeSet %s: no actor on the input lands skipped with reason supply-pass', async (flag) => {
    // The commit surface's shape on both compile paths: `skipped supply-pass`, never
    // `passed` (a judgment nobody made) and never no row (a declaration gone inert).
    const outcome = await dispatchUnder(
      flag,
      declareEntry(TESTS_ARE_THE_WRITERS, TESTS_ID),
      inputOf([editCall(CREATE_TEST)]),
      join(dir, `absent-${flag}.log`),
    );

    expect(outcome.events).toEqual(['skipped']);
    expect(outcome.rows).toEqual([
      { event: 'skipped', subject: TEST_FILE, reason: 'supply-pass', values: undefined },
    ]);
  });

  it.each(
    FLAGS,
  )('observesChangeSet %s: a subagent running git commit lands advised at subject `-` with its name as witness', async (flag) => {
    // The call world through the whole path: routed at `-`, the actor merged into it,
    // the scope admitting the command, `empty` breaking on the agent type.
    const outcome = await dispatchUnder(
      flag,
      declareEntry(COMMITS_FROM_MAIN, COMMITS_ID),
      inputOf([shellCall(COMMIT)], { agentType: IMPLEMENTER }),
      join(dir, `commit-${flag}.log`),
    );

    expect(outcome.events).toEqual(['advised']);
    expect(outcome.rows).toEqual([
      { event: 'advised', subject: CALL_SUBJECT, reason: undefined, values: [[IMPLEMENTER]] },
    ]);
  });

  it.each(
    FLAGS,
  )('observesChangeSet %s: a file change and a commit command in one input land the command break at the file subject', async (flag) => {
    // With a file world present there is no call world: the command rides every file
    // world, so the scope admits it there and the row's subject is the path, not `-`.
    const outcome = await dispatchUnder(
      flag,
      declareEntry(COMMITS_FROM_MAIN, COMMITS_ID),
      inputOf([editCall(CREATE_TEST), shellCall(COMMIT)], { agentType: IMPLEMENTER }),
      join(dir, `commit-with-file-${flag}.log`),
    );

    expect(outcome.events).toEqual(['advised']);
    expect(outcome.rows).toEqual([
      { event: 'advised', subject: TEST_FILE, reason: undefined, values: [[IMPLEMENTER]] },
    ]);
  });
});
