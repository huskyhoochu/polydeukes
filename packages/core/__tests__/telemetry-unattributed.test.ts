import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// COVENANT-14 §2-d RED phase. The 6th telemetry event, `unattributed`: a protected entry
// whose on-disk state changed with no judgment row explaining it. An observation event on
// a different axis from the five verdicts — `skipped` is an inability the assembly knows
// UP FRONT, `unattributed` is an attribution failure discovered AFTER the fact — and it
// never blocks or passes a call (§6). Same structure as the COVENANT-13 `skipped` opening:
// `unattributed` does NOT exist in the union yet, so the round-trip/aggregation/render
// tests here are RED by construction.
import {
  aggregateGain,
  appendRecord,
  formatRecordLine,
  parseRecordLine,
  runGain,
  type TelemetryRecord,
} from '../src/index.ts';

// PRD §2-d row shape: label = 'baseline', subject = the changed protected ENTRY — the
// config element, never a file underneath it, so the attribution join stays on the same
// granularity the dispatcher records (covenant.dev-log.telemetry-subject-is-matched-entry).
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

describe('COVENANT-14 §2-d unattributed — round-trip', () => {
  it('formatRecordLine → parseRecordLine round-trips an unattributed record', () => {
    // Mutation caught: `unattributed` missing from the accepted-events set, so
    // parseRecordLine rejects it and every reader (gain, the attribution window)
    // silently drops the very row this ticket exists to write.
    const parsed = parseRecordLine(formatRecordLine(unattributedRecord));

    expect(parsed).toEqual(unattributedRecord);
  });

  it('parseRecordLine still rejects an event outside the six (unatributed)', () => {
    // The other side of the enum boundary: widening the accepted set to `unattributed`
    // must not widen it to arbitrary strings. Mutation caught: the membership check
    // dropped so a near-miss typo ('unatributed') masquerades as a valid record.
    expect(
      parseRecordLine('2026-08-12T12:00:00Z\tunatributed\tbaseline\tpackages/judge/dist'),
    ).toBeNull();
  });
});

describe('COVENANT-14 §2-d unattributed — aggregation', () => {
  it('aggregateGain initializes every label with unattributed: 0 and counts unattributed records', () => {
    // Mutation caught: the per-label counter initializer omitting the unattributed slot
    // (an undefined + 1 = NaN column), or the count bleeding into passed — which would
    // disguise "changed with no explaining judgment" as a normal pass, the exact
    // confusion §0 says the sixth word exists to prevent.
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

describe('COVENANT-14 §3.5 unattributed — render', () => {
  it('runGain shows unattributed as its own column, never summed into the five', () => {
    // AC §3.5: the gain output carries an `unattributed` column and does not fold it
    // into an existing one. Mutation caught: the render template omitting the new
    // column (the alarm invisible in the report), or the count absorbed into
    // passed/skipped (passed=3 or skipped=2 instead of the split below).
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
