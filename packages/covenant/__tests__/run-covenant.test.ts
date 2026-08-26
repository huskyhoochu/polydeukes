import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRecordLine } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// Imports go through the package entry point so the tests also pin the public export
// surface.
import { runCovenant } from '../src/index.ts';
import { exitThunk, readTelemetryLines } from './helpers.js';

let dir: string;
let telemetryPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pdks-covenant-'));
  telemetryPath = join(dir, 'roi.log');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('§5.1 exit-code translation', () => {
  it('a body exiting 0 (uphold) yields wrapper exitCode 0 and bodyExitCode 0', async () => {
    const result = await runCovenant({
      body: exitThunk(0),
      label: 'test-covenant',
      telemetryPath,
    });

    expect(result).toEqual({ exitCode: 0, bodyExitCode: 0, event: 'passed' });
  });

  it('a body exiting 1 (non-blocking break report) is translated up to wrapper exitCode 2', async () => {
    // The 1 to 2 upgrade itself: a wrapper that passes 1 straight through would hand the
    // agent a non-blocking code for a real break.
    const result = await runCovenant({
      body: exitThunk(1),
      label: 'test-covenant',
      telemetryPath,
    });

    expect(result).toEqual({ exitCode: 2, bodyExitCode: 1, event: 'blocked' });
  });

  it('a body exiting 2 (body-side fail-closed) stays wrapper exitCode 2', async () => {
    // bodyExitCode is asserted too, so a wrapper that treats 2 as an unknown code and
    // happens to land on 2 cannot pass by coincidence.
    const result = await runCovenant({
      body: exitThunk(2),
      label: 'test-covenant',
      telemetryPath,
    });

    expect(result).toEqual({ exitCode: 2, bodyExitCode: 2, event: 'blocked' });
  });

  it('an uninterpretable body exit code (3) is fail-closed to wrapper exitCode 2', async () => {
    // 3 and above must not fall through to a passing result or an undefined branch, and
    // bodyExitCode still reflects the raw code.
    const result = await runCovenant({
      body: exitThunk(3),
      label: 'test-covenant',
      telemetryPath,
    });

    expect(result).toEqual({ exitCode: 2, bodyExitCode: 3, event: 'blocked' });
  });

  it('a thunk that throws resolves to exitCode 2 and bodyExitCode 2 without rejecting', async () => {
    // "Cannot judge" must never resolve as passing, and never propagate as a rejection
    // either — a rejected promise fails this await on its own.
    const result = await runCovenant({
      body: async () => {
        throw new Error('the judge could not run at all');
      },
      label: 'test-covenant',
      telemetryPath,
    });

    expect(result).toEqual({ exitCode: 2, bodyExitCode: 2, event: 'blocked' });
  });
});

describe('§5.3 per-call logging', () => {
  it('a single passing call appends exactly one line, recovered as event=passed with matching label/subject', async () => {
    await runCovenant({
      body: exitThunk(0),
      label: 'my-label',
      subject: 'my-subject.ts',
      telemetryPath,
    });

    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    const record = parseRecordLine(lines[0]);
    expect(record).not.toBeNull();
    expect(record?.event).toBe('passed');
    expect(record?.label).toBe('my-label');
    expect(record?.subject).toBe('my-subject.ts');
  });

  it('a single blocked call (body exit 1) appends exactly one line with event=blocked', async () => {
    // The logging event mapping is separate from the exit-code mapping: a wrapper can
    // translate the code correctly and still log the wrong event.
    await runCovenant({
      body: exitThunk(1),
      label: 'my-label',
      telemetryPath,
    });

    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    expect(parseRecordLine(lines[0])?.event).toBe('blocked');
  });

  it('a crashing-judge call still appends exactly one line with event=blocked (measurement never skipped)', async () => {
    // Every call writes exactly one line, whichever outcome it ends on: an early return on
    // the crash branch silently loses the measurement.
    await runCovenant({
      body: async () => {
        throw new Error('the judge could not run at all');
      },
      label: 'my-label',
      telemetryPath,
    });

    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    expect(parseRecordLine(lines[0])?.event).toBe('blocked');
  });

  it('an unwritable telemetryPath (nonexistent directory) still returns the correct verdict without throwing', async () => {
    // Logging is fail-open, inverted from the judgment path: a logging failure must never
    // alter the verdict or propagate as an exception.
    const missingDirTelemetryPath = join(dir, 'nonexistent-subdir', 'roi.log');

    const result = await runCovenant({
      body: exitThunk(0),
      label: 'my-label',
      telemetryPath: missingDirTelemetryPath,
    });

    expect(result).toEqual({ exitCode: 0, bodyExitCode: 0, event: 'passed' });
  });
});

describe('§4 mkdir-p before telemetry append (COVENANT-01b retrofit)', () => {
  it('creates a missing nested parent directory and appends the record instead of dropping it', async () => {
    // appendRecord is fail-open and does not create missing directories, so the wrapper
    // must ensure the parent exists BEFORE calling it — otherwise a fresh checkout with no
    // telemetry directory silently drops its first row.
    const nestedTelemetryPath = join(dir, 'nested', 'deep', 'roi.log');

    const result = await runCovenant({
      body: exitThunk(0),
      label: 'my-label',
      telemetryPath: nestedTelemetryPath,
    });

    expect(result).toEqual({ exitCode: 0, bodyExitCode: 0, event: 'passed' });
    const lines = readTelemetryLines(nestedTelemetryPath);
    expect(lines).toHaveLength(1);
    const record = parseRecordLine(lines[0]);
    expect(record).not.toBeNull();
    expect(record?.event).toBe('passed');
    expect(record?.label).toBe('my-label');
  });

  it('a directory that cannot be created (parent path is a file) still yields the correct verdict without throwing', async () => {
    // The directory creation can itself fail — a path segment colliding with a regular
    // file, or permissions. That failure must be swallowed the same way appendRecord's own
    // are, never altering the verdict or escaping as a rejection.
    const blockerFile = join(dir, 'not-a-directory');
    writeFileSync(blockerFile, 'this is a file, not a directory');
    const impossibleTelemetryPath = join(blockerFile, 'child', 'roi.log');

    const result = await runCovenant({
      body: exitThunk(0),
      label: 'my-label',
      telemetryPath: impossibleTelemetryPath,
    });

    expect(result).toEqual({ exitCode: 0, bodyExitCode: 0, event: 'passed' });
  });
});
