import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CanonicalTranscript, CovenantInput, TelemetryEvent } from '@polydeukes/core';
import { parseRecordLine } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// COVENANT-17 §4.3/§4.4 RED phase — the valve moves from routing time to AFTER the verdict:
// spawn → translateExitCode → consult the valve only when the translated event is 'blocked'.
// Deliberately written in the CURRENT vocabulary (field `witness`, event 'witnessed') per
// §4.7 step 1: the redesign ships under the old names and a later mechanical rename sweeps
// them, so this file's NAME stays vocabulary-neutral. The widened shapes asserted here (the
// wrapper's valve axis, the surfaced `event`, the witness's third context argument) do not
// exist yet — transient type drift until GREEN; vitest transpiles without typechecking.
import type { CovenantRegistration, RunCovenantSpec } from '../src/index.ts';
import { dispatchCovenants, runCovenant } from '../src/index.ts';
import { exitThunk, inputWithArgs, markerThunk, readTelemetryLines } from './helpers.js';

// ---------------------------------------------------------------------------
// Injected fixture values — never source literals (fixture discipline at file top).
// The protected entry is a DIRECTORY and the mention a nested file, so the telemetry
// subject (= the matched entry, per the dispatcher contract) differs from the judged
// path and a wrong-subject implementation cannot pass by coincidence.
// ---------------------------------------------------------------------------

const PROTECTED_ENTRY = 'sub/protected';
const NESTED_MENTION = 'sub/protected/deep/file.ts';
const MATCH_SUBJECT = 'observed/session.jsonl';
const DISPATCHER_LABEL = 'my-dispatcher';

/** §4.3 — the valve axis lands on RunCovenantSpec at GREEN; this widening carries it until then. */
type ValveRunCovenantSpec = RunCovenantSpec & { witness?: () => boolean };

/** §4.3 — the widened resolve shape: the event is surfaced so callers never recompute it. */
type ValveRunResult = { exitCode: 0 | 2; bodyExitCode: number | null; event?: TelemetryEvent };

/** Typed pass-through: assignable in both directions today and after GREEN widens the shapes. */
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

describe('runCovenant — valve consulted only after a blocked verdict (COVENANT-17 §4.3)', () => {
  it('a body exiting 0 with a valve present resolves passed without consulting the valve', async () => {
    // PRD §4.3 order (spawn → translate → valve) / AC §5.2 first item: a passing body has
    // no blocked translation, so the valve is never asked. Mutation caught: the valve
    // consulted on every outcome (routing-time timing recreated inside the wrapper), which
    // would turn every clean call into a 'witnessed' row again.
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
    // PRD §7-1 (one call, one row) + §7-2 (the valve relaxes the verdict, never replaces
    // the judgment — the body always runs). The marker file proves the spawn happened.
    // Mutation caught: the open valve skipping the spawn (old timing), or a 'blocked' row
    // logged first and a 'witnessed' row appended after (two rows for one call).
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
    // PRD §4.3 step 3, the closed half: only a `true` return relaxes the verdict. Mutation
    // caught: the valve's return value ignored (any valve presence softening the block), or
    // the false branch mapped to exit 0.
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
    // PRD §7-3 — an uncertain valve never opens. Mutation caught: a try/catch around the
    // valve resolving toward open on error, or the throw escaping runCovenant as a
    // rejection (awaiting directly would fail this test on its own).
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
    // PRD §4.3 — the valve consults the TRANSLATED event, and under advise a break
    // translates to 'advised', not 'blocked': nothing to witness. Mutation caught: the
    // valve keyed on the raw body exit code (1) instead of the translation, which would
    // record advise-level breaks as 'witnessed'.
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
    // PRD §2 explicitly DEFERS tightening unjudgeable outcomes (2 / 3+) out of the valve's
    // reach to the judge-integrity candidate: this ticket moves only the timing, so today
    // any blocked translation — including a judge that crashed — can be witnessed open.
    // Mutation caught: a premature carve-out that keeps unjudgeable outcomes blocked, which
    // is the follow-up ticket's contract, not this one's. Since DISPATCH-01 the crash
    // arrives as a throw rather than a spawn failure.
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
    // AUDIT gap (c): §2 defers carving unjudgeable outcomes (2 / 3+ / null) out of the
    // valve's reach as ONE set. The spawn-failure test above covers null; this covers the
    // body's own fail-closed (exit 2), so a partial GREEN that carves out 2 while keeping
    // null witnessable — silently advancing half the deferred decision — fails here.
    const result = await runWithValve({
      body: exitThunk(2),
      label: 'test-covenant',
      telemetryPath,
      witness: () => true,
    });

    expect(result.exitCode).toBe(0);
    expect(result.bodyExitCode).toBe(2);
    expect(result.event).toBe('witnessed');
    expect(parseRecordLine(readTelemetryLines(telemetryPath)[0])?.event).toBe('witnessed');
  });
});

