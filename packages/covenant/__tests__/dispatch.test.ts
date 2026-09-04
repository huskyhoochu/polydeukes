import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CovenantInput } from '@polydeukes/core';
import { parseRecordLine } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CovenantRegistration } from '../src/dispatch.ts';
import { dispatchCovenants, matchRegistrations } from '../src/dispatch.ts';
import { exitThunk, inputWithArgs, markerThunk, readTelemetryLines } from './helpers.js';

function registration(label: string, protectedPaths: string[]): CovenantRegistration {
  return {
    label,
    protectedPaths,
    body: exitThunk(0),
  };
}

describe('matchRegistrations — path-mention core', () => {
  it('matches when a top-level string arg contains the protected path, with correct mentionedPath', () => {
    const input = inputWithArgs({ target: 'sub/protected/file.txt' });
    const reg = registration('sample-covenant', ['sub/protected/file.txt']);

    const matches = matchRegistrations(input, [reg]);

    expect(matches).toEqual([{ registration: reg, mentionedPath: 'sub/protected/file.txt' }]);
  });

  it('matches a protected path mentioned deep inside nested object/array structures', () => {
    // Traversal recurses through arbitrary nesting and does not care about the argument
    // name at any level.
    const input = inputWithArgs({
      edits: [{ meta: { nested: { file: 'sub/protected/file.txt' } } }],
    });
    const reg = registration('sample-covenant', ['sub/protected/file.txt']);

    const matches = matchRegistrations(input, [reg]);

    expect(matches).toEqual([{ registration: reg, mentionedPath: 'sub/protected/file.txt' }]);
  });

  it('matches on a partial/substring mention inside a longer string (e.g. a shell command)', () => {
    // The mention sits inside a longer command, so routing cannot require the whole string
    // to be the path. Matching is per path segment, not raw containment: a sibling sharing
    // a segment prefix stays unmatched.
    const input = inputWithArgs({ command: 'cat sub/protected/file.txt | grep secret' });
    const reg = registration('sample-covenant', ['sub/protected/file.txt']);

    const matches = matchRegistrations(input, [reg]);

    expect(matches).toEqual([{ registration: reg, mentionedPath: 'sub/protected/file.txt' }]);
  });

  it('returns zero matches when the input only mentions non-protected paths', () => {
    const input = inputWithArgs({ target: 'sub/unrelated/other.txt' });
    const reg = registration('sample-covenant', ['sub/protected/file.txt']);

    const matches = matchRegistrations(input, [reg]);

    expect(matches).toEqual([]);
  });

  it('returns only the matching registration out of two, preserving registration array order', () => {
    const input = inputWithArgs({ target: 'sub/protected/file.txt' });
    const regA = registration('covenant-a', ['sub/protected/file.txt']);
    const regB = registration('covenant-b', ['sub/other/unrelated.txt']);

    const matches = matchRegistrations(input, [regA, regB]);

    expect(matches).toEqual([{ registration: regA, mentionedPath: 'sub/protected/file.txt' }]);
  });

  it('a registration with an empty protectedPaths array never matches any input', () => {
    // An empty protectedPaths must never degrade into "match everything".
    const input = inputWithArgs({ target: 'sub/protected/file.txt' });
    const reg = registration('sample-covenant', []);

    const matches = matchRegistrations(input, [reg]);

    expect(matches).toEqual([]);
  });

  it('an empty-string protectedPaths entry never matches any input', () => {
    // `value.includes('')` is vacuously true for every string, so an unguarded empty entry
    // turns the registration into a match-everything one, judging every tool call with an
    // empty subject.
    const input = inputWithArgs({ target: 'sub/unrelated/other.txt' });
    const reg = registration('sample-covenant', ['']);

    const matches = matchRegistrations(input, [reg]);

    expect(matches).toEqual([]);
  });

  it('does not match when the protected path string appears only in subagentSpawns or userMessages', () => {
    // Only tool-call args participate in path-mention routing: walking subagentSpawns or
    // userMessages into the scan produces false positives from text nobody executed.
    const input: CovenantInput = {
      toolCalls: [{ name: 'some-tool', args: { target: 'sub/unrelated/other.txt' } }],
      subagentSpawns: [{ kind: 'sub/protected/file.txt' }],
      userMessages: [{ text: 'please edit sub/protected/file.txt' }],
    };
    const reg = registration('sample-covenant', ['sub/protected/file.txt']);

    const matches = matchRegistrations(input, [reg]);

    expect(matches).toEqual([]);
  });

  it('routes a quote-split protected path in a command arg to the registration', () => {
    // A quote-split write like `printf x > sub/prot"e"cted/file.txt` has no contiguous
    // protected path in the raw arg, so raw-substring routing silently misses it and no
    // covenant is judged. Candidate extraction is tokenize-aware and quote-stripped.
    const input = inputWithArgs({ command: 'printf x > sub/prot"e"cted/file.txt' });
    const reg = registration('sample-covenant', ['sub/protected/file.txt']);

    const matches = matchRegistrations(input, [reg]);

    expect(matches).toEqual([{ registration: reg, mentionedPath: 'sub/protected/file.txt' }]);
  });

  it('routes an absolute file_path to the registration (high-review regression)', () => {
    // Edit/Write send an absolute file_path. Segment matching anchored at index 0 would
    // leave an absolute descendant of a relative protected path unrouted, skipping self-mod
    // entirely.
    const input = inputWithArgs({ file_path: '/home/u/proj/sub/protected/file.txt' });
    const reg = registration('sample-covenant', ['sub/protected/file.txt']);

    const matches = matchRegistrations(input, [reg]);

    expect(matches).toEqual([{ registration: reg, mentionedPath: 'sub/protected/file.txt' }]);
  });

  it('routes a `--flag=<protected>` argument to the registration (high-review regression)', () => {
    // `--dest=sub/protected/file.txt` is one tokenizer word, so without the shell-separator
    // split the path candidate never surfaces.
    const input = inputWithArgs({ command: 'cp x --dest=sub/protected/file.txt' });
    const reg = registration('sample-covenant', ['sub/protected/file.txt']);

    const matches = matchRegistrations(input, [reg]);

    expect(matches).toEqual([{ registration: reg, mentionedPath: 'sub/protected/file.txt' }]);
  });
});

