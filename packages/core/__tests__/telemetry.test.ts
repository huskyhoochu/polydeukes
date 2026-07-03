import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// CORE-02 RED phase. Import from the package entry point (src/index.ts) — the same
// surface `@polydeukes/core` publishes. None of these symbols exist yet (only CORE-01's
// covenant protocol + `version` are exported), so this file is RED by construction. The
// signatures asserted here become the GREEN-phase contract.
import {
  aggregateGain,
  appendRecord,
  formatRecordLine,
  parseRecordLine,
  readRecords,
  runGain,
  type TelemetryRecord,
} from '../src/index.ts';

// ---------------------------------------------------------------------------
// Fixtures — memoriq's 4-field TSV format is the reference (PRD §4.1).
// ---------------------------------------------------------------------------

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

describe('§5.1 record', () => {
  it('a single appendRecord() call writes exactly one tab-separated 4-field line ending in a newline', () => {
    // Mutation caught: appendRecord that writes without a trailing newline, drops a
    // field, or joins fields with something other than a tab.
    const result = appendRecord(logPath, baseRecord);

    expect(result.ok).toBe(true);
    const content = readFileSync(logPath, 'utf-8');
    const lines = content.split('\n');

    // Exactly one line of content, terminated by a trailing newline (so split yields
    // [line, ''] — 2 elements, not 1 or 3).
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('');
    expect(content.endsWith('\n')).toBe(true);
    expect(lines[0].split('\t')).toHaveLength(4);
    expect(lines[0].split('\t')).toEqual(['2026-07-03T12:00:00Z', 'passed', 'self-mod', 'a.ts']);
  });

  it('formatRecordLine() → parseRecordLine() round-trip preserves the record', () => {
    // Catches a formatter/parser pair that silently drops or reorders a field —
    // round-trip identity is the contract, not just "doesn't throw".
    const line = formatRecordLine(baseRecord);
    const parsed = parseRecordLine(line);

    expect(parsed).toEqual(baseRecord);
  });

  it('a record whose subject is the "-" (absent) sentinel survives the round-trip', () => {
    // Boundary: '-' is the documented sentinel for "no subject", not an error case.
    // Catches a parser that treats '-' specially (e.g. converts it to '' or undefined).
    const absentSubject: TelemetryRecord = { ...baseRecord, subject: '-' };
    const parsed = parseRecordLine(formatRecordLine(absentSubject));

    expect(parsed).toEqual(absentSubject);
  });

  it('labels/subjects containing tabs or newlines are sanitized into a single 4-field line', () => {
    // P1 line-integrity invariant: without sanitization, a tab/newline inside a field
    // would fabricate extra TSV fields or extra lines, corrupting every record after it.
    const dirty: TelemetryRecord = {
      timestamp: '2026-07-03T12:00:00Z',
      event: 'blocked',
      label: 'self\tmod\nrule',
      subject: 'path\r\nwith\tnewline',
    };
    const line = formatRecordLine(dirty);

    // Exactly one line: no embedded newline survives inside the formatted line itself
    // (the trailing terminator, if any, is not counted as an interior line break).
    expect(line.replace(/\n$/, '')).not.toMatch(/[\n\r]/);
    const fields = line.replace(/\n$/, '').split('\t');
    expect(fields).toHaveLength(4);

    const parsed = parseRecordLine(line);
    expect(parsed).not.toBeNull();
    expect(parsed?.label).not.toMatch(/[\t\n\r]/);
    expect(parsed?.subject).not.toMatch(/[\t\n\r]/);
  });
});

describe('§5.2 integrity', () => {
  it('10 concurrent appends yield exactly 10 lines, each valid under parseRecordLine() (no interleaving)', async () => {
    // Atomicity mechanism under test: 1 record = 1 write call, relying on POSIX
    // O_APPEND single-write semantics to avoid line interleaving under concurrency
    // (PRD §4.2). Promise.all over microtasks is sufficient to exercise interleaving
    // risk in a multi-call appender; it would NOT catch a real multi-process race, but
    // it does catch a naive read-modify-write append that clobbers concurrent writers.
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
    // P0 fail-open boundary (intentionally inverted from covenant fail-closed, PRD §4.3):
    // telemetry failure must never propagate as an exception. Mutation caught: try/catch
    // removed around the fs write, or the failure path returning { ok: true }.
    const missingDirPath = join(dir, 'nonexistent-subdir', 'roi.log');

    let result: { ok: boolean } | undefined;
    expect(() => {
      result = appendRecord(missingDirPath, baseRecord);
    }).not.toThrow();

    expect(result).toEqual({ ok: false });
  });

  it('readRecords() on an absent file returns { records: [], skipped: 0 } without throwing', () => {
    // Mutation caught: readRecords that throws ENOENT instead of treating an absent
    // log as "nothing collected yet" — the fail-open counterpart on the read side.
    const missingPath = join(dir, 'never-written.log');

    let result: { records: TelemetryRecord[]; skipped: number } | undefined;
    expect(() => {
      result = readRecords(missingPath);
    }).not.toThrow();

    expect(result).toEqual({ records: [], skipped: 0 });
  });
});

