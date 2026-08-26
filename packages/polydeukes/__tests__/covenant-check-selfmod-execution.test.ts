import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// DISPATCH-01 AC-9 RED phase — the commit self-mod execution proof. Pre-conversion this
// was a declared limit (covenant-check-unbuilt-body.test.ts: the body's break reason
// goes to inherited fd 2, unreachable by a spy, and passed/self-mod is unreachable
// because a matched call always breaks). In-process the wrapper writes the judge's
// reason through process.stderr.write, so the reason text — producible only by a judge
// that actually ran against the staged change — becomes the execution observation.
import { runCovenantCheck } from '../src/index.ts';
import { type CheckRepo, createCheckRepo, telemetryRows } from './helpers';

/** Injected fixture values. */
const PROTECTED_ENTRY = 'secret.txt';
/** The self-mod verdict's own phrasing (AC-1 ② pins it on the session side) — a line
 * only an executed judge produces, never a filename echo from the assembly. */
const JUDGE_PHRASE = 'would modify protected path';

let repo: CheckRepo;

beforeEach(() => {
  repo = createCheckRepo('pdks-selfmod-exec-');
});

afterEach(() => {
  repo.cleanup();
  vi.restoreAllMocks();
});

describe('DISPATCH-01 AC-9 — the commit self-mod judge observably executes in-process', () => {
  it('a staged protected change under advise puts the judge reason, naming the entry, on the spyable stderr', async () => {
    // Mutation caught: advised self-mod rows written without the judge running (the
    // fabricated-verdict shape CONFIG-06b fought blind) — the reason text through the
    // wrapper's own stderr write is producible only by an executed judgment.
    repo.writeConfig({
      protectedPaths: [PROTECTED_ENTRY],
      adapters: { git: { enforce: 'advise' } },
    });
    repo.write(PROTECTED_ENTRY, 'sensitive\n');
    repo.git('add', PROTECTED_ENTRY, 'polydeukes.config.json');
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const result = await runCovenantCheck({
      repoRoot: repo.repoRoot,
      telemetryPath: repo.telemetryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(telemetryRows(repo.telemetryPath).map(([event, label]) => [event, label])).toEqual([
      ['advised', 'self-mod'],
      ['advised', 'self-mod'],
    ]);
    const reasonLines = stderrWrite.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes(JUDGE_PHRASE) && line.includes(PROTECTED_ENTRY));
    expect(reasonLines).not.toHaveLength(0);
  });
});