let dir: string;
let telemetryPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pdks-dispatch-'));
  telemetryPath = join(dir, 'roi.log');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('dispatchCovenants — dispatch shell', () => {
  it('a matching input routed to an exit-0 dummy body yields dispatcher exitCode 0 and the judge actually ran', async () => {
    // The marker file is the proof the judge actually ran, so the dispatcher cannot record
    // a verdict for a judge it never called.
    const outFile = join(dir, 'echoed-stdin.txt');
    const rawPayload = JSON.stringify(inputWithArgs({ target: 'sub/protected/file.txt' }));
    const reg: CovenantRegistration = {
      label: 'sample-covenant',
      protectedPaths: ['sub/protected/file.txt'],
      body: markerThunk(outFile),
    };

    const result = await dispatchCovenants({
      stdinPayload: rawPayload,
      registrations: [reg],
      telemetryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(outFile)).toBe(true);
  });

  it('a non-matching input yields exitCode 0, zero spawns, and zero telemetry lines', async () => {
    const outFile = join(dir, 'should-not-exist.txt');
    const input = inputWithArgs({ target: 'sub/unrelated/other.txt' });
    const reg: CovenantRegistration = {
      label: 'sample-covenant',
      protectedPaths: ['sub/protected/file.txt'],
      body: markerThunk(outFile),
    };

    const result = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [reg],
      telemetryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(outFile)).toBe(false);
    expect(existsSync(telemetryPath)).toBe(false);
  });

  it('invalid JSON stdin payload yields exitCode 2, zero spawns, and exactly one blocked telemetry record labeled by dispatcherLabel', async () => {
    // Unparseable input is the dispatcher's own fail-closed boundary: no judge runs, and
    // exactly one record carries the dispatcher's label.
    const outFile = join(dir, 'should-not-exist.txt');
    const reg: CovenantRegistration = {
      label: 'sample-covenant',
      protectedPaths: ['sub/protected/file.txt'],
      body: markerThunk(outFile),
    };

    const result = await dispatchCovenants({
      stdinPayload: 'not valid json at all {{{',
      registrations: [reg],
      telemetryPath,
      dispatcherLabel: 'my-dispatcher',
    });

    expect(result.exitCode).toBe(2);
    expect(existsSync(outFile)).toBe(false);
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    const record = parseRecordLine(lines[0]);
    expect(record?.event).toBe('blocked');
    expect(record?.label).toBe('my-dispatcher');
  });

  it('two matching registrations (one exit-0, one exit-1 body) both execute (run-all), aggregate to exitCode 2, and each logs its own telemetry record with subject=mentionedPath', async () => {
    // Run-all, no short-circuit: stopping after the first breaking result drops the second
    // judgment and its telemetry record.
    const outFileA = join(dir, 'body-a-ran.txt');
    const outFileB = join(dir, 'body-b-ran.txt');
    const input = inputWithArgs({ target: 'sub/protected/file.txt' });
    const regA: CovenantRegistration = {
      label: 'covenant-a',
      protectedPaths: ['sub/protected/file.txt'],
      body: markerThunk(outFileA, 0),
    };
    const regB: CovenantRegistration = {
      label: 'covenant-b',
      protectedPaths: ['sub/protected/file.txt'],
      body: markerThunk(outFileB, 1),
    };

    const result = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [regA, regB],
      telemetryPath,
    });

    expect(result.exitCode).toBe(2);
    expect(existsSync(outFileA)).toBe(true);
    expect(existsSync(outFileB)).toBe(true);
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(2);
    const records = lines.map((l) => parseRecordLine(l));
    expect(records.map((r) => r?.label)).toEqual(['covenant-a', 'covenant-b']);
    expect(records.every((r) => r?.subject === 'sub/protected/file.txt')).toBe(true);
  });

  it('a parseable payload with a null toolCalls element yields exitCode 2, zero spawns, and one blocked record', async () => {
    // parseInput validates only that the three collections are arrays, so a null element
    // reaches the dispatcher's traversal. An uncaught TypeError exits the hook with a
    // non-blocking code — unjudgeable structure must block, never throw.
    const outFile = join(dir, 'should-not-exist.txt');
    const reg: CovenantRegistration = {
      label: 'sample-covenant',
      protectedPaths: ['sub/protected/file.txt'],
      body: markerThunk(outFile),
    };

    const result = await dispatchCovenants({
      stdinPayload: '{"toolCalls":[null],"subagentSpawns":[],"userMessages":[]}',
      registrations: [reg],
      telemetryPath,
    });

    expect(result.exitCode).toBe(2);
    expect(existsSync(outFile)).toBe(false);
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    const record = parseRecordLine(lines[0]);
    expect(record?.event).toBe('blocked');
    expect(record?.label).toBe('dispatcher');
  });

  it('a pathologically deep args nesting yields exitCode 2 with one blocked record instead of an unhandled stack overflow', async () => {
    // Recursion over an adversarially deep args tree can throw RangeError. Whether
    // JSON.parse or the traversal gives out first, the dispatcher must resolve to a blocking
    // 2 with its own record rather than reject.
    const depth = 200_000;
    const payload = `{"toolCalls":[{"name":"some-tool","args":{"a":${'['.repeat(depth)}"x"${']'.repeat(depth)}}}],"subagentSpawns":[],"userMessages":[]}`;
    const reg: CovenantRegistration = {
      label: 'sample-covenant',
      protectedPaths: ['sub/protected/file.txt'],
      body: exitThunk(0),
    };

    const result = await dispatchCovenants({
      stdinPayload: payload,
      registrations: [reg],
      telemetryPath,
    });

    expect(result.exitCode).toBe(2);
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    expect(parseRecordLine(lines[0])?.event).toBe('blocked');
  });

  it('an empty registrations array yields exitCode 0 for any payload', async () => {
    const input = inputWithArgs({ target: 'sub/protected/file.txt' });

    const result = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [],
      telemetryPath,
    });

    expect(result.exitCode).toBe(0);
  });
});

