import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectStagedChanges, type StagedChange } from '../src/index.ts';

// Real throwaway git repositories under os.tmpdir(). The collector's contract is defined
// against actual `git diff --cached` output and blob reads, so a real repo is the only
// honest fixture. user.email/user.name are set locally so commits succeed in a clean CI
// environment.

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
    // pre must be null, never '': the delta layer distinguishes "no prior file" from
    // "empty prior file".
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
    // The judgment must see what will actually be committed — the staged blob — never the
    // newer worktree bytes.
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
    // A repo with no commits has no HEAD blob. The collector must narrow to the best
    // judgeable reading — all added, pre=null — never throw.
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

describe('§4.2 collectStagedChanges — staged rename surfaces as delete + add (review F1)', () => {
  it('reports the rename source as deleted and the destination as added', () => {
    // git enables rename detection by default, collapsing `git mv` into a single R entry
    // whose source path vanishes from judgment — renaming a protected file away would
    // then escape the covenant. `--no-renames` forces D+A so the disappearance from the
    // protected location is judged.
    write('protected-here.txt', 'locked content\n');
    git('add', 'protected-here.txt');
    git('commit', '--quiet', '-m', 'initial');
    git('mv', 'protected-here.txt', 'elsewhere.txt');

    const changes = collectStagedChanges(repoRoot);

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

describe('§4.2 collectStagedChanges — staged blob over 1MB (review F2)', () => {
  it('collects a large staged file instead of failing on the spawn buffer default', () => {
    // execFileSync defaults maxBuffer to 1MB, so `git show :<path>` on a legitimately
    // large staged file (lockfile, fixture, bundle) throws ENOBUFS without the override
    // and the runner fails the whole commit closed.
    const twoMegabytes = 'x'.repeat(2 * 1024 * 1024);
    write('big.txt', twoMegabytes);
    git('add', 'big.txt');

    const change = changeFor(collectStagedChanges(repoRoot), 'big.txt');

    expect(change?.post?.length).toBe(twoMegabytes.length);
  });
});

describe('§4.2 collectStagedChanges — binary staged blob (review F4, PRD §4.2)', () => {
  it('yields null content for a binary blob instead of lossily decoded text', () => {
    // A binary blob decoded as utf-8 replaces invalid sequences with U+FFFD, so a delta
    // judge would scan corrupted bytes and a forbidden pattern could be mangled away —
    // the fail-open direction. No judgeable text content means post=null, with the
    // toolCall still surviving via its status.
    writeFileSync(join(repoRoot, 'blob.bin'), Buffer.from([0x50, 0x00, 0xff, 0xfe, 0x01]));
    git('add', 'blob.bin');

    const change = changeFor(collectStagedChanges(repoRoot), 'blob.bin');

    expect(change?.status).toBe('added');
    expect(change?.post).toBeNull();
  });
});

describe('§4.2 collectStagedChanges — empty staging area', () => {
  it('returns an empty array when nothing is staged', () => {
    write('committed.txt', 'content\n');
    git('add', 'committed.txt');
    git('commit', '--quiet', '-m', 'initial');
    // Worktree change left UNSTAGED — must not appear.
    write('committed.txt', 'dirty but not staged\n');

    expect(collectStagedChanges(repoRoot)).toEqual([]);
  });
});
