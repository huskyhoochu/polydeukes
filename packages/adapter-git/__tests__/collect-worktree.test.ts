import { execFileSync } from 'node:child_process';
import { mkdtempSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// DIAG-01 §4.1 / §5 AC-1 RED phase — the worktree collector: pre = `HEAD:<path>`, post =
// the bytes on disk, untracked non-ignored files included. Same `StagedChange[]` shape as
// the staged collector, so the translation core stays at zero lines changed.
import { collectWorktreeChanges, type StagedChange } from '../src/index.ts';

// ---------------------------------------------------------------------------
// Real throwaway git repositories (collect.test.ts precedent): the contract is defined
// against actual `git diff HEAD` / `git ls-files --others` output and disk reads.
// ---------------------------------------------------------------------------

let repoRoot: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf-8' });
}

function write(relPath: string, content: string): void {
  writeFileSync(join(repoRoot, relPath), content);
}

/** Find the single change for a path — surfaces "not collected" as undefined. */
function changeFor(changes: StagedChange[], path: string): StagedChange | undefined {
  return changes.find((change) => change.path === path);
}

/** Commit one file so HEAD exists and the file is tracked. */
function commitFile(relPath: string, content: string): void {
  write(relPath, content);
  git('add', relPath);
  git('commit', '--quiet', '-m', `add ${relPath}`);
}

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'pdks-git-worktree-'));
  git('init', '--quiet');
  git('config', 'user.email', 'test@polydeukes.local');
  git('config', 'user.name', 'Polydeukes Test');
  git('config', 'commit.gpgsign', 'false');
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('§5 AC-1 collectWorktreeChanges — modified file', () => {
  it('reports pre=HEAD content and post=the bytes on disk, not the index', () => {
    // Mutation caught: post read from the index (`:<path>`) instead of the disk — the
    // staged collector's behaviour leaking in — or pre/post swapped. The index holds a
    // middle version so the three sources are all distinguishable.
    commitFile('a.txt', 'first\n');
    write('a.txt', 'staged middle\n');
    git('add', 'a.txt');
    write('a.txt', 'on disk\n');

    const change = changeFor(collectWorktreeChanges(repoRoot), 'a.txt');

    expect(change).toEqual({
      path: 'a.txt',
      status: 'modified',
      pre: 'first\n',
      post: 'on disk\n',
    });
  });
});

describe('§5 AC-1 collectWorktreeChanges — untracked file', () => {
  it('reports an untracked, non-ignored file as added with pre=null', () => {
    // Mutation caught: the `ls-files --others` pass dropped, so a brand-new file on disk
    // (the most common worktree state) is never judged — fail-open.
    commitFile('base.txt', 'base\n');
    write('fresh.txt', 'brand new\n');

    const change = changeFor(collectWorktreeChanges(repoRoot), 'fresh.txt');

    expect(change).toEqual({
      path: 'fresh.txt',
      status: 'added',
      pre: null,
      post: 'brand new\n',
    });
  });

  it('omits an untracked file that .gitignore excludes', () => {
    // Mutation caught: `--exclude-standard` dropped, so build output and dependencies
    // would flood the judgment (§7 risk 2 names the cost; the contract is the filter).
    commitFile('.gitignore', 'ignored.txt\n');
    write('ignored.txt', 'noise\n');

    expect(changeFor(collectWorktreeChanges(repoRoot), 'ignored.txt')).toBeUndefined();
  });
});

describe('§5 AC-1 collectWorktreeChanges — file deleted on disk', () => {
  it('reports a tracked file removed from disk (not via git rm) as deleted with post=null', () => {
    // Mutation caught: a missing disk file coerced to '' or thrown on read instead of
    // status deleted / post null — the index still holds the file, so only the disk
    // observation says it is gone.
    commitFile('doomed.txt', 'to be removed\n');
    unlinkSync(join(repoRoot, 'doomed.txt'));

    const change = changeFor(collectWorktreeChanges(repoRoot), 'doomed.txt');

    expect(change).toEqual({
      path: 'doomed.txt',
      status: 'deleted',
      pre: 'to be removed\n',
      post: null,
    });
  });
});

describe('§5 AC-1 collectWorktreeChanges — binary content', () => {
  it('yields null for a binary file on disk instead of lossily decoded text', () => {
    // Mutation caught: the NUL-byte heuristic applied to blob reads but not to the disk
    // read path — a forbidden pattern mangled by U+FFFD replacement slips past the delta
    // judge (fail-open direction, review F4 of the commit adapter).
    commitFile('base.txt', 'base\n');
    writeFileSync(join(repoRoot, 'blob.bin'), Buffer.from([0x50, 0x00, 0xff, 0xfe, 0x01]));

    const change = changeFor(collectWorktreeChanges(repoRoot), 'blob.bin');

    expect(change?.status).toBe('added');
    expect(change?.post).toBeNull();
  });
});

