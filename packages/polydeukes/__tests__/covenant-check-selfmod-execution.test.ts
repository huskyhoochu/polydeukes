import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// The commit self-mod execution proof. `passed/self-mod` is unreachable — a matched call
// always breaks — so the observation is the judge's reason text, which the wrapper writes
// through process.stderr.write and only a judge that actually ran can produce.
import { runCovenantCheck } from '../src/index.ts';
import { type CheckRepo, createCheckRepo, telemetryRows } from './helpers';

/** Injected fixture values. */
const PROTECTED_ENTRY = 'secret.txt';
/** The self-mod verdict's own phrasing — a line only an executed judge produces, never
 * a filename echo from the assembly. */
const JUDGE_PHRASE = 'would modify protected path';

let repo: CheckRepo;

beforeEach(() => {
  repo = createCheckRepo('pdks-selfmod-exec-');
});

afterEach(() => {
  repo.cleanup();
  vi.restoreAllMocks();
});

describe('the commit self-mod judge observably executes in-process', () => {
  it('a staged protected change under advise puts the judge reason, naming the entry, on the spyable stderr', async () => {
    // An advised self-mod row written without the judge running is a fabricated verdict;
    // the reason text is producible only by an executed judgment.
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
