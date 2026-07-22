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

function git(repoRoot: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf-8' });
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
  const listing = git(repoRoot, ['diff', '--cached', '--name-status', '-z']);
  const tokens = listing.split('\0').filter((token) => token !== '');

  const changes: StagedChange[] = [];
  for (let index = 0; index < tokens.length; ) {
    const rawStatus = tokens[index++] as string;
    // R/C entries carry two paths (source then destination) — consume both so the
    // token stream stays aligned, and judge the destination as a write.
    if (rawStatus.startsWith('R') || rawStatus.startsWith('C')) {
      index++;
    }
    const path = tokens[index++] as string;

    if (rawStatus === 'D') {
      changes.push({
        path,
        status: 'deleted',
        pre: git(repoRoot, ['show', `HEAD:${path}`]),
        post: null,
      });
      continue;
    }

    const existsInHead = hasHead && rawStatus === 'M';
    changes.push({
      path,
      status: existsInHead ? 'modified' : 'added',
      pre: existsInHead ? git(repoRoot, ['show', `HEAD:${path}`]) : null,
      post: git(repoRoot, ['show', `:${path}`]),
    });
  }

  return changes;
}
