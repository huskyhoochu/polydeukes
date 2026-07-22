import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// CORE-05 RED phase. Both symbols are being promoted to public core exports (PRD §4),
// so the test imports them through the package entry point (src/index.ts) — the same
// surface `@polydeukes/core` publishes. AC-1 is that they are *public core exports*, so
// deep-module paths would not prove the contract. Neither symbol is exported yet, so this
// file is RED by construction (missing exports, not a behavioral assertion).
import {
  appendRecordFailOpen,
  isPlainObject,
  readRecords,
  type TelemetryRecord,
} from '../src/index.ts';

// ---------------------------------------------------------------------------
// isPlainObject — PRD §4.1: typeof === 'object' && !== null && !Array.isArray.
// ---------------------------------------------------------------------------

describe('isPlainObject', () => {
  it('returns true for an empty object literal', () => {
    // Kills a mutant that reverses the return (e.g. `!isPlainObject`) or that treats
    // an empty object as falsy.
    expect(isPlainObject({})).toBe(true);
  });

  it('returns false for null', () => {
    // P0: `typeof null === 'object'`, so dropping the `!== null` clause makes null pass.
    // This is the classic mutant the null check exists to kill.
    expect(isPlainObject(null)).toBe(false);
  });

  it('returns false for an array', () => {
    // P0: arrays are `typeof === 'object'` too, so dropping `!Array.isArray` makes an
    // array pass. The predicate's whole job is to exclude arrays.
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject([1, 2, 3])).toBe(false);
  });

  it('returns false for primitive values (string, number, boolean, undefined)', () => {
    // Each is `typeof !== 'object'`. Catches a mutant that widens the typeof check or
    // drops it entirely.
    expect(isPlainObject('str')).toBe(false);
    expect(isPlainObject(42)).toBe(false);
    expect(isPlainObject(true)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// appendRecordFailOpen — PRD §4.2: mkdir(recursive) + timestamp stamp + append,
// all in one try block; every failure swallowed (never throws, never alters flow).
// ---------------------------------------------------------------------------

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
    // P1: proves the mkdir-recursive behavior — the parent directory does NOT exist when
    // the call is made, and core `appendRecord` deliberately does not create it (PRD §4.2
    // invariant). Kills a mutant that drops the mkdirSync line: without it the append into
    // a nonexistent directory fails and readRecords finds nothing.
    const logPath = join(dir, 'nested', 'deeper', 'roi.log');

    appendRecordFailOpen(logPath, record);

    const { records } = readRecords(logPath);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ event: 'passed', label: 'self-mod', subject: 'a.ts' });
    // The timestamp is stamped by the wrapper, not the caller — assert it is a non-empty
    // ISO string. Kills a mutant that omits the timestamp field or leaves it blank.
    expect(records[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('does not throw and writes nothing when the parent path is an existing file (mkdir fails)', () => {
    // P0 fail-open boundary (inverted from covenant fail-closed): a logging failure must
    // never propagate. Fixture: the intended parent "directory" is actually an existing
    // file, so mkdirSync(recursive) throws ENOTDIR. Kills a mutant that removes the
    // try/catch — the throw would then escape and alter the caller's flow.
    const parentFile = join(dir, 'a-file');
    writeFileSync(parentFile, 'i am a file, not a directory');
    const logPath = join(parentFile, 'roi.log');

    expect(() => appendRecordFailOpen(logPath, record)).not.toThrow();

    // Nothing was written — the append never succeeded, so the log path yields no records.
    const { records } = readRecords(logPath);
    expect(records).toHaveLength(0);
  });
});
