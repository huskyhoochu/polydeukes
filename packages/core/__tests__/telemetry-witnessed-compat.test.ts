import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// COVENANT-17 §4.1 RED phase — the third telemetry event renames 'bypassed' → 'witnessed':
// writes always carry the new name, reads accept the legacy 'bypassed' field one-way (the
// local roi.log holds 3,275 legacy rows the gate-② journal round must still count). Written
// in the NEW vocabulary on purpose: these tests stay red until the rename lands, and the
// 'witnessed' literal is a transient type error until TelemetryEvent gains it (vitest
// transpiles without typechecking).
import { formatRecordLine, parseRecordLine, runGain, type TelemetryRecord } from '../src/index.ts';

// ---------------------------------------------------------------------------
// Fixtures — same 4-field TSV vocabulary as telemetry.test.ts. The legacy lines are
// handwritten raw TSV (never produced through formatRecordLine, which §4.1 forbids
// from ever emitting the old name).
// ---------------------------------------------------------------------------

const witnessedRecord: TelemetryRecord = {
  timestamp: '2026-07-28T12:00:00Z',
  event: 'witnessed',
  label: 'self-mod',
  subject: 'a.ts',
};

const LEGACY_BYPASSED_LINE = '2026-07-03T12:00:00Z\tbypassed\tself-mod\ta.ts';

let dir: string;
let logPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pdks-telemetry-witnessed-'));
  logPath = join(dir, 'roi.log');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('COVENANT-17 §4.1 witnessed event — write always new, read accepts legacy', () => {
  it('a legacy bypassed line parses one-way into a witnessed record (migration seam)', () => {
    // PRD §4.1 second bullet: the 3,275 legacy rows in the local log must surface as
    // witnessed data, not as corrupt lines. Mutation caught: the legacy branch omitted
    // (legacy rows skipped) or the legacy event passed through verbatim (two names for one
    // event splitting every aggregation).
    expect(parseRecordLine(LEGACY_BYPASSED_LINE)).toEqual({
      timestamp: '2026-07-03T12:00:00Z',
      event: 'witnessed',
      label: 'self-mod',
      subject: 'a.ts',
    });
  });

  it('formatRecordLine never writes the legacy name (compat is one-way)', () => {
    // Invariant §7-5, green before the rename too (the serializer is verbatim today): it
    // locks the future against a writer that maps witnessed back to 'bypassed' for
    // old-reader compatibility — the reverse path §4.1 explicitly rules out. Mutation
    // caught: a write-side compat shim reintroducing the old name into fresh data.
    const line = formatRecordLine(witnessedRecord);

    expect(line).toContain('witnessed');
    expect(line).not.toContain('bypassed');
  });

  it('runGain over a mixed legacy/new log counts both under witnessed= with no bypassed= column', () => {
    // PRD §4.1 + §3: the gate-② journal reads one merged number — legacy rows and new rows
    // are the same event, and the rendered summary speaks only the new name. The absent
    // corrupt-line report is load-bearing: legacy rows are READ as data, not tolerated as
    // corruption. Mutation caught: the aggregation keeping separate bypassed/witnessed
    // columns (splitting the §3 ratio), or legacy rows landing in the corrupt-line count.
    const mixedLog = `${[
      LEGACY_BYPASSED_LINE,
      '2026-07-03T12:01:00Z\tbypassed\tself-mod\tb.ts',
      '2026-07-28T12:00:00Z\twitnessed\tself-mod\tc.ts',
    ].join('\n')}\n`;
    writeFileSync(logPath, mixedLog);

    const output = runGain(logPath);

    expect(output).toContain('witnessed=3');
    expect(output).not.toMatch(/bypassed=/);
    expect(output).not.toContain('corrupt lines');
  });

  it('the legacy branch admits exactly bypassed — near-miss events still parse to null', () => {
    // Green today, locking the migration seam's width: §4.1 admits the one literal legacy
    // field, nothing else. Mutation caught: the legacy comparison written as startsWith /
    // case-insensitive / trimmed matching, which would coerce genuinely corrupt lines into
    // fabricated witnessed records instead of rejecting them.
    expect(parseRecordLine('2026-07-03T12:00:00Z\tbypass\tself-mod\ta.ts')).toBeNull();
    expect(parseRecordLine('2026-07-03T12:00:00Z\tBypassed\tself-mod\ta.ts')).toBeNull();
    expect(parseRecordLine('2026-07-03T12:00:00Z\tbypassed \tself-mod\ta.ts')).toBeNull();
    expect(parseRecordLine('2026-07-03T12:00:00Z\tmaybe\tself-mod\ta.ts')).toBeNull();
  });
});
