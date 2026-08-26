import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// The third telemetry event was renamed 'bypassed' → 'witnessed'. The migration seam is
// one-way and read-only: writes always carry the new name, reads still accept the legacy
// 'bypassed' field so existing log rows stay countable.
import { formatRecordLine, parseRecordLine, runGain, type TelemetryRecord } from '../src/index.ts';

// The legacy lines are handwritten raw TSV — formatRecordLine can never emit the old name.

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

describe('witnessed event — write always new, read accepts legacy', () => {
  it('a legacy bypassed line parses one-way into a witnessed record (migration seam)', () => {
    // Legacy rows must surface as witnessed data, not as corrupt lines: dropping the legacy
    // branch loses them, and passing the old name through verbatim splits every aggregation
    // across two names for one event.
    expect(parseRecordLine(LEGACY_BYPASSED_LINE)).toEqual({
      timestamp: '2026-07-03T12:00:00Z',
      event: 'witnessed',
      label: 'self-mod',
      subject: 'a.ts',
    });
  });

  it('formatRecordLine never writes the legacy name (compat is one-way)', () => {
    // Compatibility runs one way only: no write-side shim may map witnessed back to
    // 'bypassed' for old readers, which would reintroduce the old name into fresh data.
    const line = formatRecordLine(witnessedRecord);

    expect(line).toContain('witnessed');
    expect(line).not.toContain('bypassed');
  });

  it('runGain over a mixed legacy/new log counts both under witnessed= with no bypassed= column', () => {
    // Legacy and new rows are the same event, so they merge into one number and the summary
    // speaks only the new name. The absent corrupt-line report is load-bearing: legacy rows
    // are read as data, not tolerated as corruption.
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
    // The seam admits exactly the one legacy literal. A startsWith / case-insensitive /
    // trimmed comparison would coerce genuinely corrupt lines into fabricated witnessed
    // records instead of rejecting them.
    expect(parseRecordLine('2026-07-03T12:00:00Z\tbypass\tself-mod\ta.ts')).toBeNull();
    expect(parseRecordLine('2026-07-03T12:00:00Z\tBypassed\tself-mod\ta.ts')).toBeNull();
    expect(parseRecordLine('2026-07-03T12:00:00Z\tbypassed \tself-mod\ta.ts')).toBeNull();
    expect(parseRecordLine('2026-07-03T12:00:00Z\tmaybe\tself-mod\ta.ts')).toBeNull();
  });
});
