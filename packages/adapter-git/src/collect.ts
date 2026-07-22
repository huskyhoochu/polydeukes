/**
 * Git-backed staged-change collector (ADAPTER-git §4.2) — reads a real staging area
 * into the structured shape the pure translation core consumes.
 *
 * Synchronous `git` spawns belong in this package: an adapter accessing its payload
 * source is the same axis as `transcriptFromJsonlFile` reading a file. `pre` comes
 * from the HEAD blob and `post` from the STAGED blob (`git show :<path>`) — never the
 * worktree, which may have diverged after `git add`.
 */

import { execFileSync } from 'node:child_process';

import type { StagedChange } from './index.js';

// maxBuffer everywhere: the default 1MB would throw ENOBUFS on any large staged blob and
// fail the whole commit closed (review F2) — size is not a judgment axis.
function git(repoRoot: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf-8', maxBuffer: Infinity });
}

/**
 * Read one blob as judgeable text, or null for a binary blob (NUL-byte heuristic — the
 * same one git uses). A lossy utf-8 decode would hand the delta judges corrupted bytes,
 * so "no judgeable text" is surfaced as null instead (review F4, PRD §4.2).
 */
function gitBlobText(repoRoot: string, ref: string): string | null {
  const blob = execFileSync('git', ['show', ref], { cwd: repoRoot, maxBuffer: Infinity });
  return blob.includes(0) ? null : blob.toString('utf-8');
}

/** True when the repository has a HEAD commit (false on the unborn first commit). */
function headExists(repoRoot: string): boolean {
  try {
    git(repoRoot, ['rev-parse', '--verify', '--quiet', 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Collect the staged changes of `repoRoot` (PRD §4.2).
 *
 * `git diff --cached --name-status -z` lists the entries; blobs are read per entry.
 * On the unborn first commit (no HEAD) every staged file is `added` with `pre: null`
 * — HEAD absence is detected explicitly, never inferred from a swallowed blob-read
 * failure. An empty staging area yields `[]`.
 */
export function collectStagedChanges(repoRoot: string): StagedChange[] {
  const hasHead = headExists(repoRoot);
  // --no-renames forces D+A reporting: git detects renames by default and would collapse
  // `git mv` into one R entry whose SOURCE path vanishes from judgment — renaming a
  // protected file away must surface as a judged deletion (review F1, PRD §4.1).
  const listing = git(repoRoot, ['diff', '--cached', '--name-status', '-z', '--no-renames']);
  const tokens = listing.split('\0').filter((token) => token !== '');

  const changes: StagedChange[] = [];
  for (let index = 0; index < tokens.length; ) {
    const rawStatus = tokens[index++] as string;
    const path = tokens[index++] as string;

    if (rawStatus === 'D') {
      changes.push({
        path,
        status: 'deleted',
        pre: gitBlobText(repoRoot, `HEAD:${path}`),
        post: null,
      });
      continue;
    }

    const existsInHead = hasHead && rawStatus === 'M';
    changes.push({
      path,
      status: existsInHead ? 'modified' : 'added',
      pre: existsInHead ? gitBlobText(repoRoot, `HEAD:${path}`) : null,
      post: gitBlobText(repoRoot, `:${path}`),
    });
  }

  return changes;
}
