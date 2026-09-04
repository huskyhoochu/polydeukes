import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// The `skipped` row's fifth field: a reason token from a closed vocabulary saying WHY no
// judgment happened — the surface has no observation channel, assembly hit a config fault,
// or the declaration's own `supply: pass` let an absent source through. A `skipped` row has
// no witnesses, so the fifth field is free for it; on every other event the fifth field is
// still the witnesses JSON array. The formatter refuses a reason on any other event — that
// is an assembly error, not a datum — and the reader keeps the four-field `skipped` row
// readable as before.
import {
  formatRecordLine,
  parseRecordLine,
  readRecords,
  type TelemetryRecord,
} from '../src/telemetry.ts';

// Labels, subjects, and the witness payload are fixture values the row transports verbatim.
const LABEL = 'docs-stay-bilingual';
const SUBJECT = 'docs/a.md';
const TIMESTAMP = '2026-09-05T12:00:00Z';
const WITNESSES_JSON =
  '[{"id":"ko-follows","witnesses":[{"key":"docs/a","value":"docs/a.md"}],"total":1}]';

/** The three tokens; the export is asserted against this literal once, then the cases use it. */
const REASONS = ['no-observation', 'config-fault', 'supply-pass'] as const;

const skippedRecord: TelemetryRecord = {
  timestamp: TIMESTAMP,
  event: 'skipped',
  label: LABEL,
  subject: SUBJECT,
};

const FOUR_FIELD_SKIPPED_LINE = `${TIMESTAMP}\tskipped\t${LABEL}\t${SUBJECT}`;
const FOUR_FIELD_ADVISED_LINE = `${TIMESTAMP}\tadvised\t${LABEL}\t${SUBJECT}`;

let dir: string;
let logPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pdks-telemetry-skip-reason-'));
  logPath = join(dir, 'roi.log');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('skip reason — write side', () => {
  it.each(REASONS)('a skipped record with reason %s writes it as the fifth field', (reason) => {
    // The token must land in the fifth slot verbatim: a formatter that appends it to the
    // subject, or writes it only for the first token it knows, changes what a reader gets.
    const line = formatRecordLine({ ...skippedRecord, reason });

    expect(line).toBe(`${FOUR_FIELD_SKIPPED_LINE}\t${reason}\n`);
  });

  it('a skipped record without a reason still writes the four-field line', () => {
    // The runtime skips that carry no reason keep their width: a formatter emitting an empty
    // fifth field (`\t`) makes those rows five fields with an out-of-vocabulary token.
    expect(formatRecordLine(skippedRecord)).toBe(`${FOUR_FIELD_SKIPPED_LINE}\n`);
  });

  it('throws when a reason is set on a non-skipped event', () => {
    // A reason on `advised` would be read back as a witnesses field that is not a JSON
    // array — a corrupt row written by our own producer. Refusing at format time names the
    // assembly bug instead of burying it in the skipped-line count.
    expect(() =>
      formatRecordLine({ ...skippedRecord, event: 'advised', reason: 'no-observation' }),
    ).toThrow();
  });

  it('throws when a skipped record carries both witnesses and a reason', () => {
    // Two claimants for one field: writing both fabricates a sixth field, writing either
    // silently drops the other. Neither is a row.
    expect(() =>
      formatRecordLine({ ...skippedRecord, reason: 'config-fault', witnesses: '[]' }),
    ).toThrow();
  });
});

describe('skip reason — read side', () => {
  it.each(REASONS)('round-trips a skipped record with reason %s', (reason) => {
    // The token must come back under `reason`, not under `witnesses`: a reader that keeps
    // treating the fifth field as witnesses JSON either rejects the row (not an array) or
    // files the token in the wrong slot.
    const record: TelemetryRecord = { ...skippedRecord, reason };

    expect(parseRecordLine(formatRecordLine(record))).toEqual(record);
  });

  it('a five-field skipped line whose token is outside the vocabulary is null', () => {
    // A near-miss (`no-observ`) or a stray tab inside a subject would otherwise become a
    // skipped row with a fabricated reason; the corrupt-line disposition is the existing one.
    expect(parseRecordLine(`${FOUR_FIELD_SKIPPED_LINE}\tno-observ`)).toBeNull();
  });

  it('a five-field skipped line whose fifth field is a JSON array is null', () => {
    // The fifth field of a skipped row is a reason and nothing else: a reader that first
    // tries the witnesses parse admits `[]` on a row that can carry no witness.
    expect(parseRecordLine(`${FOUR_FIELD_SKIPPED_LINE}\t[]`)).toBeNull();
  });

  it('a five-field advised line carrying a reason token is null', () => {
    // The vocabulary is admitted per event: a reader that accepts a token in the fifth
    // field whatever the event turns a corrupt advised row into a record.
    expect(parseRecordLine(`${FOUR_FIELD_ADVISED_LINE}\tno-observation`)).toBeNull();
  });

  it('a four-field skipped line still parses, with no reason key', () => {
    // Rows written before the token existed, and the runtime skips that never carry one,
    // must read back exactly as before — no `reason: undefined` key either, or every
    // equality over old rows breaks.
    expect(parseRecordLine(FOUR_FIELD_SKIPPED_LINE)).toEqual(skippedRecord);
  });

  it('a five-field advised line still parses its witnesses JSON', () => {
    // The other reading of the fifth field is unchanged by the new one.
    const line = `${FOUR_FIELD_ADVISED_LINE}\t${WITNESSES_JSON}`;

    expect(parseRecordLine(line)).toEqual({
      timestamp: TIMESTAMP,
      event: 'advised',
      label: LABEL,
      subject: SUBJECT,
      witnesses: WITNESSES_JSON,
    });
  });

  it('readRecords reads a log mixing a reasoned skip, a bare skip, and a witnessed advise with skipped 0', () => {
    // One log, three widths of meaning: the reader must file each row under its own
    // shape and count none of them as corrupt.
    writeFileSync(
      logPath,
      `${FOUR_FIELD_SKIPPED_LINE}\tsupply-pass\n${FOUR_FIELD_SKIPPED_LINE}\n${FOUR_FIELD_ADVISED_LINE}\t${WITNESSES_JSON}\n`,
    );

    const { records, skipped } = readRecords(logPath);

    expect(skipped).toBe(0);
    expect(records).toEqual([
      { ...skippedRecord, reason: 'supply-pass' },
      skippedRecord,
      { ...skippedRecord, event: 'advised', witnesses: WITNESSES_JSON },
    ]);
  });
});
