import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

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
  it('no package source, package test, hook, or lefthook.yml names the terminal device', () => {
    // The string is assembled so this file does not name it either. A bin that opens the
    // controlling terminal is a bin with a policy of its own.
    const device = `/dev/${'tty'}`;
    const candidates = [
      ...packageDirs('src', '__tests__').flatMap(filesUnder),
      ...filesUnder(join(REPO_ROOT, '.claude', 'hooks')),
      join(REPO_ROOT, 'lefthook.yml'),
    ];

    expect(filesContaining(candidates, device)).toEqual([]);
  });
});

describe('the git adapter is gone', () => {
  it('packages/adapter-git does not exist', () => {
    expect(existsSync(join(PACKAGES, 'adapter-git'))).toBe(false);
  });

  it('neither the umbrella manifest nor release-please-config.json names adapter-git', () => {
    // A dependency on a deleted workspace package fails install; a release-please
    // extra-file pointing at a missing manifest fails the release.
    const manifests = [
      join(PACKAGES, 'polydeukes', 'package.json'),
      join(REPO_ROOT, 'release-please-config.json'),
    ];

    expect(filesContaining(manifests, 'adapter-git')).toEqual([]);
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

describe('the checked-in wiring', () => {
  const lefthook = readFileSync(join(REPO_ROOT, 'lefthook.yml'), 'utf-8');

  it('lefthook pipes git diff --cached into pdks covenant check --diff', () => {
    // The old argv form now waits on stdin for an IR, so the old wiring hangs or fails
    // every commit.
    expect(lefthook).toMatch(/git diff --cached[^|\n]*\|\s*\S*pdks covenant check --diff/);
  });

  it('the root config has no adapters.git block', () => {
    // A leftover `enforce` under the deleted namespace would read as a posture the
    // runner no longer honours.
    const config = parse(readFileSync(join(REPO_ROOT, 'polydeukes.config.yaml'), 'utf-8')) as {
      adapters?: Record<string, unknown>;
    };

    expect(config.adapters?.git).toBeUndefined();
  });
});

describe('the fixture set this file assumes', () => {
  it('reads real directories — the package tree and the hook directory exist', () => {
    // An oracle over an empty candidate list is vacuously green; this pins that the
    // walk found something.
    expect(statSync(join(PACKAGES, 'polydeukes', 'src')).isDirectory()).toBe(true);
    expect(packageDirs('src').flatMap(filesUnder).length).toBeGreaterThan(0);
  });
});
