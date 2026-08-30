import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// A judge outcome may carry the engine's breaks as `witnesses`; the wrapper serializes them
// into a fifth tab-separated field — per break its id, at most eight witnesses, and the true
// total — so an advised break can be read back from the log alone. An outcome without
// witnesses keeps the four-field row.
import type { Break } from '../src/declaration-engine.ts';
import type { RunCovenantSpec } from '../src/run-covenant.ts';
import { runCovenant } from '../src/run-covenant.ts';

const LABEL = 'declared-covenant';
const SUBJECT = 'lib/x.db';
const ENTRY = 'placed';
const WITNESS_COUNT = 9;
const WITNESSES_PER_BREAK = 8;

/** One break carrying `count` witnesses keyed and valued by position. */
function breakWith(count: number): Break {
  return {
    id: ENTRY,
    message: 'm',
    witnesses: Array.from({ length: count }, (_, i) => ({ key: String(i), value: `v${i}` })),
  };
}

/** A judge thunk answering a break with the given witnesses. */
function breakThunk(witnesses?: readonly Break[]) {
  return async () => ({ exitCode: 1, reason: 'r', ...(witnesses !== undefined && { witnesses }) });
}

/** The tab-separated fields of the single row the run appended. */
function fieldsOfOnlyRow(path: string): string[] {
  const lines = readFileSync(path, 'utf-8')
    .split('\n')
    .filter((l) => l.length > 0);
  expect(lines).toHaveLength(1);
  return (lines[0] as string).split('\t');
}

let dir: string;
let telemetryPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pdks-witnesses-'));
  telemetryPath = join(dir, 'roi.log');
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('runCovenant — the witnesses field on the telemetry row', () => {
  it('cuts a witness value longer than the row keeps and says how long it was', async () => {
    // One witness over a bare `source` step is the whole file; the count cap alone leaves
    // the row as wide as the file. The cut carries the true length so the row stays honest.
    const long = 'x'.repeat(1_000);
    await runCovenant({
      body: breakThunk([{ id: ENTRY, message: 'm', witnesses: [{ key: '0', value: long }] }]),
      label: LABEL,
      subject: SUBJECT,
      telemetryPath,
      enforce: 'advise',
    });

    const fields = fieldsOfOnlyRow(telemetryPath);
    const [entry] = JSON.parse(fields[4] as string) as {
      witnesses: { value: string; truncated?: number }[];
    }[];
    expect(entry?.witnesses[0]?.value.length).toBeLessThan(long.length);
    expect(entry?.witnesses[0]?.truncated).toBe(JSON.stringify(long).length);
    expect((fields[4] as string).length).toBeLessThan(600);
  });

  it('a witness value JSON cannot encode costs the row its fifth field, never the verdict', async () => {
    // Telemetry is fail-open: the serialization runs before the collector's own try/catch,
    // so a throw here would abandon the dispatch loop and every sibling row with it.
    const result = await runCovenant({
      body: breakThunk([{ id: ENTRY, message: 'm', witnesses: [{ key: '0', value: BigInt(1) }] }]),
      label: LABEL,
      subject: SUBJECT,
      telemetryPath,
      enforce: 'advise',
    });

    expect(result.event).toBe('advised');
    expect(fieldsOfOnlyRow(telemetryPath)).toHaveLength(4);
  });

  it('an advised break with witnesses writes five fields, the fifth capped at eight per break with the true total', async () => {
    // The cap defends the row width; the total keeps the count honest. A serializer that
    // writes all nine, or writes eight and reports total 8, fails on the parsed value.
    const result = await runCovenant({
      body: breakThunk([breakWith(WITNESS_COUNT)]),
      label: LABEL,
      subject: SUBJECT,
      telemetryPath,
      enforce: 'advise',
    } as RunCovenantSpec);

    expect(result.event).toBe('advised');
    const fields = fieldsOfOnlyRow(telemetryPath);
    expect(fields).toHaveLength(5);
    expect(fields[1]).toBe('advised');
    expect(fields[2]).toBe(LABEL);
    expect(fields[3]).toBe(SUBJECT);
    expect(JSON.parse(fields[4] as string)).toEqual([
      {
        id: ENTRY,
        witnesses: breakWith(WITNESSES_PER_BREAK).witnesses,
        total: WITNESS_COUNT,
      },
    ]);
  });

  it('a break without witnesses keeps the four-field row', async () => {
    // The four families and the meta-covenants never carry witnesses; a fifth field
    // (`undefined`, `[]`, or `null`) on their rows breaks every four-field reader.
    await runCovenant({
      body: breakThunk(),
      label: LABEL,
      subject: SUBJECT,
      telemetryPath,
      enforce: 'advise',
    } as RunCovenantSpec);

    expect(fieldsOfOnlyRow(telemetryPath)).toHaveLength(4);
  });

  it('a blocked break under enforce block still carries the fifth field', async () => {
    // Serialization keyed on the advised event alone loses the witnesses on the rows that
    // stopped a call — the ones a reader most needs to explain.
    const result = await runCovenant({
      body: breakThunk([breakWith(1)]),
      label: LABEL,
      subject: SUBJECT,
      telemetryPath,
      enforce: 'block',
    } as RunCovenantSpec);

    expect(result.event).toBe('blocked');
    const fields = fieldsOfOnlyRow(telemetryPath);
    expect(fields).toHaveLength(5);
    expect(fields[1]).toBe('blocked');
    expect(JSON.parse(fields[4] as string)).toEqual([
      { id: ENTRY, witnesses: [{ key: '0', value: 'v0' }], total: 1 },
    ]);
  });

  it('an unjudgeable body (2) under advise stays blocked with a four-field row', async () => {
    // The advise level relaxes a break (1) only; a supply failure is a refusal to judge,
    // and a translation that reads "advise → never block" lets it through as advised (0).
    const result = await runCovenant({
      body: async () => ({ exitCode: 2 }),
      label: LABEL,
      subject: SUBJECT,
      telemetryPath,
      enforce: 'advise',
    } as RunCovenantSpec);

    expect(result.event).toBe('blocked');
    expect(result.exitCode).toBe(2);
    const fields = fieldsOfOnlyRow(telemetryPath);
    expect(fields).toHaveLength(4);
    expect(fields[1]).toBe('blocked');
  });
});
