import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pkgDir = resolve(import.meta.dirname, '..');
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : name.endsWith('.ts') ? [path] : [];
  });
}
const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
describe('leaf adapter package contract', () => {
  it('exposes the package entry without an independent executable', () => {
    expect(manifest.name).toBe('@polydeukes/adapter-grok');
    expect(Object.keys(manifest.exports ?? {})).toEqual(['.']);
    expect(manifest.bin).toBeUndefined();
  });
  it('shares core vocabulary while keeping the executable composition in the umbrella', () => {
    expect(Object.keys(manifest.peerDependencies ?? {})).toEqual(['@polydeukes/core']);
    expect(manifest.dependencies ?? {}).toEqual({});
    expect(manifest.devDependencies ?? {}).not.toHaveProperty('polydeukes');
  });
  it('imports no umbrella, sibling adapter, SDK, or process launcher', () => {
    // Registration migration strings are data, while imports determine dependency direction.
    const invalid: string[] = [];
    for (const file of sources(join(pkgDir, 'src'))) {
      const text = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      for (const match of text.matchAll(
        /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g,
      )) {
        if (
          /^(?:polydeukes(?:\/|$)|@polydeukes\/(?:adapter-|sdk-)|(?:node:)?child_process$)/.test(
            match[1] ?? '',
          )
        )
          invalid.push(`${file}: ${match[1]}`);
      }
      if (/\bappendRecord\s*\(/.test(text)) invalid.push(`${file}: telemetry writer`);
    }
    expect(invalid).toEqual([]);
  });
});