describe('§5 AC-1 collectWorktreeChanges — rename on disk surfaces as delete + add', () => {
  it('reports the rename source as deleted and the destination as added', () => {
    // Mutation caught: rename detection left on (`--no-renames` dropped) or the untracked
    // destination not paired with the tracked-but-missing source — a protected file moved
    // away on disk must still be judged at its protected location.
    commitFile('protected-here.txt', 'locked content\n');
    renameSync(join(repoRoot, 'protected-here.txt'), join(repoRoot, 'elsewhere.txt'));

    const changes = collectWorktreeChanges(repoRoot);

    expect(changeFor(changes, 'protected-here.txt')).toEqual({
      path: 'protected-here.txt',
      status: 'deleted',
      pre: 'locked content\n',
      post: null,
    });
    expect(changeFor(changes, 'elsewhere.txt')).toEqual({
      path: 'elsewhere.txt',
      status: 'added',
      pre: null,
      post: 'locked content\n',
    });
  });
});

describe('§5 AC-1 collectWorktreeChanges — unborn HEAD', () => {
  it('reports every tracked and untracked file as added with pre=null when HEAD is absent', () => {
    // Boundary: `git diff HEAD` fails with no commits. The collector must narrow to "all
    // added" for both the staged file and the untracked one, never throw. Mutation
    // caught: the HEAD failure bubbling, or the staged file dropped because the diff
    // command produced nothing.
    write('one.txt', 'one\n');
    git('add', 'one.txt');
    write('two.txt', 'two\n');

    const changes = collectWorktreeChanges(repoRoot);

    expect(changeFor(changes, 'one.txt')).toEqual({
      path: 'one.txt',
      status: 'added',
      pre: null,
      post: 'one\n',
    });
    expect(changeFor(changes, 'two.txt')).toEqual({
      path: 'two.txt',
      status: 'added',
      pre: null,
      post: 'two\n',
    });
  });
});

describe('§5 AC-1 collectWorktreeChanges — clean worktree', () => {
  it('returns an empty array when disk matches HEAD', () => {
    // Boundary: nothing changed → []. Mutation caught: committed files reported as
    // changes (a diff against the empty tree instead of HEAD).
    commitFile('committed.txt', 'content\n');

    expect(collectWorktreeChanges(repoRoot)).toEqual([]);
  });
});

describe('§5 AC-1 collectWorktreeChanges — file over 1MB on disk', () => {
  it('collects a large modified file with post equal to the disk bytes', () => {
    // collect.test.ts "staged blob over 1MB" precedent: the disk read must not go
    // through a spawn with the 1MB maxBuffer default (`git show`, `git cat-file`), and
    // the HEAD-side read must carry the override. Mutation caught: either read path
    // throwing ENOBUFS and failing the diagnostic closed on a lockfile-sized edit.
    const twoMegabytes = 'x'.repeat(2 * 1024 * 1024);
    commitFile('big.txt', 'small\n');
    write('big.txt', twoMegabytes);

    const change = changeFor(collectWorktreeChanges(repoRoot), 'big.txt');

    expect(change?.status).toBe('modified');
    expect(change?.post).toBe(twoMegabytes);
  });
});

// PR #67 review — three worktree-only inputs the first cut mishandled.
describe('PR #67 review — index-only file removed from disk (status AD)', () => {
  it('reports a file added to the index and then deleted from disk as deleted with pre=null', () => {
    commitFile('base.txt', 'base\n');
    write('n.txt', 'new\n');
    git('add', 'n.txt');
    unlinkSync(join(repoRoot, 'n.txt'));

    const change = changeFor(collectWorktreeChanges(repoRoot), 'n.txt');
    expect(change).toEqual({ path: 'n.txt', status: 'deleted', pre: null, post: null });
  });

  it('reports the same file as deleted, not as added, on the unborn first commit', () => {
    write('f.txt', 'first\n');
    git('add', 'f.txt');
    unlinkSync(join(repoRoot, 'f.txt'));

    expect(collectWorktreeChanges(repoRoot)).toEqual([
      { path: 'f.txt', status: 'deleted', pre: null, post: null },
    ]);
  });
});

describe('PR #67 review — an unreadable path on disk', () => {
  it('yields null content for a dangling symlink instead of refusing the whole domain', () => {
    commitFile('base.txt', 'base\n');
    symlinkSync('/nonexistent/target', join(repoRoot, 'link'));

    const change = changeFor(collectWorktreeChanges(repoRoot), 'link');
    expect(change).toEqual({ path: 'link', status: 'added', pre: null, post: null });
  });
});

describe('PR #67 review — a ref that also names a file', () => {
  it('lists the working tree even when a file at the root is named HEAD', () => {
    commitFile('base.txt', 'base\n');
    write('HEAD', 'not a ref\n');
    write('base.txt', 'changed\n');

    const changes = collectWorktreeChanges(repoRoot);
    expect(changeFor(changes, 'base.txt')?.post).toBe('changed\n');
    expect(changeFor(changes, 'HEAD')?.status).toBe('added');
  });
});
