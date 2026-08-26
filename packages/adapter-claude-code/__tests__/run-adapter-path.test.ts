import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TelemetryEvent } from '@polydeukes/core';
import { appendRecord, parseInput, readRecords, runGain } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClaudePreToolUsePayload } from '../src/index.ts';
// Imported from the package entry point rather than the module itself, so these exercise
// the same surface `@polydeukes/adapter-claude-code` publishes.
import { type DispatchOutcome, runAdapterPath } from '../src/index.ts';

let tmpRoot: string;
let telemetryPath: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'pdks-adapter-'));
  telemetryPath = join(tmpRoot, 'telemetry.tsv');
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

const editFixture: ClaudePreToolUsePayload = {
  hook_event_name: 'PreToolUse',
  session_id: 's-1',
  transcript_path: '/tmp/t.jsonl',
  cwd: '/repo',
  tool_name: 'Edit',
  tool_input: {
    file_path: 'packages/covenant/src/dispatch.ts',
    old_string: 'a',
    new_string: 'b',
  },
};

/** Serialize one payload as a raw hook stdin string. */
function rawOf(payload: unknown): string {
  return JSON.stringify(payload);
}

const ADAPTER_LABEL = 'adapter-claude-code';

// The injected dispatch seam mirrors the real dispatcher's contract: matched registrations
// append their OWN records (one per registration, via the same core appendRecord) before
// returning. A stub that skipped that would make every adapter-supplement assertion vacuous.

/** A dispatch stub that returns a fixed outcome and counts its calls, writing no records. */
function stubReturning(outcome: DispatchOutcome): {
  dispatch: (stdinPayload: string) => Promise<DispatchOutcome>;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    dispatch: async (stdinPayload: string) => {
      calls.push(stdinPayload);
      return outcome;
    },
  };
}

/** For each matched registration, appends one record then returns the derived outcome. */
function stubDispatchingRegistrations(
  path: string,
  registrations: { label: string; event: TelemetryEvent; subject: string }[],
): (stdinPayload: string) => Promise<DispatchOutcome> {
  return async (_stdinPayload: string) => {
    const results: DispatchOutcome['results'] = [];
    for (const reg of registrations) {
      appendRecord(path, {
        timestamp: new Date().toISOString(),
        event: reg.event,
        label: reg.label,
        subject: reg.subject,
      });
      results.push({ label: reg.label, exitCode: reg.event === 'blocked' ? 2 : 0 });
    }
    const anyBlocked = registrations.some((reg) => reg.event === 'blocked');
    return { exitCode: anyBlocked ? 2 : 0, results };
  };
}

describe('translate-failure measurement', () => {
  it('a non-JSON rawPayload blocks (exit 2) and appends exactly one adapter blocked record, dispatch never called', async () => {
    // Unparseable input must fail closed AND be measured: an unmeasured refusal leaves the
    // funnel denominator short, and reaching dispatch at all would judge an input nobody
    // classified.
    const { dispatch, calls } = stubReturning({ exitCode: 0, results: [] });

    const verdict = await runAdapterPath({
      rawPayload: 'this is not json {',
      telemetryPath,
      dispatch,
    });

    expect(verdict).toEqual({ exitCode: 2 });
    expect(calls.length).toBe(0);

    const { records } = readRecords(telemetryPath);
    expect(records.length).toBe(1);
    expect(records[0].event).toBe('blocked');
    expect(records[0].label).toBe(ADAPTER_LABEL);
    expect(records[0].subject).toBe('-');
  });

  it('a Task payload without subagent_type blocks (exit 2) and appends one adapter blocked record', async () => {
    // A Task lacking subagent_type must not be demoted to a toolCall: it fails
    // classification and blocks, rather than flowing to dispatch as a spawn-less Task.
    const { dispatch, calls } = stubReturning({ exitCode: 0, results: [] });

    const verdict = await runAdapterPath({
      rawPayload: rawOf({
        hook_event_name: 'PreToolUse',
        tool_name: 'Task',
        tool_input: { prompt: 'do something' },
      }),
      telemetryPath,
      dispatch,
    });

    expect(verdict).toEqual({ exitCode: 2 });
    expect(calls.length).toBe(0);

    const { records } = readRecords(telemetryPath);
    expect(records.length).toBe(1);
    expect(records[0].event).toBe('blocked');
    expect(records[0].label).toBe(ADAPTER_LABEL);
  });

  it('a rejecting dispatch blocks (exit 2), appends one adapter blocked record, and does not propagate the rejection', async () => {
    // An unhandled rejection would exit the hook non-blocking, which is a bypass vector.
    const calls: string[] = [];
    const dispatch = async (stdinPayload: string): Promise<DispatchOutcome> => {
      calls.push(stdinPayload);
      throw new Error('dispatch blew up');
    };

    await expect(
      runAdapterPath({ rawPayload: rawOf(editFixture), telemetryPath, dispatch }),
    ).resolves.toEqual({ exitCode: 2 });
    expect(calls.length).toBe(1);

    const { records } = readRecords(telemetryPath);
    expect(records.length).toBe(1);
    expect(records[0].event).toBe('blocked');
    expect(records[0].label).toBe(ADAPTER_LABEL);
    expect(records[0].subject).toBe('-');
  });
});

