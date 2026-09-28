import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Text oracles over the repository: the facts the input contract states about files
// that no unit test loads. Each one is a `grep` a reviewer would otherwise run by hand.

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const PACKAGES = join(REPO_ROOT, 'packages');

/** Every regular file under `dir`, recursively; `node_modules` and `dist` are never entered. */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    // `packages/documentation/src/content/` is generated from `docs/` at build time and
    // is gitignored; the records it copies name the terminal device as history, not as
    // something a bin opens.
    if (entry.name === 'content' && dir.endsWith(join('documentation', 'src'))) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

/** The files the oracles read, relative to the repository root. */
function relative(path: string): string {
  return path.slice(REPO_ROOT.length + 1);
}

function packageDirs(...subdirs: string[]): string[] {
  return readdirSync(PACKAGES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => subdirs.map((sub) => join(PACKAGES, entry.name, sub)));
}

function filesContaining(paths: string[], needle: string): string[] {
  return paths.filter((path) => readFileSync(path, 'utf-8').includes(needle)).map(relative);
}

describe('the CLI asks nobody', () => {
  it('no package source or package test names the terminal device', () => {
    // The string is assembled so this file does not name it either. A bin that opens the
    // controlling terminal is a bin with a policy of its own.
    const device = `/dev/${'tty'}`;
    const candidates = packageDirs('src', '__tests__').flatMap(filesUnder);

    expect(filesContaining(candidates, device)).toEqual([]);
  });
});

describe('the git adapter is gone', () => {
  it('packages/adapter-git does not exist', () => {
    expect(existsSync(join(PACKAGES, 'adapter-git'))).toBe(false);
  });
});

describe('the umbrella never spawns git', () => {
  it('no file under packages/polydeukes/src spawns a git process', () => {
    // The world axis is a disk read; the change set arrives on stdin.
    const sources = filesUnder(join(PACKAGES, 'polydeukes', 'src'));
    const spellings = ["execFileSync('git'", "spawnSync('git'", "spawn('git'", "execSync('git"];

    const offenders = spellings.flatMap((spelling) =>
      filesContaining(sources, spelling).map((file) => `${file}: ${spelling}`),
    );

    expect(offenders).toEqual([]);
  });
});

/** The memory package: its directory, name, and the names its barrel carries. */
const MEMORY_DIR = join(PACKAGES, 'memory');
const MEMORY_VERBS = [
  'describeMemoryIndex',
  'ingestMemory',
  'lintMemory',
  'listObligations',
  'listSupersession',
  'openMemoryDb',
  'searchMemory',
  'showMemory',
  'summarizeMemoryUsage',
];
const MEMORY_TYPES = [
  'DescribeMemoryIndexSpec',
  'IngestMemorySpec',
  'LintMemorySpec',
  'ListObligationsSpec',
  'ListSupersessionSpec',
  'MemoryConfig',
  'MemoryDocument',
  'MemoryIndexState',
  'MemoryLink',
  'MemoryLinks',
  'MemoryLintResult',
  'MemoryLogEntry',
  'MemoryObligation',
  'MemorySearchResult',
  'MemorySection',
  'MemoryShownSection',
  'MemorySupersession',
  'MemoryUsage',
  'MemoryViolation',
  'OpenMemoryDbSpec',
  'SearchMemorySpec',
  'ShowMemorySpec',
  'SummarizeMemoryUsageSpec',
];

/** The runtime and type names a barrel's `export … from` statements carry, each sorted. */
function barrelNames(text: string): { runtime: string[]; types: string[] } {
  const runtime: string[] = [];
  const types: string[] = [];
  const src = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  for (const m of src.matchAll(/export\s+(type\s+)?\{([^}]*)\}\s+from\s+['"][^'"]+['"]/g)) {
    for (const raw of (m[2] as string).split(',')) {
      const item = raw.trim();
      if (item.length === 0) continue;
      const name = item.replace(/^type\s+/, '').replace(/^.*\s+as\s+/, '');
      (m[1] || item.startsWith('type ') ? types : runtime).push(name);
    }
  }
  return { runtime: runtime.sort(), types: types.sort() };
}

describe('the memory package contract', () => {
  // A verb missing from the barrel fails the umbrella's dynamic import at call time in
  // every consumer; `parseDocument`, `replaceDocument`, or `optimizeMemoryDb` re-exported
  // widens the contract to functions no caller fills a spec for.
  it('its barrel re-exports exactly the nine verbs and the twenty-three types', () => {
    const names = barrelNames(readFileSync(join(MEMORY_DIR, 'src', 'index.ts'), 'utf-8'));

    expect(names.runtime).toEqual(MEMORY_VERBS);
    expect(names.types).toEqual(MEMORY_TYPES);
  });
});

describe('the fixture set this file assumes', () => {
  it('reads real directories — the package tree exists', () => {
    // An oracle over an empty candidate list is vacuously green; this pins that the
    // walk found something.
    expect(statSync(join(PACKAGES, 'polydeukes', 'src')).isDirectory()).toBe(true);
    expect(packageDirs('src').flatMap(filesUnder).length).toBeGreaterThan(0);
  });
});
