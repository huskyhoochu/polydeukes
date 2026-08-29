/**
 * Git-backed change collectors — read a real repository into the structured shape the
 * pure translation core consumes. Three observation points of the same commit surface:
 * the staging area, the working tree, and a ref range.
 *
 * Synchronous `git` spawns belong in this package: an adapter accessing its payload
 * source is the same axis as `transcriptFromJsonlFile` reading a file. Each collector
 * names its own `pre`/`post` sources.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { StagedChange } from './staged.js';

/**
 * Run one `git` command in `repoRoot` and return its stdout. `maxBuffer` is unbounded so
 * a large blob never throws ENOBUFS; stderr is captured, so a failure reaches the caller
 * through the thrown error's message instead of the process's own output.
 */
function git(repoRoot: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf-8',
    maxBuffer: Infinity,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Read one blob as judgeable text, or null for a binary blob (NUL-byte heuristic — the
 * same one git uses). A lossy utf-8 decode would hand the delta judges corrupted bytes,
 * so "no judgeable text" is surfaced as null instead.
 */
function gitBlobText(repoRoot: string, ref: string): string | null {
  const blob = execFileSync('git', ['show', ref], {
    cwd: repoRoot,
    maxBuffer: Infinity,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
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

/** Split a `--name-status -z` listing into its `[status, path]` pairs. */
function nameStatusEntries(listing: string): [string, string][] {
  const tokens = listing.split('\0').filter((token) => token !== '');
  const entries: [string, string][] = [];
  for (let index = 0; index < tokens.length; ) {
    entries.push([tokens[index++] as string, tokens[index++] as string]);
  }
  return entries;
}

/** Split a NUL-separated path listing (`git ls-files -z`) into its paths. */
function pathList(listing: string): string[] {
  return listing.split('\0').filter((path) => path !== '');
}

/**
 * Read one file on disk as judgeable text, or null when there is none — binary content
 * (the NUL-byte heuristic {@link gitBlobText} applies to a blob) or a path that cannot be
 * read at all (a dangling symlink, a permission refusal). Either way the change survives
 * for path judgment with no content, the disposition a binary staged blob already has.
 */
function diskText(repoRoot: string, path: string): string | null {
  let bytes: Buffer;
  try {
    bytes = readFileSync(join(repoRoot, path));
  } catch {
    return null;
  }
  return bytes.includes(0) ? null : bytes.toString('utf-8');
}

/**
 * Listing flags every collector shares. `--no-renames` forces D+A reporting, so a rename
 * away from a protected path surfaces as a judged deletion instead of one R entry whose
 * source path never reaches judgment. The trailing `--` closes the revision list, so a
 * ref that also names a file is not an ambiguous argument.
 */
const NO_RENAMES = ['--name-status', '-z', '--no-renames'];
const END_OF_REVISIONS = '--';

/**
 * One `--name-status` entry as a change. `D` is a deletion with its `pre`; otherwise a
 * modification when the pre side holds the path (`M` or `T` type change, and a pre side
 * exists at all) and a creation with `pre: null` when it does not.
 */
function changeFromEntry(
  rawStatus: string,
  path: string,
  hasPreSide: boolean,
  readPre: (path: string) => string | null,
  readPost: (path: string) => string | null,
): StagedChange {
  if (rawStatus === 'D') {
    return { path, status: 'deleted', pre: readPre(path), post: null };
  }
  const existsInPre = hasPreSide && (rawStatus === 'M' || rawStatus === 'T');
  return {
    path,
    status: existsInPre ? 'modified' : 'added',
    pre: existsInPre ? readPre(path) : null,
    post: readPost(path),
  };
}

/**
 * Collect the staged changes of `repoRoot`.
 *
 * `git diff --cached --name-status -z` lists the entries; blobs are read per entry.
 * On the unborn first commit (no HEAD) every staged file is `added` with `pre: null`
 * — HEAD absence is detected explicitly, never inferred from a swallowed blob-read
 * failure. An empty staging area yields `[]`.
 */
export function collectStagedChanges(repoRoot: string): StagedChange[] {
  const hasHead = headExists(repoRoot);
  const listing = git(repoRoot, ['diff', '--cached', ...NO_RENAMES, END_OF_REVISIONS]);
  return nameStatusEntries(listing).map(([rawStatus, path]) =>
    changeFromEntry(
      rawStatus,
      path,
      hasHead,
      (p) => gitBlobText(repoRoot, `HEAD:${p}`),
      (p) => gitBlobText(repoRoot, `:${p}`),
    ),
  );
}

/**
 * Collect the working-tree changes of `repoRoot`.
 *
 * `pre` is the HEAD blob and `post` the bytes on disk; the index is not consulted.
 * Untracked, non-ignored files (`--exclude-standard`) join as `added`, and a file missing
 * from disk is `deleted` — whether HEAD held it or only the index did (`git add` then
 * `rm`: `git diff HEAD` lists no such path, `ls-files --deleted` does). On the unborn
 * first commit every tracked and untracked file present on disk is `added` with
 * `pre: null`. A clean worktree yields `[]`.
 */
export function collectWorktreeChanges(repoRoot: string): StagedChange[] {
  const untracked = pathList(git(repoRoot, ['ls-files', '--others', '--exclude-standard', '-z']));
  const missing = pathList(git(repoRoot, ['ls-files', '--deleted', '-z']));

  const tracked = headExists(repoRoot)
    ? nameStatusEntries(git(repoRoot, ['diff', 'HEAD', ...NO_RENAMES, END_OF_REVISIONS])).map(
        ([rawStatus, path]) =>
          changeFromEntry(
            rawStatus,
            path,
            true,
            (p) => gitBlobText(repoRoot, `HEAD:${p}`),
            (p) => diskText(repoRoot, p),
          ),
      )
    : pathList(git(repoRoot, ['ls-files', '-z']))
        .filter((path) => !missing.includes(path))
        .map(
          (path): StagedChange => ({
            path,
            status: 'added',
            pre: null,
            post: diskText(repoRoot, path),
          }),
        );

  const seen = new Set(tracked.map((change) => change.path));
  const created = untracked
    .filter((path) => !seen.has(path))
    .map(
      (path): StagedChange => ({
        path,
        status: 'added',
        pre: null,
        post: diskText(repoRoot, path),
      }),
    );
  // Index-only entries gone from disk: HEAD never held them, so there is no `pre`.
  const removed = missing
    .filter((path) => !seen.has(path))
    .map((path): StagedChange => ({ path, status: 'deleted', pre: null, post: null }));
  return [...tracked, ...created, ...removed];
}

/**
 * Resolve a range expression to its `[base, head]` refs — `A..B` takes base = A, `A...B`
 * takes base = merge-base(A, B). Two refs with no common ancestor fail on the explicit
 * `git merge-base` spawn rather than becoming a diff against nothing.
 */
function resolveRange(repoRoot: string, range: string): [string, string] {
  const threeDot = range.indexOf('...');
  if (threeDot !== -1) {
    const left = range.slice(0, threeDot);
    const right = range.slice(threeDot + 3);
    return [git(repoRoot, ['merge-base', left, right]).trim(), right];
  }
  const twoDot = range.indexOf('..');
  if (twoDot === -1) {
    throw new Error(`range '${range}' is neither <base>..<head> nor <base>...<head>`);
  }
  return [range.slice(0, twoDot), range.slice(twoDot + 2)];
}

/**
 * Collect the changes between two refs of `repoRoot`.
 *
 * `pre` is the base ref's blob and `post` the head ref's; neither the index nor the disk
 * is read. An unresolvable ref lets git's own failure throw rather than yielding an empty
 * domain. Identical refs yield `[]`.
 */
export function collectRangeChanges(repoRoot: string, range: string): StagedChange[] {
  const [base, head] = resolveRange(repoRoot, range);
  const listing = git(repoRoot, ['diff', ...NO_RENAMES, base, head, END_OF_REVISIONS]);
  return nameStatusEntries(listing).map(([rawStatus, path]) =>
    changeFromEntry(
      rawStatus,
      path,
      true,
      (p) => gitBlobText(repoRoot, `${base}:${p}`),
      (p) => gitBlobText(repoRoot, `${head}:${p}`),
    ),
  );
}
