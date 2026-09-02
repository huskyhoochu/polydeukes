import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CanonicalTranscript } from '@polydeukes/core';
import { parseRecordLine } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// The dispatcher's transcript seam: `spec.transcript` reaches a witness as its second
// argument, and defaults to a real empty transcript rather than undefined.
import type { CovenantRegistration } from '../src/dispatch.ts';
import { dispatchCovenants } from '../src/dispatch.ts';
import { exitThunk, inputWithArgs, markerThunk, readTelemetryLines } from './helpers.js';

// The judge body touches a marker file, so its presence proves the judge ran.

/** A fake transcript whose findUserMessages returns exactly the given texts. */
function transcriptWithUserMessages(texts: string[]): CanonicalTranscript {
  return {
    findUserMessages: () => texts.map((text) => ({ text })),
    findToolCalls: () => [],
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

describe('dispatchCovenants — transcript seam wiring', () => {
  it('injects spec.transcript as the second witness argument: a 2-arg witness that keys on a marker user message opens the valve after the verdict', async () => {
    // The witness returns true only when it observes the marker message, so a relaxed block
    // proves the injected transcript — not undefined, not the empty default — was passed.
    const outFile = join(dir, 'body-ran.txt');
    const input = inputWithArgs({ target: 'sub/protected/file.txt' });
    const reg: CovenantRegistration = {
      label: 'sample-covenant',
      protectedPaths: ['sub/protected/file.txt'],
      body: markerThunk(outFile, 1),
      witness: (_input, transcript) =>
        transcript.findUserMessages().some((m) => m.text === 'WITNESS-MARKER'),
    };

    const result = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [reg],
      telemetryPath,
      transcript: transcriptWithUserMessages(['WITNESS-MARKER']),
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(outFile)).toBe(true);
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    const record = parseRecordLine(lines[0]);
    expect(record?.event).toBe('witnessed');
    expect(record?.label).toBe('sample-covenant');
  });

  it('defaults to noopTranscript when spec.transcript is omitted: a 2-arg witness receives a real CanonicalTranscript object (both queries callable), not undefined', async () => {
    // The injection-absent default must satisfy the interface, so a 2-arg witness never
    // crashes on undefined. The witness calls BOTH queries, proving the shape, and opens
    // only when both answer empty, which is true of the empty default.
    const outFile = join(dir, 'body-ran.txt');
    const input = inputWithArgs({ target: 'sub/protected/file.txt' });
    const reg: CovenantRegistration = {
      label: 'sample-covenant',
      protectedPaths: ['sub/protected/file.txt'],
      body: markerThunk(outFile, 1),
      witness: (_input, transcript) =>
        transcript.findToolCalls().length === 0 && transcript.findUserMessages().length === 0,
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
    expect(parseRecordLine(lines[0])?.event).toBe('witnessed');
  });

  it('a 2-arg witness that throws is treated as no bypass: the body spawns and the call is blocked (fail-closed unchanged)', async () => {
    // A throwing witness is never an opening, the 2-arg signature included.
    const outFile = join(dir, 'body-ran.txt');
    const input = inputWithArgs({ target: 'sub/protected/file.txt' });
    const reg: CovenantRegistration = {
      label: 'sample-covenant',
      protectedPaths: ['sub/protected/file.txt'],
      body: markerThunk(outFile, 1),
      witness: (_input, _transcript) => {
        throw new Error('boom');
      },
    };

    const result = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [reg],
      telemetryPath,
      transcript: transcriptWithUserMessages(['WITNESS-MARKER']),
    });

    expect(result.exitCode).toBe(2);
    expect(existsSync(outFile)).toBe(true);
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    expect(parseRecordLine(lines[0])?.event).toBe('blocked');
  });

  it('verdict parity: injecting a transcript does not change matching/spawn/verdict for a registration without witness', async () => {
    // The seam carries no verdict weight for a witness-less registration: a blocking body
    // yields the same result whether or not a transcript is supplied.
    const input = inputWithArgs({ target: 'sub/protected/file.txt' });
    const makeReg = (): CovenantRegistration => ({
      label: 'sample-covenant',
      protectedPaths: ['sub/protected/file.txt'],
      body: exitThunk(1),
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
