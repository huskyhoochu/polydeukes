import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// The commit surface has no session, so its root injects no channel reader and every
// sidecar-bound source is absent on every run — the declaration's `supply` policy is what
// disposes of that, per commit. The same asymmetry the context family lives with: the
// evidence channel belongs to the other surface.
//
// Each test builds a real throwaway git repo and writes its own tmp config, so no
// protected path of THIS repository is ever referenced; the judging dist is the real one.
import { runCovenantCheck } from '../src/covenant-check.ts';
import { type CheckRepo, createCheckRepo } from './helpers.ts';

const TARGET_FILE = 'lib/a.ts';

/** A declaration judging the spawn sidecar, with its absence policy injected per test. */
function sidecarEntry(policy: 'error' | 'pass') {
  return {
    id: 'needs-writer-spawn',
    why: 'a production edit wants a writer spawn on record',
    declare: {
      mechanism: 'precedent',
      sources: { spawns: { sidecar: true } },
      supply: { spawns: policy },
      scope: { source: 'target.path', include: ['^lib/'] },
      extract: {
        writers: [
          { op: 'source', of: 'spawns' },
          { op: 'matches', re: 'tdd-test-writer' },
        ],
      },
      relate: [
        {
          id: 'writer',
          relation: { op: 'nonEmpty', of: 'writers' },
          message: 'no writer spawn on record',
        },
      ],
    },
  };
}

let repo: CheckRepo;
let repoRoot: string;
let telemetryPath: string;
let git: CheckRepo['git'];
let write: CheckRepo['write'];
let writeConfig: CheckRepo['writeConfig'];

beforeEach(() => {
  repo = createCheckRepo('pdks-check-sidecar-');
  ({ repoRoot, telemetryPath, git, write, writeConfig } = repo);
});

afterEach(() => {
  repo.cleanup();
  vi.restoreAllMocks();
});

describe('covenant check — a sidecar declaration on the surface with no channel', () => {
  it('supply: pass lets the commit through — the author chose to forgo the absent channel', async () => {
    writeConfig({ disciplines: [sidecarEntry('pass')] });
    write(TARGET_FILE, 'export {};\n');
    // Only the target is staged: the config file sits on its own protection surface, and
    // staging it would land a self-mod block that has nothing to do with the channel.
    git('add', TARGET_FILE);

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(0);
  });

  it('supply: error refuses the commit and names the source — absence is unjudgeable, not a pass', async () => {
    // An enforce level relaxes judged breaks only; a judgment that could not happen never
    // folds into a pass, whatever the posture.
    writeConfig({ disciplines: [sidecarEntry('error')] });
    write(TARGET_FILE, 'export {};\n');
    // Only the target is staged: the config file sits on its own protection surface, and
    // staging it would land a self-mod block that has nothing to do with the channel.
    git('add', TARGET_FILE);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(2);
    const lines = stderrSpy.mock.calls.map((call) => String(call[0])).join('');
    expect(lines).toContain('spawns');
  });
});
