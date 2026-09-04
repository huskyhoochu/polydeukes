import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { collectStagedChanges } from '@polydeukes/adapter-git';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// The commit root's `plan → supply → dispatch` wiring. After the
// registrations are assembled the root plans the sources they name, reads each one THE
// WAY ITS DOMAIN OBSERVES THE TREE (staged: the index, worktree: disk, range: the `<to>`
// commit), and hands every per-change dispatch one `world`: the supplied files plus the
// whole collected change set. The kernel never opens the tree — the root's `read` is the
// only place the domain distinction lives, so it is the only place it can be wrong.
//
// The dispatcher and the two supply verbs are observed through a recording dist injected
// on the `covenantDist` seam (helpers.ts `recordingDist`): the real judges still run, and
// every spec's `world` is written down before it reaches them. Each case is a real
// throwaway git repository whose config carries its own declare entry; nothing of THIS
// repository is referenced.
import { runCovenantCheck } from '../src/covenant-check.ts';
import {
  type CheckRepo,
  createCheckRepo,
  type RecordedCall,
  recordingDist,
  telemetryRows,
} from './helpers.ts';

/** Injected fixture values — the declare entry and the files its sources name. */
const DECLARE_ID = 'en-locale-has-keys';
const SOURCE_NAME = 'en';
const EN_FILE = 'locales/en.json';
/** Planned by the recording dist, never present in any observed tree. */
const MISSING_FILE = 'locales/missing.json';
/** The umbrella's protected-paths registration label — an observable contract, not a fixture choice. */
const SELF_MOD_LABEL = 'self-mod';
/** Three distinct texts for the three places one path can hold content at once. */
const HEAD_CONTENT = '{"head":true}\n';
const INDEX_CONTENT = '{"index":true}\n';
const DISK_CONTENT = '{"disk":true}\n';
const RANGE_BRANCH = 'observed';
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
/** Everything the run must not observe lives outside the repository: telemetry, the dist, its log. */
let outside: string;
let telemetryPath: string;
let calls: () => RecordedCall[];
let covenantDist: string;