describe('dispatchCovenants — skip registrations', () => {
  const skipRegistration = (matches: () => string | null): CovenantRegistration => ({
    label: 'unjudgeable-entry',
    protectedPaths: [],
    matches,
    skip: { reason: 'no session transcript to read', kind: 'no-observation' },
  });

  it('records skipped and upholds, with no body to spawn', async () => {
    const { exitCode, results } = await dispatchCovenants({
      stdinPayload: JSON.stringify(inputWithArgs({ file_path: 'src/a.ts' })),
      registrations: [skipRegistration(() => 'src/a.ts')],
      telemetryPath,
    });

    expect(exitCode).toBe(0);
    expect(results).toEqual([{ label: 'unjudgeable-entry', exitCode: 0, event: 'skipped' }]);
  });

  it('never consults the witness — a skip has no verdict to witness', async () => {
    // A skip never reaches runCovenant, where the witness lives, so it short-circuits
    // before the judge-and-witness path entirely. Folded into the body path, a live witness
    // would write `witnessed` rows for entries that were never judged.
    let consulted = false;
    const registration = {
      ...skipRegistration(() => 'src/a.ts'),
      witness: () => {
        consulted = true;
        return true;
      },
    } as CovenantRegistration;

    const { results } = await dispatchCovenants({
      stdinPayload: JSON.stringify(inputWithArgs({ file_path: 'src/a.ts' })),
      registrations: [registration],
      telemetryPath,
    });

    expect(consulted).toBe(false);
    expect(results[0].event).toBe('skipped');
  });

  it('blocks instead of skipping when the routing predicate itself could not answer', async () => {
    // matchRegistrations resolves a throwing `matches` fail-closed, which a body-bearing
    // registration carries out by judging and blocking. A skip has no body, so answering
    // `skipped` would convert that fail-closed routing into a pass.
    const { exitCode, results } = await dispatchCovenants({
      stdinPayload: JSON.stringify(inputWithArgs({ file_path: 'src/a.ts' })),
      registrations: [
        skipRegistration(() => {
          throw new Error('unjudgeable evidence kind — a stale adapter dist?');
        }),
      ],
      telemetryPath,
    });

    expect(exitCode).toBe(2);
    expect(results).toEqual([{ label: 'unjudgeable-entry', exitCode: 2, event: 'blocked' }]);
  });
});

