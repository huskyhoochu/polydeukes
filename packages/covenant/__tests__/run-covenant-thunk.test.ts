import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRecordLine } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// DISPATCH-01 §4.1 RED phase — RunCovenantSpec.body becomes an in-process judge thunk
// (() => Promise<{ exitCode, reason? }>). Wrapper order unchanged (judge → translate →
// valve → one row); a THROW is the exit-2 cell (valve consulted, body-crash parity);
// the wrapper writes `${reason}\n` to stderr at every level — the advise delivery that
// replaces stdio inherit. The shape does not exist yet: RED by construction.
import type { RunCovenantSpec, TelemetryEvent } from '../src/index.ts';
import { runCovenant } from '../src/index.ts';
import { readTelemetryLines } from './helpers.js';

const LABEL = 'thunk-covenant';
const SUBJECT = 'observed/entry';
const REASON = 'the covenant names exactly why this call broke';

/** §4.1 thunk-bodied spec; the widening carries the type drift until GREEN. */
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

describe('DISPATCH-01 §4.1 — thunk verdicts translate exactly as body exit codes did', () => {
  it('a thunk resolving exitCode 0 passes: exit 0, one passed row, valve never consulted', async () => {
    // Mutation caught: 0 misread as unknown (fail-closed), the row dropped, or the
    // valve consulted on every outcome again.
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
    // Mutation caught: 1 passed through as the wrapper exit, or the reason dropped now
    // that no child process carries it.
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
    // Mutation caught: the reason written only on the blocked branch — advise goes mute
    // (PRD §4.4, the advise delivery mechanism).
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
    // Mutation caught: the advise translation widened over 2 — a broken assembly
    // advised through (CONFIG-06b's blocker, in-process form).
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

describe('DISPATCH-01 §4.1 — a thunk THROW is the body-crash cell: blocked, valve consulted', () => {
  it.each([
    'block',
    'advise',
  ] as const)('a throwing thunk under %s with no valve fails closed: exit 2, exactly one blocked row', async (enforce) => {
    // Mutation caught: the throw escaping as a rejection, swallowed into a pass, or
    // the row skipped so the crash leaves no record.
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
    // Mutation caught: the catch placed AFTER the valve consultation (a crash bypasses
    // the witness), or a blocked row logged alongside the witnessed one.
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
    // Mutation caught: the reason write gated on the FINAL event — a witnessed opening
    // would erase what broke, and the valve's contract is never-silent (§4.1-4: the
    // reason is written whatever the level or final event).
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
    // Mutation caught: the crash branch skipping the valve (consulted 0), narrowing the
    // witness's reach relative to today's spawned crash.
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

describe('DISPATCH-01 §4.1 — an out-of-shape thunk result fails closed (old-dist skew)', () => {
  it.each([
    ['block', 3],
    ['advise', 3],
  ] as const)('an uninterpretable exitCode (3) under %s lands blocked at exit 2', async (enforce, code) => {
    // Mutation caught: the uninterpretable-code cell falling through to a pass — an old
    // covenant dist answering a code the table does not carry must stay fail-closed.
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
    // Mutation caught: the wrapper destructuring the result unguarded — an old-shape
    // registration (dist skew) resolving undefined must land in the fail-closed cell,
    // not crash out of the wrapper or read as a pass.
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