describe('funnel supplement — exactly-one-record arithmetic', () => {
  it('a no-match dispatch (exit 0, results []) passes (exit 0) and the adapter appends exactly one passed record', async () => {
    // Matched-zero passing is measured at the ADAPTER level: the dispatcher wrote nothing,
    // so the adapter supplies one passed row and the gain denominator counts this call.
    const { dispatch } = stubReturning({ exitCode: 0, results: [] });

    const verdict = await runAdapterPath({
      rawPayload: rawOf(editFixture),
      telemetryPath,
      dispatch,
    });

    expect(verdict).toEqual({ exitCode: 0 });

    const { records } = readRecords(telemetryPath);
    expect(records.length).toBe(1);
    expect(records[0].event).toBe('passed');
    expect(records[0].label).toBe(ADAPTER_LABEL);
    expect(records[0].subject).toBe('-');
  });

  it('a dispatcher self-block (exit 2, results []) blocks (exit 2) and the adapter adds ZERO extra rows', async () => {
    // The dispatcher already recorded its own blocked row, so the adapter must not
    // supplement. The supplement condition is results.length AND the exit code together:
    // either half alone double-counts this call.
    const dispatch = async () => {
      // Mirror the real dispatcher: it wrote its own blocked row before returning.
      appendRecord(telemetryPath, {
        timestamp: new Date().toISOString(),
        event: 'blocked',
        label: 'dispatcher-self',
        subject: '-',
      });
      return { exitCode: 2, results: [] } satisfies DispatchOutcome;
    };

    const verdict = await runAdapterPath({
      rawPayload: rawOf(editFixture),
      telemetryPath,
      dispatch,
    });

    expect(verdict).toEqual({ exitCode: 2 });

    const { records } = readRecords(telemetryPath);
    expect(records.length).toBe(1);
    expect(records[0].label).toBe('dispatcher-self');
    expect(records.some((r) => r.label === ADAPTER_LABEL)).toBe(false);
  });

  it('a matched+blocked dispatch (exit 2, results [{exitCode 2}]) blocks (exit 2) with ZERO adapter rows', async () => {
    // No double-counting: a matched registration recorded its own row, and results is
    // non-empty, so the adapter supplements nothing.
    const dispatch = stubDispatchingRegistrations(telemetryPath, [
      { label: 'no-edit-covenant', event: 'blocked', subject: 'packages/covenant/src/dispatch.ts' },
    ]);

    const verdict = await runAdapterPath({
      rawPayload: rawOf(editFixture),
      telemetryPath,
      dispatch,
    });

    expect(verdict).toEqual({ exitCode: 2 });

    const { records } = readRecords(telemetryPath);
    expect(records.length).toBe(1);
    expect(records[0].label).toBe('no-edit-covenant');
    expect(records.some((r) => r.label === ADAPTER_LABEL)).toBe(false);
  });

  it('a matched+passed dispatch (exit 0, results [{exitCode 0}]) passes (exit 0) with ZERO adapter rows', async () => {
    // Matched-and-passed already recorded downstream; results is non-empty, so the
    // adapter must not add a passed row on top. Catches a supplement condition that
    // triggers on "exit 0" regardless of results.length.
    const dispatch = stubDispatchingRegistrations(telemetryPath, [
      { label: 'edit-covenant', event: 'passed', subject: 'packages/covenant/src/dispatch.ts' },
    ]);

    const verdict = await runAdapterPath({
      rawPayload: rawOf(editFixture),
      telemetryPath,
      dispatch,
    });

    expect(verdict).toEqual({ exitCode: 0 });

    const { records } = readRecords(telemetryPath);
    expect(records.length).toBe(1);
    expect(records[0].label).toBe('edit-covenant');
    expect(records.some((r) => r.label === ADAPTER_LABEL)).toBe(false);
  });

  it('the stdinPayload handed to dispatch parses via core parseInput and carries the translated toolCall', async () => {
    // Boundary contract: the serialized CovenantInput must be parseInput-compatible AND
    // actually carry the original payload's tool call (name + args). Catches dispatch
    // being fed the raw payload instead of the translated IR.
    const { dispatch, calls } = stubReturning({ exitCode: 0, results: [] });

    await runAdapterPath({ rawPayload: rawOf(editFixture), telemetryPath, dispatch });

    expect(calls.length).toBe(1);
    const parsed = parseInput(calls[0]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok !== true) return;
    expect(parsed.value.toolCalls).toEqual([{ name: 'Edit', args: editFixture.tool_input }]);
    expect(parsed.value.subagentSpawns).toEqual([]);
  });
});