// ---------------------------------------------------------------------------
// §4.4 — the dispatcher's witness moves behind the verdict and gains a context arg:
//   witness?: (input, transcript, context: { label, subject }) => boolean
// ---------------------------------------------------------------------------

/** A fake transcript with one marker message — identity-asserted through the witness seam. */
function markerTranscript(): CanonicalTranscript {
  return {
    findSubagentInvocations: () => [],
    findUserMessages: () => [{ text: 'CONTEXT-SEAM-MARKER' }],
    findToolCalls: () => [],
  };
}

describe('dispatchCovenants — valve moves behind the verdict (COVENANT-17 §4.3/§4.4)', () => {
  it('a matched registration whose body upholds never consults the witness and records passed (F6)', async () => {
    // THE TIMING FLIP — PR #38 review F6 pinned. Today the witness is evaluated for every
    // MATCHED registration before the spawn, so a clean commit touching an observed scope
    // still opens the valve and records 'witnessed' with zero spawns. New order: spawn,
    // translate, and only a blocked translation asks the witness. Mutation caught: the
    // routing-time evaluation kept anywhere in the dispatch path.
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
    // PRD §7-2 at the dispatcher level: the valve relaxes the verdict after the body ran —
    // the marker file is the spawn proof the old timing cannot produce. Mutation caught:
    // the open witness still short-circuiting the spawn, or the witnessed row duplicated
    // alongside a blocked one (§7-1).
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
    // PRD §4.4 — the dispatcher fills the context so the umbrella prompt can name what
    // broke: label = the registration's label, subject = the MATCHED protected ENTRY (the
    // directory entry, not the judged file — the dispatcher's documented subject
    // semantics). The transcript must still arrive as argument two (CORE-04 seam
    // preserved). Mutation caught: context filled with the judged file path instead of the
    // matched entry, the argument order shuffled by the widened signature, or the
    // transcript dropped.
    const injectedTranscript = markerTranscript();
    const input = inputWithArgs({ file_path: NESTED_MENTION });
    // An array holder, not a nullable let: TS control-flow narrows a let assigned only
    // inside the witness closure back to null at the assertion site.
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
    // PRD §4.4 — for content-predicate routing (the transcript-mod shape) the subject IS
    // the matches() return value, same as the telemetry row. Mutation caught: the context
    // subject sourced from protectedPaths (empty here) or hardcoded to '-' for predicate
    // routes.
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
    // Invariant lock, green under the old timing too (one routing-time consult): PRD §4.3
    // forbids the dispatcher recomputing the event after runCovenant resolves, because the
    // valve is impure and a recompute would ask a TTY prompt twice per verdict. Mutation
    // caught: a GREEN that keeps the translateExitCode recompute alongside the
    // wrapper-owned valve — two consultations for one blocked match.
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
    // Invariant lock, green today: PRD §4.4 — the dispatcher's own fail-closed is OUTSIDE
    // the valve (zero spawns, no verdict to witness). Mutation caught: a naive "consult
    // the valve whenever anything blocks" GREEN that lets an open witness wave through an
    // unjudgeable payload — the fail-open hole the fail-closed branch exists to shut.
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
