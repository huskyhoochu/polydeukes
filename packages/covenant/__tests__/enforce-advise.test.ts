import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRecordLine } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CovenantRegistration } from '../src/dispatch.ts';
import { dispatchCovenants } from '../src/dispatch.ts';
// The enforce-level translation and its dispatcher threading. Advise relaxes ONLY the
// verdict cell — body exit 1 becomes exit 0 · 'advised'; every unjudgeable outcome (2, 3+,
// null) stays exit 2 · 'blocked'. Imported from the package entry point so the tests also
// pin the published surface.
import { runCovenant, translateExitCode } from '../src/index.ts';
import { exitThunk, inputWithArgs, markerThunk, readTelemetryLines } from './helpers.js';

let dir: string;
let telemetryPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pdks-enforce-advise-'));
  telemetryPath = join(dir, 'roi.log');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('translateExitCode — advise level (pure)', () => {
  it('body exit 0 (uphold) stays exit 0 · passed under advise', () => {
    // Advise does not touch the uphold cell.
    expect(translateExitCode(0, 'advise')).toEqual({ exitCode: 0, event: 'passed' });
  });

  it('body exit 1 (verdict) becomes exit 0 · advised under advise (THE one relaxed cell)', () => {
    // The single cell advise relaxes: the verdict is recorded and passed. Labelling it
    // `passed` instead would hide the very break the level exists to measure.
    expect(translateExitCode(1, 'advise')).toEqual({ exitCode: 0, event: 'advised' });
  });

  it('body exit 2 (body-side fail-closed) stays exit 2 · blocked under advise', () => {
    // Advise relaxes the verdict, never the inability to judge: a body's own fail-closed 2
    // must not soften, or every body that refuses to judge is waved through. A judge that
    // was never built does not arrive here — a missing module exits 1, colliding with a
    // real break verdict, so that branch is closed at assembly instead.
    expect(translateExitCode(2, 'advise')).toEqual({ exitCode: 2, event: 'blocked' });
  });

  it('body exit 3 (uninterpretable) stays exit 2 · blocked under advise', () => {
    // 3+ is unjudgeable and outside the level axis: "any non-zero" is not a verdict.
    expect(translateExitCode(3, 'advise')).toEqual({ exitCode: 2, event: 'blocked' });
  });

  it('body exit null (spawn failure / signal) stays exit 2 · blocked under advise', () => {
    // A judge that never produced a code cannot have judged, so advise never opens it.
    expect(translateExitCode(null, 'advise')).toEqual({ exitCode: 2, event: 'blocked' });
  });

  it('body exit 1 stays exit 2 · blocked when the enforce param is OMITTED (default block)', () => {
    // Absence of the level defaults to block, so a caller that names no level keeps
    // blocking.
    expect(translateExitCode(1)).toEqual({ exitCode: 2, event: 'blocked' });
  });
});

describe('runCovenant — enforce threaded to the wrapper', () => {
  it('a body exiting 1 under enforce advise yields exit 0 plus one advised telemetry line', async () => {
    // The spec-level enforce must reach translateExitCode, not merely be accepted on the
    // spec: a real break passes as exit 0 AND lands the distinct advised event.
    const result = await runCovenant({
      body: markerThunk(join(dir, 'body-ran.txt'), 1),
      label: 'advise-label',
      telemetryPath,
      enforce: 'advise',
    });

    expect(result.exitCode).toBe(0);
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    expect(parseRecordLine(lines[0])?.event).toBe('advised');
  });
});

describe('dispatchCovenants — enforce threading + results event field', () => {
  it('a matched exit-1 body under enforce advise yields overall exit 0 and a results entry with event advised', async () => {
    // The dispatcher threads enforce into every runCovenant call and surfaces the
    // per-registration event on results.
    const input = inputWithArgs({ target: 'sub/protected/file.txt' });
    const reg: CovenantRegistration = {
      label: 'sample-covenant',
      protectedPaths: ['sub/protected/file.txt'],
      body: exitThunk(1),
    };

    const result = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [reg],
      telemetryPath,
      enforce: 'advise',
    });

    expect(result.exitCode).toBe(0);
    expect(result.results).toEqual([{ label: 'sample-covenant', exitCode: 0, event: 'advised' }]);
  });

  it('results carry event witnessed on the witness path (enforce omitted)', () => {
    // The witnessed outcome must also surface through results, since that is where the
    // umbrella observes the event. There is no separate opening path: the body runs,
    // translates to blocked, and the witness relaxes it.
    const input = inputWithArgs({ target: 'sub/protected/file.txt' });
    const reg: CovenantRegistration = {
      label: 'witness-covenant',
      protectedPaths: ['sub/protected/file.txt'],
      body: markerThunk(join(dir, 'body-ran.txt'), 1),
      witness: () => true,
    };

    return dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [reg],
      telemetryPath,
    }).then((result) => {
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(dir, 'body-ran.txt'))).toBe(true);
      expect(result.results).toEqual([
        { label: 'witness-covenant', exitCode: 0, event: 'witnessed' },
      ]);
    });
  });

  it('dispatcher fail-closed is NOT relaxed by advise: an unparseable payload stays exit 2 + one blocked record', async () => {
    // The dispatcher's own fail-closed is outside the level axis: threading advise into it
    // opens a hole on garbage input.
    const reg: CovenantRegistration = {
      label: 'sample-covenant',
      protectedPaths: ['sub/protected/file.txt'],
      body: exitThunk(0),
    };

    const result = await dispatchCovenants({
      stdinPayload: 'not valid json at all {{{',
      registrations: [reg],
      telemetryPath,
      dispatcherLabel: 'my-dispatcher',
      enforce: 'advise',
    });

    expect(result.exitCode).toBe(2);
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    const record = parseRecordLine(lines[0]);
    expect(record?.event).toBe('blocked');
    expect(record?.label).toBe('my-dispatcher');
  });
});
