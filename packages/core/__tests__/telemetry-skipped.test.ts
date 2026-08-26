import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// `skipped`: a context-family discipline left out of assembly because the surface has no
// evidence channel — a no-op that must show up in the data, never a silent skip.
import {
  aggregateGain,
  appendRecord,
  formatRecordLine,
  parseRecordLine,
  runGain,
  type TelemetryRecord,
} from '../src/index.ts';

// label = the discipline entry id, subject = '-' (an assembly-level fact, not a per-change one).
const skippedRecord: TelemetryRecord = {
  timestamp: '2026-07-26T12:00:00Z',
  event: 'skipped',
  label: 'dependency-needs-npm-view',
  subject: '-',
};

let dir: string;
let logPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pdks-telemetry-skipped-'));
  logPath = join(dir, 'roi.log');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('skipped — round-trip', () => {
  it('formatRecordLine → parseRecordLine round-trips a skipped record', () => {
    // If `skipped` is missing from the accepted-events set the record is written and then
    // thrown away on every read, which is the silent skip this event exists to prevent.
    const parsed = parseRecordLine(formatRecordLine(skippedRecord));

    expect(parsed).toEqual(skippedRecord);
  });

  it('parseRecordLine still rejects an event outside the five (skiped)', () => {
    // The other side of the enum boundary: widening the accepted set to `skipped` must not
    // widen it to arbitrary strings, or a near-miss typo passes as a valid record.
    expect(
      parseRecordLine('2026-07-26T12:00:00Z\tskiped\tdependency-needs-npm-view\t-'),
    ).toBeNull();
  });
});

describe('skipped — aggregation', () => {
  it('aggregateGain initializes every label with skipped: 0 and counts skipped records', () => {
    // A missing skipped slot in the per-label initializer yields NaN, and a count bleeding
    // into passed/blocked/advised disguises "not judged at all" as a verdict.
    const records: TelemetryRecord[] = [
      skippedRecord,
      { ...skippedRecord, event: 'passed' },
      skippedRecord,
    ];

    const summary = aggregateGain(records);

    expect(summary.counts['dependency-needs-npm-view']).toEqual({
      passed: 1,
      blocked: 0,
      witnessed: 0,
      advised: 0,
      skipped: 2,
      unattributed: 0,
    });
  });
});

describe('skipped — render (the skipped=N collision)', () => {
  it('runGain reports the per-label skipped EVENT count separately from the corrupt-line skip count', () => {
    // `runGain` reports unparseable lines as "skipped=N" and the event column is also named
    // skipped, so both meanings can appear in one render. The fixture uses different numbers
    // (2 events vs 1 corrupt line) so a merge of the two counters cannot look correct.
    appendRecord(logPath, skippedRecord);
    appendRecord(logPath, skippedRecord);
    // One corrupt line, so the parse-skip counter is non-zero in the same render.
    const priorContent = readFileSync(logPath, 'utf-8');
    writeFileSync(logPath, `${priorContent}not a record\n`);

    const output = runGain(logPath);
    const lines = output.split('\n');

    const labelLine = lines.find((line) => line.includes('dependency-needs-npm-view'));
    expect(labelLine).toBeDefined();
    expect(labelLine).toMatch(/skipped=2/);

    // The corrupt-line report survives on a line of its own, not on the label line.
    expect(
      lines.some(
        (line) => !line.includes('dependency-needs-npm-view') && /skipped[= ]1\b/.test(line),
      ),
    ).toBe(true);
  });
});
