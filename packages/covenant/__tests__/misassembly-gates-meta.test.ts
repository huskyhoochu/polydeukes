import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CovenantInput } from '@polydeukes/core';
import { parseRecordLine } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// Each meta-covenant's registration builder takes its axis lists as options and the call set
// from the dispatcher at judge time. An empty axis list must never degrade into universal
// uphold, at either enforce level.
import type { RunCovenantSpec } from '../src/run-covenant.ts';
import { runCovenant } from '../src/run-covenant.ts';
import { selfModRegistration } from '../src/self-mod.ts';
import { shellModRegistration } from '../src/shell-mod.ts';
import { transcriptModRegistration } from '../src/transcript-mod.ts';
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

/** The thunk shape a built registration's body carries. */
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

/** Assert the misassembly outcome: exit 2 and exactly one blocked row under the label. */
function expectBlockedRow(result: { exitCode: number }, label: string): void {
  expect(result.exitCode).toBe(2);
  const lines = readTelemetryLines(telemetryPath);
  expect(lines).toHaveLength(1);
  const record = parseRecordLine(lines[0]);
  expect(record?.event).toBe('blocked');
  expect(record?.label).toBe(label);
}

describe('self-mod thunk: empty lists fail closed', () => {
  it('an empty protectedPaths list makes the thunk answer exit-2 equivalent directly', async () => {
    const reg = selfModRegistration({
      protectedPaths: [],
      mutatingToolNames: [MUTATING_TOOL],
    });

    expect(typeof reg.body).toBe('function');
    const outcome = await (reg.body as unknown as JudgeThunk)(ORDINARY_CALL);
    expect(outcome.exitCode).toBe(2);
  });

  it('empty protectedPaths under enforce advise: exit 2 + one blocked row', async () => {
    const reg = selfModRegistration({
      protectedPaths: [],
      mutatingToolNames: [MUTATING_TOOL],
    });

    const result = await runThroughWrapper(reg, 'advise');

    expectBlockedRow(result, reg.label);
  });

  it('empty mutatingToolNames under enforce advise: exit 2 + one blocked row', async () => {
    const reg = selfModRegistration({
      protectedPaths: [PROTECTED_ENTRY],
      mutatingToolNames: [],
    });

    const result = await runThroughWrapper(reg, 'advise');

    expectBlockedRow(result, reg.label);
  });
});

describe('shell-mod thunk: an empty axis list fails closed', () => {
  it('empty protectedPaths under enforce advise: exit 2 + one blocked row', async () => {
    const reg = shellModRegistration({
      protectedPaths: [],
      shellTools: [SHELL_TOOL],
      commandArgs: [COMMAND_ARG],
    });

    const result = await runThroughWrapper(reg, 'advise');

    expectBlockedRow(result, reg.label);
  });

  it('empty shellTools under enforce advise: exit 2 + one blocked row', async () => {
    // Naming no shell tool makes the judge see no call, which is universal uphold by
    // another route than an empty path list.
    const reg = shellModRegistration({
      protectedPaths: [PROTECTED_ENTRY],
      shellTools: [],
      commandArgs: [COMMAND_ARG],
    });

    const result = await runThroughWrapper(reg, 'advise');

    expectBlockedRow(result, reg.label);
  });

  it('empty commandArgs under enforce advise: exit 2 + one blocked row', async () => {
    // With no arg name to read, every shell call carries no command string and upholds
    // vacuously — the third list needs the gate as much as the other two.
    const reg = shellModRegistration({
      protectedPaths: [PROTECTED_ENTRY],
      shellTools: [SHELL_TOOL],
      commandArgs: [],
    });

    const result = await runThroughWrapper(reg, 'advise');

    expectBlockedRow(result, reg.label);
  });
});

describe('transcript-mod thunk: an empty axis list fails closed', () => {
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
    // An empty axis makes the judge see no call, so its `matches` predicate answers null
    // for everything and the registration goes SILENTLY inert — no row, no verdict, the
    // shape indistinguishable from a passing call. Routing every call instead is what makes
    // the misassembly observable.
    const reg = transcriptModRegistration({ ...completeAxes, ...empty });

    expect(reg.matches?.(inputWithArgs({ file_path: 'notes/ordinary.txt' }))).toBe(TRANSCRIPT_PATH);
    const outcome = await (reg.body as unknown as JudgeThunk)(ORDINARY_CALL);
    expect(outcome.exitCode).toBe(2);
  });

  it('an empty mutatingTools list under enforce advise: exit 2 + one blocked row', async () => {
    const reg = transcriptModRegistration({ ...completeAxes, mutatingTools: [] });

    const result = await runThroughWrapper(reg, 'advise');

    expectBlockedRow(result, reg.label);
  });

  it('a COMPLETE spec still routes on the judge, not on everything', async () => {
    // The control end of the axis: without it the case above is satisfied by a registration
    // that routes every call unconditionally, recording a verdict for every payload.
    const reg = transcriptModRegistration(completeAxes);

    expect(reg.matches?.(inputWithArgs({ file_path: 'notes/ordinary.txt' }))).toBeNull();
  });
});
