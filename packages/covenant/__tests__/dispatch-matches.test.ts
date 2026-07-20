import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CovenantInput } from '@polydeukes/core';
import { parseRecordLine } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CovenantRegistration } from '../src/dispatch.ts';
import { dispatchCovenants, matchRegistrations } from '../src/dispatch.ts';
import { echoToFileScript, inputWithArgs, readTelemetryLines } from './helpers.js';

// COVENANT-10 §4.4 / AC §5.5 — CovenantRegistration gains an optional content-predicate
// `matches?: (input) => string | null`. When present it routes instead of path-mention:
// a non-null return routes (return value = telemetry subject), null does not route, and a
// throw is a fail-closed match (subject '-'). Path-mention registrations without `matches`
// keep their existing semantics untouched. The `matches` field does not exist yet, so this
// file is RED by construction.

// ---------------------------------------------------------------------------
// §4.4 matching core (pure).
// ---------------------------------------------------------------------------

/** A body that does nothing — used where only routing (not spawn) is asserted. */
const noopBody = { command: process.execPath, args: ['-e', 'process.exit(0)'] };

describe('matchRegistrations — matches predicate seam (PRD §4.4)', () => {
  it('includes a registration whose matches returns a string, using it as mentionedPath', () => {
    // P0 content routing (PRD §4.4): a matches registration routes on its predicate even
    // though protectedPaths is [] and no protected path is mentioned. Mutation caught:
    // matchRegistrations only ever consulting protectedPaths, so a matches-only registration
    // never routes (the routing gap this ticket closes).
    const input = inputWithArgs({ file_path: 'src/a.ts' });
    const reg: CovenantRegistration = {
      label: 'content-covenant',
      protectedPaths: [],
      body: noopBody,
      matches: () => 'src/a.ts',
    };

    const matches = matchRegistrations(input, [reg]);

    expect(matches).toEqual([{ registration: reg, mentionedPath: 'src/a.ts' }]);
  });

  it('does not include a registration whose matches returns null', () => {
    // P0 routing filter: a null predicate result means no route. Mutation caught: a matches
    // result treated as truthy/always-included, spawning bodies on every input.
    const input = inputWithArgs({ file_path: 'src/a.ts' });
    const reg: CovenantRegistration = {
      label: 'content-covenant',
      protectedPaths: [],
      body: noopBody,
      matches: () => null,
    };

    expect(matchRegistrations(input, [reg])).toEqual([]);
  });

  it('treats a matches predicate that throws as a fail-closed match with mentionedPath "-"', () => {
    // P0 fail-closed routing (PRD §4.4): an uncertain predicate must NOT let the call slip
    // through unrouted. A throw routes with subject '-'. Mutation caught: a try/catch that
    // swallows the throw into "no match" (fail-open), or the throw escaping matchRegistrations.
    const input = inputWithArgs({ file_path: 'src/a.ts' });
    const reg: CovenantRegistration = {
      label: 'content-covenant',
      protectedPaths: [],
      body: noopBody,
      matches: () => {
        throw new Error('predicate blew up');
      },
    };

    const matches = matchRegistrations(input, [reg]);

    expect(matches).toEqual([{ registration: reg, mentionedPath: '-' }]);
  });

  it('a registration WITHOUT matches keeps existing path-mention semantics (regression pin)', () => {
    // P0 no-regression (PRD §4.4 / §7): the existing two registrations must be untouched —
    // absence of matches falls back to protectedPaths substring routing. Mutation caught: the
    // seam wiring making a matches-absent registration stop routing on path mention.
    const input = inputWithArgs({ target: 'sub/protected/file.txt' });
    const reg: CovenantRegistration = {
      label: 'path-covenant',
      protectedPaths: ['sub/protected/file.txt'],
      body: noopBody,
    };

    expect(matchRegistrations(input, [reg])).toEqual([
      { registration: reg, mentionedPath: 'sub/protected/file.txt' },
    ]);
  });

  it('runs a matches registration and a path-mention registration together in array order', () => {
    // P1 coexistence (AC §5.5): a matches registration and a path-mention registration both
    // routing on the same input are both included, preserving registration order. Mutation
    // caught: the two routing paths made mutually exclusive (one branch shadows the other).
    const input: CovenantInput = {
      toolCalls: [{ name: 'some-tool', args: { file_path: 'sub/protected/file.txt' } }],
      subagentSpawns: [],
      userMessages: [],
    };
    const pathReg: CovenantRegistration = {
      label: 'path-covenant',
      protectedPaths: ['sub/protected/file.txt'],
      body: noopBody,
    };
    const contentReg: CovenantRegistration = {
      label: 'content-covenant',
      protectedPaths: [],
      body: noopBody,
      matches: () => 'sub/protected/file.txt',
    };

    const matches = matchRegistrations(input, [pathReg, contentReg]);

    expect(matches.map((m) => m.registration.label)).toEqual(['path-covenant', 'content-covenant']);
  });
});

