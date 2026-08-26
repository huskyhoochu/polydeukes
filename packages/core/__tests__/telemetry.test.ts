import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// Imports from the package entry point — the same surface `@polydeukes/core` publishes.
import {
  aggregateGain,
  appendRecord,
  formatRecordLine,
  parseRecordLine,
  readRecords,
  runGain,
  type TelemetryRecord,
} from '../src/index.ts';

const baseRecord: TelemetryRecord = {
  timestamp: '2026-07-03T12:00:00Z',
  event: 'passed',
  label: 'self-mod',
  subject: 'a.ts',
};

let dir: string;
let logPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pdks-telemetry-'));
  logPath = join(dir, 'roi.log');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('record', () => {
  it('a single appendRecord() call writes exactly one tab-separated 4-field line ending in a newline', () => {
    const result = appendRecord(logPath, baseRecord);

    expect(result.ok).toBe(true);
    const content = readFileSync(logPath, 'utf-8');
    const lines = content.split('\n');

    // One line terminated by a trailing newline, so split yields [line, ''].
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('');
    expect(content.endsWith('\n')).toBe(true);
    expect(lines[0].split('\t')).toHaveLength(4);
    expect(lines[0].split('\t')).toEqual(['2026-07-03T12:00:00Z', 'passed', 'self-mod', 'a.ts']);
  });

  it('formatRecordLine() → parseRecordLine() round-trip preserves the record', () => {
    const line = formatRecordLine(baseRecord);
    const parsed = parseRecordLine(line);

    expect(parsed).toEqual(baseRecord);
  });

  it('a record whose subject is the "-" (absent) sentinel survives the round-trip', () => {
    // '-' is the sentinel for "no subject", not an error case: a parser must not convert
    // it to '' or undefined.
    const absentSubject: TelemetryRecord = { ...baseRecord, subject: '-' };
    const parsed = parseRecordLine(formatRecordLine(absentSubject));

    expect(parsed).toEqual(absentSubject);
  });

  it('labels/subjects containing tabs or newlines are sanitized into a single 4-field line', () => {
    // Without sanitization a tab or newline inside a field fabricates extra TSV fields or
    // extra lines, corrupting every record after it.
    const dirty: TelemetryRecord = {
      timestamp: '2026-07-03T12:00:00Z',
      event: 'blocked',
      label: 'self\tmod\nrule',
      subject: 'path\r\nwith\tnewline',
    };
    const line = formatRecordLine(dirty);

    // The trailing terminator, if any, is stripped first so it does not count as an
    // interior line break.
    expect(line.replace(/\n$/, '')).not.toMatch(/[\n\r]/);
    const fields = line.replace(/\n$/, '').split('\t');
    expect(fields).toHaveLength(4);

    const parsed = parseRecordLine(line);
    expect(parsed).not.toBeNull();
    expect(parsed?.label).not.toMatch(/[\t\n\r]/);
    expect(parsed?.subject).not.toMatch(/[\t\n\r]/);
  });
});

describe('integrity', () => {
  it('10 concurrent appends yield exactly 10 lines, each valid under parseRecordLine() (no interleaving)', async () => {
    // Atomicity rests on 1 record = 1 write call, using POSIX O_APPEND single-write
    // semantics. Promise.all over microtasks would NOT catch a real multi-process race;
    // it does catch a read-modify-write append that clobbers concurrent writers.
    const records: TelemetryRecord[] = Array.from({ length: 10 }, (_, i) => ({
      timestamp: '2026-07-03T12:00:00Z',
      event: i % 2 === 0 ? 'passed' : 'blocked',
      label: `covenant-${i}`,
      subject: '-',
    }));

    await Promise.all(records.map((record) => Promise.resolve(appendRecord(logPath, record))));

    const content = readFileSync(logPath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.length > 0);

    expect(lines).toHaveLength(10);
    for (const line of lines) {
      expect(parseRecordLine(line)).not.toBeNull();
    }
  });

  it('appendRecord() into a nonexistent directory returns { ok: false } without throwing', () => {
    // Telemetry fails OPEN — deliberately inverted from the covenant's fail-closed rule.
    // A measurement that cannot be written must never propagate as an exception and stop
    // the work it was measuring.
    const missingDirPath = join(dir, 'nonexistent-subdir', 'roi.log');

    let result: { ok: boolean } | undefined;
    expect(() => {
      result = appendRecord(missingDirPath, baseRecord);
    }).not.toThrow();

    expect(result).toEqual({ ok: false });
  });

  it('readRecords() on an absent file returns { records: [], skipped: 0 } without throwing', () => {
    // The fail-open counterpart on the read side: an absent log means "nothing collected
    // yet", not ENOENT.
    const missingPath = join(dir, 'never-written.log');

    let result: { records: TelemetryRecord[]; skipped: number } | undefined;
    expect(() => {
      result = readRecords(missingPath);
    }).not.toThrow();

    expect(result).toEqual({ records: [], skipped: 0 });
  });
});

