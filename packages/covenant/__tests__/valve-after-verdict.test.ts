import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CanonicalTranscript, CovenantInput, TelemetryEvent } from '@polydeukes/core';
import { parseRecordLine } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// The valve stands AFTER the verdict: judge, translate, and consult the valve only when the
// translated event is 'blocked'.
import type { CovenantRegistration } from '../src/dispatch.ts';
import { dispatchCovenants } from '../src/dispatch.ts';
import type { RunCovenantSpec } from '../src/run-covenant.ts';
import { runCovenant } from '../src/run-covenant.ts';
import { exitThunk, inputWithArgs, markerThunk, readTelemetryLines } from './helpers.js';

// The protected entry is a DIRECTORY and the mention a nested file, so the telemetry
// subject — the matched entry, per the dispatcher's contract — differs from the judged path
// and a wrong-subject implementation cannot pass by coincidence.

const PROTECTED_ENTRY = 'sub/protected';
const NESTED_MENTION = 'sub/protected/deep/file.ts';
const MATCH_SUBJECT = 'observed/session.jsonl';
const DISPATCHER_LABEL = 'my-dispatcher';

/** The valve axis on RunCovenantSpec. */
type ValveRunCovenantSpec = RunCovenantSpec & { witness?: () => boolean };

/** The resolve shape: the event is surfaced so callers never recompute it. */
type ValveRunResult = { exitCode: 0 | 2; event?: TelemetryEvent };

/** Typed pass-through. */
async function runWithValve(spec: ValveRunCovenantSpec): Promise<ValveRunResult> {
  return await runCovenant(spec);
}

let dir: string;
let telemetryPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pdks-valve-after-verdict-'));
  telemetryPath = join(dir, 'roi.log');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('runCovenant — valve consulted only after a blocked verdict', () => {
  it('a body exiting 0 with a valve present resolves passed without consulting the valve', async () => {
    // A passing body has no blocked translation, so the valve is never asked. Consulted on
    // every outcome, it would turn every clean call into a `witnessed` row.
    let consulted = 0;
    const result = await runWithValve({
      body: exitThunk(0),
      label: 'test-covenant',
      telemetryPath,
      witness: () => {
        consulted += 1;
        return true;
      },
    });

    expect(consulted).toBe(0);
    expect(result.exitCode).toBe(0);
    expect(result.event).toBe('passed');
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    expect(parseRecordLine(lines[0])?.event).toBe('passed');
  });

  it('a blocked body with an open valve still spawns, resolves witnessed at exit 0, with exactly one witnessed row', async () => {
    // The valve relaxes the verdict, never replaces the judgment: the body always runs, and
    // the marker file proves it did. One call still writes one row, not a `blocked` row
    // followed by a `witnessed` one.
    const outFile = join(dir, 'body-ran.txt');
    const result = await runWithValve({
      body: markerThunk(outFile, 1),
      label: 'test-covenant',
      telemetryPath,
      witness: () => true,
    });

    expect(existsSync(outFile)).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.event).toBe('witnessed');
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    expect(parseRecordLine(lines[0])?.event).toBe('witnessed');
  });

  it('a blocked body with a closed valve stays blocked at exit 2 with one blocked row', async () => {
    // Only a `true` return relaxes the verdict; the mere presence of a valve does not.
    const result = await runWithValve({
      body: exitThunk(1),
      label: 'test-covenant',
      telemetryPath,
      witness: () => false,
    });

    expect(result.exitCode).toBe(2);
    expect(result.event).toBe('blocked');
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    expect(parseRecordLine(lines[0])?.event).toBe('blocked');
  });

  it('a throwing valve counts as closed: the block stands at exit 2', async () => {
    // An uncertain valve never opens, and the throw never escapes as a rejection (awaiting
    // directly would fail this test on its own).
    const result = await runWithValve({
      body: exitThunk(1),
      label: 'test-covenant',
      telemetryPath,
      witness: () => {
        throw new Error('valve blew up');
      },
    });

    expect(result.exitCode).toBe(2);
    expect(result.event).toBe('blocked');
    expect(parseRecordLine(readTelemetryLines(telemetryPath)[0])?.event).toBe('blocked');
  });

  it('under enforce advise a break resolves advised at exit 0 and the valve is not consulted', async () => {
    // The valve consults the TRANSLATED event, and under advise a break translates to
    // `advised` rather than `blocked`, so there is nothing to witness. Keyed on the raw body
    // exit code instead, every advise-level break would be recorded as `witnessed`.
    let consulted = 0;
    const result = await runWithValve({
      body: exitThunk(1),
      label: 'test-covenant',
      telemetryPath,
      enforce: 'advise',
      witness: () => {
        consulted += 1;
        return true;
      },
    });

    expect(consulted).toBe(0);
    expect(result.exitCode).toBe(0);
    expect(result.event).toBe('advised');
    expect(parseRecordLine(readTelemetryLines(telemetryPath)[0])?.event).toBe('advised');
  });

  it('a crashing judge with an open valve resolves witnessed at exit 0 — unjudgeable blocked is still witnessable', async () => {
    // Any blocked translation, a crashed judge included, can be witnessed open: unjudgeable
    // outcomes are not carved out of the valve's reach.
    const result = await runWithValve({
      body: async () => {
        throw new Error('the judge could not run at all');
      },
      label: 'test-covenant',
      telemetryPath,
      witness: () => true,
    });

    expect(result.exitCode).toBe(0);
    expect(result.event).toBe('witnessed');
    expect(parseRecordLine(readTelemetryLines(telemetryPath)[0])?.event).toBe('witnessed');
  });

  it('a body exiting 2 with an open valve resolves witnessed — the deferred tightening stays whole', async () => {
    // The unjudgeable outcomes are ONE set: the crash case above covers the thrown half and
    // this covers the body's own fail-closed exit 2. Both reach the valve, so making only one
    // of them witnessable fails here. Which half a run took is not part of the wrapper's
    // result, so these two inputs are what tells them apart.
    const result = await runWithValve({
      body: exitThunk(2),
      label: 'test-covenant',
      telemetryPath,
      witness: () => true,
    });

    expect(result.exitCode).toBe(0);
    expect(result.event).toBe('witnessed');
    expect(parseRecordLine(readTelemetryLines(telemetryPath)[0])?.event).toBe('witnessed');
  });
});

