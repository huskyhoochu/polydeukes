import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TelemetryEvent } from '@polydeukes/core';
import { parseRecordLine } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// RunCovenantSpec.body is an in-process judge thunk. The wrapper's order is judge,
// translate, consult the valve, write one row; a THROW lands in the unjudgeable cell with
// the valve still consulted; and the reason reaches stderr at every level, which is how an
// advised break is delivered at all.
import type { RunCovenantSpec } from '../src/run-covenant.ts';
import { runCovenant } from '../src/run-covenant.ts';
import { readTelemetryLines } from './helpers.js';

const LABEL = 'thunk-covenant';
const SUBJECT = 'observed/entry';
const REASON = 'the covenant names exactly why this call broke';

/** The thunk-bodied spec shape. */
type ThunkRunCovenantSpec = {
  body: () => Promise<{ exitCode: number; reason?: string }>;
  label: string;
  subject?: string;
  telemetryPath: string;
  enforce?: 'block' | 'advise';
  witness?: () => boolean;
};

type ThunkRunResult = { exitCode: 0 | 2; event?: TelemetryEvent };

async function runThunk(spec: ThunkRunCovenantSpec): Promise<ThunkRunResult> {
  return await runCovenant(spec as unknown as RunCovenantSpec);
}

let dir: string;
let telemetryPath: string;

function spyStderr() {
  return vi.spyOn(process.stderr, 'write').mockReturnValue(true);
}
let stderrWrite: ReturnType<typeof spyStderr>;

