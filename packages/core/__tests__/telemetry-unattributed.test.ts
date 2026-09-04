import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// `unattributed`: a protected entry whose on-disk state changed with no judgment row
// explaining it. An observation on a different axis from the five verdicts — `skipped` is an
// inability the assembly knows up front, this is an attribution failure discovered after the
// fact — and it never blocks or passes a call.
import {
  aggregateGain,
  appendRecord,
  formatRecordLine,
  parseRecordLine,
  runGain,
  type TelemetryRecord,
} from '../src/telemetry.ts';

// subject is the changed protected ENTRY — the config element, never a file underneath it,
// so the attribution join stays on the same granularity the dispatcher records.
const unattributedRecord: TelemetryRecord = {
  timestamp: '2026-08-12T12:00:00Z',
  event: 'unattributed',
  label: 'baseline',
  subject: 'packages/judge/dist',
};

let dir: string;
let logPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pdks-telemetry-unattributed-'));
  logPath = join(dir, 'roi.log');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('unattributed — round-trip', () => {
  it('formatRecordLine → parseRecordLine round-trips an unattributed record', () => {
    // If `unattributed` is missing from the accepted-events set, every reader silently drops
    // the row instead of surfacing the attribution failure.
    const parsed = parseRecordLine(formatRecordLine(unattributedRecord));

    expect(parsed).toEqual(unattributedRecord);
  });

  it('parseRecordLine still rejects an event outside the six (unatributed)', () => {
    // The other side of the enum boundary: widening the accepted set to `unattributed` must
    // not widen it to arbitrary strings, or a near-miss typo passes as a valid record.
    expect(
      parseRecordLine('2026-08-12T12:00:00Z\tunatributed\tbaseline\tpackages/judge/dist'),
    ).toBeNull();
  });
});

describe('unattributed — aggregation', () => {
  it('aggregateGain initializes every label with unattributed: 0 and counts unattributed records', () => {
    // A missing unattributed slot in the per-label initializer yields NaN, and a count
    // bleeding into passed disguises "changed with no explaining judgment" as a normal pass.
    const records: TelemetryRecord[] = [
      unattributedRecord,
      { ...unattributedRecord, event: 'passed' },
      unattributedRecord,
    ];

    const summary = aggregateGain(records);

    expect(summary.counts.baseline).toEqual({
      passed: 1,
      blocked: 0,
      witnessed: 0,
      advised: 0,
      skipped: 0,
      unattributed: 2,
    });
  });
});

describe('unattributed — render', () => {
  it('runGain shows unattributed as its own column, never summed into the five', () => {
    // The column must stand on its own: omitting it makes the alarm invisible in the report,
    // and folding it into passed or skipped hides it behind a number that looks normal.
    appendRecord(logPath, unattributedRecord);
    appendRecord(logPath, unattributedRecord);
    appendRecord(logPath, { ...unattributedRecord, event: 'passed' });

    const output = runGain(logPath);
    const labelLine = output.split('\n').find((line) => line.includes('baseline'));

    expect(labelLine).toBeDefined();
    expect(labelLine).toMatch(/unattributed=2/);
    expect(labelLine).toMatch(/passed=1/);
    expect(labelLine).toMatch(/skipped=0/);
  });
});
