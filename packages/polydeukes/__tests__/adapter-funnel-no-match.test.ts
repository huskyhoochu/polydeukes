import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAdapterPath } from '@polydeukes/adapter-claude-code';
import { readRecords } from '@polydeukes/core';
import type { CovenantRegistration } from '@polydeukes/covenant';
import { dispatchCovenants } from '@polydeukes/covenant';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// DISPATCH-01 AC-8 — the no-match no-record pin at the package boundary
// (roi-telemetry-wiring §8 carry-over), through the real session funnel: the
// dispatcher contributes ZERO rows on a no-match call — the single surviving row is
// the adapter's own funnel supplement, measured here so a dispatcher that starts
// fabricating per-registration rows cannot hide behind it.

/** Injected fixture values. */
const PROTECTED_ENTRY = 'gate';
const REG_LABEL = 'self-mod';
const ADAPTER_LABEL = 'adapter-claude-code';

let dir: string;
let telemetryPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pdks-funnel-no-match-'));
  telemetryPath = join(dir, 'roi.log');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** One registration; the body answers 0 so a routed control leaves a judged row. */
function registration(): CovenantRegistration {
  return {
    label: REG_LABEL,
    protectedPaths: [PROTECTED_ENTRY],
    body: async () => ({ exitCode: 0 }),
  };
}

/** The session funnel: runAdapterPath handing its IR to the real dispatcher. */
async function runFunnel(filePath: string) {
  return await runAdapterPath({
    rawPayload: JSON.stringify({
      hook_event_name: 'PreToolUse',
      session_id: 's-1',
      cwd: dir,
      tool_name: 'Write',
      tool_input: { file_path: filePath, content: 'nothing special\n' },
    }),
    telemetryPath,
    dispatch: (stdinPayload: string) =>
      dispatchCovenants({ stdinPayload, registrations: [registration()], telemetryPath }),
  });
}

function rows(): [string, string][] {
  return readRecords(telemetryPath).records.map((record) => [record.event, record.label]);
}

describe('DISPATCH-01 AC-8 — a no-match call leaves no dispatcher row through the real funnel', () => {
  it('session: a Write touching nothing protected leaves ONLY the adapter supplement (zero dispatcher rows)', async () => {
    // Mutation caught: the dispatcher fabricating a row for a call no registration
    // judged — no-match is no-record at the dispatch boundary.
    const result = await runFunnel('notes/ordinary.txt');

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([['passed', ADAPTER_LABEL]]);
  });

  it('session: the same funnel DOES leave a judged row when the payload routes — the probe is not inert', async () => {
    // Mutation caught: the pin above going green because the wiring routes nothing at
    // all (testing-fixtures: an inert probe never routes).
    await runFunnel(`${PROTECTED_ENTRY}/inner.txt`);

    expect(rows().map(([, label]) => label)).toContain(REG_LABEL);
  });
});
