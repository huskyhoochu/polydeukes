import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CanonicalTranscript, CovenantInput } from '@polydeukes/core';
import { parseRecordLine } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// CORE-04 RED phase (§5.2). The dispatcher seam wiring — `spec.transcript` and the
// 2-arg `escapeHatch(input, transcript)` signature — does not exist yet, so this file is
// RED by construction. The behaviours asserted here become the GREEN contract.
import type { CovenantRegistration } from '../src/dispatch.ts';
import { dispatchCovenants } from '../src/dispatch.ts';

// ---------------------------------------------------------------------------
// Helpers — copied from dispatch.test.ts (fake bodies via `node -e`, temp
// telemetry). A spawned body writes its stdin verbatim to a file, so file
// presence proves a spawn happened and file absence proves a bypass.
// ---------------------------------------------------------------------------

/** Build a minimal CovenantInput with a single toolCalls[0].args value tree. */
function inputWithArgs(args: Record<string, unknown>): CovenantInput {
  return {
    toolCalls: [{ name: 'some-tool', args }],
    subagentSpawns: [],
    userMessages: [],
  };
}

/**
 * A body that reads stdin to completion, writes it verbatim to `outFile`
 * (passed as argv), then exits with the given code. File presence == it spawned.
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

/** A fake transcript whose findUserMessages returns exactly the given texts. */
function transcriptWithUserMessages(texts: string[]): CanonicalTranscript {
  return {
    findSubagentInvocations: () => [],
    findUserMessages: () => texts.map((text) => ({ text })),
  };
}

let dir: string;
let telemetryPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pdks-transcript-seam-'));
  telemetryPath = join(dir, 'roi.log');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('dispatchCovenants — transcript seam wiring (PRD §5.2)', () => {
  it('injects spec.transcript as the second hatch argument: a 2-arg hatch that keys on a marker user message bypasses the spawn', async () => {
    // P0: the transcript must actually reach the hatch's second parameter. The hatch
    // returns true only when it observes the marker message, so a bypass proves the
    // injected transcript (not undefined, not noop) was passed. Mutation caught: the
    // dispatcher calling the hatch with one argument only, or passing the wrong object.
    const outFile = join(dir, 'should-not-exist.txt');
    const input = inputWithArgs({ target: 'sub/protected/file.txt' });
    const reg: CovenantRegistration = {
      label: 'sample-covenant',
      protectedPaths: ['sub/protected/file.txt'],
      body: { command: process.execPath, args: echoToFileScript(outFile) },
      escapeHatch: (_input, transcript) =>
        transcript.findUserMessages().some((m) => m.text === 'WAIVER-MARKER'),
    };

    const result = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [reg],
      telemetryPath,
      transcript: transcriptWithUserMessages(['WAIVER-MARKER']),
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(outFile)).toBe(false);
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    const record = parseRecordLine(lines[0]);
    expect(record?.event).toBe('bypassed');
    expect(record?.label).toBe('sample-covenant');
  });

  it('defaults to noopTranscript when spec.transcript is omitted: a 2-arg hatch receives a real CanonicalTranscript object (both queries callable), not undefined', async () => {
    // P0: the injection-absent default must be an object satisfying the interface, so a
    // 2-arg hatch never crashes on undefined. The hatch calls BOTH queries (proving the
    // shape) and bypasses only when findUserMessages() is empty — true for the noop
    // default. Mutation caught: passing undefined as the second argument (hatch throws →
    // no bypass → body spawns), or defaulting to a non-empty transcript.
    const outFile = join(dir, 'should-not-exist.txt');
    const input = inputWithArgs({ target: 'sub/protected/file.txt' });
    const reg: CovenantRegistration = {
      label: 'sample-covenant',
      protectedPaths: ['sub/protected/file.txt'],
      body: { command: process.execPath, args: echoToFileScript(outFile) },
      escapeHatch: (_input, transcript) =>
        transcript.findSubagentInvocations().length === 0 &&
        transcript.findUserMessages().length === 0,
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
    expect(parseRecordLine(lines[0])?.event).toBe('bypassed');
  });

  it('a 2-arg hatch that throws is treated as no bypass: the body spawns and the call is blocked (fail-closed unchanged)', async () => {
    // P0 fail-closed regression (PRD §4.3: "throw하는 hatch = bypass 아님"), now with the
    // widened 2-arg signature. Mutation caught: the seam widening dropping the try/catch,
    // or a throwing hatch resolving to bypass instead of a normal spawn.
    const outFile = join(dir, 'body-ran.txt');
    const input = inputWithArgs({ target: 'sub/protected/file.txt' });
    const reg: CovenantRegistration = {
      label: 'sample-covenant',
      protectedPaths: ['sub/protected/file.txt'],
      body: { command: process.execPath, args: echoToFileScript(outFile, 1) },
      escapeHatch: (_input, _transcript) => {
        throw new Error('boom');
      },
    };

    const result = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [reg],
      telemetryPath,
      transcript: transcriptWithUserMessages(['WAIVER-MARKER']),
    });

    expect(result.exitCode).toBe(2);
    expect(existsSync(outFile)).toBe(true);
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    expect(parseRecordLine(lines[0])?.event).toBe('blocked');
  });

  it('verdict parity: injecting a transcript does not change matching/spawn/verdict for a registration without escapeHatch', async () => {
    // Invariant (PRD §5.2/§7 "판정 불변"): the seam carries no verdict weight for a
    // hatch-less registration. A blocking body must yield the same exitCode 2 whether or
    // not spec.transcript is supplied. Mutation caught: the transcript wiring altering
    // the match/spawn path for registrations that never consult it.
    const input = inputWithArgs({ target: 'sub/protected/file.txt' });
    const makeReg = (): CovenantRegistration => ({
      label: 'sample-covenant',
      protectedPaths: ['sub/protected/file.txt'],
      body: { command: process.execPath, args: ['-e', 'process.exit(1)'] },
    });

    const withoutTranscript = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [makeReg()],
      telemetryPath: join(dir, 'roi-a.log'),
    });
    const withTranscript = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [makeReg()],
      telemetryPath: join(dir, 'roi-b.log'),
      transcript: transcriptWithUserMessages(['anything']),
    });

    expect(withoutTranscript.exitCode).toBe(2);
    expect(withTranscript.exitCode).toBe(2);
    expect(withTranscript.results).toEqual(withoutTranscript.results);
  });
});
