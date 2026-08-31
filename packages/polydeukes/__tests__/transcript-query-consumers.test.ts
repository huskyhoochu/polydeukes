import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// `findSubagentInvocations` is a transcript query with production implementations and no
// production caller: the precedent judgment reads `findToolCalls` (a spawn without an
// outcome cannot prove execution), and the spawn channel of the world axis is the sidecar
// source. This oracle keeps the internal consumption at zero so the query can be retired
// from the transcript contract in one deliberate major change — a caller added in the
// meantime would silently re-anchor the contract. Source-text oracle over every package's
// src tree, like the engine purity suite.

const PACKAGES_DIR = fileURLToPath(new URL('../../', import.meta.url));
const QUERY = 'findSubagentInvocations';

/** The modules that define or produce the query — the only places its name may appear. */
const PRODUCERS = ['adapter-claude-code/src/transcript.ts', 'core/src/transcript.ts'];

/** Every .ts source under each package's src tree, as packages-relative paths. */
function sourceFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith('.ts')) files.push(relative(PACKAGES_DIR, path));
    }
  };
  for (const pkg of readdirSync(PACKAGES_DIR)) {
    const src = join(PACKAGES_DIR, pkg, 'src');
    if (existsDir(src)) walk(src);
  }
  return files.sort();
}

function existsDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

describe('findSubagentInvocations — production implementations, zero production callers', () => {
  const files = sourceFiles();

  it('reads a non-empty source set including both producer modules — no vacuous pass', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const producer of PRODUCERS) expect(files).toContain(producer);
  });

  it('no src module calls the query — `.findSubagentInvocations(` appears nowhere', () => {
    // A dotted call is a consumer; one anywhere in src (the producers included — a
    // producer calling its own query is still a consumer) re-anchors the contract the
    // retirement decision rests on.
    for (const file of files) {
      const text = readFileSync(join(PACKAGES_DIR, file), 'utf8');
      expect(text, file).not.toMatch(/\.findSubagentInvocations\s*\(/);
    }
  });

  it('the name itself appears only in the two producer modules', () => {
    // Naming the symbol elsewhere — a re-export, a wrapper, a type pick — is consumption
    // in another spelling; the dotted-call check alone would not see it.
    const naming = files.filter((file) =>
      readFileSync(join(PACKAGES_DIR, file), 'utf8').includes(QUERY),
    );

    expect(naming).toEqual(PRODUCERS);
  });
});
