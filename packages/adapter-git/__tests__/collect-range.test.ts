import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// DIAG-01 §4.1 / §5 AC-2 RED phase — the ref-range collector: pre = `<base>:<path>`,
// post = `<head>:<path>`. `A..B` takes base = A; `A...B` takes base = merge-base(A, B).
// An unresolvable ref throws (fail-closed at the runner).
import { collectRangeChanges, type StagedChange } from '../src/index.ts';

let repoRoot: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf-8' }).trim();
}

function write(relPath: string, content: string): void {
  writeFileSync(join(repoRoot, relPath), content);
}

/** Commit one file and return the commit's sha. */
function commitFile(relPath: string, content: string): string {
  write(relPath, content);
  git('add', relPath);
  git('commit', '--quiet', '-m', `write ${relPath}`);
  return git('rev-parse', 'HEAD');
}

function changeFor(changes: StagedChange[], path: string): StagedChange | undefined {
  return changes.find((change) => change.path === path);
}

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'pdks-git-range-'));
  git('init', '--quiet', '-b', 'main');
  git('config', 'user.email', 'test@polydeukes.local');
  git('config', 'user.name', 'Polydeukes Test');
  git('config', 'commit.gpgsign', 'false');
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('§5 AC-2 collectRangeChanges — two-dot range', () => {
  it('reads pre from the base ref blob and post from the head ref blob, ignoring index and disk', () => {
    // Mutation caught: pre/post read from HEAD/index/disk (any of the other collectors'
    // sources) instead of the two named refs. Index and disk each hold a distinct version
    // so every wrong source produces a different answer.
    const base = commitFile('a.txt', 'one\n');
    const head = commitFile('a.txt', 'two\n');
    write('a.txt', 'staged three\n');
    git('add', 'a.txt');
    write('a.txt', 'disk four\n');

    const change = changeFor(collectRangeChanges(repoRoot, `${base}..${head}`), 'a.txt');

    expect(change).toEqual({
      path: 'a.txt',
      status: 'modified',
      pre: 'one\n',
      post: 'two\n',
    });
  });

  it('reports a file created between the refs as added with pre=null', () => {
    // Mutation caught: an absent base blob coerced to '' rather than null, or the A
    // status mapped to modified.
    const base = commitFile('base.txt', 'base\n');
    const head = commitFile('fresh.txt', 'new\n');

    expect(changeFor(collectRangeChanges(repoRoot, `${base}..${head}`), 'fresh.txt')).toEqual({
      path: 'fresh.txt',
      status: 'added',
      pre: null,
      post: 'new\n',
    });
  });

  it('reports a file removed between the refs as deleted with post=null', () => {
    // Mutation caught: the deletion dropped from the listing, or post read from HEAD's
    // (absent) blob and coerced to ''.
    const base = commitFile('doomed.txt', 'gone soon\n');
    git('rm', '--quiet', 'doomed.txt');
    git('commit', '--quiet', '-m', 'remove');
    const head = git('rev-parse', 'HEAD');

    expect(changeFor(collectRangeChanges(repoRoot, `${base}..${head}`), 'doomed.txt')).toEqual({
      path: 'doomed.txt',
      status: 'deleted',
      pre: 'gone soon\n',
      post: null,
    });
  });
});

describe('§5 AC-2 collectRangeChanges — three-dot range uses the merge-base', () => {
  it('takes pre from merge-base(A, B) under A...B, while A..B takes pre from A itself', () => {
    // Mutation caught: `...` parsed as `..` (base = A's tip), the exact bug that would
    // judge a PR against main's newest commit and report main's own edits as the PR's.
    // The branches diverge on the SAME file so the two forms yield different `pre`.
    commitFile('a.txt', 'base\n');
    git('checkout', '--quiet', '-b', 'feature');
    commitFile('a.txt', 'feature\n');
    git('checkout', '--quiet', 'main');
    commitFile('a.txt', 'main\n');

    const threeDot = changeFor(collectRangeChanges(repoRoot, 'main...feature'), 'a.txt');
    const twoDot = changeFor(collectRangeChanges(repoRoot, 'main..feature'), 'a.txt');

    expect(threeDot).toEqual({
      path: 'a.txt',
      status: 'modified',
      pre: 'base\n',
      post: 'feature\n',
    });
    expect(twoDot).toEqual({
      path: 'a.txt',
      status: 'modified',
      pre: 'main\n',
      post: 'feature\n',
    });
  });
});

describe('§5 AC-2 collectRangeChanges — unresolvable ref', () => {
  it('throws when one side of the range does not exist', () => {
    // Fail-closed: a git failure must surface as a throw so the runner records one
    // blocked row. Mutation caught: the git error swallowed into [] (exit 0 on a typo).
    // The thrown message must carry git's own naming of the ref, so a throw for some
    // other reason (an absent export, a spawn failure) does not satisfy this.
    const head = commitFile('a.txt', 'one\n');

    expect(() => collectRangeChanges(repoRoot, `no-such-ref..${head}`)).toThrow(/no-such-ref/);
  });
});

describe('§5 AC-2 collectRangeChanges — identical refs', () => {
  it('returns an empty array for HEAD..HEAD', () => {
    // Boundary: nothing between the refs → []. Mutation caught: a listing that diffs
    // against the empty tree and reports every committed file.
    commitFile('a.txt', 'one\n');

    expect(collectRangeChanges(repoRoot, 'HEAD..HEAD')).toEqual([]);
  });
});

