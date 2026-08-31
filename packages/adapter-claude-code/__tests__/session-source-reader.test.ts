import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sessionSourceReader } from '../src/session-source-reader.ts';

// The session surface's supply reader: `sessionSourceReader({ repoRoot })` answers a
// repo-relative path with the working tree's text or with absence. Absence covers every
// shape the disk can hold under a planned path that is not readable text — no entry, a
// directory, a path whose parent is a file, bytes carrying a NUL. Everything else throws:
// a permission refusal must reach the root's fail-closed path instead of passing for a
// file that is not there. The commit surface's worktree reader asserts the same absence
// table in its own suite — the two readers live in packages that cannot depend on each
// other, so the shared table is pinned twice.

// Paths and contents are fixture values.
const TEXT_FILE = 'locales/en.json';
const TEXT = '{"a":1}\n';
const EMPTY_FILE = 'locales/empty.json';
const DIR_PATH = 'locales/nested';
const THROUGH_FILE = 'locales/en.json/inner.json';
const BINARY_FILE = 'assets/blob.bin';
const LOCKED_FILE = 'secrets/locked.json';

let repoRoot: string;

/** Write content at a repo-relative path, creating parents. */
function write(relPath: string, content: string | Buffer): void {
  const absolute = join(repoRoot, relPath);
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, content);
}

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'pdks-session-read-'));
});

afterEach(() => {
  // The permission fixture must be reopened before rm can clear the tree.
  try {
    chmodSync(join(repoRoot, LOCKED_FILE), 0o600);
  } catch {
    // No permission fixture in this test.
  }
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('sessionSourceReader — text in the tree', () => {
  it('answers the file text verbatim for a repo-relative path', () => {
    // The reader joins onto repoRoot: one resolving against the process cwd reads another
    // repository's file (or nothing) whenever the hook runs from elsewhere.
    write(TEXT_FILE, TEXT);

    expect(sessionSourceReader({ repoRoot })(TEXT_FILE)).toBe(TEXT);
  });

  it('answers the empty string for an empty file — present, not absent', () => {
    // A truthiness check turns an empty locale file into absence and flips the supply
    // policy's disposition for a file that exists.
    write(EMPTY_FILE, '');

    expect(sessionSourceReader({ repoRoot })(EMPTY_FILE)).toBe('');
  });
});

describe('sessionSourceReader — the absence table', () => {
  it('answers undefined for a path with no entry (ENOENT)', () => {
    expect(sessionSourceReader({ repoRoot })('locales/missing.json')).toBeUndefined();
  });

  it('answers undefined for a directory (EISDIR)', () => {
    // A reader folding only ENOENT propagates the directory error, and a tree that merely
    // has a folder under a planned path fails every call closed.
    mkdirSync(join(repoRoot, DIR_PATH), { recursive: true });

    expect(sessionSourceReader({ repoRoot })(DIR_PATH)).toBeUndefined();
  });

  it('answers undefined for a path whose parent is a file (ENOTDIR)', () => {
    write(TEXT_FILE, TEXT);

    expect(sessionSourceReader({ repoRoot })(THROUGH_FILE)).toBeUndefined();
  });

  it('answers undefined for bytes carrying a NUL — never a lossy decode', () => {
    // A utf-8 decode of binary content is still a string; without the NUL check the bytes
    // are supplied as text and `json` breaks a declaration on a file that was never text.
    write(BINARY_FILE, Buffer.from('ab\0cd'));

    expect(sessionSourceReader({ repoRoot })(BINARY_FILE)).toBeUndefined();
  });

  it.skipIf(typeof process.getuid === 'function' && process.getuid() === 0)(
    'throws on a permission refusal — not absence',
    () => {
      // EACCES folded into absence lets a `supply: pass` declaration skip a file the root
      // could not read, and the fail-closed row never lands. Skipped as root, which no
      // mode can refuse.
      write(LOCKED_FILE, TEXT);
      chmodSync(join(repoRoot, LOCKED_FILE), 0o000);

      expect(() => sessionSourceReader({ repoRoot })(LOCKED_FILE)).toThrow();
    },
  );
});
