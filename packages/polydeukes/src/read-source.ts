/**
 * The disk reading both composition roots supply a named source from.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A `read` over the working tree under `root`: repo-relative path in, the file's text or
 * absence out.
 *
 * Absence covers every shape the disk can hold under a planned path that is not a readable
 * text — no entry at all, a directory, a path whose parent is a file, and bytes carrying a
 * NUL, which no declaration can parse and which a utf-8 decode would hand on as a lossy
 * string. Everything else throws, so a permission refusal fails the run closed rather than
 * passing for a file that is not there.
 */
export function readDiskSource(root: string): (path: string) => string | undefined {
  return (path) => {
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(root, path));
    } catch (error) {
      const { code } = error as NodeJS.ErrnoException;
      if (code === 'ENOENT' || code === 'EISDIR' || code === 'ENOTDIR') return undefined;
      throw error;
    }
    return bytes.includes(0) ? undefined : bytes.toString('utf-8');
  };
}
