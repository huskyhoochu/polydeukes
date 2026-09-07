import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CovenantModule } from '../src/covenant/module.ts';
// The commit root's `plan → supply → dispatch` wiring. After the registrations are
// assembled the root plans the sources they name, reads each one from the WORKING TREE,
// and hands every per-change dispatch one `world`: the supplied files plus the whole
// observed change set. The kernel never opens the tree — the root's `read` is the only
// place the disk is reached, so it is the only place it can be wrong.
//
// The dispatcher and the two supply verbs are observed through a recording judge module
// injected on the `covenant` seam (helpers.ts `recordingCovenant`): the real judges still run, and
// every spec's `world` is written down before it reaches them. Each case is a real
// throwaway git repository whose config carries its own declare entry; nothing of THIS
// repository is referenced. The staged diff is translated to the IR the runner judges,
// which is what a caller pipes in through `--diff`.
import { runCovenantCheck } from '../src/covenant-check.ts';
import { covenantInputFromUnifiedDiff } from '../src/diff-ir.ts';
import {
  type CheckRepo,
  createCheckRepo,
  type RecordedCall,
  recordingCovenant,
  telemetryRows,
} from './helpers.ts';

/** Injected fixture values — the declare entry and the files its sources name. */
const DECLARE_ID = 'en-locale-has-keys';
const SOURCE_NAME = 'en';
const EN_FILE = 'locales/en.json';
/** Planned by the recording module, never present in the observed tree. */
const MISSING_FILE = 'locales/missing.json';
/** The umbrella's protected-paths registration label — an observable contract, not a fixture choice. */
const SELF_MOD_LABEL = 'self-mod';
const HEAD_CONTENT = '{"head":true}\n';
const DISK_CONTENT = '{"disk":true}\n';
const declareEntry = {
  id: DECLARE_ID,
  why: 'the English locale must carry at least one key',
  declare: {
    // World axis with `nonEmpty`: `scoped-valve` is the one name that admits it, and it
    // asks for the valve block below.
    mechanism: 'scoped-valve',
    sources: { [SOURCE_NAME]: { file: EN_FILE } },
    supply: { [SOURCE_NAME]: 'pass' },
    scope: { source: 'target.path', include: ['^locales/'] },
    extract: {
      enKeys: [{ op: 'source', of: SOURCE_NAME }, { op: 'json' }, { op: 'flattenKeys' }],
    },
    relate: [
      {
        id: 'has-keys',
        relation: { op: 'nonEmpty', of: 'enKeys' },
        message: 'the English locale carries no key',
      },
    ],
    witness: {
      extract: {
        override: [
          { op: 'source', of: 'target.path' },
          { op: 'matches', re: '^$' },
        ],
      },
      relate: [{ id: 'valve', relation: { op: 'nonEmpty', of: 'override' }, message: 'w' }],
    },
  },
};

let repo: CheckRepo;
let repoRoot: string;
let git: CheckRepo['git'];
let write: CheckRepo['write'];
let writeConfig: CheckRepo['writeConfig'];
/** What the run must not observe lives outside the repository: the telemetry log. */
let outside: string;
let telemetryPath: string;
let calls: () => RecordedCall[];
let covenant: CovenantModule;

/** The staged diff of the fixture repository, translated to the IR the runner judges. */
function stagedInput() {
  return covenantInputFromUnifiedDiff({ text: git('diff', '--cached') });
}

beforeEach(() => {
  repo = createCheckRepo('pdks-check-world-axis-');
  ({ repoRoot, git, write, writeConfig } = repo);
  outside = mkdtempSync(join(tmpdir(), 'pdks-check-world-axis-outside-'));
  telemetryPath = join(outside, 'roi.log');
  ({ covenant, calls } = recordingCovenant([EN_FILE, MISSING_FILE]));
});

afterEach(() => {
  repo.cleanup();
  rmSync(outside, { recursive: true, force: true });
});

