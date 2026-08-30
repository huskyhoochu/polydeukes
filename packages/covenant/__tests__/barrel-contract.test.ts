import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { DispatchOutcome } from '@polydeukes/core';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { dispatchCovenants } from '../src/dispatch.ts';

// This package's contract, checked as source text: the barrel carries exactly the symbols a
// consumer reads, and a symbol the barrel does not carry stays exported from its home
// module. This file reads source text ONLY — it must never rebuild dist (no `beforeAll`
// build step, ever): a rebuild while the tree is mid-change locks the session behind the
// fail-closed hook.

const pkgDir = resolve(import.meta.dirname, '..');
const packagesDir = resolve(import.meta.dirname, '../..');
const umbrellaSrc = join(packagesDir, 'polydeukes/src');

// The export-name parser below is deliberately a second copy of the one in the umbrella's
// package-contract test rather than a shared helper. A contract check cannot check itself,
// so two independent readers of the same source is the whole defense: a bug in one parser
// cannot hide the same bug in the other, and sharing them would trade that for the smaller
// win of one fewer function. Sharing would also mean this package's tests importing from a
// sibling package's test directory.
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
 * The consumer contract of the `.` entry point, grouped by who reads each symbol: the
 * umbrella's static imports, the verbs (each with its spec type) the two composition roots
 * call through the covenant module, and the symbols the package README names.
 */
const KEPT_EXPORTS: readonly string[] = [
  // umbrella static imports
  'CovenantRegistration',
  'findUnattributed',
  'readBaseline',
  'snapshotBaseline',
  'writeBaseline',
  // the baseline verbs' own parameter and result types
  'BaselineSnapshot',
  'StoredBaseline',
  'ttlWitness',
  'TtlWitnessSpec',
  // composition-root calls through the covenant module, each verb with its spec type
  'selfModRegistration',
  'SelfModRegistrationSpec',
  'shellModRegistration',
  'ShellModRegistrationSpec',
  'transcriptModRegistration',
  'TranscriptModRegistrationSpec',
  'compileDisciplineRegistrations',
  'CompileDisciplinesSpec',
  'dispatchCovenants',
  'planSources',
  'PlanSourcesSpec',
  'SourcePlan',
  'supplySources',
  'SupplySourcesSpec',
  'SuppliedSources',
  // README-named symbols
  'runCovenant',
  'RunCovenantSpec',
  'compileDeclaration',
  'judgeDeclaration',
  'witnessOpens',
  'World',
  'worldsFromInput',
  // the declaration verbs' own parameter and result types
  'CompiledDeclaration',
  'ConfigFault',
  'DeclarationVerdict',
  'SuppliedWorld',
];

/**
 * Symbols the barrel does not carry, each under its home module. Narrowing the barrel is
 * not deleting the symbol: every name here stays `export`ed from its module, where this
 * package's own tests reach it.
 */
const MODULE_EXPORTS: Record<string, readonly string[]> = {
  'src/baseline.ts': ['BaselineSnapshot', 'StoredBaseline'],
  'src/bash-line.ts': [
    'extractMutations',
    'Indeterminate',
    'MutationAnalysis',
    'MutationRule',
    'MutationTarget',
    'RedirectToken',
    'SimpleCommand',
    'TokenizeResult',
    'tokenizeCommandLine',
    'WordToken',
  ],
  'src/declaration-engine.ts': [
    'Break',
    'EXTRACT_STEPS',
    'Item',
    'Items',
    'PairedItems',
    'scopeAdmits',
    'UNARY_STEP_NAMES',
    'Witness',
  ],
  'src/delta.ts': [
    'Baseline',
    'captureBaseline',
    'diffBaselines',
    'FileDelta',
    'judgeAddedViolations',
  ],
  'src/discipline.ts': ['judgeDiscipline', 'SuppliedWorld'],
  'src/dispatch.ts': ['matchRegistrations'],
  'src/mention.ts': ['mentionsPath', 'pathMatchesProtected'],
  'src/mutation-rules.ts': ['redirectWriteRule', 'sedInPlaceRule', 'teeRule'],
  'src/run-covenant.ts': [
    'JudgeOutcome',
    'outcomeFromVerdict',
    'translateExitCode',
    'UNJUDGEABLE_OUTCOME',
  ],
  'src/self-mod.ts': ['judgeSelfModification', 'SelfModificationSpec'],
  'src/shell-mod.ts': [
    'DEFAULT_READ_ONLY_COMMANDS',
    'judgeShellModification',
    'ShellModificationSpec',
  ],
  'src/transcript-mod.ts': ['judgeTranscriptModification', 'TranscriptModificationSpec'],
};

describe('the barrel export set', () => {
  // Both ends land here: a symbol left in (or added back to) the barrel is a leak no
  // typechecker flags, and a kept symbol dropped from it loses the README-named entry
  // points silently — they have no static importer, so nothing else goes red.
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
  // as the umbrella grows. It reaches only the symbols the umbrella NAMES; the spec types
  // it passes structurally, and the README-named entry points, are the kept list's own axis.
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
        /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'@polydeukes\/covenant'/g,
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

  // The second derived axis, and the one the umbrella scan above cannot see. A verb on the
  // barrel whose signature names a type that is NOT on the barrel hands the consumer a call
  // they cannot give a written type: neither the parameter nor the result can be named
  // through the exports map, and a declaration-emitting build fails on it. The demand side
  // here is the kept verbs' own signatures, so narrowing that strands a type goes red
  // without anyone maintaining a list. Types core hands out are reachable and count as met.
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
    for (const file of readdirSync(join(pkgDir, 'src'))) {
      if (!file.endsWith('.ts') || file === 'index.ts') continue;
      const src = stripComments(readFileSync(join(pkgDir, 'src', file), 'utf-8'));
      for (const m of src.matchAll(
        /export (?:async )?function ([A-Za-z_]\w*)\s*\(([\s\S]*?)\)\s*:\s*([\s\S]*?)\s*\{\n/g,
      )) {
        const verb = m[1] as string;
        if (!barrel.has(verb)) continue;
        for (const named of new Set(`${m[2]} ${m[3]}`.match(/\b[A-Z]\w*/g) ?? [])) {
          if (barrel.has(named) || core.has(named) || BUILTIN.has(named)) continue;
          stranded.push(`${verb} names ${named}`);
        }
      }
    }
    expect(stranded, `kept verbs naming types off the contract:\n${stranded.join('\n')}`).toEqual(
      [],
    );
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

// A compile-time fact: `tsc --noEmit` checks it, the test runner strips it. It runs as a
// no-op so the suite stays green at runtime while the type contract is the thing going red.
describe('the dispatch outcome type', () => {
  // An anonymous return literal drifting from the named core type leaves the contract
  // unnamed again the moment either side changes.
  it('dispatchCovenants resolves to exactly the core DispatchOutcome', () => {
    expectTypeOf<Awaited<ReturnType<typeof dispatchCovenants>>>().toEqualTypeOf<DispatchOutcome>();
  });
});