describe('dispatchCovenants — witness seam', () => {
  it('a matched registration whose body breaks with a witness predicate returning true is witnessed: the body still spawns, exitCode 0, one witnessed record', async () => {
    // The witness relaxes a real break AFTER the body reported it, so the body always runs
    // and the opening is recorded as its own `witnessed` event.
    const outFile = join(dir, 'body-ran.txt');
    const input = inputWithArgs({ target: 'sub/protected/file.txt' });
    const reg: CovenantRegistration = {
      label: 'sample-covenant',
      protectedPaths: ['sub/protected/file.txt'],
      body: markerThunk(outFile, 1),
      witness: () => true,
    };

    const result = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [reg],
      telemetryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(outFile)).toBe(true);
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    const record = parseRecordLine(lines[0]);
    expect(record?.event).toBe('witnessed');
    expect(record?.label).toBe('sample-covenant');
    expect(record?.subject).toBe('sub/protected/file.txt');
  });

  it('a matched registration with a witness predicate returning false spawns the body normally', async () => {
    const outFile = join(dir, 'body-ran.txt');
    const input = inputWithArgs({ target: 'sub/protected/file.txt' });
    const reg: CovenantRegistration = {
      label: 'sample-covenant',
      protectedPaths: ['sub/protected/file.txt'],
      body: markerThunk(outFile, 0),
      witness: () => false,
    };

    const result = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [reg],
      telemetryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(outFile)).toBe(true);
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    expect(parseRecordLine(lines[0])?.event).toBe('passed');
  });

  it('a witness predicate that throws is treated as no bypass: the body spawns and the call is blocked', async () => {
    // A throwing witness is never an opening: it resolves to false, and the throw never
    // escapes as a rejected promise (asserted by awaiting directly).
    const outFile = join(dir, 'body-ran.txt');
    const input = inputWithArgs({ target: 'sub/protected/file.txt' });
    const reg: CovenantRegistration = {
      label: 'sample-covenant',
      protectedPaths: ['sub/protected/file.txt'],
      body: markerThunk(outFile, 1),
      witness: () => {
        throw new Error('boom');
      },
    };

    const result = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [reg],
      telemetryPath,
    });

    expect(result.exitCode).toBe(2);
    expect(existsSync(outFile)).toBe(true);
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    expect(parseRecordLine(lines[0])?.event).toBe('blocked');
  });

  it('two matched registrations, first witness-bearing and second a normal exit-0 body, both resolve (run-all preserved)', async () => {
    // Run-all carried into the witness seam: a witness-bearing registration must not stop
    // the other matched registrations from running.
    const outFileB = join(dir, 'body-b-ran.txt');
    const input = inputWithArgs({ target: 'sub/protected/file.txt' });
    const regA: CovenantRegistration = {
      label: 'covenant-a',
      protectedPaths: ['sub/protected/file.txt'],
      body: exitThunk(1),
      witness: () => true,
    };
    const regB: CovenantRegistration = {
      label: 'covenant-b',
      protectedPaths: ['sub/protected/file.txt'],
      body: markerThunk(outFileB, 0),
    };

    const result = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [regA, regB],
      telemetryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(outFileB)).toBe(true);
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(2);
    const records = lines.map((l) => parseRecordLine(l));
    expect(records.map((r) => r?.event)).toEqual(['witnessed', 'passed']);
    expect(records.map((r) => r?.label)).toEqual(['covenant-a', 'covenant-b']);
  });
});
