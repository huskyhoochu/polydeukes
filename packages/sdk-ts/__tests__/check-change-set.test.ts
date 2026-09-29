import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkChangeSet } from '../src/check-change-set.ts';
import type { CheckCovenantSpawnSpec } from '../src/check-covenant.ts';

// `checkChangeSet` is the second verb: one unified diff in, one `pdks covenant check --diff`
// spawn, the child's status and stderr back as a verdict value. It judges nothing, writes no
// row, and neither reads nor rewrites the diff. Every case injects the `spawn` seam and reads
// what the seam was handed. Umbrella resolution, the default spawn, and the status table are
// shared with `checkCovenant` and pinned in check-covenant.test.ts; the cases here pin this
// verb's own arguments and stdin, and the two fail-open branches once more for this verb.
//
// `polydeukes` is located from the caller's repoRoot exactly as `checkCovenant` locates it: a
// stub package under the fixture's own `node_modules` carrying `bin.pdks`, and a tree without
// it is the not-installed case.

/** Injected fixture values — a target under the consumer's tree and its content. */
const TARGET = 'src/answer.ts';
const CONTENT = 'export const answer = 42;';
const STUB_BIN_REL = './dist/bin.js';
/** What the child must be asked to run, after the bin path, under each posture. */
const BLOCK_ARGS = ['covenant', 'check', '--diff', '--enforce', 'block'];
const ADVISE_ARGS = ['covenant', 'check', '--diff', '--enforce', 'advise'];

type SpawnResult = { status: number | null; stderr: string };

let repoRoot: string;

beforeEach(() => {
  // Realpath'd: macOS hands out `/var/...` for a tmpdir whose real location is
  // `/private/var/...`, and the bin path resolution and the cwd assertion must agree.
  repoRoot = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-sdk-ts-diff-')));
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

/** A stub `polydeukes` install under the fixture root; returns the absolute bin path. */
function installStubPolydeukes(): string {
  const pkgDir = join(repoRoot, 'node_modules', 'polydeukes');
  mkdirSync(join(pkgDir, 'dist'), { recursive: true });
  writeFileSync(join(repoRoot, 'package.json'), '{"name":"consumer","private":true}\n');
  writeFileSync(
    join(pkgDir, 'package.json'),
    JSON.stringify({ name: 'polydeukes', bin: { pdks: STUB_BIN_REL } }),
  );
  writeFileSync(join(pkgDir, 'dist', 'bin.js'), '');
  return join(pkgDir, 'dist', 'bin.js');
}

/** A recording seam answering `result` for every spawn. */
function recordingSpawn(result: SpawnResult) {
  const calls: CheckCovenantSpawnSpec[] = [];
  return {
    calls,
    spawn: async (spec: CheckCovenantSpawnSpec): Promise<SpawnResult> => {
      calls.push({ ...spec, args: [...spec.args] });
      return result;
    },
  };
}

/** A unified diff creating one file, in the form `git diff` emits for a new file. */
function creationDiff(path: string, line: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${path}`,
    '@@ -0,0 +1 @@',
    `+${line}`,
    '',
  ].join('\n');
}

describe('checkChangeSet — what the seam is handed', () => {
  it('spawns the resolved bin with `covenant check --diff --enforce block` by default, cwd = repoRoot, stdin = the diff verbatim', async () => {
    // Four values, each its own defect: without `--diff` the child parses the diff as an
    // IR and fails closed on every call; `advise` by default turns every break into exit 0
    // with no one reading stderr; a cwd off the repoRoot reads another config; a diff
    // JSON-encoded or trimmed on the way is a change set this package edited.
    const bin = installStubPolydeukes();
    const diff = creationDiff(TARGET, CONTENT);
    const { calls, spawn } = recordingSpawn({ status: 0, stderr: '' });

    await checkChangeSet({ repoRoot, diff, spawn });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual([bin, ...BLOCK_ARGS]);
    expect(calls[0]?.cwd).toBe(repoRoot);
    expect(calls[0]?.stdin).toBe(diff);
  });

  it("`enforce: 'advise'` swaps only the level", async () => {
    const bin = installStubPolydeukes();
    const { calls, spawn } = recordingSpawn({ status: 0, stderr: '' });

    await checkChangeSet({
      repoRoot,
      diff: creationDiff(TARGET, CONTENT),
      enforce: 'advise',
      spawn,
    });

    expect(calls[0]?.args).toEqual([bin, ...ADVISE_ARGS]);
  });

  it("an explicit `enforce: 'block'` stays block", async () => {
    // Reading the field as a truthy flag would send `advise` for the one value that asked
    // for block, and every break would land at exit 0.
    const bin = installStubPolydeukes();
    const { calls, spawn } = recordingSpawn({ status: 0, stderr: '' });

    await checkChangeSet({
      repoRoot,
      diff: creationDiff(TARGET, CONTENT),
      enforce: 'block',
      spawn,
    });

    expect(calls[0]?.args).toEqual([bin, ...BLOCK_ARGS]);
  });

  it('hands an empty diff to the child unchanged instead of deciding about it here', async () => {
    // Whether a diff of nothing is a change set is the judge's call. An SDK that answers
    // `unjudged` or `upheld` for an empty string without spawning has judged once.
    installStubPolydeukes();
    const { calls, spawn } = recordingSpawn({ status: 0, stderr: '' });

    await checkChangeSet({ repoRoot, diff: '', spawn });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.stdin).toBe('');
  });
});

describe('checkChangeSet — the fail-open branches', () => {
  it("status 1 → { verdict: 'unjudged' } with a reason naming the status", async () => {
    // A crashed child is not a verdict. Mapping 1 onto `blocked` invents a break; mapping
    // it onto `upheld` is the fail-open hole an uninstalled dist would fall through.
    installStubPolydeukes();
    const { spawn } = recordingSpawn({
      status: 1,
      stderr: 'TypeError: covenant.x is not a function',
    });

    const verdict = await checkChangeSet({ repoRoot, diff: creationDiff(TARGET, CONTENT), spawn });

    expect(verdict).toMatchObject({ verdict: 'unjudged' });
    expect(verdict).toHaveProperty('reason', expect.stringMatching(/\b1\b/));
    expect(verdict).not.toHaveProperty('advisories');
  });

  it('no polydeukes under repoRoot spawns nothing and returns unjudged naming the package', async () => {
    // With no bin there is nothing to spawn and no writer for a row. `upheld` here is an
    // absent judge passing every change set.
    const { calls, spawn } = recordingSpawn({ status: 0, stderr: '' });

    const verdict = await checkChangeSet({ repoRoot, diff: creationDiff(TARGET, CONTENT), spawn });

    expect(calls).toEqual([]);
    expect(verdict).toMatchObject({ verdict: 'unjudged' });
    expect(verdict).toHaveProperty('reason', expect.stringContaining('polydeukes'));
  });
});