describe('gain', () => {
  // A fixed distribution over 100 records so per-label counts can be asserted exactly
  // rather than "> 0": passed 50 + blocked 30 + witnessed 20. The zero-count events carry
  // no records but must stay — aggregateGain reports every event in the vocabulary, so
  // dropping a slot breaks the exact-equality comparison below.
  const distribution: Record<string, Record<TelemetryRecord['event'], number>> = {
    'covenant-a': {
      passed: 20,
      blocked: 10,
      witnessed: 5,
      advised: 0,
      skipped: 0,
      unattributed: 0,
    },
    'covenant-b': {
      passed: 15,
      blocked: 10,
      witnessed: 5,
      advised: 0,
      skipped: 0,
      unattributed: 0,
    },
    'covenant-c': {
      passed: 15,
      blocked: 10,
      witnessed: 10,
      advised: 0,
      skipped: 0,
      unattributed: 0,
    },
  };

  function buildDistributionRecords(): TelemetryRecord[] {
    const records: TelemetryRecord[] = [];
    for (const [label, counts] of Object.entries(distribution)) {
      for (const [event, count] of Object.entries(counts) as [TelemetryRecord['event'], number][]) {
        for (let i = 0; i < count; i++) {
          records.push({ timestamp: '2026-07-03T12:00:00Z', event, label, subject: '-' });
        }
      }
    }
    return records;
  }

  it('a 100-record simulation (fixed 3-label × 3-event distribution) aggregates to total 100 with exact per-label counts', () => {
    const records = buildDistributionRecords();
    for (const record of records) {
      appendRecord(logPath, record);
    }

    const { records: readBack } = readRecords(logPath);
    const summary = aggregateGain(readBack);

    expect(summary.total).toBe(100);
    expect(summary.counts).toEqual(distribution);
  });

  it('runGain() output mentions every label and marks witnessed distinctly', () => {
    // Substring checks only: the exact output format is deliberately unpinned, so these
    // assert what must be present — every label, and witnessed distinguishable from
    // passed/blocked rather than folded into them.
    const records = buildDistributionRecords();
    for (const record of records) {
      appendRecord(logPath, record);
    }

    const output = runGain(logPath);

    for (const label of Object.keys(distribution)) {
      expect(output).toContain(label);
    }
    expect(output).toMatch(/witnessed/i);
  });

  it('one corrupt line is skipped and reported as skipped=1 while the rest aggregate normally', () => {
    // The corrupt line sits BETWEEN valid records, so a scan that aborts on it loses the
    // record after it rather than merely miscounting.
    appendRecord(logPath, baseRecord);
    appendRecord(logPath, { ...baseRecord, event: 'blocked' });
    const priorContent = readFileSync(logPath, 'utf-8');
    writeFileSync(logPath, `${priorContent}not a record\n`);
    appendRecord(logPath, { ...baseRecord, event: 'witnessed' });

    const { records, skipped } = readRecords(logPath);

    expect(skipped).toBe(1);
    expect(records).toHaveLength(3);

    // The skipped count must be reported, not just tolerated: silent skipping would hide
    // log corruption behind a plausible-looking summary.
    expect(() => runGain(logPath)).not.toThrow();
    const output = runGain(logPath);
    expect(output).toContain('self-mod');
    expect(output).toMatch(/skipped[= ]1/);
  });

  it('runGain() reports "no telemetry collected" for an absent or empty log', () => {
    const missingPath = join(dir, 'never-written.log');

    expect(runGain(missingPath)).toContain('no telemetry collected');

    // An existing-but-empty log must behave identically to an absent one.
    writeFileSync(logPath, '');
    expect(runGain(logPath)).toContain('no telemetry collected');
  });

  it('parseRecordLine() returns null for wrong field counts and unknown events', () => {
    expect(parseRecordLine('2026-07-03T12:00:00Z\tpassed\tself-mod')).toBeNull(); // 3 fields
    expect(parseRecordLine('2026-07-03T12:00:00Z\tpassed\tself-mod\ta.ts\textra')).toBeNull(); // 5 fields
    expect(parseRecordLine('2026-07-03T12:00:00Z\tmaybe\tself-mod\ta.ts')).toBeNull(); // bad event
    expect(parseRecordLine('')).toBeNull(); // empty line
  });
});
