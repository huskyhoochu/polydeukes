import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// CONFIG-06 §4.3 RED phase. The 4th first-class telemetry event, `advised`: "a violation
// verdict was reached, but the enforcement level was advise so it passed and was recorded
// only". Imported from the package entry point (the surface `@polydeukes/core` publishes).
// The `advised` event does NOT exist in the union yet, so these are RED by construction.
import {
  aggregateGain,
  appendRecord,
  formatRecordLine,
  parseRecordLine,
  runGain,
  type TelemetryRecord,
} from '../src/index.ts';

const advisedRecord: TelemetryRecord = {
  timestamp: '2026-07-23T12:00:00Z',
  event: 'advised',
  label: 'commit-self-mod',
  subject: 'lib/protected.ts',
};

let dir: string;
let logPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pdks-telemetry-advised-'));
  logPath = join(dir, 'roi.log');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('CONFIG-06 §4.3 advised — round-trip', () => {
  it('formatRecordLine → parseRecordLine round-trips an advised record', () => {
    // Mutation caught: `advised` missing from the accepted-events set, so parseRecordLine
    // rejects it and the round-trip returns null instead of the original record.
    const parsed = parseRecordLine(formatRecordLine(advisedRecord));

    expect(parsed).toEqual(advisedRecord);
  });

  it('parseRecordLine still rejects an event outside the four (advized)', () => {
    // The other side of the enum boundary: widening the accepted set to `advised` must not
    // widen it to arbitrary strings. Mutation caught: the membership check dropped so a
    // near-miss typo ('advized') masquerades as a valid record.
    expect(
      parseRecordLine('2026-07-23T12:00:00Z\tadvized\tcommit-self-mod\tlib/protected.ts'),
    ).toBeNull();
  });
});

describe('CONFIG-06 §4.3 advised — aggregation', () => {
  it('aggregateGain initializes every label with advised: 0 and counts advised records', () => {
    // Mutation caught: the per-label counter initializer omitting the advised slot (so an
    // advised record lands on undefined + 1 = NaN or throws), or the count bleeding into
    // passed/blocked instead of its own column.
    const records: TelemetryRecord[] = [
      advisedRecord,
      { ...advisedRecord, event: 'passed' },
      advisedRecord,
    ];

    const summary = aggregateGain(records);

    expect(summary.counts['commit-self-mod']).toEqual({
      passed: 1,
      blocked: 0,
      bypassed: 0,
      advised: 2,
    });
  });
});

describe('CONFIG-06 §4.3 advised — render', () => {
  it('runGain output carries an advised= column for a label', () => {
    // Mutation caught: the render line omitting the advised count, which would hide the
    // recorded-but-passed verdicts the whole ticket exists to measure.
    appendRecord(logPath, advisedRecord);

    const output = runGain(logPath);

    expect(output).toContain('commit-self-mod');
    expect(output).toMatch(/advised=1/);
  });
});
