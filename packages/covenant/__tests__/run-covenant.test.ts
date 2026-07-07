import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRecordLine } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// COVENANT-01. Imports go through the package entry point (src/index.ts) so the tests
// also pin the public export surface. The signature asserted here is the PRD §4.1 contract.
import { runCovenant } from '../src/index.ts';

// ---------------------------------------------------------------------------
// Dummy covenant bodies — deterministic `node -e` inline scripts (PRD §6 step 2).
// process.execPath is the command; args carry the inline script (and, for the
// echo-style body, an output file path as an extra arg).
// ---------------------------------------------------------------------------

/** A body that exits with a fixed code, ignoring stdin entirely. */
function exitScript(code: number): string[] {
  return ['-e', `process.exit(${code})`];
}

/**
 * A body that reads stdin to completion and writes it verbatim to `outFile`
 * (passed as the script's argv), then exits 0. Used to prove stdin passthrough
 * without the wrapper parsing anything.
 */
function echoToFileScript(outFile: string): string[] {
  const script = `
    const fs = require('node:fs');
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => {
      fs.writeFileSync(process.argv[1], Buffer.concat(chunks).toString('utf-8'));
      process.exit(0);
    });
  `;
  return ['-e', script, outFile];
}

/** Read the telemetry log and return its non-empty lines. */
function readTelemetryLines(path: string): string[] {
  return readFileSync(path, 'utf-8')
    .split('\n')
    .filter((l) => l.length > 0);
}

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
    // Mutation caught: translation table entry for 0 removed/flipped, or bodyExitCode
    // not passed through on the success path.
    const result = await runCovenant({
      command: process.execPath,
      args: exitScript(0),
      stdinPayload: '{}',
      label: 'test-covenant',
      telemetryPath,
    });

    expect(result).toEqual({ exitCode: 0, bodyExitCode: 0 });
  });

  it('a body exiting 1 (non-blocking break report) is translated up to wrapper exitCode 2', async () => {
    // Core mutation target: the 1→2 upgrade itself (PRD §4.2 row 2). A wrapper that
    // passes 1 straight through, or that treats 1 as passing, must fail this test.
    const result = await runCovenant({
      command: process.execPath,
      args: exitScript(1),
      stdinPayload: '{}',
      label: 'test-covenant',
      telemetryPath,
    });

    expect(result).toEqual({ exitCode: 2, bodyExitCode: 1 });
  });

  it('a body exiting 2 (body-side fail-closed) stays wrapper exitCode 2', async () => {
    // Distinguishes "2 stays 2" from "2 gets remapped somewhere else" — a wrapper that
    // e.g. treats 2 as an unknown code and still lands on 2 would falsely pass this if
    // bodyExitCode weren't asserted too.
    const result = await runCovenant({
      command: process.execPath,
      args: exitScript(2),
      stdinPayload: '{}',
      label: 'test-covenant',
      telemetryPath,
    });

    expect(result).toEqual({ exitCode: 2, bodyExitCode: 2 });
  });

  it('an uninterpretable body exit code (3) is fail-closed to wrapper exitCode 2', async () => {
    // PRD §4.2 row 4: "the rest (3+)" must not fall through to a passing result or to
    // an unhandled/undefined branch. bodyExitCode still reflects the raw 3.
    const result = await runCovenant({
      command: process.execPath,
      args: exitScript(3),
      stdinPayload: '{}',
      label: 'test-covenant',
      telemetryPath,
    });

    expect(result).toEqual({ exitCode: 2, bodyExitCode: 3 });
  });

  it('a nonexistent executable (spawn failure) resolves to exitCode 2 and bodyExitCode null without throwing', async () => {
    // P0 fail-closed boundary (PRD §4.2 row 5): "cannot judge" must never resolve as
    // passing, and must never propagate as a rejected promise/thrown error either.
    // A rejected promise here fails the test on its own (unhandled rejection /
    // await throw) -- no extra assertion wrapper needed to catch that case.
    const result = await runCovenant({
      command: join(dir, 'this-executable-does-not-exist'),
      stdinPayload: '{}',
      label: 'test-covenant',
      telemetryPath,
    });

    expect(result).toEqual({ exitCode: 2, bodyExitCode: null });
  });
});