describe('roadmap-AC arithmetic — 10 mixed calls yield exactly 10 records', () => {
  it('records exactly one row per adapter-path entry across 10 mixed scenarios', async () => {
    // The exactly-one-row invariant, over 5 scenario kinds ×2: every entry leaves
    // exactly one row regardless of match/translate outcome, so a broken supplement
    // rule shows up as a total != 10.
    const validRaw = rawOf(editFixture);
    const invalidRaw = 'not json {';

    // 2× matched+passed (downstream records passed, zero adapter rows)
    for (let i = 0; i < 2; i++) {
      await runAdapterPath({
        rawPayload: validRaw,
        telemetryPath,
        dispatch: stubDispatchingRegistrations(telemetryPath, [
          { label: 'edit-covenant', event: 'passed', subject: 'packages/covenant/src/dispatch.ts' },
        ]),
      });
    }

    // 2× matched+blocked (downstream records blocked, zero adapter rows)
    for (let i = 0; i < 2; i++) {
      await runAdapterPath({
        rawPayload: validRaw,
        telemetryPath,
        dispatch: stubDispatchingRegistrations(telemetryPath, [
          {
            label: 'push-covenant',
            event: 'blocked',
            subject: 'packages/covenant/src/dispatch.ts',
          },
        ]),
      });
    }

    // 2× witnessed (witness: downstream records witnessed, exit 0, results non-empty)
    for (let i = 0; i < 2; i++) {
      await runAdapterPath({
        rawPayload: validRaw,
        telemetryPath,
        dispatch: stubDispatchingRegistrations(telemetryPath, [
          {
            label: 'edit-covenant',
            event: 'witnessed',
            subject: 'packages/covenant/src/dispatch.ts',
          },
        ]),
      });
    }

    // 2× no-match (adapter supplies one passed row each)
    for (let i = 0; i < 2; i++) {
      await runAdapterPath({
        rawPayload: validRaw,
        telemetryPath,
        dispatch: stubReturning({ exitCode: 0, results: [] }).dispatch,
      });
    }

    // 2× translate-fail (adapter supplies one blocked row each, dispatch never reached)
    for (let i = 0; i < 2; i++) {
      await runAdapterPath({
        rawPayload: invalidRaw,
        telemetryPath,
        dispatch: stubReturning({ exitCode: 0, results: [] }).dispatch,
      });
    }

    const { records } = readRecords(telemetryPath);
    expect(records.length).toBe(10);

    const byEvent = (event: TelemetryEvent) => records.filter((r) => r.event === event).length;
    // 2 matched-passed + 2 no-match-adapter-passed = 4 passed
    expect(byEvent('passed')).toBe(4);
    // 2 matched-blocked + 2 translate-fail-adapter-blocked = 4 blocked
    expect(byEvent('blocked')).toBe(4);
    expect(byEvent('witnessed')).toBe(2);
  });

  it('runGain distinguishes the adapter label from covenant labels (separate denominators)', async () => {
    // External contract: the gain report must keep the adapter-path denominator
    // separate from per-covenant counts so a downstream report can split numerator
    // from denominator.
    await runAdapterPath({
      rawPayload: rawOf(editFixture),
      telemetryPath,
      dispatch: stubReturning({ exitCode: 0, results: [] }).dispatch, // no-match → adapter passed row
    });
    await runAdapterPath({
      rawPayload: rawOf(editFixture),
      telemetryPath,
      dispatch: stubDispatchingRegistrations(telemetryPath, [
        { label: 'edit-covenant', event: 'blocked', subject: 'packages/covenant/src/dispatch.ts' },
      ]),
    });

    const report = runGain(telemetryPath);
    expect(report).toContain(`${ADAPTER_LABEL}: passed=1 blocked=0 witnessed=0`);
    expect(report).toContain('edit-covenant: passed=0 blocked=1 witnessed=0');
  });
});