/** Stderr writes carrying the fixture reason. */
function reasonWrites(): string[] {
  return stderrWrite.mock.calls.map((call) => String(call[0])).filter((s) => s.includes(REASON));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pdks-thunk-'));
  telemetryPath = join(dir, 'roi.log');
  stderrWrite = spyStderr();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('thunk verdicts translate exactly as body exit codes did', () => {
  it('a thunk resolving exitCode 0 passes: exit 0, one passed row, valve never consulted', async () => {
    let consulted = 0;
    const result = await runThunk({
      body: async () => ({ exitCode: 0 }),
      label: LABEL,
      subject: SUBJECT,
      telemetryPath,
      witness: () => {
        consulted += 1;
        return true;
      },
    });

    expect(consulted).toBe(0);
    expect(result.exitCode).toBe(0);
    expect(result.event).toBe('passed');
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    const record = parseRecordLine(lines[0]);
    expect(record?.event).toBe('passed');
    expect(record?.label).toBe(LABEL);
    expect(record?.subject).toBe(SUBJECT);
  });

  it('exitCode 1 under block translates up: exit 2, one blocked row, the reason once on stderr', async () => {
    // No child process carries the reason any more, so the wrapper is the only thing that
    // can put it on stderr.
    const result = await runThunk({
      body: async () => ({ exitCode: 1, reason: REASON }),
      label: LABEL,
      telemetryPath,
    });

    expect(result.exitCode).toBe(2);
    expect(result.event).toBe('blocked');
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    expect(parseRecordLine(lines[0])?.event).toBe('blocked');
    expect(reasonWrites()).toEqual([`${REASON}\n`]);
  });

  it('exitCode 1 under advise records advised at exit 0 WITH the reason on stderr', async () => {
    // Written only on the blocked branch, advise goes mute — and the reason on stderr is
    // the entire delivery mechanism of an advised break.
    const result = await runThunk({
      body: async () => ({ exitCode: 1, reason: REASON }),
      label: LABEL,
      telemetryPath,
      enforce: 'advise',
    });

    expect(result.exitCode).toBe(0);
    expect(result.event).toBe('advised');
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    expect(parseRecordLine(lines[0])?.event).toBe('advised');
    expect(reasonWrites()).toEqual([`${REASON}\n`]);
  });

  it('exitCode 2 under advise stays blocked at exit 2 (misassembly never softens)', async () => {
    // Widening the advise translation over 2 advises a broken assembly through.
    const result = await runThunk({
      body: async () => ({ exitCode: 2 }),
      label: LABEL,
      telemetryPath,
      enforce: 'advise',
    });

    expect(result.exitCode).toBe(2);
    expect(result.event).toBe('blocked');
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    expect(parseRecordLine(lines[0])?.event).toBe('blocked');
  });
});

describe('a thunk THROW is the body-crash cell: blocked, valve consulted', () => {
  it.each([
    'block',
    'advise',
  ] as const)('a throwing thunk under %s with no valve fails closed: exit 2, exactly one blocked row', async (enforce) => {
    const result = await runThunk({
      body: async () => {
        throw new Error('judge blew up mid-judgment');
      },
      label: LABEL,
      telemetryPath,
      enforce,
    });

    expect(result.exitCode).toBe(2);
    expect(result.event).toBe('blocked');
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    expect(parseRecordLine(lines[0])?.event).toBe('blocked');
  });

  it('a throwing thunk with an open valve resolves witnessed at exit 0 — one row, never two', async () => {
    // The catch must precede the valve consultation, or a crash escapes the witness
    // entirely; and one call still writes one row.
    const result = await runThunk({
      body: async () => {
        throw new Error('judge blew up mid-judgment');
      },
      label: LABEL,
      telemetryPath,
      witness: () => true,
    });

    expect(result.exitCode).toBe(0);
    expect(result.event).toBe('witnessed');
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    expect(parseRecordLine(lines[0])?.event).toBe('witnessed');
  });

  it('a witnessed break still puts the reason on stderr — the valve is never silent', async () => {
    // The valve is never silent: gating the reason write on the FINAL event would let a
    // witnessed opening erase what broke.
    const result = await runThunk({
      body: async () => ({ exitCode: 1, reason: REASON }),
      label: LABEL,
      telemetryPath,
      witness: () => true,
    });

    expect(result.exitCode).toBe(0);
    expect(result.event).toBe('witnessed');
    expect(parseRecordLine(readTelemetryLines(telemetryPath)[0])?.event).toBe('witnessed');
    expect(reasonWrites()).toEqual([`${REASON}\n`]);
  });

  it('a throwing thunk with a closed valve stays blocked: consulted once, refused', async () => {
    // The crash branch must still consult the valve, or the witness reaches less than it
    // does for any other blocked outcome.
    let consulted = 0;
    const result = await runThunk({
      body: async () => {
        throw new Error('judge blew up mid-judgment');
      },
      label: LABEL,
      telemetryPath,
      witness: () => {
        consulted += 1;
        return false;
      },
    });

    expect(consulted).toBe(1);
    expect(result.exitCode).toBe(2);
    expect(result.event).toBe('blocked');
    expect(parseRecordLine(readTelemetryLines(telemetryPath)[0])?.event).toBe('blocked');
  });
});

describe('an out-of-shape thunk result fails closed (old-dist skew)', () => {
  it.each([
    ['block', 3],
    ['advise', 3],
  ] as const)('an uninterpretable exitCode (3) under %s lands blocked at exit 2', async (enforce, code) => {
    // An old dist answering a code the table does not carry must stay fail-closed.
    const result = await runThunk({
      body: async () => ({ exitCode: code }),
      label: LABEL,
      telemetryPath,
      enforce,
    });

    expect(result.exitCode).toBe(2);
    expect(result.event).toBe('blocked');
    expect(parseRecordLine(readTelemetryLines(telemetryPath)[0])?.event).toBe('blocked');
  });

  it.each([
    'block',
    'advise',
  ] as const)('a thunk resolving a non-object under %s lands blocked at exit 2', async (enforce) => {
    // An old-shape registration resolving undefined must land in the fail-closed cell
    // rather than crash out of the wrapper or read as a pass.
    const result = await runThunk({
      body: (async () => undefined) as unknown as ThunkRunCovenantSpec['body'],
      label: LABEL,
      telemetryPath,
      enforce,
    });

    expect(result.exitCode).toBe(2);
    expect(result.event).toBe('blocked');
    expect(parseRecordLine(readTelemetryLines(telemetryPath)[0])?.event).toBe('blocked');
  });
});
