import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// The optional fifth TSV field: a judgment that produced witness elements carries them as
// one already-serialized JSON string. A record without witnesses writes the unchanged
// 4-field line, the reader accepts both widths and rejects every other, and the aggregate
// projection never looks at the field.
import {
  aggregateGain,
  appendRecordFailOpen,
  formatRecordLine,
  parseRecordLine,
  readRecords,
  runGain,
  type TelemetryRecord,
} from '../src/index.ts';

// Labels, subjects, and the witness payload are fixture values the row transports verbatim.
const LABEL = 'db-only-under-knowledge';
const SUBJECT = 'lib/x.db';
const WITNESSES_JSON = '[{"id":"placed","witnesses":[{"key":"0","value":"lib/x.db"}],"total":1}]';

const fourFieldRecord: TelemetryRecord = {
  timestamp: '2026-08-29T12:00:00Z',
  event: 'advised',
  label: LABEL,
  subject: SUBJECT,
};

const fiveFieldRecord: TelemetryRecord = { ...fourFieldRecord, witnesses: WITNESSES_JSON };

const FOUR_FIELD_LINE = `2026-08-29T12:00:00Z\tadvised\t${LABEL}\t${SUBJECT}`;
const FIVE_FIELD_LINE = `${FOUR_FIELD_LINE}\t${WITNESSES_JSON}`;

let dir: string;
let logPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pdks-telemetry-witnesses-'));
  logPath = join(dir, 'roi.log');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('witnesses field — write side', () => {
  it('formatRecordLine writes exactly five tab-separated fields, the last being the string verbatim', () => {
    // A formatter that JSON-encodes the field a second time, or trims it, changes what a
    // reader recovers; the string must land as given and the line must still end in a
    // newline so the next row starts on its own line.
    const line = formatRecordLine(fiveFieldRecord);

    expect(line.endsWith('\n')).toBe(true);
    const fields = line.replace(/\n$/, '').split('\t');
    expect(fields).toHaveLength(5);
    expect(fields[4]).toBe(WITNESSES_JSON);
  });

  it('a record without witnesses still writes the unchanged four-field line', () => {
    // Every other family's rows stay four fields: a formatter that always emits a fifth
    // slot (empty string or '-') would change the width of every existing producer.
    const line = formatRecordLine(fourFieldRecord);

    expect(line).toBe(`${FOUR_FIELD_LINE}\n`);
  });

  it('a witnesses string containing a tab or newline is sanitized into a single five-field line', () => {
    // JSON escapes tabs and newlines, but the field is a string the caller hands over; an
    // unsanitized raw tab fabricates a sixth field and the whole row becomes unreadable.
    const dirty: TelemetryRecord = { ...fourFieldRecord, witnesses: '["a\tb\nc\r\nd"]' };
    const line = formatRecordLine(dirty);

    expect(line.replace(/\n$/, '')).not.toMatch(/[\n\r]/);
    expect(line.replace(/\n$/, '').split('\t')).toHaveLength(5);
    const parsed = parseRecordLine(line);
    expect(parsed).not.toBeNull();
    expect(parsed?.witnesses).not.toMatch(/[\t\n\r]/);
  });
});

describe('witnesses field — read side', () => {
  it('parses a five-field line into a record carrying the witnesses string', () => {
    // The fifth field must be read as `witnesses`, not folded into `subject` or dropped.
    expect(parseRecordLine(FIVE_FIELD_LINE)).toEqual(fiveFieldRecord);
  });

  it('parses a four-field line with witnesses undefined (existing logs stay readable)', () => {
    // Backward compatibility runs in the read direction: a parser that now requires five
    // fields turns every row written so far into a corrupt line.
    const parsed = parseRecordLine(FOUR_FIELD_LINE);

    expect(parsed).not.toBeNull();
    expect(parsed?.witnesses).toBeUndefined();
    expect(parsed).toEqual(fourFieldRecord);
  });

  it('rejects a five-field line whose fifth field is not a JSON array', () => {
    // A stray tab inside a subject also makes five fields; reading it as a record would
    // count a row under the wrong subject and hide the corruption from the skipped count.
    expect(parseRecordLine(`${FOUR_FIELD_LINE}\tb.ts`)).toBeNull();
    expect(parseRecordLine(`${FOUR_FIELD_LINE}\t{"id":"x"}`)).toBeNull();
  });

  it('rejects a six-field line and a two-field line as null', () => {
    // Widening the accepted width from {4} to {4, 5} must not become "at least 4" or "any":
    // a sixth field is a corrupt row, and so is a two-field one.
    expect(parseRecordLine(`${FIVE_FIELD_LINE}\textra`)).toBeNull();
    expect(parseRecordLine('2026-08-29T12:00:00Z\tadvised')).toBeNull();
  });

  it('readRecords returns both widths from one mixed log with skipped 0', () => {
    // A log written by the old and the new producer is one log; the five-field row must
    // not count as corrupt, and the four-field row must not be dropped.
    writeFileSync(logPath, `${FOUR_FIELD_LINE}\n${FIVE_FIELD_LINE}\n`);

    const { records, skipped } = readRecords(logPath);

    expect(skipped).toBe(0);
    expect(records).toEqual([fourFieldRecord, fiveFieldRecord]);
  });
});

describe('witnesses field — the fail-open writer and the aggregate projection', () => {
  it('appendRecordFailOpen writes a five-field line when the record carries witnesses', () => {
    // The wrapper stamps the timestamp and delegates the row format; a wrapper that
    // rebuilds the record from the four named fields loses the fifth.
    appendRecordFailOpen(logPath, {
      event: 'advised',
      label: LABEL,
      subject: SUBJECT,
      witnesses: WITNESSES_JSON,
    });

    const content = readFileSync(logPath, 'utf-8');
    const fields = content.replace(/\n$/, '').split('\t');
    expect(fields).toHaveLength(5);
    expect(fields[4]).toBe(WITNESSES_JSON);
    expect(fields.slice(1, 4)).toEqual(['advised', LABEL, SUBJECT]);
  });

  it('a five-field record counts under its event like any other (gain projection unchanged)', () => {
    // The aggregate never reads the fifth field: a record with witnesses is one `advised`
    // row, neither excluded from the total nor counted under a new column.
    const summary = aggregateGain([fourFieldRecord, fiveFieldRecord]);

    expect(summary.total).toBe(2);
    expect(summary.counts[LABEL]?.advised).toBe(2);

    writeFileSync(logPath, `${FOUR_FIELD_LINE}\n${FIVE_FIELD_LINE}\n`);
    expect(runGain(logPath)).toContain('advised=2');
  });
});