/** Commit the config and the locale at `HEAD_CONTENT`, so HEAD is the clean baseline. */
function commitBaseline(): string {
  writeConfig({ disciplines: [declareEntry] });
  write(EN_FILE, HEAD_CONTENT);
  git('add', 'polydeukes.config.json', EN_FILE);
  git('commit', '--quiet', '-m', 'baseline');
  return git('rev-parse', 'HEAD').trim();
}

/** The worlds every dispatch of the run received, in dispatch order. */
function dispatchedWorlds(): NonNullable<Extract<RecordedCall, { kind: 'dispatch' }>['world']>[] {
  return calls()
    .filter((call): call is Extract<RecordedCall, { kind: 'dispatch' }> => call.kind === 'dispatch')
    .map((call) => {
      expect(call.hasWorld, 'a dispatch received no world').toBe(true);
      return call.world as NonNullable<typeof call.world>;
    });
}

/** The run must have judged, not failed closed: exit 0 and no `blocked` row from any label. */
function expectJudged(result: { exitCode: number }): void {
  expect(result.exitCode).toBe(0);
  expect(telemetryRows(telemetryPath).filter(([event]) => event === 'blocked')).toEqual([]);
}

describe('covenant check — the read is the working tree', () => {
  it('the world carries the DISK text of a planned file, and no key for a planned file the disk lacks', async () => {
    // The missing file kills a `read` that folds an absent path into '' or null instead
    // of leaving the key absent — the `supply` policy can only dispose of absence it can
    // see.
    commitBaseline();
    write(EN_FILE, DISK_CONTENT);
    git('add', EN_FILE);

    const result = await runCovenantCheck({
      repoRoot,
      telemetryPath,
      covenant,
      input: stagedInput(),
    });

    expectJudged(result);
    expect(dispatchedWorlds().map((world) => world.files)).toEqual([{ [EN_FILE]: DISK_CONTENT }]);
  });
});

describe('covenant check — the change set is the whole observation, on every dispatch', () => {
  it('three staged changes dispatch three times, each carrying the same three paths in input order', async () => {
    // The commit root dispatches once per change so every change leaves its own row, and
    // that is exactly why the judge cannot derive the change set from its input — the
    // input holds one change. A root that passes each dispatch its own path (or omits
    // `changes`) turns every `Implies` over the change set into a one-element vacuity:
    // the `*.md ⇒ *.ko.md` pairing never finds a pair and never finds one missing. The
    // order is the input's, so the judge's witnesses keep the observation's order.
    commitBaseline();
    write(EN_FILE, DISK_CONTENT);
    write('notes/a.txt', 'a\n');
    write('notes/b.txt', 'b\n');
    git('add', EN_FILE, 'notes/a.txt', 'notes/b.txt');
    const observed = stagedInput();
    const changed = observed.toolCalls.map((call) => call.fileChange?.path);
    expect(changed).toHaveLength(3);

    const result = await runCovenantCheck({
      repoRoot,
      telemetryPath,
      covenant,
      input: observed,
    });

    expectJudged(result);
    expect(dispatchedWorlds().map((world) => world.changes)).toEqual([changed, changed, changed]);
  });
});

describe('covenant check — the plan is made from the assembled registrations', () => {
  it('planSources receives the registrations the run judges with — the declare entry and the meta-covenant', async () => {
    // The plan is what the sources are read FOR. A root that plans before compiling (or
    // hands the planner an empty list) supplies nothing to a declare entry that named a
    // file, and the entry's `supply: error` then refuses every call it scopes — a
    // judgment about the wiring, misread as one about the change. One plan per run: the
    // per-change loop shares it, or the tree is read once per change.
    commitBaseline();
    write(EN_FILE, DISK_CONTENT);
    git('add', EN_FILE);

    const result = await runCovenantCheck({
      repoRoot,
      telemetryPath,
      covenant,
      input: stagedInput(),
    });

    expectJudged(result);
    const plans = calls().filter((call) => call.kind === 'plan');
    expect(plans).toHaveLength(1);
    expect(plans[0]?.labels).toEqual(expect.arrayContaining([DECLARE_ID, SELF_MOD_LABEL]));
  });
});

