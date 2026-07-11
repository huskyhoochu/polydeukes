import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CovenantInput } from '@polydeukes/core';
import { parseRecordLine } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CovenantRegistration } from '../src/dispatch.ts';
import { dispatchCovenants, matchRegistrations } from '../src/dispatch.ts';

// ---------------------------------------------------------------------------
// §6.1 matching core (pure) — synthetic CovenantInput builders, no I/O.
// ---------------------------------------------------------------------------

/** Build a minimal CovenantInput with a single toolCalls[0].args value tree. */
function inputWithArgs(args: Record<string, unknown>): CovenantInput {
  return {
    toolCalls: [{ name: 'some-tool', args }],
    subagentSpawns: [],
    userMessages: [],
  };
}

function registration(label: string, protectedPaths: string[]): CovenantRegistration {
  return {
    label,
    protectedPaths,
    body: { command: process.execPath, args: ['-e', 'process.exit(0)'] },
  };
}

describe('matchRegistrations — path-mention core (PRD §6.1)', () => {
  it('matches when a top-level string arg contains the protected path, with correct mentionedPath', () => {
    // Mutation caught: substring check replaced with equality, or mentionedPath
    // returning the wrong element / the input value instead of the registration's path.
    const input = inputWithArgs({ target: 'sub/protected/file.txt' });
    const reg = registration('sample-covenant', ['sub/protected/file.txt']);

    const matches = matchRegistrations(input, [reg]);

    expect(matches).toEqual([{ registration: reg, mentionedPath: 'sub/protected/file.txt' }]);
  });

  it('matches a protected path mentioned deep inside nested object/array structures', () => {
    // Proves traversal recurses through arbitrary nesting (object -> array -> object)
    // and does not care about the argument name at any level. Mutation caught: a
    // shallow scan that only checks top-level values or a fixed nesting depth.
    const input = inputWithArgs({
      edits: [{ meta: { nested: { file: 'sub/protected/file.txt' } } }],
    });
    const reg = registration('sample-covenant', ['sub/protected/file.txt']);

    const matches = matchRegistrations(input, [reg]);

    expect(matches).toEqual([{ registration: reg, mentionedPath: 'sub/protected/file.txt' }]);
  });

  it('matches on a partial/substring mention inside a longer string (e.g. a shell command)', () => {
    // Path-mention policy (PRD §4.2/§8): matching is substring containment, not exact
    // equality or path-boundary aware. Mutation caught: a check requiring the whole
    // string to equal the protected path, or requiring word/path-segment boundaries.
    const input = inputWithArgs({ command: 'cat sub/protected/file.txt | grep secret' });
    const reg = registration('sample-covenant', ['sub/protected/file.txt']);

    const matches = matchRegistrations(input, [reg]);

    expect(matches).toEqual([{ registration: reg, mentionedPath: 'sub/protected/file.txt' }]);
  });

  it('returns zero matches when the input only mentions non-protected paths', () => {
    // Mutation caught: a match function that always returns non-empty (e.g. returns
    // every registration regardless of content), or one that ignores absence.
    const input = inputWithArgs({ target: 'sub/unrelated/other.txt' });
    const reg = registration('sample-covenant', ['sub/protected/file.txt']);

    const matches = matchRegistrations(input, [reg]);

    expect(matches).toEqual([]);
  });

  it('returns only the matching registration out of two, preserving registration array order', () => {
    // Mutation caught: order not preserved (e.g. matched registrations pushed in
    // reverse or sorted), or both/neither returned instead of exactly the one match.
    const input = inputWithArgs({ target: 'sub/protected/file.txt' });
    const regA = registration('covenant-a', ['sub/protected/file.txt']);
    const regB = registration('covenant-b', ['sub/other/unrelated.txt']);

    const matches = matchRegistrations(input, [regA, regB]);

    expect(matches).toEqual([{ registration: regA, mentionedPath: 'sub/protected/file.txt' }]);
  });

  it('a registration with an empty protectedPaths array never matches any input', () => {
    // Mutation caught: an empty-array short-circuit removed, causing an empty
    // protectedPaths to be treated as "match everything" (e.g. `.some()` on empty
    // array vacuously true if the predicate were inverted).
    const input = inputWithArgs({ target: 'sub/protected/file.txt' });
    const reg = registration('sample-covenant', []);

    const matches = matchRegistrations(input, [reg]);

    expect(matches).toEqual([]);
  });

  it('an empty-string protectedPaths entry never matches any input', () => {
    // Mutation caught: `value.includes('')` is vacuously true for every string, so an
    // unguarded empty entry would turn the registration into a match-everything rule
    // (covenant spawned on every tool call, subject logged as '').
    const input = inputWithArgs({ target: 'sub/unrelated/other.txt' });
    const reg = registration('sample-covenant', ['']);

    const matches = matchRegistrations(input, [reg]);

    expect(matches).toEqual([]);
  });

  it('does not match when the protected path string appears only in subagentSpawns or userMessages', () => {
    // PRD §4.2 non-participation rule. Mutation caught: a traversal that also walks
    // subagentSpawns[].kind or userMessages[].text into the scan, producing a false
    // positive match from those fields.
    const input: CovenantInput = {
      toolCalls: [{ name: 'some-tool', args: { target: 'sub/unrelated/other.txt' } }],
      subagentSpawns: [{ kind: 'sub/protected/file.txt' }],
      userMessages: [{ text: 'please edit sub/protected/file.txt' }],
    };
    const reg = registration('sample-covenant', ['sub/protected/file.txt']);

    const matches = matchRegistrations(input, [reg]);

    expect(matches).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §6.2 dispatch shell — real dummy bodies spawned via `node -e` inline scripts,
// following the run-covenant.test.ts convention.
// ---------------------------------------------------------------------------

/**
 * A body that reads stdin to completion and writes it verbatim to `outFile`
 * (passed as the script's argv), then exits with the given code. Used both to prove
 * stdin passthrough and to prove/disprove that a spawn happened at all (a missing
 * outFile means the body never ran).
 */
function echoToFileScript(outFile: string, exitCode = 0): string[] {
  const script = `
    const fs = require('node:fs');
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => {
      fs.writeFileSync(process.argv[1], Buffer.concat(chunks).toString('utf-8'));
      process.exit(${exitCode});
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
  dir = mkdtempSync(join(tmpdir(), 'pdks-dispatch-'));
  telemetryPath = join(dir, 'roi.log');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('dispatchCovenants — dispatch shell (PRD §6.2)', () => {
  it('a matching input routed to an exit-0 dummy body yields dispatcher exitCode 0 and the body received the verbatim raw payload on stdin', async () => {
    // Mutation caught: the shell re-serializing the parsed input before forwarding it
    // (opaque-cargo violation), or the wrapper verdict not being surfaced as-is.
    const outFile = join(dir, 'echoed-stdin.txt');
    const rawPayload = JSON.stringify(inputWithArgs({ target: 'sub/protected/file.txt' }));
    const reg: CovenantRegistration = {
      label: 'sample-covenant',
      protectedPaths: ['sub/protected/file.txt'],
      body: { command: process.execPath, args: echoToFileScript(outFile) },
    };

    const result = await dispatchCovenants({
      stdinPayload: rawPayload,
      registrations: [reg],
      telemetryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(readFileSync(outFile, 'utf-8')).toBe(rawPayload);
  });

  it('a non-matching input yields exitCode 0, zero spawns, and zero telemetry lines', async () => {
    // Mutation caught: the dispatcher spawning every registration unconditionally
    // (ignoring matchRegistrations), or writing a telemetry record even absent a match.
    const outFile = join(dir, 'should-not-exist.txt');
    const input = inputWithArgs({ target: 'sub/unrelated/other.txt' });
    const reg: CovenantRegistration = {
      label: 'sample-covenant',
      protectedPaths: ['sub/protected/file.txt'],
      body: { command: process.execPath, args: echoToFileScript(outFile) },
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
    // P0 fail-closed boundary (PRD §4.3 row 1). Mutation caught: falling through to a
    // passing exit code on unparseable input, spawning a body anyway, or skipping/
    // duplicating the fail-closed telemetry record.
    const outFile = join(dir, 'should-not-exist.txt');
    const reg: CovenantRegistration = {
      label: 'sample-covenant',
      protectedPaths: ['sub/protected/file.txt'],
      body: { command: process.execPath, args: echoToFileScript(outFile) },
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
    // P0 run-all invariant (PRD §4.3/§8: "run-all, no short-circuit"). Mutation caught:
    // a short-circuit that stops after the first breaking result, dropping the second
    // spawn and its telemetry record, or subject not threaded from mentionedPath.
    const outFileA = join(dir, 'body-a-ran.txt');
    const outFileB = join(dir, 'body-b-ran.txt');
    const input = inputWithArgs({ target: 'sub/protected/file.txt' });
    const regA: CovenantRegistration = {
      label: 'covenant-a',
      protectedPaths: ['sub/protected/file.txt'],
      body: { command: process.execPath, args: echoToFileScript(outFileA, 0) },
    };
    const regB: CovenantRegistration = {
      label: 'covenant-b',
      protectedPaths: ['sub/protected/file.txt'],
      body: { command: process.execPath, args: echoToFileScript(outFileB, 1) },
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
    // fail-closed boundary: parseInput only validates that the three collections are
    // arrays (an intended CORE-01 boundary), so a null element reaches the dispatcher's
    // traversal. An uncaught TypeError would exit the hook with a non-blocking code —
    // a bypass vector. Unjudgeable structure must block, not throw.
    const outFile = join(dir, 'should-not-exist.txt');
    const reg: CovenantRegistration = {
      label: 'sample-covenant',
      protectedPaths: ['sub/protected/file.txt'],
      body: { command: process.execPath, args: echoToFileScript(outFile) },
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
    // fail-closed boundary: recursion over an adversarially deep args tree can throw
    // RangeError (stack overflow). Whether JSON.parse or the traversal gives out first,
    // the dispatcher must resolve to a blocking 2 with its own record — never reject.
    const depth = 200_000;
    const payload = `{"toolCalls":[{"name":"some-tool","args":{"a":${'['.repeat(depth)}"x"${']'.repeat(depth)}}}],"subagentSpawns":[],"userMessages":[]}`;
    const reg: CovenantRegistration = {
      label: 'sample-covenant',
      protectedPaths: ['sub/protected/file.txt'],
      body: { command: process.execPath, args: ['-e', 'process.exit(0)'] },
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
    // Mutation caught: an empty-array edge case that throws, hangs, or defaults to
    // exitCode 2 instead of the vacuous-pass 0.
    const input = inputWithArgs({ target: 'sub/protected/file.txt' });

    const result = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [],
      telemetryPath,
    });

    expect(result.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// escape hatch seam (COVENANT-03, PRD §4.3) — dummy bodies again, no real
// self-mod artifact needed here (that round trip lives in self-mod.test.ts).
// ---------------------------------------------------------------------------

describe('dispatchCovenants — escape hatch seam (PRD §4.3)', () => {
  it('a matched registration with an escapeHatch predicate returning true is bypassed: no spawn, exitCode 0, one bypassed record', async () => {
    // P0: the hatch must pre-empt spawning entirely (measured control, not a body-level
    // decision). Mutation caught: the hatch evaluated but ignored (body still spawns),
    // or the bypass not logged as the distinct 'bypassed' event.
    const outFile = join(dir, 'should-not-exist.txt');
    const input = inputWithArgs({ target: 'sub/protected/file.txt' });
    const reg: CovenantRegistration = {
      label: 'sample-covenant',
      protectedPaths: ['sub/protected/file.txt'],
      body: { command: process.execPath, args: echoToFileScript(outFile) },
      escapeHatch: () => true,
    };

    const result = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [reg],
      telemetryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(outFile)).toBe(false);
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    const record = parseRecordLine(lines[0]);
    expect(record?.event).toBe('bypassed');
    expect(record?.label).toBe('sample-covenant');
    expect(record?.subject).toBe('sub/protected/file.txt');
  });

  it('a matched registration with an escapeHatch predicate returning false spawns the body normally', async () => {
    // Mutation caught: a hatch seam that always skips spawning regardless of the
    // predicate's return value (fail-open in the wrong direction).
    const outFile = join(dir, 'body-ran.txt');
    const input = inputWithArgs({ target: 'sub/protected/file.txt' });
    const reg: CovenantRegistration = {
      label: 'sample-covenant',
      protectedPaths: ['sub/protected/file.txt'],
      body: { command: process.execPath, args: echoToFileScript(outFile, 0) },
      escapeHatch: () => false,
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

  it('an escapeHatch predicate that throws is treated as no bypass: the body spawns and the call is blocked', async () => {
    // P0 fail-open guard (PRD §4.3/§7: "hatch throw -> false, never bypass"). Mutation
    // caught: a try/catch around the predicate that resolves to true on error instead of
    // false, or an unhandled throw that escapes as a rejected dispatchCovenants promise
    // (asserted here by awaiting directly, per the async-not-toThrow discipline).
    const outFile = join(dir, 'body-ran.txt');
    const input = inputWithArgs({ target: 'sub/protected/file.txt' });
    const reg: CovenantRegistration = {
      label: 'sample-covenant',
      protectedPaths: ['sub/protected/file.txt'],
      body: { command: process.execPath, args: echoToFileScript(outFile, 1) },
      escapeHatch: () => {
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

  it('two matched registrations, first hatched and second a normal exit-0 body, both resolve (run-all preserved)', async () => {
    // P0 run-all invariant carried into the hatch seam: a hatched registration must not
    // stop other matched registrations from running. Mutation caught: an early return
    // after the first bypass that skips evaluating/running the rest of the matches.
    const outFileB = join(dir, 'body-b-ran.txt');
    const input = inputWithArgs({ target: 'sub/protected/file.txt' });
    const regA: CovenantRegistration = {
      label: 'covenant-a',
      protectedPaths: ['sub/protected/file.txt'],
      body: { command: process.execPath, args: ['-e', 'process.exit(1)'] },
      escapeHatch: () => true,
    };
    const regB: CovenantRegistration = {
      label: 'covenant-b',
      protectedPaths: ['sub/protected/file.txt'],
      body: { command: process.execPath, args: echoToFileScript(outFileB, 0) },
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
    expect(records.map((r) => r?.event)).toEqual(['bypassed', 'passed']);
    expect(records.map((r) => r?.label)).toEqual(['covenant-a', 'covenant-b']);
  });
});
