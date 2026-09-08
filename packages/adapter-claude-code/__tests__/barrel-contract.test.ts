import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// This package's contract, checked as source text: the barrel carries exactly the symbols a
// consumer reads, and a symbol the barrel does not carry stays exported from its home
// module. This file reads source text ONLY — it must never rebuild dist (no `beforeAll`
// build step, ever): a rebuild while the tree is mid-change locks the session behind the
// fail-closed hook.

const pkgDir = resolve(import.meta.dirname, '..');

// The export-name parser below is deliberately its own copy of the one in the umbrella's
// package-contract test rather than a shared helper. A contract check cannot check itself,
// so independent readers of the same source are the defense: a bug in one parser cannot
// hide the same bug in the other, and sharing them would mean this package's tests
// importing from a sibling package's test directory.
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

/**
 * The consumer contract of the `.` entry point: the verbs the generated delegator and the
 * init generators call, and the spec ingredients they hand those verbs.
 */
const KEPT_EXPORTS: readonly string[] = [
  'transcriptFromJsonlFile',
  'TranscriptFromJsonlFileSpec',
  'transcriptPathFromPayload',
  'TranscriptPathFromPayloadSpec',
  // this surface's supply bodies — the readers the session root injects into the supply
  // layer — each with the spec type its signature names
  'sessionSourceReader',
  'SessionSourceReaderSpec',
  'sessionChannelReader',
  'SessionChannelReaderSpec',
  // the session evidence the umbrella lifts into the IR's `session` key
  'sessionEvidenceFromPayload',
  'SessionEvidenceFromPayloadSpec',
  'SessionEvidenceOutcome',
  // spec ingredients the composition root and the init generators both read
  'COMMAND_ARGS',
  'MUTATING_TOOLS',
  'SHELL_TOOLS',
  // the session entry point the generated delegator calls: builds the IR and spawns
  // `pdks covenant check`, with the spec and outcome types its signature names
  'runHook',
  'RunHookSpec',
  'RunHookOutcome',
];

/**
 * Symbols the barrel does not carry, each under its home module. Narrowing the barrel is
 * not deleting the symbol: every name here stays `export`ed from its module, where this
 * package's own tests reach it.
 */
const MODULE_EXPORTS: Record<string, readonly string[]> = {
  'src/file-changes.ts': ['collectFileChanges'],
  'src/transcript.ts': ['transcriptFromJsonl'],
  'src/up-translate.ts': [
    'buildCovenantInput',
    'ClaudePreToolUsePayload',
    'TranslatedEvent',
    'translateEvent',
  ],
  'src/virtual-post-state.ts': ['VirtualPostState', 'virtualPostState'],
};

describe('the barrel export set', () => {
  // Both ends land here: a symbol left in (or added back to) the barrel is a leak no
  // typechecker flags, and a kept symbol dropped from it strands a consumer's imports.
  it('is exactly the consumer contract, no more and no less', () => {
    const barrel = readFileSync(join(pkgDir, 'src/index.ts'), 'utf-8');
    expect([...exportedNames(barrel)].sort()).toEqual([...KEPT_EXPORTS].sort());
  });
});

describe('un-barreled symbols', () => {
  // "Un-barrel" implemented as deletion: removing a module's `export` along with its barrel
  // line silently erases behavior that only these names reach.
  it('every symbol off the barrel stays exported from its home module', () => {
    const missing: string[] = [];
    for (const [module, names] of Object.entries(MODULE_EXPORTS)) {
      const exported = exportedNames(readFileSync(join(pkgDir, module), 'utf-8'));
      for (const name of names) {
        if (!exported.has(name)) missing.push(`${module}#${name}`);
      }
    }
    expect(missing, `module exports gone:\n${missing.join('\n')}`).toEqual([]);
  });
});

describe('the README against the contract', () => {
  // A README sentence naming a symbol the contract does not carry sends a consumer to an
  // import that does not resolve. The kept list is the fixed side here, so the assertion
  // bites while the barrel itself still carries the symbol.
  it('names no src export outside the kept contract', () => {
    const readme = readFileSync(join(pkgDir, 'README.md'), 'utf-8');
    const srcExports = new Set<string>();
    for (const file of readdirSync(join(pkgDir, 'src'))) {
      if (!file.endsWith('.ts')) continue;
      for (const n of exportedNames(readFileSync(join(pkgDir, 'src', file), 'utf-8'))) {
        srcExports.add(n);
      }
    }
    const named = new Set(
      [...readme.matchAll(new RegExp(`\`(${IDENT})\``, 'g'))].map((m) => m[1] as string),
    );
    const outside = [...named]
      .filter((id) => srcExports.has(id) && !KEPT_EXPORTS.includes(id))
      .sort();
    expect(outside, `README names symbols off the contract:\n${outside.join('\n')}`).toEqual([]);
  });
});

describe("this package's own tests against the barrel", () => {
  // A test that spawns a node process reads the barrel through a path string, so narrowing the
  // contract breaks it at run time and no source-text check sees the import. The e2e that
  // drives ttlWitness over the transcript provider did exactly that, and only the full suite
  // caught it. Home-module dist paths are what a package's own test reads.
  it('reaches dist through home modules, never the barrel', () => {
    const testsDir = join(pkgDir, '__tests__');
    const offenders: string[] = [];
    for (const file of readdirSync(testsDir)) {
      if (!file.endsWith('.ts')) continue;
      const text = stripComments(readFileSync(join(testsDir, file), 'utf-8'));
      for (const m of text.matchAll(/['"`][^'"`]*adapter-claude-code\/dist\/index\.js['"`]/g)) {
        offenders.push(`${file}: ${m[0]}`);
      }
    }
    expect(offenders, `tests reading this package's dist barrel:\n${offenders.join('\n')}`).toEqual(
      [],
    );
  });
});
