import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isPlainObject } from '../src/is-plain-object.ts';
// Imported through the package entry point, not a deep module path: being public core
// exports is itself part of the contract under test.
import { appendRecordFailOpen, readRecords, type TelemetryRecord } from '../src/telemetry.ts';

describe('isPlainObject', () => {
  it('returns true for an empty object literal', () => {
    expect(isPlainObject({})).toBe(true);
  });

  it('returns false for null', () => {
    // `typeof null === 'object'`, so dropping the `!== null` clause makes null pass.
    expect(isPlainObject(null)).toBe(false);
  });

  it('returns false for an array', () => {
    // Arrays are `typeof === 'object'` too, so dropping `!Array.isArray` makes one pass —
    // excluding arrays is the predicate's whole job.
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject([1, 2, 3])).toBe(false);
  });

  it('returns false for primitive values (string, number, boolean, undefined)', () => {
    expect(isPlainObject('str')).toBe(false);
    expect(isPlainObject(42)).toBe(false);
    expect(isPlainObject(true)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
  });
});

// appendRecordFailOpen does mkdir(recursive) + timestamp stamp + append in one try block,
// swallowing every failure: it never throws and never alters the caller's flow.

describe('appendRecordFailOpen', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pdks-fail-open-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const record: Omit<TelemetryRecord, 'timestamp'> = {
    event: 'passed',
    label: 'self-mod',
    subject: 'a.ts',
  };

  it('creates the missing parent directory and writes a parseable record carrying a timestamp', () => {
    // The parent directory deliberately does NOT exist when the call is made — core
    // `appendRecord` does not create it, this wrapper does. Without the mkdirSync the
    // append into a nonexistent directory fails and readRecords finds nothing.
    const logPath = join(dir, 'nested', 'deeper', 'roi.log');

    appendRecordFailOpen(logPath, record);

    const { records } = readRecords(logPath);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ event: 'passed', label: 'self-mod', subject: 'a.ts' });
    // The timestamp is stamped by the wrapper, not the caller.
    expect(records[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('does not throw and writes nothing when the parent path is an existing file (mkdir fails)', () => {
    // Telemetry fails open, inverted from the covenant's fail-closed: a logging failure
    // must never propagate. The fixture makes the intended parent "directory" an existing
    // file, so mkdirSync(recursive) throws ENOTDIR; without the try/catch that throw
    // escapes into the caller's flow.
    const parentFile = join(dir, 'a-file');
    writeFileSync(parentFile, 'i am a file, not a directory');
    const logPath = join(parentFile, 'roi.log');

    expect(() => appendRecordFailOpen(logPath, record)).not.toThrow();

    const { records } = readRecords(logPath);
    expect(records).toHaveLength(0);
  });
});
