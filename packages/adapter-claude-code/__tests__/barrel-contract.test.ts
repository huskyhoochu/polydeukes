import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// This package's contract, checked as source text: the barrel carries exactly the symbols a
// consumer reads, and a symbol the barrel does not carry stays exported from its home
// module. This file reads source text ONLY — it must never rebuild dist (no `beforeAll`
// build step, ever): a rebuild while the tree is mid-change locks the session behind the
// fail-closed hook.

const pkgDir = resolve(import.meta.dirname, '..');
const packagesDir = resolve(import.meta.dirname, '../..');
const umbrellaSrc = join(packagesDir, 'polydeukes/src');

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
 * The consumer contract of the `.` entry point: the verbs the umbrella's composition
 * root and generators call, and the spec ingredients they hand those verbs.
 */
const KEPT_EXPORTS: readonly string[] = [
  // umbrella session composition root, each with the spec type its signature names
  'runAdapterPath',
  'RunAdapterPathSpec',
  'AdapterPathOutcome',
  // The dispatch seam's parameter type. A consumer binding its own dispatcher names this to
  // type the callback, and `@polydeukes/core` is a dependency of this package rather than of
  // theirs — so a type the seam names has to come from here.
  'DispatchAdapterView',
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
  // spec ingredients the composition root and the init generators both read
  'COMMAND_ARGS',
  'MUTATING_TOOLS',
  'SHELL_TOOLS',
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
  // typechecker flags, and a kept symbol dropped from it strands the umbrella's imports.
  it('is exactly the consumer contract, no more and no less', () => {
    const barrel = readFileSync(join(pkgDir, 'src/index.ts'), 'utf-8');
    expect([...exportedNames(barrel)].sort()).toEqual([...KEPT_EXPORTS].sort());
  });
});

describe('the barrel against its consumers', () => {
  // The kept list above is written by hand, so it proves nothing on its own: an implementer
  // narrowing the barrel edits both in one pass and the assertion stays green. This derives
  // the demand side from the umbrella's own source instead — every name it imports from this
  // package must be a name this package hands out. Universal over a code path, so it holds
  // as the umbrella grows.
  it('carries every symbol the umbrella imports from it', () => {
    const walkTs = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return walkTs(path);
        return name.endsWith('.ts') ? [path] : [];
      });

    const demanded = new Set<string>();
    for (const file of walkTs(umbrellaSrc)) {
      const src = stripComments(readFileSync(file, 'utf-8'));
      for (const m of src.matchAll(
        /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'@polydeukes\/adapter-claude-code'/g,
      )) {
        for (const raw of (m[1] as string).split(',')) {
          const item = raw.trim().replace(/^type\s+/, '');
          if (item.length > 0) demanded.add(item.split(/\s+as\s+/)[0] as string);
        }
      }
    }

    const barrel = exportedNames(readFileSync(join(pkgDir, 'src/index.ts'), 'utf-8'));
    const unmet = [...demanded].filter((name) => !barrel.has(name)).sort();
    expect(unmet, `umbrella imports not exported by the barrel:\n${unmet.join('\n')}`).toEqual([]);
    // A demand set that collapses to nothing would make the assertion vacuous.
    expect(demanded.size).toBeGreaterThan(0);
  });

  // A verb on the barrel whose signature names a type that is neither on the barrel nor
  // handed out by core gives the consumer a call they cannot give a written type: neither
  // the parameter nor the result can be named through the exports map. The demand side is
  // the kept verbs' own signatures, so a narrowing that strands a type goes red without
  // anyone maintaining a list. Types core hands out are reachable and count as met.
  it('hands out every type its own kept verbs name', () => {
    const BUILTIN = new Set([
      'Promise',
      'Array',
      'Record',
      'Readonly',
      'Omit',
      'Pick',
      'Partial',
      'NonNullable',
    ]);
    const barrel = exportedNames(readFileSync(join(pkgDir, 'src/index.ts'), 'utf-8'));
    const core = exportedNames(readFileSync(join(packagesDir, 'core/src/index.ts'), 'utf-8'));

    const stranded: string[] = [];
    const inspected = new Set<string>();
    for (const file of readdirSync(join(pkgDir, 'src'))) {
      if (!file.endsWith('.ts') || file === 'index.ts') continue;
      const src = stripComments(readFileSync(join(pkgDir, 'src', file), 'utf-8'));
      for (const m of src.matchAll(
        /export (?:async )?function ([A-Za-z_]\w*)\s*\(([\s\S]*?)\)\s*:\s*([\s\S]*?)\s*\{\n/g,
      )) {
        const verb = m[1] as string;
        if (!barrel.has(verb)) continue;
        inspected.add(verb);
        for (const named of new Set(`${m[2]} ${m[3]}`.match(/\b[A-Z]\w*/g) ?? [])) {
          if (barrel.has(named) || core.has(named) || BUILTIN.has(named)) continue;
          stranded.push(`${verb} names ${named}`);
        }
      }
    }
    expect(stranded, `kept verbs naming types off the contract:\n${stranded.join('\n')}`).toEqual(
      [],
    );
    // A signature parser that matches nothing would make the assertion vacuous.
    expect(inspected.size).toBeGreaterThan(0);
  });
});

describe('the dispatch outcome type', () => {
  // A local re-declaration of the core protocol type protects one direction only:
  // structural typing bites when the dispatcher drops a field the copy names, and stays
  // silent when the dispatcher grows one. The core declaration is the single origin, so
  // this module may not declare its own.
  it('run-adapter-path.ts declares no DispatchOutcome of its own', () => {
    const src = stripComments(readFileSync(join(pkgDir, 'src/run-adapter-path.ts'), 'utf-8'));
    const declarations = src.match(/export\s+type\s+DispatchOutcome\b/g) ?? [];
    expect(declarations).toEqual([]);
  });

  // Deleting the local copy without importing the origin would leave the dispatch seam
  // typed against nothing — the file must name core as the type's one source.
  it('run-adapter-path.ts imports DispatchOutcome from core', () => {
    const src = stripComments(readFileSync(join(pkgDir, 'src/run-adapter-path.ts'), 'utf-8'));
    const fromCore = [
      ...src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'@polydeukes\/core'/g),
    ].flatMap((m) => (m[1] as string).split(',').map((raw) => raw.trim().replace(/^type\s+/, '')));
    expect(fromCore).toContain('DispatchOutcome');
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