beforeEach(() => {
  repo = createCheckRepo('pdks-check-world-axis-');
  ({ repoRoot, git, write, writeConfig } = repo);
  outside = mkdtempSync(join(tmpdir(), 'pdks-check-world-axis-outside-'));
  telemetryPath = join(outside, 'roi.log');
  ({ distDir: covenantDist, calls } = recordingDist(outside, [EN_FILE, MISSING_FILE]));
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

describe('covenant check — the read follows the domain', () => {
  it('staged: the world carries the INDEX blob of a planned file, and no key for a planned file the index lacks', async () => {
    // Three contents sit on one path at once — HEAD, index, disk — and only the index is
    // what the commit will contain. A `read` over the disk hands the judge an edit the
    // commit does not carry; one over HEAD hands it the state the commit replaces. The
    // missing file kills a `read` that folds git's exit 128 into '' or null instead of
    // leaving the key absent — the `supply` policy can only dispose of absence it can see.
    commitBaseline();
    write(EN_FILE, INDEX_CONTENT);
    git('add', EN_FILE);
    write(EN_FILE, DISK_CONTENT);

    const result = await runCovenantCheck({ repoRoot, telemetryPath, covenantDist });

    expectJudged(result);
    expect(dispatchedWorlds().map((world) => world.files)).toEqual([{ [EN_FILE]: INDEX_CONTENT }]);
  });

  it('worktree: the world carries the DISK text of a planned file, and no key for one the disk lacks', async () => {
    // The same three-way split observed from the worktree arm: here disk is the truth and
    // the index is the wrong source. A root that built one `read` for every domain — the
    // staged one, say — leaves this case reading the index. `changes` must ride this arm
    // too: a root that fills it in the staged loop alone leaves the diagnostic domains
    // with a one-element derivation.
    commitBaseline();
    write(EN_FILE, INDEX_CONTENT);
    git('add', EN_FILE);
    write(EN_FILE, DISK_CONTENT);

    const result = await runCovenantCheck({
      repoRoot,
      telemetryPath,
      covenantDist,
      domain: { kind: 'worktree' },
    });

    expectJudged(result);
    expect(dispatchedWorlds().map((world) => [world.files, world.changes])).toEqual([
      [{ [EN_FILE]: DISK_CONTENT }, [EN_FILE]],
    ]);
  });

  it('range: the world carries the `<to>` commit blob of a planned file, not `<from>` and not the disk', async () => {
    // A range judges what the `<to>` commit contains. Reading `<from>` compares the
    // change against the state it replaced; reading the disk mixes in edits no commit in
    // the range holds. All three differ here, so only `git show <to>:<path>` lands the
    // pinned text.
    const base = commitBaseline();
    git('checkout', '--quiet', '-b', RANGE_BRANCH);
    write(EN_FILE, INDEX_CONTENT);
    git('add', EN_FILE);
    git('commit', '--quiet', '-m', 'observed');
    write(EN_FILE, DISK_CONTENT);

    const result = await runCovenantCheck({
      repoRoot,
      telemetryPath,
      covenantDist,
      domain: { kind: 'range', base, head: RANGE_BRANCH },
    });

    expectJudged(result);
    expect(dispatchedWorlds().map((world) => [world.files, world.changes])).toEqual([
      [{ [EN_FILE]: INDEX_CONTENT }, [EN_FILE]],
    ]);
  });
});

describe('covenant check — the change set is the whole observation, on every dispatch', () => {
  it('three staged changes dispatch three times, each carrying the same three paths in collection order', async () => {
    // The commit root dispatches once per change so every change leaves its own row, and
    // that is exactly why the judge cannot derive the change set from its input — the
    // input holds one change. A root that passes each dispatch its own path (or omits
    // `changes`) turns every `Implies` over the change set into a one-element vacuity:
    // the `*.md ⇒ *.ko.md` pairing never finds a pair and never finds one missing. The
    // order is the collector's, so the judge's witnesses keep the observation's order.
    commitBaseline();
    write(EN_FILE, INDEX_CONTENT);
    write('notes/a.txt', 'a\n');
    write('notes/b.txt', 'b\n');
    git('add', EN_FILE, 'notes/a.txt', 'notes/b.txt');
    const collected = collectStagedChanges({ repoRoot: repoRoot }).map((change) => change.path);
    expect(collected).toHaveLength(3);

    const result = await runCovenantCheck({ repoRoot, telemetryPath, covenantDist });

    expectJudged(result);
    expect(dispatchedWorlds().map((world) => world.changes)).toEqual([
      collected,
      collected,
      collected,
    ]);
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
    write(EN_FILE, INDEX_CONTENT);
    git('add', EN_FILE);

    const result = await runCovenantCheck({ repoRoot, telemetryPath, covenantDist });

    expectJudged(result);
    const plans = calls().filter((call) => call.kind === 'plan');
    expect(plans).toHaveLength(1);
    expect(plans[0]?.labels).toEqual(expect.arrayContaining([DECLARE_ID, SELF_MOD_LABEL]));
  });
});

/** A planned path that is a directory, the file inside it, and two more shapes a path can hold. */
const DIR_PATH = 'locales/nested';
const DIR_INNER = 'locales/nested/inner.json';
const BINARY_FILE = 'assets/blob.bin';
/** On disk only — committed nowhere, staged nowhere. */
const FRESH_FILE = 'locales/fresh.json';
const BINARY_CONTENT = Buffer.from('ab\0cd');

/** Write bytes the collectors classify as binary (a NUL inside) at a repo-relative path. */
function writeBinary(relPath: string): void {
  const absolute = join(repoRoot, relPath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, BINARY_CONTENT);
}

/** Commit the nested directory on top of the baseline, so HEAD and the disk both hold it. */
function commitNestedDirectory(): void {
  write(DIR_INNER, '{}\n');
  git('add', DIR_INNER);
  git('commit', '--quiet', '-m', 'nested');
}

describe('covenant check — a planned path the domain cannot give as text is an absence, not a refusal', () => {
  // The defect class is fail-closed on a mere absence: a path that is a directory, a
  // binary blob, or a file git can see on disk but not in the observed tree is not a
  // text a declaration can parse, and refusing the whole run for it turns every commit
  // in the repository into a witness prompt. Each case keeps the planned locale beside
  // the odd path, so a `read` that answers absence for everything on any failure is
  // refuted by the locale's text still landing.
  it('worktree: a planned path that is a directory on disk yields no key, and the file beside it is read', async () => {
    // `readFileSync` on a directory throws EISDIR; a `read` that folds only ENOENT
    // propagates it and the run lands `supply-error` on a tree that merely has a folder.
    commitBaseline();
    commitNestedDirectory();
    write(EN_FILE, DISK_CONTENT);
    ({ distDir: covenantDist, calls } = recordingDist(outside, [DIR_PATH, EN_FILE]));

    const result = await runCovenantCheck({
      repoRoot,
      telemetryPath,
      covenantDist,
      domain: { kind: 'worktree' },
    });

    expectJudged(result);
    expect(dispatchedWorlds().map((world) => world.files)).toEqual([{ [EN_FILE]: DISK_CONTENT }]);
  });

  it('worktree: a planned path holding NUL bytes on disk yields no key, not a lossy decode', async () => {
    // A utf-8 decode of binary content is still a string; without the NUL check the
    // bytes are supplied as text and `json` breaks the declaration on a file that was
    // never a locale.
    commitBaseline();
    writeBinary(BINARY_FILE);
    write(EN_FILE, DISK_CONTENT);
    ({ distDir: covenantDist, calls } = recordingDist(outside, [BINARY_FILE, EN_FILE]));

    const result = await runCovenantCheck({
      repoRoot,
      telemetryPath,
      covenantDist,
      domain: { kind: 'worktree' },
    });

    expectJudged(result);
    const worlds = dispatchedWorlds();
    expect(worlds.length).toBeGreaterThan(0);
    for (const world of worlds) expect(world.files).toEqual({ [EN_FILE]: DISK_CONTENT });
  });

  it('staged: a planned path that is a directory in HEAD and on disk yields no key, and the run still judges', async () => {
    // The index holds no directory entry, so git refuses `:<dir>` with a message that
    // is not "does not exist": a `read` matching that one phrase throws here and the
    // run fails closed on a folder the repository has always had.
    commitBaseline();
    commitNestedDirectory();
    write(EN_FILE, INDEX_CONTENT);
    git('add', EN_FILE);
    ({ distDir: covenantDist, calls } = recordingDist(outside, [DIR_PATH, EN_FILE]));

    const result = await runCovenantCheck({ repoRoot, telemetryPath, covenantDist });

    expectJudged(result);
    expect(dispatchedWorlds().map((world) => world.files)).toEqual([{ [EN_FILE]: INDEX_CONTENT }]);
  });

  it('range: a planned path that is a directory at <to> yields no key — the tree listing is not a file', async () => {
    // `git show <to>:<dir>` exits 0 and prints a tree listing; a `read` that trusts exit
    // 0 supplies "tree observed:locales/nested\n\ninner.json" as the file's text.
    const base = commitBaseline();
    git('checkout', '--quiet', '-b', RANGE_BRANCH);
    write(DIR_INNER, '{}\n');
    write(EN_FILE, INDEX_CONTENT);
    git('add', DIR_INNER, EN_FILE);
    git('commit', '--quiet', '-m', 'observed');
    ({ distDir: covenantDist, calls } = recordingDist(outside, [DIR_PATH, EN_FILE]));

    const result = await runCovenantCheck({
      repoRoot,
      telemetryPath,
      covenantDist,
      domain: { kind: 'range', base, head: RANGE_BRANCH },
    });

    expectJudged(result);
    const worlds = dispatchedWorlds();
    expect(worlds).toHaveLength(2);
    for (const world of worlds) expect(world.files).toEqual({ [EN_FILE]: INDEX_CONTENT });
  });

  it('range: a planned path on disk but absent from <to> yields no key rather than a refusal', async () => {
    // git answers "exists on disk, but not in '<to>'" with exit 128 — a different phrase
    // from the not-in-index one. A `read` matching the phrase throws, and an untracked
    // scratch file next to the locales fails every range run closed.
    const base = commitBaseline();
    git('checkout', '--quiet', '-b', RANGE_BRANCH);
    write(EN_FILE, INDEX_CONTENT);
    git('add', EN_FILE);
    git('commit', '--quiet', '-m', 'observed');
    write(FRESH_FILE, 'fresh\n');
    ({ distDir: covenantDist, calls } = recordingDist(outside, [FRESH_FILE, EN_FILE]));

    const result = await runCovenantCheck({
      repoRoot,
      telemetryPath,
      covenantDist,
      domain: { kind: 'range', base, head: RANGE_BRANCH },
    });

    expectJudged(result);
    expect(dispatchedWorlds().map((world) => world.files)).toEqual([{ [EN_FILE]: INDEX_CONTENT }]);
  });

  it('staged: a planned path whose index blob carries NUL bytes yields no key', async () => {
    // `git show :<path>` hands back the bytes; decoding them as utf-8 without the NUL
    // check supplies garbage as text, the same lossy decode the collectors already refuse.
    commitBaseline();
    writeBinary(BINARY_FILE);
    write(EN_FILE, INDEX_CONTENT);
    git('add', BINARY_FILE, EN_FILE);
    ({ distDir: covenantDist, calls } = recordingDist(outside, [BINARY_FILE, EN_FILE]));

    const result = await runCovenantCheck({ repoRoot, telemetryPath, covenantDist });

    expectJudged(result);
    const worlds = dispatchedWorlds();
    expect(worlds).toHaveLength(2);
    for (const world of worlds) expect(world.files).toEqual({ [EN_FILE]: INDEX_CONTENT });
  });

  it('staged: a missing planned path is still an absence when the environment names a non-English locale', async () => {
    // git localizes its "does not exist" message; a `read` that recognizes absence by
    // the English phrase refuses every commit on a machine whose LANG is not English.
    // The variables are set on the process the run spawns git from and restored after.
    commitBaseline();
    write(EN_FILE, INDEX_CONTENT);
    git('add', EN_FILE);
    const saved = { LC_ALL: process.env.LC_ALL, LANG: process.env.LANG };
    process.env.LC_ALL = 'ko_KR.UTF-8';
    process.env.LANG = 'fr_FR.UTF-8';
    try {
      const result = await runCovenantCheck({ repoRoot, telemetryPath, covenantDist });

      expectJudged(result);
      expect(dispatchedWorlds().map((world) => world.files)).toEqual([
        { [EN_FILE]: INDEX_CONTENT },
      ]);
    } finally {
      for (const name of ['LC_ALL', 'LANG'] as const) {
        if (saved[name] === undefined) delete process.env[name];
        else process.env[name] = saved[name];
      }
    }
  });
});

describe('covenant check — the change set lists the changes that produce a world', () => {
  it('a staged binary file is dispatched but not listed in changes', async () => {
    // The collector gives a binary staged blob a call with no evidence, so it produces no
    // world of its own; listing its path in `changes` hands the pairing declarations a
    // path no world will ever answer for. The dispatch itself still happens — the path
    // judges still see the call — so the count stays at one per staged change.
    commitBaseline();
    write(EN_FILE, INDEX_CONTENT);
    writeBinary(BINARY_FILE);
    git('add', EN_FILE, BINARY_FILE);
    const collected = collectStagedChanges({ repoRoot: repoRoot }).map((change) => change.path);
    expect(collected).toHaveLength(2);

    const result = await runCovenantCheck({ repoRoot, telemetryPath, covenantDist });

    expectJudged(result);
    expect(dispatchedWorlds().map((world) => world.changes)).toEqual([[EN_FILE], [EN_FILE]]);
  });
});
