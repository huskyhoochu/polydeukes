import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The engine is the embeddable kernel's shape: it takes a `World` value and returns a
// verdict, and reads nothing else. Its modules import no `node:*` builtin and know none of
// the covenant input types. The check reads the source of every engine module — the file
// list is enumerated so a module added beside the entry is covered without editing here.

const SRC_DIR = fileURLToPath(new URL('../src/', import.meta.url));
const ENTRY_MODULE = 'declaration-engine.ts';
const ENGINE_MODULE = /^(declaration-.*|extract-.*|relations)\.ts$/;

const engineFiles = readdirSync(SRC_DIR).filter((name) => ENGINE_MODULE.test(name));
const sources = engineFiles.map((name) => ({
  name,
  text: readFileSync(`${SRC_DIR}${name}`, 'utf8'),
}));

describe('declaration engine — purity of the module set', () => {
  it('reads the entry module and a non-empty source — the check cannot pass vacuously', () => {
    expect(engineFiles).toContain(ENTRY_MODULE);
    for (const { name, text } of sources) {
      expect(text.length, name).toBeGreaterThan(0);
    }
  });

  it.each(sources.map((s) => s.name))('%s imports no node: builtin', (name) => {
    const text = sources.find((s) => s.name === name)?.text ?? '';
    expect(text).not.toMatch(/from\s+['"]node:/);
    expect(text).not.toMatch(/import\s*\(\s*['"]node:/);
  });

  it.each(sources.map((s) => s.name))('%s names no covenant input type', (name) => {
    // `CovenantInput` and the transcript are the surface's vocabulary; an engine that
    // reads them has stopped being a function of the world.
    const text = sources.find((s) => s.name === name)?.text ?? '';
    expect(text).not.toContain('CovenantInput');
    expect(text).not.toContain('FileChange');
    expect(text).not.toMatch(/transcript/i);
  });

  it.each(sources.map((s) => s.name))('%s reads no ambient process state', (name) => {
    const text = sources.find((s) => s.name === name)?.text ?? '';
    expect(text).not.toMatch(/process\s*\./);
  });
});

// The whole package, one axis wider. The engine rules above are about the engine's own
// modules; this one is about the package: since the pre-state read became an injected
// reader and the baseline comparator moved to the umbrella, NO module here opens a file or
// spawns a process. Effects belong to the surface that observes, and the judge receives
// what it needs as values.
//
// Without this, re-adding `readFileSync` to a judge is silently green: the commit surface
// would judge a staged diff against the working tree's current bytes, reporting a file that
// was staged clean but dirtied afterwards as broken, with no test failing.

const packageSources = readdirSync(SRC_DIR)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => ({ name, text: readFileSync(`${SRC_DIR}${name}`, 'utf8') }));

describe('the covenant package — no effects, only values', () => {
  it('enumerates the package source set, including a module outside the engine', () => {
    // Guards the oracle itself: a glob that matched nothing would pass every case below.
    expect(packageSources.length).toBeGreaterThan(engineFiles.length);
    expect(packageSources.map((s) => s.name)).toContain('discipline.ts');
  });

  it.each(packageSources.map((s) => s.name))('%s opens no file and spawns nothing', (name) => {
    const text = packageSources.find((s) => s.name === name)?.text ?? '';
    expect(text).not.toMatch(/from\s+['"]node:(fs|child_process)/);
    expect(text).not.toMatch(/import\s*\(\s*['"]node:(fs|child_process)/);
    expect(text).not.toMatch(/require\s*\(\s*['"]node:(fs|child_process)/);
  });
});
