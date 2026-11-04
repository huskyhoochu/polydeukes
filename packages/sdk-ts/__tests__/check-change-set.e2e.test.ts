import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkChangeSet } from '../src/check-change-set.ts';

// `checkChangeSet` against the BUILT `pdks`: a throwaway tree scaffolded by `pdks init`,
// with one protected path of its own. Only a
// real spawn proves that the child runs in diff mode — a diff handed to the IR parser fails
// closed on every input, which an exit-code-only check reads as `blocked` — that it takes
// the config layer, and that the row it writes is the judge's own.
// check-change-set.test.ts pins the same contract through the injected seam.

const checkoutRoot = resolve(import.meta.dirname, '../../..');
const PDKS_BIN = process.env.POLYDEUKES_E2E_PDKS ?? resolve(checkoutRoot, 'target/debug/pdks');

/** Injected fixture values — the consumer's protected directory and its targets. */
const PROTECTED_DIR = 'pipeline/gates';
const ORDINARY_TARGET = 'src/answer.ts';
const TELEMETRY_REL = 'roi.log';

let projectRoot: string;

beforeEach(() => {
  vi.stubEnv('PATH', '');
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-sdk-ts-diff-e2e-')));
});

afterEach(() => {
  // rmSync removes symlinks themselves, never what they point at.
  vi.unstubAllEnvs();
  rmSync(projectRoot, { recursive: true, force: true });
});

/**
 * `pdks init` for the scaffold, then the consumer's own config over the scaffolded one: one
 * protected directory and a telemetry path inside the fixture, so the rows this suite reads
 * are this tree's alone. The executable sits in the fixture root, which is the only PATH entry.
 */
function scaffoldConsumer(): void {
  expect(existsSync(PDKS_BIN), `${PDKS_BIN} is missing: run \`cargo build -p pdks\` first`).toBe(
    true,
  );
  symlinkSync(PDKS_BIN, join(projectRoot, 'pdks'));
  vi.stubEnv('PATH', projectRoot);
  const init = spawnSync(PDKS_BIN, ['init'], { cwd: projectRoot, encoding: 'utf-8' });
  expect(init.status, init.stderr).toBe(0);
  writeFileSync(
    join(projectRoot, 'polydeukes.config.yaml'),
    [
      'protectedPaths:',
      `  - '${PROTECTED_DIR}'`,
      'telemetry:',
      `  logPath: '${join(projectRoot, TELEMETRY_REL)}'`,
      '',
    ].join('\n'),
  );
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

function rows(): [string, string, string][] {
  return rowsAt(join(projectRoot, TELEMETRY_REL));
}

/** Injected fixture values — the host layer outside the tree, its one entry, and the line it forbids. */
const LAYER_FILE = 'discipline-layer.json';
const LAYER_ID = 'host-no-flushall';
const LAYER_WHY = 'a cache flush in a shared environment erases every other tenant’s state';
const FORBIDDEN_LINE = 'redis.FLUSHALL();';
const LAYER_TELEMETRY_FILE = 'layer-roi.log';

/**
 * A layer with one shared-list entry at `enforce: block`: an added-only declaration over
 * `src/` whose added lines may not carry the forbidden token. The change-set surface reads
 * `pre` · `post` of the created file, so this is the list that surface compiles.
 */
function flushBanLayer(): Record<string, unknown> {
  return {
    disciplines: [
      {
        id: LAYER_ID,
        why: LAYER_WHY,
        enforce: 'block',
        declare: {
          mechanism: 'added-only',
          scope: { source: 'target.path', include: ['^src/'] },
          supply: { pre: 'empty', post: 'empty' },
          extract: {
            before: [
              { op: 'source', of: 'pre' },
              { op: 'lines' },
              { op: 'keyByPattern', re: '(FLUSHALL)' },
            ],
            after: [
              { op: 'source', of: 'post' },
              { op: 'lines' },
              { op: 'keyByPattern', re: '(FLUSHALL)' },
            ],
            added: [{ op: 'onlyIn', of: 'after', notIn: 'before' }],
          },
          relate: [{ id: 'no-flush', relation: { op: 'empty', of: 'added' }, message: '{value}' }],
        },
      },
    ],
  };
}

/** Every telemetry row at an absolute path as [event, label, subject]; rows are tab-separated `timestamp event label subject`. */
function rowsAt(path: string): [string, string, string][] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [, event = '', label = '', subject = ''] = line.split('\t');
      return [event, label, subject];
    });
}

describe('checkChangeSet with a config layer against the built pdks', () => {
  let outside: string;

  beforeEach(() => {
    outside = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-sdk-ts-layer-outside-')));
  });

  afterEach(() => {
    rmSync(outside, { recursive: true, force: true });
  });

  it('a diff adding the forbidden line under the layer’s entry → blocked, the id in the reason, one blocked row under the id at telemetryPath', async () => {
    // The row's label and location separate the four ways this can be green wrongly: a
    // layer never handed on leaves `upheld`; a layer that fails to load blocks under the
    // runner's label; a `telemetryPath` parsed and dropped writes the row to the config's
    // log; and the subject must be the created file, not the runner's `-`.
    scaffoldConsumer();
    const layerPath = join(outside, LAYER_FILE);
    const telemetryPath = join(outside, LAYER_TELEMETRY_FILE);
    writeFileSync(layerPath, JSON.stringify(flushBanLayer()));

    const verdict = await checkChangeSet({
      repoRoot: projectRoot,
      diff: creationDiff(ORDINARY_TARGET, FORBIDDEN_LINE),
      configLayer: layerPath,
      telemetryPath,
    });

    expect(verdict).toMatchObject({ verdict: 'blocked' });
    expect(verdict).toHaveProperty('reason', expect.stringContaining(LAYER_ID));
    expect(rowsAt(telemetryPath)).toContainEqual(['blocked', LAYER_ID, ORDINARY_TARGET]);
    expect(rows().filter(([, label]) => label === LAYER_ID)).toEqual([]);
  });
});

describe('checkChangeSet against the built pdks', () => {
  it('a diff creating a file outside every protected path → upheld, and no blocked row', async () => {
    // The over-blocking end: a diff outside every protected path comes back upheld.
    scaffoldConsumer();

    const verdict = await checkChangeSet({
      repoRoot: projectRoot,
      diff: creationDiff(ORDINARY_TARGET, 'export const answer = 42;'),
    });

    expect(verdict).toMatchObject({ verdict: 'upheld' });
    expect(rows().filter(([event]) => event === 'blocked')).toEqual([]);
  });
});
