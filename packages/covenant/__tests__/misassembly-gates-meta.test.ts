import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CovenantInput } from '@polydeukes/core';
import { parseRecordLine } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// DISPATCH-01 §4.3 — the meta-covenant body CLIs' empty-list misassembly gates live in the
// in-process thunks (successors of the self-mod.test.ts §5.2 argv cells). The registration
// builders are the §4.4 assembly seams: options passed as an object, the call set supplied
// by the dispatcher when the judge runs. An empty axis list must never degrade into
// universal uphold, at either enforce level.
import type { RunCovenantSpec } from '../src/index.ts';
import {
  runCovenant,
  selfModRegistration,
  shellModRegistration,
  transcriptModRegistration,
} from '../src/index.ts';
import { inputWithArgs, readTelemetryLines } from './helpers.js';

const PROTECTED_ENTRY = 'sub/protected';
const MUTATING_TOOL = 'Edit';
const SHELL_TOOL = 'Bash';
const COMMAND_ARG = 'command';
const TRANSCRIPT_PATH = '/home/someone/.claude/projects/p/session.jsonl';
const LEVELS = ['block', 'advise'] as const;

/** An unremarkable call: every gate below must refuse it for the ASSEMBLY's sake, not the
 * payload's — a misassembled covenant blocks whatever it is handed. */
const ORDINARY_CALL: CovenantInput = inputWithArgs({ file_path: 'notes/ordinary.txt' });

/** The §4.1 thunk shape a built registration's body now carries. */
type JudgeThunk = (input: CovenantInput) => Promise<{ exitCode: number; reason?: string }>;

let dir: string;
let telemetryPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pdks-gates-meta-'));
  telemetryPath = join(dir, 'roi.log');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Run one registration's thunk through the wrapper at the given level. */
async function runThroughWrapper(
  reg: { label: string; body: unknown },
  enforce: (typeof LEVELS)[number],
) {
  return await runCovenant({
    body: () => (reg.body as JudgeThunk)(ORDINARY_CALL),
    label: reg.label,
    telemetryPath,
    enforce,
  } as unknown as RunCovenantSpec);
}

/** Assert the misassembly cell: exit 2 + exactly one blocked row under the label. */
function expectBlockedRow(result: { exitCode: number }, label: string): void {
  expect(result.exitCode).toBe(2);
  const lines = readTelemetryLines(telemetryPath);
  expect(lines).toHaveLength(1);
  const record = parseRecordLine(lines[0]);
  expect(record?.event).toBe('blocked');
  expect(record?.label).toBe(label);
}

describe('DISPATCH-01 §4.3 — self-mod thunk: empty lists fail closed', () => {
  it('an empty protectedPaths list makes the thunk answer exit-2 equivalent directly', async () => {
    // Mutation caught: the argv-layer fail-closed deleted with self-mod-body.ts instead
    // of moved — an empty vector judges every call as upheld.
    const reg = selfModRegistration({
      protectedPaths: [],
      mutatingToolNames: [MUTATING_TOOL],
    });

    expect(typeof reg.body).toBe('function');
    const outcome = await (reg.body as unknown as JudgeThunk)(ORDINARY_CALL);
    expect(outcome.exitCode).toBe(2);
  });

  it('empty protectedPaths under enforce advise: exit 2 + one blocked row', async () => {
    // Mutation caught: the gate emitting a break (exit-1 equivalent) that advise
    // softens to exit 0 — the level where a misassembly slips through.
    const reg = selfModRegistration({
      protectedPaths: [],
      mutatingToolNames: [MUTATING_TOOL],
    });

    const result = await runThroughWrapper(reg, 'advise');

    expectBlockedRow(result, reg.label);
  });

  it('empty mutatingToolNames under enforce advise: exit 2 + one blocked row', async () => {
    // Mutation caught: the gate checking only protectedPaths — half the CLI gate
    // migrated.
    const reg = selfModRegistration({
      protectedPaths: [PROTECTED_ENTRY],
      mutatingToolNames: [],
    });

    const result = await runThroughWrapper(reg, 'advise');

    expectBlockedRow(result, reg.label);
  });
});

