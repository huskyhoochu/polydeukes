import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TelemetryEvent } from '@polydeukes/core';
import { appendRecord, parseInput, readRecords, runGain } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClaudePreToolUsePayload } from '../src/index.ts';
// ADAPTER-03. Import from the package entry point (src/index.ts) — the same surface
// `@polydeukes/adapter-claude-code` publishes. The wiring module does not exist yet,
// so this import fails at RED (module not implemented).
import { type DispatchOutcome, runAdapterPath } from '../src/index.ts';

// ---------------------------------------------------------------------------
// Per-test temp telemetry path — each test writes to its own log, cleaned after.
// ---------------------------------------------------------------------------

let tmpRoot: string;
let telemetryPath: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'pdks-adapter-'));
  telemetryPath = join(tmpRoot, 'telemetry.tsv');
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixtures — realistic Claude Code PreToolUse hook payloads (snake_case, PRD §4.1).
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Dispatch stub factories. The injected dispatch seam mirrors the documented
// dispatcher contract: matched registrations append their OWN records (one per
// registration, via the same core appendRecord) before returning. Stubs are
// deterministic and call-counting where the spec needs "dispatch not called".
// ---------------------------------------------------------------------------

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

/** A dispatch stub that rejects, counting its calls. */
function stubRejecting(): {
  dispatch: (stdinPayload: string) => Promise<DispatchOutcome>;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    dispatch: async (stdinPayload: string) => {
      calls.push(stdinPayload);
      throw new Error('dispatch blew up');
    },
  };
}

/**
 * A dispatch stub that faithfully mirrors the real dispatcher's record contract:
 * for each matched registration it appends one record (its own covenant label,
 * subject = the mentioned path) via the core collector, then returns the outcome
 * derived from those registrations.
 */
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

// ===========================================================================
// §5.1 translate-failure measurement (unmeasured segment 1)
// ===========================================================================

describe('§5.1 translate-failure measurement', () => {
  it('a non-JSON rawPayload blocks (exit 2) and appends exactly one adapter blocked record, dispatch never called', async () => {
    // P0: unparseable input must fail closed (CORE-01) AND be measured (the whole
    // point of this ticket). Mutation caught: JSON.parse failure not mapped to exit 2,
    // the blocked record dropped, or dispatch invoked despite an unclassifiable input.
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
    // P0: a Task lacking subagent_type must not be demoted to a toolCall — it fails
    // classification and blocks. Mutation caught: the subagent_type failure treated as
    // success, letting a spawn-less Task flow to dispatch.
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
    // P0: an unhandled rejection would exit the hook non-blocking = a bypass vector
    // (PRD §4.1 step 4). Mutation caught: the try/catch around dispatch removed (throw
    // escapes), or the caught rejection mapped to exit 0 instead of 2.
    const { dispatch, calls } = stubRejecting();

    let verdict: { exitCode: 0 | 2 } | undefined;
    await expect(
      (async () => {
        verdict = await runAdapterPath({ rawPayload: rawOf(editFixture), telemetryPath, dispatch });
      })(),
    ).resolves.toBeUndefined();

    expect(verdict).toEqual({ exitCode: 2 });
    expect(calls.length).toBe(1); // dispatch was reached, then threw

    const { records } = readRecords(telemetryPath);
    expect(records.length).toBe(1);
    expect(records[0].event).toBe('blocked');
    expect(records[0].label).toBe(ADAPTER_LABEL);
    expect(records[0].subject).toBe('-');
  });
});

// ===========================================================================
// §5.2 funnel supplement (unmeasured segment 2) — exactly-one-record arithmetic
// ===========================================================================