// ---------------------------------------------------------------------------
// §4.4 dispatch shell — real dummy bodies (following dispatch.test.ts conventions).
// ---------------------------------------------------------------------------

let dir: string;
let telemetryPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pdks-dispatch-matches-'));
  telemetryPath = join(dir, 'roi.log');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('dispatchCovenants — matches seam end-to-end (PRD §4.4, AC §5.5)', () => {
  it('spawns the body of a matches registration and logs one record with subject=the returned string', async () => {
    // P0 routing→spawn→measure: a content-matched registration must spawn and log its own
    // subject. Mutation caught: matches routing dropped in the dispatch path (body never
    // spawns), or the subject not threaded from the matches return value.
    const outFile = join(dir, 'body-ran.txt');
    const input = inputWithArgs({ file_path: 'src/a.ts' });
    const reg: CovenantRegistration = {
      label: 'content-covenant',
      protectedPaths: [],
      body: { command: process.execPath, args: echoToFileScript(outFile, 0) },
      matches: () => 'src/a.ts',
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
    expect(record?.label).toBe('content-covenant');
    expect(record?.subject).toBe('src/a.ts');
  });

  it('a matches registration returning null spawns nothing and writes zero telemetry rows', async () => {
    // P0 no-match no-side-effect (PRD §4.4): a non-routing predicate produces no spawn and no
    // record. Mutation caught: the dispatcher spawning a matches registration unconditionally,
    // or writing a record despite no match.
    const outFile = join(dir, 'should-not-exist.txt');
    const input = inputWithArgs({ file_path: 'src/a.ts' });
    const reg: CovenantRegistration = {
      label: 'content-covenant',
      protectedPaths: [],
      body: { command: process.execPath, args: echoToFileScript(outFile, 0) },
      matches: () => null,
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

  it('a matches predicate that throws still spawns the body (fail-closed match)', async () => {
    // P0 fail-closed through the dispatch path: a throwing predicate must route (body spawns)
    // so uncertain routing never leaks fail-open. Mutation caught: the throw swallowed to
    // "no match" so the covenant body never runs.
    const outFile = join(dir, 'body-ran.txt');
    const input = inputWithArgs({ file_path: 'src/a.ts' });
    const reg: CovenantRegistration = {
      label: 'content-covenant',
      protectedPaths: [],
      body: { command: process.execPath, args: echoToFileScript(outFile, 1) },
      matches: () => {
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
  });

  it('a path-mention registration and a matches registration both spawn on an input satisfying both (run-all)', async () => {
    // P0 coexistence run-all (AC §5.5, roadmap "custom body coexistence"): both bodies spawn,
    // records logged in registration order. Mutation caught: one routing path shadowing the
    // other so only a single body runs.
    const outPath = join(dir, 'path-body.txt');
    const outContent = join(dir, 'content-body.txt');
    const input: CovenantInput = {
      toolCalls: [{ name: 'some-tool', args: { file_path: 'sub/protected/file.txt' } }],
      subagentSpawns: [],
      userMessages: [],
    };
    const pathReg: CovenantRegistration = {
      label: 'path-covenant',
      protectedPaths: ['sub/protected/file.txt'],
      body: { command: process.execPath, args: echoToFileScript(outPath, 0) },
    };
    const contentReg: CovenantRegistration = {
      label: 'content-covenant',
      protectedPaths: [],
      body: { command: process.execPath, args: echoToFileScript(outContent, 0) },
      matches: () => 'sub/protected/file.txt',
    };

    const result = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [pathReg, contentReg],
      telemetryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(outPath)).toBe(true);
    expect(existsSync(outContent)).toBe(true);
    const records = readTelemetryLines(telemetryPath).map((l) => parseRecordLine(l));
    expect(records.map((r) => r?.label)).toEqual(['path-covenant', 'content-covenant']);
  });
});