describe('§5.3 gain', () => {
  // Fixed, deterministic 3-label × 3-event distribution over 100 records so per-label
  // counts can be asserted exactly (not just "> 0"). label A: 20/10/5, label B: 15/10/5,
  // label C: 15/10/10 → passed 50 + blocked 30 + bypassed 20 = 100.
  const distribution: Record<string, Record<TelemetryRecord['event'], number>> = {
    'covenant-a': { passed: 20, blocked: 10, bypassed: 5 },
    'covenant-b': { passed: 15, blocked: 10, bypassed: 5 },
    'covenant-c': { passed: 15, blocked: 10, bypassed: 10 },
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
    // Mutation caught: total that sums only 2/3 events (e.g. forgets bypassed), or
    // per-label counters that share a single accumulator across labels.
    const records = buildDistributionRecords();
    for (const record of records) {
      appendRecord(logPath, record);
    }

    const { records: readBack } = readRecords(logPath);
    const summary = aggregateGain(readBack);

    expect(summary.total).toBe(100);
    expect(summary.counts).toEqual(distribution);
  });

  it('runGain() output mentions every label and marks bypassed distinctly', () => {
    // Business-meaningful substring checks only — exact formatting is GREEN's choice.
    // Mutation caught: runGain that omits a label entirely, or that folds bypassed
    // into passed/blocked without a distinguishable marker.
    const records = buildDistributionRecords();
    for (const record of records) {
      appendRecord(logPath, record);
    }

    const output = runGain(logPath);

    for (const label of Object.keys(distribution)) {
      expect(output).toContain(label);
    }
    expect(output).toMatch(/bypassed/i);
  });

  it('one corrupt line is skipped and reported as skipped=1 while the rest aggregate normally', () => {
    // Mutation caught: a corrupt line that throws and aborts the whole scan, or that
    // gets silently parsed into a bogus record instead of being skipped-and-counted.
    appendRecord(logPath, baseRecord);
    appendRecord(logPath, { ...baseRecord, event: 'blocked' });
    // Inject a corrupt line directly (not a valid 4-field TSV record).
    const priorContent = readFileSync(logPath, 'utf-8');
    writeFileSync(logPath, `${priorContent}not a record\n`);
    appendRecord(logPath, { ...baseRecord, event: 'bypassed' });

    const { records, skipped } = readRecords(logPath);

    expect(skipped).toBe(1);
    expect(records).toHaveLength(3);

    // runGain must not throw or drop output because of the corrupt line, and must
    // report the skipped count (PRD §4.4) — silent skipping would hide log corruption.
    expect(() => runGain(logPath)).not.toThrow();
    const output = runGain(logPath);
    expect(output).toContain('self-mod');
    expect(output).toMatch(/skipped[= ]1/);
  });

  it('runGain() reports "no telemetry collected" for an absent or empty log', () => {
    // Mutation caught: runGain that throws on a missing file instead of reporting the
    // documented "no telemetry collected" message, or that omits the exact phrase.
    const missingPath = join(dir, 'never-written.log');

    expect(runGain(missingPath)).toContain('no telemetry collected');

    // An existing-but-empty log must behave identically to an absent one.
    writeFileSync(logPath, '');
    expect(runGain(logPath)).toContain('no telemetry collected');
  });

  it('parseRecordLine() returns null for wrong field counts and unknown events', () => {
    // Mutation caught: field-count / enum-membership checks removed, letting a
    // malformed line masquerade as a valid TelemetryRecord instead of being rejected.
    expect(parseRecordLine('2026-07-03T12:00:00Z\tpassed\tself-mod')).toBeNull(); // 3 fields
    expect(parseRecordLine('2026-07-03T12:00:00Z\tpassed\tself-mod\ta.ts\textra')).toBeNull(); // 5 fields
    expect(parseRecordLine('2026-07-03T12:00:00Z\tmaybe\tself-mod\ta.ts')).toBeNull(); // bad event
    expect(parseRecordLine('')).toBeNull(); // empty line
  });
});
