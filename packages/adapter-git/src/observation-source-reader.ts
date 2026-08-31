/**
 * The commit surface's supply body for named file sources — one repo-relative path read the
 * way an observation of the tree sees it.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SourceReader } from '@polydeukes/core';

/**
 * Which observation of the tree a reader answers from. The same path can carry three
 * different texts at one instant, so the observation — not the disk — decides which one a
 * declaration judges.
 *
 * `range` names its two refs. `ancestry: 'merge-base'` selects the `A...B` reading, whose
 * base is the two refs' common ancestor rather than `A` itself; the text a range supplies
 * comes from `head` either way.
 */
export type Observation =
  | { kind: 'staged' }
  | { kind: 'worktree' }
  | { kind: 'range'; base: string; head: string; ancestry?: 'merge-base' };

/** {@link observationSourceReader} input — the repository and how it is observed. */
export type ObservationSourceReaderSpec = { repoRoot: string; observation: Observation };

/** Run git under `repoRoot` and return its raw bytes; a non-zero exit throws. */
function git(repoRoot: string, args: string[]): Buffer {
  return execFileSync('git', args, {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: Infinity,
  });
}

/**
 * The space-separated fields of the listing entry FOR `path`, or `undefined` when the
 * listing names no such entry.
 *
 * Both listings answer a directory with the entries under it rather than with nothing, so
 * the entry's own path decides: `locales/nested` is not the file `locales/nested/inner.json`.
 */
function firstEntry(listing: Buffer, path: string): { fields: string[] } | undefined {
  for (const record of listing.toString('utf-8').split('\0')) {
    const [head, entryPath] = record.split('\t');
    if (entryPath === path && head !== undefined) return { fields: head.split(' ') };
  }
  return undefined;
}

/** One object's text, or absence for bytes carrying a NUL — no judgeable text is no source. */
function blobText(repoRoot: string, hash: string): string | undefined {
  const bytes = git(repoRoot, ['cat-file', 'blob', hash]);
  return bytes.includes(0) ? undefined : bytes.toString('utf-8');
}

/** `100`* is the regular-file mode family; a symlink or a gitlink is not a file's text. */
function isFileMode(mode: string | undefined): boolean {
  return mode?.startsWith('100') === true;
}

/**
 * A reader over the working tree under `repoRoot`, with the same absence table the session
 * surface's disk reader pins in its own package.
 *
 * Symlinks are followed, deliberately unlike the staged and range branches: on disk the
 * observable fact IS the target's text (the session surface reads the same way), while in
 * the index a symlink's blob is only the target path string, which is no source text. The
 * same symlinked path can therefore read present here and absent under `staged`.
 */
function worktreeReader(repoRoot: string): SourceReader {
  return (path) => {
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(repoRoot, path));
    } catch (error) {
      const { code } = error as NodeJS.ErrnoException;
      if (code === 'ENOENT' || code === 'EISDIR' || code === 'ENOTDIR') return undefined;
      throw error;
    }
    return bytes.includes(0) ? undefined : bytes.toString('utf-8');
  };
}

/**
 * Read one repo-relative path the way the observation sees the tree: the index for a staged
 * run, the working tree for a worktree one, the `head` commit for a range.
 *
 * Whether the observed tree carries the path, and as what, comes from git's machine-readable
 * listings rather than from a message; the text then comes from the object the listing named,
 * and only after its MODE says a regular file — a symlink's blob reads fine and holds the
 * link target, which supplied as text would judge the wrong string, and a gitlink names a
 * commit no blob read can answer. Anything the observation holds but cannot give as judgeable
 * text answers `undefined`, which the declaration's `supply` policy disposes of. Every git
 * failure throws, so an unreadable repository fails the run closed instead of passing for a
 * file that is not there.
 */
export function observationSourceReader(spec: ObservationSourceReaderSpec): SourceReader {
  const { repoRoot, observation } = spec;
  if (observation.kind === 'worktree') return worktreeReader(repoRoot);

  if (observation.kind === 'range') {
    const { head } = observation;
    return (path) => {
      const entry = firstEntry(git(repoRoot, ['ls-tree', '-z', head, '--', path]), path);
      if (entry === undefined) return undefined;
      const [mode, type, hash] = entry.fields;
      if (type !== 'blob' || !isFileMode(mode) || hash === undefined) return undefined;
      return blobText(repoRoot, hash);
    };
  }

  return (path) => {
    const entry = firstEntry(git(repoRoot, ['ls-files', '--stage', '-z', '--', path]), path);
    if (entry === undefined) return undefined;
    const [mode, hash, stage] = entry.fields;
    // Only stage 0 is the index's settled text. During an unresolved merge the listing
    // carries stages 1..3 — ancestor, ours, theirs — and the first of those is the merge
    // BASE, a text nobody is committing; a conflicted entry answers absence instead, for
    // the declaration's `supply` policy to dispose of.
    if (!isFileMode(mode) || hash === undefined || stage !== '0') return undefined;
    return blobText(repoRoot, hash);
  };
}
