import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// This package's contract, checked as source text and manifest: its barrel carries exactly the
// names a consumer reads, and it declares one entry point and no bin.

const pkgDir = resolve(import.meta.dirname, '..');
const sdkSrc = join(pkgDir, 'src');

/** The consumer contract: three verbs, byte transport and generated wire vocabulary. */
const KEPT_EXPORTS: readonly string[] = [
  'checkCovenant',
  'CheckCovenantSpec',
  'CheckCovenantVerdict',
  'checkChangeSet',
  'CheckChangeSetSpec',
  'memorySearch',
  'MemorySearchSpec',
  'MemorySearchOutcome',
  'Spawn',
  'SpawnSpec',
  'SpawnOutcome',
  'CovenantInput',
  'ToolCall',
  'FileChange',
  'SubagentSpawn',
  'UserMessage',
  'Actor',
  'Tools',
  'Session',
  'SessionUserMessage',
  'SessionToolCall',
  'Channels',
  'MemorySearchResult',
];

const IDENT = '[A-Za-z_][A-Za-z0-9_]*';

const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** Names exported by a source text: local definitions plus the exported names of brace lists. */
const exportedNames = (text: string): Set<string> => {
  const src = stripComments(text);
  const names = new Set<string>();
  for (const m of src.matchAll(
    new RegExp(
      `export\\s+(?:default\\s+)?(?:declare\\s+)?(?:abstract\\s+)?(?:async\\s+)?(?:function|const|type|interface|class|let|enum)\\s+(${IDENT})`,
      'g',
    ),
  )) {
    names.add(m[1] as string);
  }
  for (const m of src.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const raw of (m[1] as string).split(',')) {
      const item = raw.trim().replace(/^type\s+/, '');
      if (item.length === 0) continue;
      const alias = item.match(new RegExp(`^${IDENT}\\s+as\\s+(${IDENT})$`));
      names.add(alias ? (alias[1] as string) : item);
    }
  }
  return names;
};

type Manifest = {
  name?: string;
  bin?: Record<string, string>;
  exports?: Record<string, unknown>;
};

const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8')) as Manifest;

describe('the barrel export set', () => {
  it('contains exactly the consumer verbs and spec vocabulary', () => {
    // A leaked helper widens the contract one release at a time; a dropped name strands a
    // consumer import. `export *` would defeat this check by carrying nothing to parse.
    const barrel = readFileSync(join(sdkSrc, 'index.ts'), 'utf-8');
    expect(stripComments(barrel)).not.toMatch(/export\s+\*/);
    expect([...exportedNames(barrel)].sort()).toEqual([...KEPT_EXPORTS].sort());
  });
});

describe('the SDK manifest', () => {
  it('names the package, exposes exactly the `.` entry point, and declares no bin', () => {
    // A bin makes the SDK a second CLI beside `pdks`; the SDK is a library that spawns one.
    expect(manifest.name).toBe('@polydeukes/sdk-ts');
    expect(Object.keys(manifest.exports ?? {})).toEqual(['.']);
    expect(manifest.bin).toBeUndefined();
  });
});
