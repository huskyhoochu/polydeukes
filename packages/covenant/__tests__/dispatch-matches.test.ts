import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CovenantInput } from '@polydeukes/core';
import { parseRecordLine } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CovenantRegistration } from '../src/dispatch.ts';
import { dispatchCovenants, matchRegistrations } from '../src/dispatch.ts';
import { exitThunk, inputWithArgs, markerThunk, readTelemetryLines } from './helpers.js';

// A registration's optional `matches?: (input) => string | null` routes instead of
// path-mention: a non-null return routes and becomes the telemetry subject, null does not
// route, and a throw is a fail-closed match with subject '-'. Registrations without
// `matches` keep path-mention semantics.

/** A body that does nothing — used where only routing (not spawn) is asserted. */
const noopBody = exitThunk(0);

describe('matchRegistrations — matches predicate seam (PRD §4.4)', () => {
  it('includes a registration whose matches returns a string, using it as mentionedPath', () => {
    // A matches registration routes on its predicate even though protectedPaths is [] and
    // no protected path is mentioned.
    const input = inputWithArgs({ file_path: 'src/a.ts' });
    const reg: CovenantRegistration = {
      label: 'content-covenant',
      protectedPaths: [],
      body: noopBody,
      matches: () => 'src/a.ts',
    };

    const matches = matchRegistrations(input, [reg]);

    expect(matches).toEqual([
      { registration: reg, mentionedPath: 'src/a.ts', routingFailed: false },
    ]);
  });

  it('does not include a registration whose matches returns null', () => {
    // A null predicate result means no route; treating the result as truthy would judge
    // every input.
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
    // An uncertain predicate must NOT let the call slip through unrouted: a throw routes
    // with subject '-' rather than being swallowed into "no match".
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

    // routingFailed travels with the match so a bodyless skip registration can still
    // carry the fail-closed verdict out — it has no body to spawn one.
    expect(matches).toEqual([{ registration: reg, mentionedPath: '-', routingFailed: true }]);
  });

  it('a registration WITHOUT matches keeps existing path-mention semantics (regression pin)', () => {
    // Absence of `matches` falls back to protectedPaths substring routing.
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
    // The two routing paths are not mutually exclusive: both registrations route on the
    // same input, in registration order.
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
    // The subject on the row must be threaded from the matches return value.
    const outFile = join(dir, 'body-ran.txt');
    const input = inputWithArgs({ file_path: 'src/a.ts' });
    const reg: CovenantRegistration = {
      label: 'content-covenant',
      protectedPaths: [],
      body: markerThunk(outFile, 0),
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
    // A non-routing predicate produces no judgment and no record.
    const outFile = join(dir, 'should-not-exist.txt');
    const input = inputWithArgs({ file_path: 'src/a.ts' });
    const reg: CovenantRegistration = {
      label: 'content-covenant',
      protectedPaths: [],
      body: markerThunk(outFile, 0),
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
    // Fail-closed through the dispatch path: a throwing predicate must route and the body
    // must run, so uncertain routing never leaks fail-open.
    const outFile = join(dir, 'body-ran.txt');
    const input = inputWithArgs({ file_path: 'src/a.ts' });
    const reg: CovenantRegistration = {
      label: 'content-covenant',
      protectedPaths: [],
      body: markerThunk(outFile, 1),
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
    // Both bodies run and both records land, in registration order: neither routing path
    // shadows the other.
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
      body: markerThunk(outPath, 0),
    };
    const contentReg: CovenantRegistration = {
      label: 'content-covenant',
      protectedPaths: [],
      body: markerThunk(outContent, 0),
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
