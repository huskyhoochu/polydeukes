import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRecordLine } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CovenantRegistration } from '../src/dispatch.ts';
import { dispatchCovenants } from '../src/dispatch.ts';
// CONFIG-06 §4.4/§4.5 RED phase. The enforce-level translation seam and its dispatcher
// threading. Imported from the package entry points (the published surfaces). The new
// symbols — translateExitCode's second `enforce` parameter, RunCovenantSpec.enforce, the
// dispatcher spec's enforce, and the results `event` field — do NOT exist yet, so these
// are RED by construction. Contract asserted (GREEN matches):
//   translateExitCode(bodyExitCode, enforce: 'block' | 'advise' = 'block')
//     advise relaxes ONLY the verdict cell (body exit 1 → exit 0 · 'advised'); every
//     unjudgeable outcome (2, 3+, null) stays exit 2 · 'blocked' (§4.4 invariant).
import { runCovenant, translateExitCode } from '../src/index.ts';
import { echoToFileScript, inputWithArgs, readTelemetryLines } from './helpers.js';

let dir: string;
let telemetryPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pdks-enforce-advise-'));
  telemetryPath = join(dir, 'roi.log');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('CONFIG-06 §4.4 translateExitCode — advise level (pure)', () => {
  it('body exit 0 (uphold) stays exit 0 · passed under advise', () => {
    // §4.4 row 1: advise does not touch the uphold cell. Mutation caught: the advise
    // branch mislabeling a pass as advised, or flipping its exit code.
    expect(translateExitCode(0, 'advise')).toEqual({ exitCode: 0, event: 'passed' });
  });

  it('body exit 1 (verdict) becomes exit 0 · advised under advise (THE one relaxed cell)', () => {
    // §4.4 row 2 — the single cell advise relaxes: a normal violation verdict is recorded
    // and passed. Mutation caught: the relaxation not applied (stays exit 2 · blocked), or
    // applied but mislabeled (exit 0 · passed hides the verdict the ticket measures).
    expect(translateExitCode(1, 'advise')).toEqual({ exitCode: 0, event: 'advised' });
  });

  it('body exit 2 (body-side fail-closed) stays exit 2 · blocked under advise', () => {
    // §4.4 row 3 invariant: advise relaxes the verdict, NOT the unjudgeable. A body's own
    // fail-closed 2 must never soften. Mutation caught: the advise branch relaxing exit 2
    // the same way it relaxes exit 1 (fail-open hole on stale dist / parse failure).
    expect(translateExitCode(2, 'advise')).toEqual({ exitCode: 2, event: 'blocked' });
  });

  it('body exit 3 (uninterpretable) stays exit 2 · blocked under advise', () => {
    // §4.4 row 4: 3+ is unjudgeable, outside the level axis. Mutation caught: an advise
    // branch that treats "any non-zero" as a relaxable verdict.
    expect(translateExitCode(3, 'advise')).toEqual({ exitCode: 2, event: 'blocked' });
  });

  it('body exit null (spawn failure / signal) stays exit 2 · blocked under advise', () => {
    // §4.4 row 4: a spawn failure cannot judge — advise never opens it. Mutation caught:
    // a null branch falling through the advise verdict-relaxation path.
    expect(translateExitCode(null, 'advise')).toEqual({ exitCode: 2, event: 'blocked' });
  });

  it('body exit 1 stays exit 2 · blocked when the enforce param is OMITTED (default block)', () => {
    // §4.4 block column, defaulted argument: absence of the level defaults to block, so
    // every existing caller keeps current behavior. Mutation caught: the default value
    // flipped to 'advise', silently relaxing all legacy call sites.
    expect(translateExitCode(1)).toEqual({ exitCode: 2, event: 'blocked' });
  });
});

describe('CONFIG-06 §4.4 runCovenant — enforce threaded to the wrapper', () => {
  it('a body exiting 1 under enforce advise yields exit 0 plus one advised telemetry line', async () => {
    // Proves the spec-level enforce reaches translateExitCode: a real break body (exit 1)
    // passes as exit 0 AND logs the distinct advised event (N:N unchanged, only the name).
    // Mutation caught: enforce accepted on the spec but never threaded, so the body still
    // blocks / logs blocked.
    const result = await runCovenant({
      command: process.execPath,
      args: echoToFileScript(join(dir, 'body-ran.txt'), 1),
      stdinPayload: '{}',
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

describe('CONFIG-06 §4.5 dispatchCovenants — enforce threading + results event field', () => {
  it('a matched exit-1 body under enforce advise yields overall exit 0 and a results entry with event advised', async () => {
    // §4.5: the dispatcher threads enforce into every runCovenant call, and surfaces the
    // per-registration event on results. Mutation caught: enforce dropped at the dispatch
    // layer (verdict still blocks), or the results entry missing/mislabeling event.
    const input = inputWithArgs({ target: 'sub/protected/file.txt' });
    const reg: CovenantRegistration = {
      label: 'sample-covenant',
      protectedPaths: ['sub/protected/file.txt'],
      body: { command: process.execPath, args: ['-e', 'process.exit(1)'] },
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

  it('results carry event bypassed on the escape-hatch path (enforce omitted)', () => {
    // §4.5: the existing bypass path must also expose event — the umbrella observes the
    // event through results. Mutation caught: the event field wired only on the body path
    // and left off the bypass path. (Sync body: assertion is the awaited result below.)
    const input = inputWithArgs({ target: 'sub/protected/file.txt' });
    const reg: CovenantRegistration = {
      label: 'bypass-covenant',
      protectedPaths: ['sub/protected/file.txt'],
      body: { command: process.execPath, args: echoToFileScript(join(dir, 'nope.txt'), 0) },
      escapeHatch: () => true,
    };

    return dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [reg],
      telemetryPath,
    }).then((result) => {
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(dir, 'nope.txt'))).toBe(false);
      expect(result.results).toEqual([
        { label: 'bypass-covenant', exitCode: 0, event: 'bypassed' },
      ]);
    });
  });

  it('dispatcher fail-closed is NOT relaxed by advise: an unparseable payload stays exit 2 + one blocked record', async () => {
    // §4.5 invariant: the dispatcher's own fail-closed (unparseable stdin) is outside the
    // level axis — enforce advise must not soften it. Mutation caught: the advise level
    // threaded into the dispatcher-level fail-closed, opening a bypass on garbage input.
    const reg: CovenantRegistration = {
      label: 'sample-covenant',
      protectedPaths: ['sub/protected/file.txt'],
      body: { command: process.execPath, args: ['-e', 'process.exit(0)'] },
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
