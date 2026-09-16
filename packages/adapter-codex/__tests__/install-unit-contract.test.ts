import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// This package as an install unit, checked as source text and manifest: the adapter writes
// no telemetry row, loads no sibling adapter, and judges nothing. What the roster resolves
// to is checked where it reaches the IR, not here. Source text ONLY — this file must never
// rebuild dist: a rebuild while the tree is mid-change locks the session behind the
// fail-closed hook.

const pkgDir = resolve(import.meta.dirname, '..');
const adapterSrc = join(pkgDir, 'src');

const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const walkTs = (dir: string): string[] => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walkTs(path);
    return name.endsWith('.ts') ? [path] : [];
  });
};

function allSrcText(): string {
  return walkTs(adapterSrc)
    .map((file) => stripComments(readFileSync(file, 'utf-8')))
    .join('\n');
}

type Manifest = {
  name?: string;
  bin?: Record<string, string>;
  exports?: Record<string, unknown>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8')) as Manifest;

describe('the adapter writes no row, loads no sibling, and registers no dead roster entry', () => {
  it('names neither matcher alias, no sibling adapter, no umbrella, and no telemetry writer', () => {
    // `Edit` and `Write` are matcher aliases the host never rewrites into `tool_name`. An
    // entry for either matches no call that ever arrives, so nothing the host can send
    // makes the dead entry observable — the literal is the only place it is visible.
    //
    // The import restrictions are the dependency direction: both siblings and the umbrella
    // resolve in this tree, so a wrong import type-checks and runs green while loading
    // another host's names. `appendRecord` would write a second row beside the child's.
    const text = allSrcText();
    expect(text).not.toMatch(/'Write'/);
    expect(text).not.toMatch(/'Edit'/);
    expect(text).not.toContain('@polydeukes/adapter-claude-code');
    expect(text).not.toContain('@polydeukes/adapter-grok');
    expect(text).not.toMatch(/from\s+['"]polydeukes(\/|['"])/);
    expect(text).not.toContain('appendRecord');
  });
});

describe('the adapter manifest', () => {
  it('names the package, exposes exactly the `.` entry point, and declares the `pdks-codex` bin', () => {
    expect(manifest.name).toBe('@polydeukes/adapter-codex');
    expect(Object.keys(manifest.exports ?? {})).toEqual(['.']);
    expect(manifest.bin).toEqual({ 'pdks-codex': './dist/bin.js' });
  });

  it('takes the umbrella and core as peers only — no dependencies, and the umbrella never as a devDependency', () => {
    // The spawn finds `pdks` in the consumer's install graph; the peer is that fact stated
    // at install time. A dependency on the umbrella would pin a second copy beside the
    // consumer's; a dependency on core would duplicate the vocabulary.
    expect(Object.keys(manifest.peerDependencies ?? {}).sort()).toEqual(
      ['@polydeukes/core', 'polydeukes'].sort(),
    );
    expect(manifest.dependencies ?? {}).toEqual({});
    expect(manifest.devDependencies ?? {}).not.toHaveProperty('polydeukes');
  });
});