/** A planned path that is a directory, the file inside it, and the binary shape. */
const DIR_PATH = 'locales/nested';
const DIR_INNER = 'locales/nested/inner.json';
const BINARY_FILE = 'assets/blob.bin';
const BINARY_CONTENT = Buffer.from('ab\0cd');

/** Write bytes a text source cannot carry (a NUL inside) at a repo-relative path. */
function writeBinary(relPath: string): void {
  const absolute = join(repoRoot, relPath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, BINARY_CONTENT);
}

describe('covenant check — a planned path the tree cannot give as text is an absence, not a refusal', () => {
  // The defect class is fail-closed on a mere absence: a path that is a directory or a
  // binary blob is not a text a declaration can parse, and refusing the whole run for it
  // turns every commit in the repository into a refusal. Each case keeps the planned
  // locale beside the odd path, so a `read` that answers absence for everything on any
  // failure is refuted by the locale's text still landing.
  it('a planned path that is a directory on disk yields no key, and the file beside it is read', async () => {
    // `readFileSync` on a directory throws EISDIR; a `read` that folds only ENOENT
    // propagates it and the run refuses a tree that merely has a folder.
    commitBaseline();
    write(DIR_INNER, '{}\n');
    write(EN_FILE, DISK_CONTENT);
    git('add', DIR_INNER, EN_FILE);
    ({ covenant, calls } = recordingCovenant([DIR_PATH, EN_FILE]));

    const result = await runCovenantCheck({
      repoRoot,
      telemetryPath,
      covenant,
      input: stagedInput(),
    });

    expectJudged(result);
    const worlds = dispatchedWorlds();
    expect(worlds.length).toBeGreaterThan(0);
    for (const world of worlds) expect(world.files).toEqual({ [EN_FILE]: DISK_CONTENT });
  });

  it('a planned path holding NUL bytes on disk yields no key, not a lossy decode', async () => {
    // A utf-8 decode of binary content is still a string; without the NUL check the
    // bytes are supplied as text and `json` breaks the declaration on a file that was
    // never a locale.
    commitBaseline();
    writeBinary(BINARY_FILE);
    write(EN_FILE, DISK_CONTENT);
    git('add', BINARY_FILE, EN_FILE);
    ({ covenant, calls } = recordingCovenant([BINARY_FILE, EN_FILE]));

    const result = await runCovenantCheck({
      repoRoot,
      telemetryPath,
      covenant,
      input: stagedInput(),
    });

    expectJudged(result);
    const worlds = dispatchedWorlds();
    expect(worlds.length).toBeGreaterThan(0);
    for (const world of worlds) expect(world.files).toEqual({ [EN_FILE]: DISK_CONTENT });
  });
});

describe('covenant check — the change set lists the changes that produce a world', () => {
  it('a staged binary file is dispatched but not listed in changes', async () => {
    // A binary staged blob translates to a call with no evidence, so it produces no world
    // of its own; listing its path in `changes` hands the pairing declarations a path no
    // world will ever answer for. The dispatch itself still happens — the path judges
    // still see the call — so the count stays at one per staged change.
    commitBaseline();
    write(EN_FILE, DISK_CONTENT);
    writeBinary(BINARY_FILE);
    git('add', EN_FILE, BINARY_FILE);
    const observed = stagedInput();
    expect(observed.toolCalls).toHaveLength(2);

    const result = await runCovenantCheck({
      repoRoot,
      telemetryPath,
      covenant,
      input: observed,
    });

    expectJudged(result);
    expect(dispatchedWorlds().map((world) => world.changes)).toEqual([[EN_FILE], [EN_FILE]]);
  });
});