describe('DISPATCH-01 §4.3 — shell-mod thunk: an empty axis list fails closed', () => {
  it('empty protectedPaths under enforce advise: exit 2 + one blocked row', async () => {
    // Mutation caught: the gate migrated into the self-mod thunk alone — one cause,
    // two dispositions across the meta pair.
    const reg = shellModRegistration({
      protectedPaths: [],
      shellTools: [SHELL_TOOL],
      commandArgs: [COMMAND_ARG],
    });

    const result = await runThroughWrapper(reg, 'advise');

    expectBlockedRow(result, reg.label);
  });

  it('empty shellTools under enforce advise: exit 2 + one blocked row', async () => {
    // Mutation caught: the gate checking protectedPaths alone — naming no shell tool
    // makes the judge see no call, which is the universal-uphold shape by another route.
    const reg = shellModRegistration({
      protectedPaths: [PROTECTED_ENTRY],
      shellTools: [],
      commandArgs: [COMMAND_ARG],
    });

    const result = await runThroughWrapper(reg, 'advise');

    expectBlockedRow(result, reg.label);
  });

  it('empty commandArgs under enforce advise: exit 2 + one blocked row', async () => {
    // Mutation caught: the third required list left out of the gate — with no arg name
    // to read, every shell call carries no command string and upholds vacuously.
    const reg = shellModRegistration({
      protectedPaths: [PROTECTED_ENTRY],
      shellTools: [SHELL_TOOL],
      commandArgs: [],
    });

    const result = await runThroughWrapper(reg, 'advise');

    expectBlockedRow(result, reg.label);
  });
});

describe('DISPATCH-01 §4.3 — transcript-mod thunk: an empty axis list fails closed', () => {
  /** The axes a complete transcript-mod spec names; each case empties exactly one. */
  const completeAxes = {
    transcriptPath: TRANSCRIPT_PATH,
    shellTools: [SHELL_TOOL],
    commandArgs: [COMMAND_ARG],
    mutatingTools: [MUTATING_TOOL],
  };

  it.each([
    ['mutatingTools', { mutatingTools: [] as string[] }],
    ['shellTools', { shellTools: [] as string[] }],
    ['commandArgs', { commandArgs: [] as string[] }],
  ])('an empty %s routes fail-closed and answers the unjudgeable outcome', async (_axis, empty) => {
    // Mutation caught: the meta pair's gate never extended to the third meta-covenant.
    // An empty axis makes the judge see no call, so its `matches` predicate answers null
    // for everything and the registration goes SILENTLY inert — no row, no verdict, the
    // shape that looks identical to a passing call. Routing every call instead is what
    // makes the misassembly observable.
    const reg = transcriptModRegistration({ ...completeAxes, ...empty });

    expect(reg.matches?.(inputWithArgs({ file_path: 'notes/ordinary.txt' }))).toBe(TRANSCRIPT_PATH);
    const outcome = await (reg.body as unknown as JudgeThunk)(ORDINARY_CALL);
    expect(outcome.exitCode).toBe(2);
  });

  it('an empty mutatingTools list under enforce advise: exit 2 + one blocked row', async () => {
    // Mutation caught: the gate emitting a break (exit-1 equivalent) that advise softens
    // to exit 0 — the level where a misassembly slips through.
    const reg = transcriptModRegistration({ ...completeAxes, mutatingTools: [] });

    const result = await runThroughWrapper(reg, 'advise');

    expectBlockedRow(result, reg.label);
  });

  it('a COMPLETE spec still routes on the judge, not on everything', async () => {
    // The control end of the axis: without it the gate above could be satisfied by a
    // registration that routes every call unconditionally, which would record a verdict
    // for every unrelated payload.
    const reg = transcriptModRegistration(completeAxes);

    expect(reg.matches?.(inputWithArgs({ file_path: 'notes/ordinary.txt' }))).toBeNull();
  });
});
