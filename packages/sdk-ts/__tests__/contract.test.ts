import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// This package's contract, checked as source text and manifest: the SDK carries no
// judgment, writes no row, builds no IR, loads no sibling, and its barrel carries exactly
// the names a consumer reads. Source text ONLY — this file must never rebuild dist: a
// rebuild while the tree is mid-change locks the session behind the fail-closed hook.

const pkgDir = resolve(import.meta.dirname, '..');
const sdkSrc = join(pkgDir, 'src');

/** The umbrella and adapter imports the SDK must not carry — it spawns the bin instead. */
const FORBIDDEN_IMPORTS = [
  '@polydeukes/core',
  'polydeukes',
  '@polydeukes/adapter-claude-code',
  '@polydeukes/adapter-grok',
  '@polydeukes/adapter-codex',
];
/** The judge's verbs: naming one here is judging or recording in-process. */
const FORBIDDEN_VERBS = ['appendRecord', 'dispatchCovenants', 'compileDisciplineRegistrations'];
/** IR keys the host proves; their type declarations are vocabulary, not evidence. */
const FORBIDDEN_IR_KEYS = ['session:', 'tools:'];
/** One host's tool roster, matched as quoted literals: the roster is the consumer's value. */
const FORBIDDEN_TOOL_LITERALS = ['Write', 'Edit', 'Bash'];

/** The consumer contract: four verbs, byte transport and generated wire vocabulary. */
const KEPT_EXPORTS: readonly string[] = [
  'checkCovenant',
  'CheckCovenantSpec',
  'CheckCovenantVerdict',
  'checkChangeSet',
  'CheckChangeSetSpec',
  'memoryIngest',
  'MemoryIngestSpec',
  'MemoryIngestOutcome',
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

const walkTs = (dir: string): string[] => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walkTs(path);
    return name.endsWith('.ts') ? [path] : [];
  });
};

function allSrcText(): string {
  return walkTs(sdkSrc)
    .map((file) => stripComments(readFileSync(file, 'utf-8')))
    .join('\n');
}

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

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type Manifest = {
  name?: string;
  description?: string;
  bin?: Record<string, string>;
  exports?: Record<string, unknown>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8')) as Manifest;

describe('the SDK source judges nothing, records nothing, and builds no IR', () => {
  it('src exists and names the verb it exports', () => {
    // An empty src satisfies every absence check below; the positive literal is the other
    // end.
    const text = allSrcText();
    expect(walkTs(sdkSrc).length).toBeGreaterThan(0);
    expect(text).toContain('checkCovenant');
  });

  it('imports no runtime package from the judgment chain', () => {
    // An SDK import must not load the judge or require a separately installed vocabulary package.
    const text = allSrcText();
    for (const name of FORBIDDEN_IMPORTS) {
      expect(text, name).not.toMatch(
        new RegExp(`from\\s+['"]${escapeRegExp(name)}(?:/[^'"]*)?['"]`),
      );
      expect(text, name).not.toMatch(
        new RegExp(`import\\(\\s*['"]${escapeRegExp(name)}(?:/[^'"]*)?['"]`),
      );
    }
  });

  it('names none of the judge verbs', () => {
    // `appendRecord` here would write a row beside the child's; the other two would judge
    // in-process, and the exit code the consumer reads would no longer be the child's.
    const text = allSrcText();
    for (const verb of FORBIDDEN_VERBS) {
      expect(text, verb).not.toMatch(new RegExp(`\\b${verb}\\b`));
    }
  });

  it('constructs no `session:` or `tools:` key and carries no host tool literal', () => {
    // The IR is the caller's; a `session:` or `tools:` written here is evidence the host
    // never proved, and a `Write` · `Edit` · `Bash` literal is one host's roster inside a
    // package meant for every host.
    const text = walkTs(sdkSrc)
      .map((file) =>
        stripComments(stripTypeScriptTypes(readFileSync(file, 'utf8'), { mode: 'transform' })),
      )
      .join('\n');
    for (const key of FORBIDDEN_IR_KEYS) expect(text, key).not.toContain(key);
    for (const name of FORBIDDEN_TOOL_LITERALS) {
      expect(text, name).not.toMatch(new RegExp(`['"\`]${name}['"\`]`));
    }
  });
});

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

  it('carries no runtime or peer dependencies on core or the umbrella', () => {
    expect(manifest.peerDependencies ?? {}).toEqual({});
    expect(manifest.dependencies ?? {}).toEqual({});
    expect(manifest.devDependencies ?? {}).not.toHaveProperty('polydeukes');
  });
});