describe('fail-open logging', () => {
  it('creates a missing parent directory so the record is still written (mkdir guarantee)', async () => {
    // A telemetry path under a not-yet-created directory must still record. Without
    // the mkdir step the append silently fails and the no-match passed row is lost.
    const nestedPath = join(tmpRoot, 'nested', 'deeper', 'telemetry.tsv');
    const { dispatch } = stubReturning({ exitCode: 0, results: [] });

    const verdict = await runAdapterPath({
      rawPayload: rawOf(editFixture),
      telemetryPath: nestedPath,
      dispatch,
    });

    expect(verdict).toEqual({ exitCode: 0 });
    const { records } = readRecords(nestedPath);
    expect(records.length).toBe(1);
    expect(records[0].event).toBe('passed');
    expect(records[0].label).toBe(ADAPTER_LABEL);
  });

  it('an unwritable telemetryPath does not throw and leaves a blocked verdict unchanged (exit 2)', async () => {
    // A logging failure must NEVER change the verdict. A directory occupies the file
    // path, so every append fails — the blocked input must still exit 2, no throw.
    const occupied = join(tmpRoot, 'occupied');
    mkdirSync(occupied); // a directory where the log file should be
    const { dispatch } = stubReturning({ exitCode: 0, results: [] });

    await expect(
      runAdapterPath({ rawPayload: 'not json {', telemetryPath: occupied, dispatch }),
    ).resolves.toEqual({ exitCode: 2 });
  });

  it('an unwritable telemetryPath does not throw and leaves a passing verdict unchanged (exit 0)', async () => {
    // The passing side of the same rule: a no-match input still exits 0 even when the
    // adapter's passed-row append cannot be written.
    const occupied = join(tmpRoot, 'occupied-pass');
    mkdirSync(occupied);
    const { dispatch } = stubReturning({ exitCode: 0, results: [] });

    await expect(
      runAdapterPath({ rawPayload: rawOf(editFixture), telemetryPath: occupied, dispatch }),
    ).resolves.toEqual({ exitCode: 0 });
  });
});
