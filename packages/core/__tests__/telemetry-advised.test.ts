import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// `advised`: a break verdict was reached, but the enforcement level was advise, so the call
// passed and the verdict was recorded only.
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

describe('advised — round-trip', () => {
  it('formatRecordLine → parseRecordLine round-trips an advised record', () => {
    // If `advised` is missing from the accepted-events set the round-trip returns null and
    // the recorded verdict is lost on every read.
    const parsed = parseRecordLine(formatRecordLine(advisedRecord));

    expect(parsed).toEqual(advisedRecord);
  });

  it('parseRecordLine still rejects an event outside the four (advized)', () => {
    // The other side of the enum boundary: widening the accepted set to `advised` must not
    // widen it to arbitrary strings, or a near-miss typo passes as a valid record.
    expect(
      parseRecordLine('2026-07-23T12:00:00Z\tadvized\tcommit-self-mod\tlib/protected.ts'),
    ).toBeNull();
  });
});

describe('advised — aggregation', () => {
  it('aggregateGain initializes every label with advised: 0 and counts advised records', () => {
    // A missing advised slot in the per-label initializer yields NaN or throws, and a count
    // bleeding into passed/blocked loses the distinction the event exists to record.
    const records: TelemetryRecord[] = [
      advisedRecord,
      { ...advisedRecord, event: 'passed' },
      advisedRecord,
    ];

    const summary = aggregateGain(records);

    expect(summary.counts['commit-self-mod']).toEqual({
      passed: 1,
      blocked: 0,
      witnessed: 0,
      advised: 2,
      skipped: 0,
      unattributed: 0,
    });
  });
});

describe('advised — render', () => {
  it('runGain output carries an advised= column for a label', () => {
    // Omitting the advised count from the render line hides the recorded-but-passed verdicts.
    appendRecord(logPath, advisedRecord);

    const output = runGain(logPath);

    expect(output).toContain('commit-self-mod');
    expect(output).toMatch(/advised=1/);
  });
});
