/**
 * The commit surface's supply body for named file sources — one repo-relative path read from
 * the working tree.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SourceReader } from '@polydeukes/core';

/** {@link worktreeReader} input — the repository the paths are relative to. */
export type WorktreeReaderSpec = { repoRoot: string };

/**
 * A reader over the working tree under `repoRoot`, with the same absence table the session
 * surface's disk reader pins in its own package.
 *
 * Symlinks are followed: on disk the observable fact IS the target's text, and the session
 * surface reads the same way. A path the tree holds but cannot give as judgeable text —
 * a directory, or bytes carrying a NUL — answers `undefined`, which the declaration's
 * `supply` policy disposes of.
 */
export function worktreeReader(spec: WorktreeReaderSpec): SourceReader {
  return (path) => {
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(spec.repoRoot, path));
    } catch (error) {
      const { code } = error as NodeJS.ErrnoException;
      if (code === 'ENOENT' || code === 'EISDIR' || code === 'ENOTDIR') return undefined;
      throw error;
    }
    return bytes.includes(0) ? undefined : bytes.toString('utf-8');
  };
}