describe('§5.2 funnel supplement — exactly-one-record arithmetic', () => {
  it('a no-match dispatch (exit 0, results []) passes (exit 0) and the adapter appends exactly one passed record', async () => {
    // P0 funnel decision: matched-zero passing is measured at the ADAPTER level. The
    // dispatcher wrote nothing; the adapter supplies one passed row so the gain
    // denominator counts this call. Mutation caught: the results.length===0 && exit 0
    // branch not appending, or appending the wrong event/label.
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
    // P0 no-double-count: the dispatcher already recorded its own blocked row, so the
    // adapter must NOT supplement. Mutation caught: the supplement condition widened to
    // "any exit 2" (would add a second row), or narrowed to "results.length===0"
    // regardless of exit code.
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
    expect(records.length).toBe(1); // only the stub's own row
    expect(records[0].label).toBe('dispatcher-self');
    expect(records.some((r) => r.label === ADAPTER_LABEL)).toBe(false);
  });

  it('a matched+blocked dispatch (exit 2, results [{exitCode 2}]) blocks (exit 2) with ZERO adapter rows', async () => {
    // P0 no-double-count: a matched registration recorded its own row; results is
    // non-empty so the adapter supplements nothing. Mutation caught: the "results
    // non-empty ⇒ zero adapter rows" rule broken so the adapter double-counts.
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
    // P0 no-double-count: matched-and-passed already recorded downstream; results is
    // non-empty so the adapter must not add a passed row on top. Mutation caught: the
    // supplement condition triggering on "exit 0" regardless of results.length.
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
    // P1 boundary contract: the serialized CovenantInput must be parseInput-compatible
    // AND actually carry the original payload's tool call (name + args). Mutation caught:
    // dispatch fed the raw payload instead of the translated IR, or the translated IR
    // built without the toolCall (args dropped / name swapped).
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

// ===========================================================================
// §5.3 roadmap-AC arithmetic — 10 mixed calls yield exactly 10 records
// ===========================================================================

describe('§5.3 roadmap-AC arithmetic — 10 mixed calls yield exactly 10 records', () => {
  it('records exactly one row per adapter-path entry across 10 mixed scenarios', async () => {
    // P0 exactly-one-row invariant (PRD §4.3 table is canonical): 5 scenario kinds ×2.
    // Every entry leaves exactly one row regardless of match/translate outcome. Mutation
    // caught: any scenario over- or under-counting (a broken supplement rule shows up as
    // a total != 10).
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

    // 2× bypassed (escape hatch: downstream records bypassed, exit 0, results non-empty)
    for (let i = 0; i < 2; i++) {
      await runAdapterPath({
        rawPayload: validRaw,
        telemetryPath,
        dispatch: stubDispatchingRegistrations(telemetryPath, [
          {
            label: 'edit-covenant',
            event: 'bypassed',
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
    expect(byEvent('bypassed')).toBe(2);
  });

  it('runGain distinguishes the adapter label from covenant labels (separate denominators)', async () => {
    // P1 external contract: the gain report must keep the adapter-path denominator
    // separate from per-covenant counts so a downstream report can split numerator from
    // denominator. Mutation caught: adapter rows written under a covenant label, or
    // no-match not producing an adapter-labelled row at all.
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
    expect(report).toContain(`${ADAPTER_LABEL}: passed=1 blocked=0 bypassed=0`);
    expect(report).toContain('edit-covenant: passed=0 blocked=1 bypassed=0');
  });
});

// ===========================================================================
// §5.4 fail-open logging ⊥ fail-closed verdict
// ===========================================================================

describe('§5.4 fail-open logging', () => {
  it('creates a missing parent directory so the record is still written (mkdir guarantee)', async () => {
    // P1 fail-open: a telemetry path under a not-yet-created directory must still record
    // (COVENANT-01b inheritance). Mutation caught: the mkdir step removed, so the append
    // silently fails and the no-match passed row is lost.
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
    // P0 fail-open ⊥ fail-closed: a logging failure must NEVER change the verdict. Here a
    // directory occupies the file path, so every append fails — the blocked input must
    // still exit 2, no throw. Mutation caught: the fail-open try/catch removed, or a log
    // failure short-circuiting the verdict.
    const occupied = join(tmpRoot, 'occupied');
    mkdirSync(occupied); // a directory where the log file should be
    const { dispatch } = stubReturning({ exitCode: 0, results: [] });

    let verdict: { exitCode: 0 | 2 } | undefined;
    await expect(
      (async () => {
        verdict = await runAdapterPath({
          rawPayload: 'not json {',
          telemetryPath: occupied,
          dispatch,
        });
      })(),
    ).resolves.toBeUndefined();

    expect(verdict).toEqual({ exitCode: 2 });
  });

  it('an unwritable telemetryPath does not throw and leaves a passing verdict unchanged (exit 0)', async () => {
    // P0 fail-open ⊥ fail-closed, passing side: a no-match input still exits 0 even when
    // the adapter's passed-row append cannot be written. Mutation caught: a log failure
    // flipping the verdict to blocking, or the append throwing out of runAdapterPath.
    const occupied = join(tmpRoot, 'occupied-pass');
    mkdirSync(occupied);
    const { dispatch } = stubReturning({ exitCode: 0, results: [] });

    let verdict: { exitCode: 0 | 2 } | undefined;
    await expect(
      (async () => {
        verdict = await runAdapterPath({
          rawPayload: rawOf(editFixture),
          telemetryPath: occupied,
          dispatch,
        });
      })(),
    ).resolves.toBeUndefined();

    expect(verdict).toEqual({ exitCode: 0 });
  });
});