describe('§5.2 stdin passthrough', () => {
  it('stdinPayload reaches the body verbatim, including a deliberately malformed JSON string', async () => {
    // Mutation caught: any parsing/validation/re-serialization of the payload before
    // piping it to the body's stdin. The payload is intentionally invalid JSON — the
    // wrapper must not choke on it, reject it, or "fix" it; it is opaque cargo.
    const outFile = join(dir, 'echoed-stdin.txt');
    const malformedPayload = '{"toolCalls": [}}} not valid json at all';

    const result = await runCovenant({
      command: process.execPath,
      args: echoToFileScript(outFile),
      stdinPayload: malformedPayload,
      label: 'test-covenant',
      telemetryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(readFileSync(outFile, 'utf-8')).toBe(malformedPayload);
  });
});

describe('§5.3 per-call logging', () => {
  it('a single passing call appends exactly one line, recovered as event=passed with matching label/subject', async () => {
    // Mutation caught: appendRecord called 0 or 2+ times per call, or the record's
    // event/label/subject fields not threaded through from the call spec.
    await runCovenant({
      command: process.execPath,
      args: exitScript(0),
      stdinPayload: '{}',
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
    // Distinguishes the logging event mapping from the exit-code mapping: a wrapper
    // could translate the exit code correctly yet still log the wrong event string.
    await runCovenant({
      command: process.execPath,
      args: exitScript(1),
      stdinPayload: '{}',
      label: 'my-label',
      telemetryPath,
    });

    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    expect(parseRecordLine(lines[0])?.event).toBe('blocked');
  });

  it('a spawn-failure call still appends exactly one line with event=blocked (measurement never skipped)', async () => {
    // P0: PRD §4.3 "every call, exactly one line, regardless of which table row it
    // ends on". Mutation caught: an early-return on spawn error that skips the
    // appendRecord call entirely, silently losing the measurement.
    await runCovenant({
      command: join(dir, 'this-executable-does-not-exist'),
      stdinPayload: '{}',
      label: 'my-label',
      telemetryPath,
    });

    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    expect(parseRecordLine(lines[0])?.event).toBe('blocked');
  });

  it('an unwritable telemetryPath (nonexistent directory) still returns the correct verdict without throwing', async () => {
    // P0 fail-open boundary (PRD §4.3, inverted from the covenant fail-closed path):
    // a logging failure must never alter the verdict or propagate as an exception.
    // Mutation caught: appendRecord's { ok: false } bubbling up as a thrown error, or
    // the verdict being short-circuited to a blocked/passed default on log failure.
    const missingDirTelemetryPath = join(dir, 'nonexistent-subdir', 'roi.log');

    // Same rationale as above: a rejection would fail this await directly.
    const result = await runCovenant({
      command: process.execPath,
      args: exitScript(0),
      stdinPayload: '{}',
      label: 'my-label',
      telemetryPath: missingDirTelemetryPath,
    });

    expect(result).toEqual({ exitCode: 0, bodyExitCode: 0 });
  });
});

describe('§4 mkdir-p before telemetry append (COVENANT-01b retrofit)', () => {
  it('creates a missing nested parent directory and appends the record instead of dropping it', async () => {
    // Core regression test: telemetry.ts's appendRecord is fail-open and does NOT create
    // missing directories by design (core purity). The wrapper must ensure the parent
    // directory exists before calling appendRecord, so a fresh checkout with no
    // .polydeukes/ directory yet still gets its first telemetry line written instead of
    // silently dropped. Mutation caught: removing/skipping the mkdir-p call, or calling
    // it after appendRecord instead of before.
    const nestedTelemetryPath = join(dir, 'nested', 'deep', 'roi.log');

    const result = await runCovenant({
      command: process.execPath,
      args: exitScript(0),
      stdinPayload: '{}',
      label: 'my-label',
      telemetryPath: nestedTelemetryPath,
    });

    expect(result).toEqual({ exitCode: 0, bodyExitCode: 0 });
    const lines = readTelemetryLines(nestedTelemetryPath);
    expect(lines).toHaveLength(1);
    const record = parseRecordLine(lines[0]);
    expect(record).not.toBeNull();
    expect(record?.event).toBe('passed');
    expect(record?.label).toBe('my-label');
  });

  it('a directory that cannot be created (parent path is a file) still yields the correct verdict without throwing', async () => {
    // P0 fail-open boundary: mkdir-p can itself fail (e.g. a path segment collides with an
    // existing regular file, or permissions deny it). That failure must never propagate as
    // a thrown error/rejection and must never alter the verdict computed from bodyExitCode.
    // Mutation caught: an unguarded mkdirSync call whose ENOTDIR/EEXIST error is left to
    // bubble up instead of being swallowed the same way appendRecord's own failures are.
    const blockerFile = join(dir, 'not-a-directory');
    writeFileSync(blockerFile, 'this is a file, not a directory');
    const impossibleTelemetryPath = join(blockerFile, 'child', 'roi.log');

    // Same rationale as the existing "unwritable telemetryPath" test above: a rejection
    // would fail this await directly, no extra try/catch needed to detect a throw.
    const result = await runCovenant({
      command: process.execPath,
      args: exitScript(0),
      stdinPayload: '{}',
      label: 'my-label',
      telemetryPath: impossibleTelemetryPath,
    });

    expect(result).toEqual({ exitCode: 0, bodyExitCode: 0 });
  });
});
