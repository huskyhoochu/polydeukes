import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The `--diff` surface observes a finished change set, and many tools produce one — this
// repository's commit hook is one of them. The living documents name the surface after
// what it observes, never after one producer: "change-set surface" in English, the
// glossary's Korean term in the mirrors. Dated build-in-public posts keep the words they
// shipped with and are outside the scan.

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const GLOSSARY = join(REPO_ROOT, '.claude/rules/domain-terms.md');
const NEW_TERM = 'change-set surface';
/** The retired English spelling, matched without regard to case. */
const OLD_TERM = /commit surface/i;
/**
 * The retired Korean spelling, assembled from code points so this file — a package test
 * source — carries no Hangul literal of its own.
 */
const OLD_TERM_KO = new RegExp(String.fromCodePoint(0xcee4, 0xbc0b, 0x20, 0xd45c, 0xba74));
/** The directory of dated posts the scan never enters. */
const DATED_POSTS = join(REPO_ROOT, 'docs/build-in-public');

function filesUnder(dir: string, keep: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (path === DATED_POSTS || entry.name === 'node_modules' || entry.name === 'dist') continue;
      out.push(...filesUnder(path, keep));
    } else if (entry.isFile() && keep(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

const isMarkdown = (name: string): boolean => name.endsWith('.md');
const isSource = (name: string): boolean => name.endsWith('.ts');

function packageDirs(): string[] {
  const packages = join(REPO_ROOT, 'packages');
  return readdirSync(packages, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packages, entry.name));
}

/** Every living document and package source the rename sweeps. */
function livingFiles(): string[] {
  return [
    ...filesUnder(join(REPO_ROOT, 'docs'), isMarkdown),
    join(REPO_ROOT, 'README.md'),
    join(REPO_ROOT, 'README.ko.md'),
    join(REPO_ROOT, 'AGENTS.md'),
    ...filesUnder(join(REPO_ROOT, '.claude/rules'), isMarkdown),
    ...packageDirs().flatMap((dir) =>
      readdirSync(dir)
        .filter((name) => /^README(\.ko)?\.md$/.test(name))
        .map((name) => join(dir, name)),
    ),
    ...packageDirs().flatMap((dir) => filesUnder(join(dir, 'src'), isSource)),
  ].filter((path) => existsSync(path));
}

/** `path: count` for every file whose text matches `needle`. */
function carriers(needle: RegExp): string[] {
  const found: string[] = [];
  for (const file of livingFiles()) {
    const matches = readFileSync(file, 'utf-8').match(
      new RegExp(needle.source, `${needle.flags}g`),
    );
    if (matches !== null && matches.length > 0) {
      found.push(`${file.slice(REPO_ROOT.length + 1)}: ${matches.length}`);
    }
  }
  return found.sort();
}

describe('the surface is named after what it observes', () => {
  it('the glossary defines the change-set surface', () => {
    // The positive end: a sweep that deletes the old term and defines nothing leaves the
    // surface nameless in the one file every other document defers to.
    expect(readFileSync(GLOSSARY, 'utf-8')).toContain(NEW_TERM);
  });

  it('no living document, rule, README, or package source says the retired English term', () => {
    const found = carriers(OLD_TERM);
    expect(found, `retired term still present:\n${found.join('\n')}`).toEqual([]);
  });

  it('no living Korean mirror says the retired Korean term', () => {
    const found = carriers(OLD_TERM_KO);
    expect(found, `retired Korean term still present:\n${found.join('\n')}`).toEqual([]);
  });
});
