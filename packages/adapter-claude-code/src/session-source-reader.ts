/**
 * The session surface's supply body for named file sources — the working tree as this
 * surface observes it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SourceReader } from '@polydeukes/core';

/** {@link sessionSourceReader} input — the repository the paths are relative to. */
export type SessionSourceReaderSpec = { repoRoot: string };

/**
 * A reader over the working tree under `repoRoot`: repo-relative path in, the file's text or
 * absence out.
 *
 * Absence covers every shape the disk can hold under a planned path that is not a readable
 * text — no entry at all, a directory, a path whose parent is a file, and bytes carrying a
 * NUL, which no declaration can parse and which a utf-8 decode would hand on as a lossy
 * string. Everything else throws, so a permission refusal fails the run closed rather than
 * passing for a file that is not there.
 */
export function sessionSourceReader(spec: SessionSourceReaderSpec): SourceReader {
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
