import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// COVENANT-13 §4.5 / AC §5.4.11 RED phase. The 5th first-class telemetry event, `skipped`:
// "a context-family discipline was left out of assembly because the surface has no evidence
// channel" — a no-op that must show up in the data (never a silent skip). Same structure as
// the CONFIG-06 `advised` opening. `skipped` does NOT exist in the union yet, so the
// round-trip/aggregation/render tests are RED by construction.
import {
  aggregateGain,
  appendRecord,
  formatRecordLine,
  parseRecordLine,
  runGain,
  type TelemetryRecord,
} from '../src/index.ts';

// PRD §4.5: label = the discipline entry id, subject = '-' (an assembly-level fact, not a
// per-change one).
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

describe('COVENANT-13 §4.5 skipped — round-trip', () => {
  it('formatRecordLine → parseRecordLine round-trips a skipped record', () => {
    // Mutation caught: `skipped` missing from the accepted-events set, so parseRecordLine
    // rejects it and the round-trip returns null — the "no silent skip" record would be
    // written and then thrown away on every read.
    const parsed = parseRecordLine(formatRecordLine(skippedRecord));

    expect(parsed).toEqual(skippedRecord);
  });

  it('parseRecordLine still rejects an event outside the five (skiped)', () => {
    // The other side of the enum boundary: widening the accepted set to `skipped` must not
    // widen it to arbitrary strings. Mutation caught: the membership check dropped so a
    // near-miss typo ('skiped') masquerades as a valid record.
    expect(
      parseRecordLine('2026-07-26T12:00:00Z\tskiped\tdependency-needs-npm-view\t-'),
    ).toBeNull();
  });
});

describe('COVENANT-13 §4.5 skipped — aggregation', () => {
  it('aggregateGain initializes every label with skipped: 0 and counts skipped records', () => {
    // Mutation caught: the per-label counter initializer omitting the skipped slot (an
    // undefined + 1 = NaN column), or the count bleeding into passed/blocked/advised —
    // which would disguise "not judged at all" as a verdict.
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
    });
  });
});

describe('COVENANT-13 §4.5 skipped — render (the skipped=N collision)', () => {
  it('runGain reports the per-label skipped EVENT count separately from the corrupt-line skip count', () => {
    // Design trap made explicit: `runGain` already reports unparseable lines as
    // "skipped=N" (CORE-02), and the new EVENT column is also named skipped. Both meanings
    // can appear in one render — with different numbers on purpose here (2 events vs 1
    // corrupt line). Mutation caught: the two counters merged (label line showing 3, or
    // the corrupt-line report absorbing the event count), or the label line omitting the
    // skipped column entirely, which would hide the very no-op this event exists to expose.
    appendRecord(logPath, skippedRecord);
    appendRecord(logPath, skippedRecord);
    // Inject one corrupt line so the parse-skip counter is non-zero in the same render.
    const priorContent = readFileSync(logPath, 'utf-8');
    writeFileSync(logPath, `${priorContent}not a record\n`);

    const output = runGain(logPath);
    const lines = output.split('\n');

    // The label's own line carries the EVENT count (2).
    const labelLine = lines.find((line) => line.includes('dependency-needs-npm-view'));
    expect(labelLine).toBeDefined();
    expect(labelLine).toMatch(/skipped=2/);

    // The corrupt-line report (1) survives on a line of its own, not on the label line.
    expect(
      lines.some(
        (line) => !line.includes('dependency-needs-npm-view') && /skipped[= ]1\b/.test(line),
      ),
    ).toBe(true);
  });
});
