import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { observationSourceReader } from '../src/observation-source-reader.ts';

// The commit surface's supply reader: `observationSourceReader({ repoRoot, observation })`
// answers a repo-relative path the way the observation sees the tree — `staged` reads the
// index blob, `worktree` the disk, `range` the `<to>` commit's blob. Three different texts
// can sit on one path at the same instant, which is why the observation, not the disk,
// decides which one a declaration judges. Anything the observed tree holds but cannot give
// as judgeable text — no entry, a directory, a NUL-carrying blob — is absence
// (`undefined`); a git failure throws, fail-closed. Real throwaway git repositories are
// the fixture, as in the collector suites.

// Paths and contents are fixture values.
const FILE = 'locales/en.json';
const BASE_CONTENT = '{"base":true}\n';
const HEAD_CONTENT = '{"head":true}\n';
const INDEX_CONTENT = '{"index":true}\n';
const DISK_CONTENT = '{"disk":true}\n';
const DIR_PATH = 'locales/nested';
const DIR_INNER = 'locales/nested/inner.json';
const BINARY_FILE = 'assets/blob.bin';
const LOCKED_FILE = 'secrets/locked.json';

let repoRoot: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf-8' });
}

function write(relPath: string, content: string | Buffer): void {
  const absolute = join(repoRoot, relPath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

/** The reader for one observation of the fixture repository. */
function readerFor(
  observation:
    | { kind: 'staged' }
    | { kind: 'worktree' }
    | { kind: 'range'; base: string; head: string; ancestry?: 'merge-base' },
) {
  return observationSourceReader({ repoRoot, observation });
}

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'pdks-git-read-'));
  git('init', '--quiet');
  git('config', 'user.email', 'test@polydeukes.local');
  git('config', 'user.name', 'Polydeukes Test');
  git('config', 'commit.gpgsign', 'false');
});

afterEach(() => {
  try {
    chmodSync(join(repoRoot, LOCKED_FILE), 0o600);
  } catch {
    // No permission fixture in this test.
  }
  rmSync(repoRoot, { recursive: true, force: true });
});

/**
 * Four contents on one path at once: base commit, head commit, index, disk — so each
 * observation's answer is distinguishable from every other's. Returns the base commit sha.
 */
function fourWaySplit(): string {
  write(FILE, BASE_CONTENT);
  git('add', FILE);
  git('commit', '--quiet', '-m', 'base');
  const base = git('rev-parse', 'HEAD').trim();
  write(FILE, HEAD_CONTENT);
  git('add', FILE);
  git('commit', '--quiet', '-m', 'head');
  write(FILE, INDEX_CONTENT);
  git('add', FILE);
  write(FILE, DISK_CONTENT);
  return base;
}

describe('observationSourceReader — three observations, three texts on one path', () => {
  it('staged reads the index blob — not HEAD, not the disk', () => {
    // The index is what the commit will contain. A reader over the disk hands the judge
    // an edit the commit does not carry; one over HEAD, the state the commit replaces.
    fourWaySplit();

    expect(readerFor({ kind: 'staged' })(FILE)).toBe(INDEX_CONTENT);
  });

  it('worktree reads the disk — not the index', () => {
    // The diagnostic observation judges what is actually in the tree; a single reader
    // built for the staged observation reads the index here.
    fourWaySplit();

    expect(readerFor({ kind: 'worktree' })(FILE)).toBe(DISK_CONTENT);
  });

  it('range reads the <to> commit blob — not <from>, not the index, not the disk', () => {
    // A range judges what the head commit contains. All four contents differ in this
    // fixture, so only the `<to>` blob lands the pinned text.
    const base = fourWaySplit();

    expect(readerFor({ kind: 'range', base, head: 'HEAD' })(FILE)).toBe(HEAD_CONTENT);
  });
});

