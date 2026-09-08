import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// This package as an install unit, checked as source text and manifest: the adapter writes
// no telemetry row and loads no sibling adapter, the roster is Grok-native, and the umbrella
// no longer ships a Grok installer. Source text ONLY — this file must never rebuild dist: a
// rebuild while the tree is mid-change locks the session behind the fail-closed hook.

const pkgDir = resolve(import.meta.dirname, '..');
const adapterSrc = join(pkgDir, 'src');
const umbrellaSrc = resolve(import.meta.dirname, '../../polydeukes/src');

const WRITE = 'write';
const SEARCH_REPLACE = 'search_replace';
const RUN = 'run_terminal_command';
const FAILURE_PREFIX = 'adapter-grok failed before spawn:';
const NOT_INSTALLED_PREFIX = 'covenant hook failed closed:';

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
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8')) as Manifest;

describe('the adapter writes no row, loads no sibling, and pins the Grok roster', () => {
  it('src carries the Grok roster literals and failure prefixes, and none of the forbidden strings', () => {
    // An empty src satisfies every absence check. The positive literals are the other end:
    // a roster that is not in the file, or a failure line that never leaves the adapter,
    // is a hole no negative grep can see. `appendRecord` here would write a second row
    // beside the child's; a sibling-adapter import would load Claude names; rewriting
    // Grok names is the old path this package exists to stop using.
    const text = allSrcText();
    expect(text).toContain(`'${WRITE}'`);
    expect(text).toContain(`'${SEARCH_REPLACE}'`);
    expect(text).toContain(`'${RUN}'`);
    expect(text).toContain(FAILURE_PREFIX);
    expect(text).toContain(NOT_INSTALLED_PREFIX);
    expect(text).not.toContain('appendRecord');
    expect(text).not.toContain('@polydeukes/adapter-claude-code');
    expect(text).not.toContain('rewriteGrokToolNames');
    expect(text).not.toMatch(/'Write'/);
    expect(text).not.toMatch(/'Edit'/);
    expect(text).not.toMatch(/'Bash'/);
  });
});

describe('the adapter manifest', () => {
  it('names the package, exposes exactly the `.` entry point, and declares the `pdks-grok` bin', () => {
    expect(manifest.name).toBe('@polydeukes/adapter-grok');
    expect(Object.keys(manifest.exports ?? {})).toEqual(['.']);
    expect(manifest.bin).toEqual({ 'pdks-grok': './dist/bin.js' });
  });

  it('takes the umbrella and core as peers, and the umbrella never as a devDependency', () => {
    // The spawn finds `pdks` in the consumer's install graph; the peer is that fact stated
    // at install time. This package is not a dependency of the umbrella, so a
    // devDependency on the umbrella is unused rather than cyclic — and still not declared.
    expect(Object.keys(manifest.peerDependencies ?? {}).sort()).toEqual(
      ['@polydeukes/core', 'polydeukes'].sort(),
    );
    expect(manifest.devDependencies ?? {}).not.toHaveProperty('polydeukes');
  });
});

describe('the umbrella no longer ships a Grok installer', () => {
  it('has no init-grok module and no `init grok` branch in the umbrella bin', () => {
    // The Grok session surface installs through this package's bin. An umbrella file or
    // `pdks init grok` branch left behind is a second installer that still rewrites names
    // and still points at the Claude delegator.
    expect(existsSync(join(umbrellaSrc, 'init-grok.ts'))).toBe(false);
    const bin = stripComments(readFileSync(join(umbrellaSrc, 'bin.ts'), 'utf-8'));
    expect(bin).not.toMatch(/init grok/);
    expect(bin).not.toContain('init-grok');
  });
});