describe('§5 AC-2 collectRangeChanges — unresolvable head ref', () => {
  it('throws naming the ref when the head side of the range does not exist', () => {
    // The two sides resolve on different code paths (base may pass through merge-base,
    // head never does). Mutation caught: only the base side validated, the head side
    // falling back to HEAD or the worktree — a typo in the PR tip judged as clean.
    commitFile('a.txt', 'one\n');

    expect(() => collectRangeChanges(repoRoot, 'HEAD..no-such-ref')).toThrow(/no-such-ref/);
  });
});

describe('§5 AC-2 collectRangeChanges — three-dot range with no common ancestor', () => {
  it('throws for A...B when the two refs share no merge-base', () => {
    // §7 risk 3: merge-base fails on unrelated histories and the collector must fail
    // closed. Mutation caught: an empty merge-base output taken as "no base" and the
    // range reported as [] (exit 0 on a diff nobody computed), or coerced to the empty
    // tree so the whole other history is judged as additions.
    commitFile('a.txt', 'one\n');
    const mainBranch = git('rev-parse', '--abbrev-ref', 'HEAD');
    git('checkout', '--quiet', '--orphan', 'other');
    git('rm', '--quiet', '-rf', '.');
    commitFile('b.txt', 'two\n');

    // git's own failing command must be what the message names, so a throw for another
    // reason (an absent export) does not satisfy this.
    expect(() => collectRangeChanges(repoRoot, `${mainBranch}...other`)).toThrow(/merge-base/);
  });
});

describe('§5 AC-2 collectRangeChanges — binary on either side', () => {
  const BINARY = Buffer.from([0x50, 0x00, 0xff, 0xfe, 0x01]);

  function commitBytes(relPath: string, bytes: Buffer | string): string {
    writeFileSync(join(repoRoot, relPath), bytes);
    git('add', relPath);
    git('commit', '--quiet', '-m', `write ${relPath}`);
    return git('rev-parse', 'HEAD');
  }

  it('yields pre=null and post=text when the base blob is binary and the head blob is text', () => {
    // Mutation caught: the NUL heuristic applied to the head read only — a binary base
    // decoded with U+FFFD noise feeds the delta judge a fabricated "removed" side.
    const base = commitBytes('blob', BINARY);
    const head = commitBytes('blob', 'now text\n');

    expect(changeFor(collectRangeChanges(repoRoot, `${base}..${head}`), 'blob')).toEqual({
      path: 'blob',
      status: 'modified',
      pre: null,
      post: 'now text\n',
    });
  });

  it('yields pre=text and post=null when the base blob is text and the head blob is binary', () => {
    // Mutation caught: the heuristic applied to the base read only — a forbidden pattern
    // mangled by lossy decoding of the head blob slips past the delta judge (fail-open).
    const base = commitBytes('blob', 'was text\n');
    const head = commitBytes('blob', BINARY);

    expect(changeFor(collectRangeChanges(repoRoot, `${base}..${head}`), 'blob')).toEqual({
      path: 'blob',
      status: 'modified',
      pre: 'was text\n',
      post: null,
    });
  });
});

describe('§5 AC-2 collectRangeChanges — rename between refs surfaces as delete + add', () => {
  it('reports a 100% identical rename as the source deleted and the destination added', () => {
    // Mutation caught: `--no-renames` dropped from the range listing — git would emit
    // one R100 row, the source would never be judged at its protected location, and
    // the status parser would meet a letter it has no mapping for.
    const base = commitFile('protected-here.txt', 'locked content\n');
    git('mv', 'protected-here.txt', 'elsewhere.txt');
    git('commit', '--quiet', '-m', 'move');
    const head = git('rev-parse', 'HEAD');

    const changes = collectRangeChanges(repoRoot, `${base}..${head}`);

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

describe('§5 AC-2 collectRangeChanges — blob over 1MB between refs', () => {
  it('collects a large head blob instead of failing on the spawn buffer default', () => {
    // collect.test.ts "staged blob over 1MB" precedent: execFileSync caps stdout at 1MB
    // unless overridden, so a lockfile-sized blob would throw ENOBUFS and the runner
    // would fail the whole range closed. Mutation caught: the maxBuffer override missing
    // from the ref-blob read path.
    const twoMegabytes = 'x'.repeat(2 * 1024 * 1024);
    const base = commitFile('big.txt', 'small\n');
    const head = commitFile('big.txt', twoMegabytes);

    const change = changeFor(collectRangeChanges(repoRoot, `${base}..${head}`), 'big.txt');

    expect(change?.post?.length).toBe(twoMegabytes.length);
  });
});

// PR #67 review — inputs git itself treats specially.
describe('PR #67 review — a ref that also names a file', () => {
  it('judges the range when a branch and a root file share the name', () => {
    commitFile('base.txt', 'base\n');
    git('branch', 'amb');
    commitFile('base.txt', 'changed\n');
    write('amb', 'a file, not a ref\n');

    const change = changeFor(collectRangeChanges(repoRoot, 'amb..HEAD'), 'base.txt');
    expect(change).toEqual({
      path: 'base.txt',
      status: 'modified',
      pre: 'base\n',
      post: 'changed\n',
    });
  });
});

describe('PR #67 review — a type change (T) keeps its pre side', () => {
  it('reports a symlink replaced by a regular file as modified with pre=the link target', () => {
    commitFile('base.txt', 'base\n');
    symlinkSync('base.txt', join(repoRoot, 'link'));
    git('add', 'link');
    git('commit', '--quiet', '-m', 'link');
    unlinkSync(join(repoRoot, 'link'));
    write('link', 'now a file\n');
    git('add', 'link');
    git('commit', '--quiet', '-m', 'file');

    const change = changeFor(collectRangeChanges(repoRoot, 'HEAD~1..HEAD'), 'link');
    expect(change).toEqual({
      path: 'link',
      status: 'modified',
      pre: 'base.txt',
      post: 'now a file\n',
    });
  });
});
