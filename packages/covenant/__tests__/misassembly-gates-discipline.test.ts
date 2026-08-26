import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DisciplineEntry } from '@polydeukes/core';
import { parseRecordLine } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// DISPATCH-01 §4.3 RED phase — the discipline body CLI's skeleton misassembly gates migrate into
// the compiled judge thunk. The compiler composes thunks (no bodyCommand/
// bodyModulePath), and a command-family entry on an empty shell surface must fail
// closed AT THE THUNK: exit-2 equivalent, blocked at BOTH enforce levels (advise
// softens judged breaks, never the inability to judge). RED by construction.
import type { CompileDisciplinesSpec, RunCovenantSpec } from '../src/index.ts';
import { compileDisciplineRegistrations, runCovenant } from '../src/index.ts';
import { readTelemetryLines } from './helpers.js';

const ROOT = '/repo';
const COMMAND_ID = 'hooks-armed';
const cmdEntry: DisciplineEntry = { id: COMMAND_ID, forbidCommand: 'LEFTHOOK=(0|false)\\b' };

/** The §4.1 thunk shape a compiled registration's body now carries. */
type JudgeThunk = () => Promise<{ exitCode: number; reason?: string }>;

/** Compile ONE entry under the given (possibly defective) shell surface options. */
function compileWithSurface(surface: { shellTools?: string[]; commandArgs?: string[] }) {
  const spec = {
    disciplines: [cmdEntry],
    rootDir: ROOT,
    shellTools: ['Bash'],
    commandArgs: ['command'],
    ...surface,
  } as unknown as CompileDisciplinesSpec;
  const [reg] = compileDisciplineRegistrations(spec);
  return reg;
}

let dir: string;
let telemetryPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pdks-gates-discipline-'));
  telemetryPath = join(dir, 'roi.log');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('DISPATCH-01 §4.3 — a command-family thunk on an empty shell surface fails closed', () => {
  it.each([
    ['shellTools', { shellTools: [] as string[] }],
    ['commandArgs', { commandArgs: [] as string[] }],
  ])('an empty %s makes the thunk answer exit-2 equivalent, never a vacuous uphold', async (_axis, surface) => {
    // Mutation caught: the argv-layer fail-closed deleted with the body CLI instead of
    // moved — the universal-pass hole.
    const reg = compileWithSurface(surface);
    const thunk = reg.body as unknown as JudgeThunk;

    const outcome = await thunk();

    expect(outcome.exitCode).toBe(2);
  });

  it.each([
    ['block', 'shellTools', { shellTools: [] as string[] }],
    ['advise', 'shellTools', { shellTools: [] as string[] }],
  ])('under enforce %s with empty %s the wrapper lands exit 2 + one blocked row', async (enforce, _axis, surface) => {
    // Mutation caught: the gate emitting exit 1 (a break advise would soften), or the
    // advise translation widened over 2.
    const reg = compileWithSurface(surface);

    const result = await runCovenant({
      body: reg.body,
      label: reg.label,
      telemetryPath,
      enforce,
    } as unknown as RunCovenantSpec);

    expect(result.exitCode).toBe(2);
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    const record = parseRecordLine(lines[0]);
    expect(record?.event).toBe('blocked');
    expect(record?.label).toBe(COMMAND_ID);
  });
});