// At the dispatcher the witness signature is
// `(input, transcript, context: { label, subject }) => boolean`.

/** A fake transcript with one marker message — identity-asserted through the witness seam. */
function markerTranscript(): CanonicalTranscript {
  return {
    findSubagentInvocations: () => [],
    findUserMessages: () => [{ text: 'CONTEXT-SEAM-MARKER' }],
    findToolCalls: () => [],
  };
}

describe('dispatchCovenants — valve moves behind the verdict', () => {
  it('a matched registration whose body upholds never consults the witness and records passed (F6)', async () => {
    // Evaluated at routing time instead, the witness fires for every MATCHED registration,
    // so a clean commit touching an observed scope records `witnessed` with no judgment
    // having run at all.
    const outFile = join(dir, 'body-ran.txt');
    let consulted = 0;
    const reg: CovenantRegistration = {
      label: 'covenant-upholds',
      protectedPaths: [PROTECTED_ENTRY],
      body: markerThunk(outFile, 0),
      witness: () => {
        consulted += 1;
        return true;
      },
    };

    const result = await dispatchCovenants({
      stdinPayload: JSON.stringify(inputWithArgs({ file_path: NESTED_MENTION })),
      registrations: [reg],
      telemetryPath,
    });

    expect(existsSync(outFile)).toBe(true);
    expect(consulted).toBe(0);
    expect(result.exitCode).toBe(0);
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    expect(parseRecordLine(lines[0])?.event).toBe('passed');
  });

  it('a matched registration whose body breaks with an open witness still spawns and records one witnessed row', async () => {
    // The valve relaxes the verdict after the body ran, and the marker file proves it did.
    // One call, one row.
    const outFile = join(dir, 'body-ran.txt');
    const reg: CovenantRegistration = {
      label: 'covenant-breaks',
      protectedPaths: [PROTECTED_ENTRY],
      body: markerThunk(outFile, 1),
      witness: () => true,
    };

    const result = await dispatchCovenants({
      stdinPayload: JSON.stringify(inputWithArgs({ file_path: NESTED_MENTION })),
      registrations: [reg],
      telemetryPath,
    });

    expect(existsSync(outFile)).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.results).toEqual([{ label: 'covenant-breaks', exitCode: 0, event: 'witnessed' }]);
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    const record = parseRecordLine(lines[0]);
    expect(record?.event).toBe('witnessed');
    expect(record?.subject).toBe(PROTECTED_ENTRY);
  });

  it('the witness receives the parsed input, the injected transcript, and a { label, subject } context', async () => {
    // The dispatcher fills the context so a prompt can name what broke: the subject is the
    // MATCHED protected ENTRY, the directory entry rather than the judged file, which is
    // the dispatcher's subject semantics everywhere. The transcript stays argument two.
    const injectedTranscript = markerTranscript();
    const input = inputWithArgs({ file_path: NESTED_MENTION });
    // An array holder, not a nullable let: TS control-flow narrows a let assigned only
    // inside the closure back to null at the assertion site.
    const received: {
      input: CovenantInput;
      transcript: CanonicalTranscript;
      context: { label: string; subject: string };
    }[] = [];
    const reg: CovenantRegistration = {
      label: 'covenant-context',
      protectedPaths: [PROTECTED_ENTRY],
      body: exitThunk(1),
      witness: (witnessInput, transcript, context) => {
        received.push({ input: witnessInput, transcript, context });
        return true;
      },
    };

    await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [reg],
      telemetryPath,
      transcript: injectedTranscript,
    });

    expect(received).toHaveLength(1);
    expect(received[0].input).toEqual(input);
    expect(received[0].transcript).toBe(injectedTranscript);
    expect(received[0].context).toEqual({ label: 'covenant-context', subject: PROTECTED_ENTRY });
  });

  it('a matches-predicate registration hands the witness the string matches() returned as context.subject', async () => {
    // For content-predicate routing the subject IS the matches() return value, the same as
    // on the telemetry row — never protectedPaths, which is empty here.
    let receivedContext: { label: string; subject: string } | null = null;
    const reg = {
      label: 'content-covenant',
      protectedPaths: [],
      matches: () => MATCH_SUBJECT,
      body: exitThunk(1),
      witness: (
        _input: CovenantInput,
        _transcript: CanonicalTranscript,
        context: { label: string; subject: string },
      ) => {
        receivedContext = context;
        return true;
      },
    };

    await dispatchCovenants({
      stdinPayload: JSON.stringify(inputWithArgs({ file_path: 'unrelated/file.ts' })),
      registrations: [reg],
      telemetryPath,
    });

    expect(receivedContext).toEqual({ label: 'content-covenant', subject: MATCH_SUBJECT });
    expect(parseRecordLine(readTelemetryLines(telemetryPath)[0])?.subject).toBe(MATCH_SUBJECT);
  });

  it('the witness is consulted exactly once for one blocked match (no recompute, no double prompt)', async () => {
    // The dispatcher must not recompute the event after runCovenant resolves: the valve is
    // impure, so a recompute asks a TTY prompt twice for one verdict.
    let consulted = 0;
    const reg: CovenantRegistration = {
      label: 'covenant-breaks',
      protectedPaths: [PROTECTED_ENTRY],
      body: exitThunk(1),
      witness: () => {
        consulted += 1;
        return true;
      },
    };

    const result = await dispatchCovenants({
      stdinPayload: JSON.stringify(inputWithArgs({ file_path: NESTED_MENTION })),
      registrations: [reg],
      telemetryPath,
    });

    expect(consulted).toBe(1);
    expect(result.results).toEqual([{ label: 'covenant-breaks', exitCode: 0, event: 'witnessed' }]);
    expect(readTelemetryLines(telemetryPath)).toHaveLength(1);
  });

  it('an unparseable payload stays dispatcher fail-closed: one blocked row, witness never consulted, exit 2', async () => {
    // The dispatcher's own fail-closed is OUTSIDE the valve: no judgment ran, so there is
    // no verdict to witness. Consulting the valve whenever anything blocks would let an
    // open witness wave through the very payload the branch exists to refuse.
    let consulted = 0;
    const reg: CovenantRegistration = {
      label: 'covenant-breaks',
      protectedPaths: [PROTECTED_ENTRY],
      body: exitThunk(1),
      witness: () => {
        consulted += 1;
        return true;
      },
    };

    const result = await dispatchCovenants({
      stdinPayload: 'not valid json at all {{{',
      registrations: [reg],
      telemetryPath,
      dispatcherLabel: DISPATCHER_LABEL,
    });

    expect(result.exitCode).toBe(2);
    expect(consulted).toBe(0);
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    const record = parseRecordLine(lines[0]);
    expect(record?.event).toBe('blocked');
    expect(record?.label).toBe(DISPATCHER_LABEL);
    expect(record?.subject).toBe('-');
  });
});
