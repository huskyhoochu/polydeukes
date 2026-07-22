import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// ADAPTER-git §4.2 — the git-backed collector reads a real staging area.
import { collectStagedChanges, type StagedChange } from '../src/index.ts';

// ---------------------------------------------------------------------------
// Real throwaway git repositories under os.tmpdir(). These are integration tests:
// the collector's contract is defined against actual `git diff --cached` output and
// blob reads, so a real repo is the only honest fixture. user.email/user.name are set
// locally so commits succeed in a clean CI environment.
// ---------------------------------------------------------------------------

let repoRoot: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf-8' });
}

function write(relPath: string, content: string): void {
  writeFileSync(join(repoRoot, relPath), content);
}

/** Find the single staged change for a path — surfaces "not collected" as undefined. */
function changeFor(changes: StagedChange[], path: string): StagedChange | undefined {
  return changes.find((change) => change.path === path);
}

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'pdks-git-'));
  git('init', '--quiet');
  git('config', 'user.email', 'test@polydeukes.local');
  git('config', 'user.name', 'Polydeukes Test');
  git('config', 'commit.gpgsign', 'false');
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('§4.2 collectStagedChanges — modified file', () => {
  it('reports a modified file with pre=HEAD content and post=staged content', () => {
    // Mutation caught: pre read from the worktree instead of HEAD, or post/pre swapped.
    write('a.txt', 'first\n');
    git('add', 'a.txt');
    git('commit', '--quiet', '-m', 'initial');
    write('a.txt', 'second\n');
    git('add', 'a.txt');

    const change = changeFor(collectStagedChanges(repoRoot), 'a.txt');

    expect(change).toEqual({
      path: 'a.txt',
      status: 'modified',
      pre: 'first\n',
      post: 'second\n',
    });
  });
});

describe('§4.2 collectStagedChanges — added file', () => {
  it('reports a newly staged file as added with pre=null', () => {
    // Mutation caught: added misreported as modified, or pre defaulted to '' instead of
    // null (the delta layer distinguishes "no prior file" from "empty prior file").
    write('base.txt', 'base\n');
    git('add', 'base.txt');
    git('commit', '--quiet', '-m', 'initial');
    write('fresh.txt', 'brand new\n');
    git('add', 'fresh.txt');

    const change = changeFor(collectStagedChanges(repoRoot), 'fresh.txt');

    expect(change).toEqual({
      path: 'fresh.txt',
      status: 'added',
      pre: null,
      post: 'brand new\n',
    });
  });
});

describe('§4.2 collectStagedChanges — deleted file', () => {
  it('reports a staged deletion with status deleted and post=null', () => {
    // Mutation caught: deletion dropped from the diff, or post read as the (absent) staged
    // blob and coerced to '' instead of null.
    write('doomed.txt', 'to be removed\n');
    git('add', 'doomed.txt');
    git('commit', '--quiet', '-m', 'initial');
    git('rm', '--quiet', 'doomed.txt');

    const change = changeFor(collectStagedChanges(repoRoot), 'doomed.txt');

    expect(change).toEqual({
      path: 'doomed.txt',
      status: 'deleted',
      pre: 'to be removed\n',
      post: null,
    });
  });
});

describe('§4.2 collectStagedChanges — staged then re-edited in the worktree', () => {
  it('reads post from the STAGED blob, not the current worktree content', () => {
    // P0 (load-bearing for a pre-commit adapter): after `git add`, the file is edited
    // again in the worktree. The judgment must see what will actually be committed (the
    // staged blob), never the newer worktree bytes. Mutation caught: post read via
    // `git show HEAD:<path>` mistakenly pointing at the worktree, or reading the file
    // from disk instead of `git show :<path>`.
    write('staged.txt', 'committed version\n');
    git('add', 'staged.txt');
    // Diverge the worktree from the index AFTER staging.
    write('staged.txt', 'later worktree edit that must not be judged\n');

    const change = changeFor(collectStagedChanges(repoRoot), 'staged.txt');

    expect(change?.status).toBe('added');
    expect(change?.post).toBe('committed version\n');
  });
});

describe('§4.2 collectStagedChanges — first commit with no HEAD', () => {
  it('reports every staged file as added with pre=null when HEAD is absent', () => {
    // Boundary: a repo with no commits has no HEAD blob. The collector must narrow to
    // "best judgeable" (all added, pre=null), never throw. Mutation caught: a `git show
    // HEAD:<path>` failure bubbling as an exception instead of yielding added.
    write('one.txt', 'one\n');
    write('two.txt', 'two\n');
    git('add', 'one.txt', 'two.txt');

    const changes = collectStagedChanges(repoRoot);

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

describe('§4.2 collectStagedChanges — empty staging area', () => {
  it('returns an empty array when nothing is staged', () => {
    // Boundary: no staged changes → []. Mutation caught: returning worktree-dirty or
    // committed files as if they were staged.
    write('committed.txt', 'content\n');
    git('add', 'committed.txt');
    git('commit', '--quiet', '-m', 'initial');
    // Worktree change left UNSTAGED — must not appear.
    write('committed.txt', 'dirty but not staged\n');

    expect(collectStagedChanges(repoRoot)).toEqual([]);
  });
});