describe('observationSourceReader — absence per observation', () => {
  it('staged: a path the index does not list is absent, even when it sits on disk', () => {
    // An untracked scratch file must not fail the run; the supply policy disposes of the
    // absence.
    fourWaySplit();
    write('locales/fresh.json', 'fresh\n');

    expect(readerFor({ kind: 'staged' })('locales/fresh.json')).toBeUndefined();
  });

  it('staged: a directory is absent — the listing names its entries, never the directory', () => {
    // Both git listings answer a directory with the entries under it rather than nothing,
    // so a reader that takes the first entry hands the judge the INNER file's text under
    // the directory's path.
    write(DIR_INNER, '{}\n');
    git('add', DIR_INNER);

    expect(readerFor({ kind: 'staged' })(DIR_PATH)).toBeUndefined();
  });

  it('staged: an index blob carrying NUL bytes is absent, not a lossy decode', () => {
    write(BINARY_FILE, Buffer.from('ab\0cd'));
    git('add', BINARY_FILE);

    expect(readerFor({ kind: 'staged' })(BINARY_FILE)).toBeUndefined();
  });

  it('staged: a symlink entry is absent — its blob is the link target, not the file text', () => {
    // The index stores a symlink as a 120000-mode entry whose blob is the TARGET PATH as
    // a string; supplying that string as the file's text judges 'en.json' where a locale
    // was expected. Only the entry's mode separates the two — the blob itself reads fine.
    // The plain file beside it refutes a reader that answers absence for everything.
    write(FILE, DISK_CONTENT);
    symlinkSync('en.json', join(repoRoot, 'locales/link.json'));
    git('add', FILE, 'locales/link.json');
    const read = readerFor({ kind: 'staged' });

    expect(read('locales/link.json')).toBeUndefined();
    expect(read(FILE)).toBe(DISK_CONTENT);
  });

  it('staged: a submodule gitlink entry is absent — a commit object is not a blob', () => {
    // A gitlink (160000-mode) names a commit, usually of ANOTHER repository; reading it
    // as a blob throws even when the object exists here. The reader must refuse by mode
    // before any object read, or one submodule fails every staged run closed. The
    // cacheinfo plant stages a gitlink without cloning a real submodule.
    write(FILE, DISK_CONTENT);
    git('add', FILE);
    git('commit', '--quiet', '-m', 'baseline');
    const sha = git('rev-parse', 'HEAD').trim();
    git('update-index', '--add', '--cacheinfo', `160000,${sha},vendor/dep`);
    const read = readerFor({ kind: 'staged' });

    expect(read('vendor/dep')).toBeUndefined();
    expect(read(FILE)).toBe(DISK_CONTENT);
  });

  it('staged: a conflicted entry is absent — stage 1 is the merge base, a text nobody commits', () => {
    // During an unresolved merge `ls-files --stage` lists stages 1..3 in order, and the
    // first record is the common ancestor's blob. Reading it would judge a declaration
    // against pre-merge text; absence hands the case to the supply policy instead.
    write(FILE, BASE_CONTENT);
    git('add', FILE);
    git('commit', '--quiet', '-m', 'base');
    git('checkout', '--quiet', '-b', 'side');
    write(FILE, '{"side":true}\n');
    git('add', FILE);
    git('commit', '--quiet', '-m', 'side');
    git('checkout', '--quiet', '-');
    write(FILE, HEAD_CONTENT);
    git('add', FILE);
    git('commit', '--quiet', '-m', 'ours');
    try {
      git('merge', '--quiet', 'side');
    } catch {
      // The conflict is the fixture.
    }

    expect(readerFor({ kind: 'staged' })(FILE)).toBeUndefined();
  });

  it('range: a symlink entry is absent — ls-tree reports it as a blob, only the mode tells', () => {
    // `type !== 'blob'` alone does not refuse a symlink (git lists it as type blob, mode
    // 120000); without the mode check the link TARGET STRING would be supplied as the
    // file's text. This pins the range branch's own guard — the staged branch has its own.
    write('messages/en.json', HEAD_CONTENT);
    symlinkSync('messages/en.json', join(repoRoot, FILE.replace('locales/', '')));
    write(FILE, BASE_CONTENT);
    git('add', '--all');
    git('commit', '--quiet', '-m', 'base');
    const base = git('rev-parse', 'HEAD').trim();
    rmSync(join(repoRoot, FILE));
    symlinkSync('../messages/en.json', join(repoRoot, FILE));
    git('add', '--all');
    git('commit', '--quiet', '-m', 'link');

    expect(readerFor({ kind: 'range', base, head: 'HEAD' })(FILE)).toBeUndefined();
  });

  it('range: a path absent from <to> is absent, even when it sits on disk', () => {
    const base = fourWaySplit();
    write('locales/fresh.json', 'fresh\n');

    expect(readerFor({ kind: 'range', base, head: 'HEAD' })('locales/fresh.json')).toBeUndefined();
  });

  it('throws when the directory is not a git repository — fail-closed, never absence', () => {
    // A broken repository answering "every file is absent" would let every `supply: pass`
    // declaration skip and every `error` one blame the change; the run must fail closed
    // on its own wiring instead.
    const bare = mkdtempSync(join(tmpdir(), 'pdks-not-a-repo-'));
    try {
      expect(() =>
        observationSourceReader({ repoRoot: bare, observation: { kind: 'staged' } })(FILE),
      ).toThrow();
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});

describe('observationSourceReader — the worktree absence table (twin of the session reader)', () => {
  // The session surface's disk reader pins the same table in its own package: the two
  // cannot depend on each other, so the shared absence semantics are pinned twice.
  it('answers the disk text verbatim, and the empty string for an empty file', () => {
    write(FILE, DISK_CONTENT);
    write('locales/empty.json', '');
    const read = readerFor({ kind: 'worktree' });

    expect(read(FILE)).toBe(DISK_CONTENT);
    expect(read('locales/empty.json')).toBe('');
  });

  it('answers undefined for ENOENT, a directory, a path through a file, and NUL bytes', () => {
    write(FILE, DISK_CONTENT);
    mkdirSync(join(repoRoot, DIR_PATH), { recursive: true });
    write(BINARY_FILE, Buffer.from('ab\0cd'));
    const read = readerFor({ kind: 'worktree' });

    expect(read('locales/missing.json')).toBeUndefined();
    expect(read(DIR_PATH)).toBeUndefined();
    expect(read(`${FILE}/inner.json`)).toBeUndefined();
    expect(read(BINARY_FILE)).toBeUndefined();
  });

  it.skipIf(typeof process.getuid === 'function' && process.getuid() === 0)(
    'throws on a permission refusal — not absence',
    () => {
      // EACCES folded into absence lets a declaration skip a file the root could not
      // read. Skipped as root, which no mode can refuse.
      write(LOCKED_FILE, DISK_CONTENT);
      chmodSync(join(repoRoot, LOCKED_FILE), 0o000);

      expect(() => readerFor({ kind: 'worktree' })(LOCKED_FILE)).toThrow();
    },
  );
});
