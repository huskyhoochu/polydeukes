import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// This package as an install unit, checked as source text and manifest: the adapter writes
// no telemetry row and loads no umbrella module, the umbrella knows no Claude Code
// directory, and the manifest declares the bin and the peer the spawn depends on. Source
// text ONLY — this file must never rebuild dist: a rebuild while the tree is mid-change
// locks the session behind the fail-closed hook.

const pkgDir = resolve(import.meta.dirname, '..');
const adapterSrc = join(pkgDir, 'src');
const umbrellaSrc = resolve(import.meta.dirname, '../../polydeukes/src');

/** The Claude Code directory literal — the string the umbrella's sources must not carry. */
const CLAUDE_DIR_LITERAL = '.claude/';
/**
 * Umbrella files that still carry the literal after this ticket: the generated config
 * template protects `.claude/hooks` and `.claude/settings.json` as its minimum (the
 * scaffold stays in the umbrella). Anything outside this set is a regression.
 */
const UMBRELLA_DECLARED_CARRIERS = ['scaffold-project.ts'];
/**
 * No adapter file writes a row: every verdict this package's calls earn is the spawned
 * judge's, so the set of declared writers here is empty.
 */
const ADAPTER_DECLARED_ROW_WRITERS: string[] = [];

const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const walkTs = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walkTs(path);
    return name.endsWith('.ts') ? [path] : [];
  });

/** `file: count` for every source file under `dir` whose comment-stripped text carries `needle`. */
function carriers(dir: string, needle: string): string[] {
  const found: string[] = [];
  for (const file of walkTs(dir)) {
    const count = stripComments(readFileSync(file, 'utf-8')).split(needle).length - 1;
    if (count > 0) found.push(`${file.slice(dir.length + 1)}: ${count}`);
  }
  return found.sort();
}

type Manifest = {
  bin?: Record<string, string>;
  exports?: Record<string, unknown>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8')) as Manifest;

describe('the adapter writes no row and loads no umbrella module', () => {
  it('has zero appendRecord calls anywhere under src', () => {
    // The row a call leaves on the spawn path is written by `pdks` alone. A second writer
    // means a pre-spawn failure lands two rows, or lands one under a label the runner never
    // uses, and the one-call-one-row accounting the log is read by breaks. The set is
    // closed, so a new writer fails here by name.
    const found = carriers(adapterSrc, 'appendRecord').map((entry) => entry.split(':')[0]);
    const outside = found.filter((file) => !ADAPTER_DECLARED_ROW_WRITERS.includes(file as string));
    expect(outside, `telemetry writers in adapter src:\n${outside.join('\n')}`).toEqual([]);
  });

  it('names the umbrella session subpath nowhere under src', () => {
    // The umbrella has no `.` entry point and the session subpath is the in-process path
    // this package replaces; importing it from here re-creates the dependency cycle the
    // peer declaration exists to avoid.
    const found = carriers(adapterSrc, 'polydeukes/claude-code');
    expect(found, `umbrella subpath references in adapter src:\n${found.join('\n')}`).toEqual([]);
  });
});

describe('the adapter manifest', () => {
  it('exposes exactly the `.` entry point', () => {
    // A subpath added here would be a second contract the package-contract check does not
    // admit for a sibling package; `runHook` travels on the barrel.
    expect(Object.keys(manifest.exports ?? {})).toEqual(['.']);
  });

  it('declares the `pdks-claude-code` bin at the built entry', () => {
    expect(manifest.bin).toEqual({ 'pdks-claude-code': './dist/bin.js' });
  });

  it('takes the umbrella and core as peers, and the umbrella never as a devDependency', () => {
    // The spawn finds `pdks` in the consumer's install graph; the peer is that fact stated
    // at install time. A devDependency on the umbrella closes a cycle in the workspace
    // task graph (the umbrella still depends on this package) and the build refuses to run.
    expect(Object.keys(manifest.peerDependencies ?? {}).sort()).toEqual(
      ['@polydeukes/core', 'polydeukes'].sort(),
    );
    expect(manifest.devDependencies ?? {}).not.toHaveProperty('polydeukes');
  });
});

describe('the umbrella knows no Claude Code directory', () => {
  it('carries the `.claude/` literal in code only where the scaffold template still needs it', () => {
    // Comment-stripped: a comment naming the directory teaches nothing at run time. The set
    // is closed, so a new umbrella file learning a Claude Code path fails here by name.
    const found = carriers(umbrellaSrc, CLAUDE_DIR_LITERAL).map((entry) => entry.split(':')[0]);
    const outside = found.filter((file) => !UMBRELLA_DECLARED_CARRIERS.includes(file as string));
    expect(
      outside,
      `umbrella src files carrying ${CLAUDE_DIR_LITERAL} outside the declared set:\n${outside.join('\n')}`,
    ).toEqual([]);
  });
});
