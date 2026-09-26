import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { covenantModule } from '../src/covenant/module.ts';

// The judge is a module of the umbrella, not a package beside it. These are text and
// layout oracles over the working tree: which package directories exist, which names no
// file may still spell, which umbrella modules exist and which do not, and what the root
// config protects. This file reads source text ONLY and never rebuilds dist (no
// `beforeAll` build step, ever): a rebuild while the tree is mid-change locks the session
// behind the fail-closed hook.

const repoRoot = resolve(import.meta.dirname, '../../..');
const umbrellaSrc = join(repoRoot, 'packages', 'polydeukes', 'src');
const umbrellaDist = join(repoRoot, 'packages', 'polydeukes', 'dist');

/** The package directories that ship, left after the fold. */
const PACKAGE_DIRS = [
  'adapter-claude-code',
  'adapter-codex',
  'adapter-grok',
  'core',
  'memory',
  'polydeukes',
  'sdk-ts',
];
/** Workspace members that are not published; they carry no copy of the judge. */
const PRIVATE_PACKAGE_DIRS = ['documentation'];
/** The two specifiers the judgment chain never reaches: the memory package and its store. */
const MEMORY_SPECIFIERS = ['@polydeukes/memory', 'node:sqlite'];
/** A specifier the judgment chain does reach — the walk found edges if this is present. */
const VOCABULARY_SPECIFIER = '@polydeukes/core';
/** A specifier bin.ts reaches statically; its subcommand bodies are dynamic, so core is not one. */
const BIN_STATIC_SPECIFIER = 'node:fs';
/**
 * The name and the path the fold retires, assembled so this file is not its own
 * counterexample.
 */
const RETIRED_PACKAGE_NAME = ['@polydeukes', 'covenant'].join('/');
const RETIRED_PACKAGE_PATH = ['packages', 'covenant'].join('/');
/**
 * Where the retired name may still appear: the wiki clone, the release record, and
 * everything the tree does not track (installed modules, build output, the build cache,
 * git's own store, the telemetry log).
 */
const EXCLUDED_DIRS = new Set(['_docs', 'node_modules', 'dist', '.git', '.polydeukes', '.turbo']);
const EXCLUDED_FILES = new Set(['CHANGELOG.md']);
/**
 * Umbrella modules whose text may contain `import(`: bin.ts defers the subcommand bodies,
 * and the memory command module loads the optional memory package on the call alone.
 */
const DYNAMIC_IMPORT_MODULES = new Set(['bin.ts', 'memory-command.ts']);
/** The words the `explain` module may no longer spell: host, VCS, and hook names. */
const EXPLAIN_FOREIGN_WORDS = ['claude-code', 'git', 'hook', 'grok'];
/** The seven verbs the composition roots call on the judge module. */
const COVENANT_MEMBERS = [
  'compileDisciplineRegistrations',
  'dispatchCovenants',
  'planSources',
  'selfModRegistration',
  'shellModRegistration',
  'supplySources',
  'transcriptModRegistration',
];
/** The root config's protected entry for the umbrella's own build output. */
const UMBRELLA_DIST_ENTRY = 'packages/polydeukes/dist';

/** Every file under `dir`, recursively, skipping the excluded directory names at any depth. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (EXCLUDED_DIRS.has(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return EXCLUDED_FILES.has(name) ? [] : [path];
  });
}

/** Repo-relative paths of every tracked-tree file whose text contains `needle`. */
function filesContaining(needle: string): string[] {
  return walk(repoRoot)
    .filter((path) => readFileSync(path, 'utf-8').includes(needle))
    .map((path) => relative(repoRoot, path))
    .sort();
}

const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** Every `.ts` file under the umbrella's `src/`, as `src`-relative paths. */
function umbrellaSources(): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) visit(path);
      else if (name.endsWith('.ts')) out.push(relative(umbrellaSrc, path));
    }
  };
  visit(umbrellaSrc);
  return out.sort();
}

describe('the workspace holds seven packages', () => {
  // The retired package directory left behind keeps a second copy of the judge that no
  // manifest depends on and every path glob still matches.
  it('packages/ lists exactly the seven package directories', () => {
    const present = readdirSync(join(repoRoot, 'packages')).sort();
    expect(present.filter((dir) => !PRIVATE_PACKAGE_DIRS.includes(dir))).toEqual(PACKAGE_DIRS);
  });
});

describe('the retired package name resolves nowhere in the tree', () => {
  // One surviving import of the retired name — a test alias, a manifest dependency, a
  // lockfile entry, a rule's path glob — is a reference `pnpm install` can no longer
  // satisfy, and the first consumer of it crashes before any verdict.
  it('no file spells the retired package name', () => {
    expect(filesContaining(RETIRED_PACKAGE_NAME)).toEqual([]);
  });

  // The path form survives in places the name does not reach: a protected-paths entry, a
  // discipline scope, a release-please extra-file, a rule's `paths:` glob.
  it('no file spells the retired package path', () => {
    expect(filesContaining(RETIRED_PACKAGE_PATH)).toEqual([]);
  });
});

describe('the judge is a static module of the umbrella', () => {
  // The fold landed as a move, not a deletion: the dispatcher sits under `src/covenant/`
  // and no barrel sits beside it (a barrel there would be a package boundary without a
  // package).
  it('src/covenant/ carries the dispatcher and no index barrel', () => {
    expect(existsSync(join(umbrellaSrc, 'covenant', 'dispatch.ts'))).toBe(true);
    expect(existsSync(join(umbrellaSrc, 'covenant', 'index.ts'))).toBe(false);
  });

  // The dist-path loader existed for a state (umbrella dist present, judge dist absent)
  // that a judge inside the umbrella dist cannot reach; kept, it is a second load path
  // the seam tests never exercise.
  it('covenant-module.ts is gone from the umbrella', () => {
    expect(existsSync(join(umbrellaSrc, 'covenant-module.ts'))).toBe(false);
  });

  // The umbrella barrel had zero consumers; kept, it re-exports the change-set surface for
  // every `import 'polydeukes'` and re-widens the contract ① no longer allows.
  it('src/index.ts is gone from the umbrella', () => {
    expect(existsSync(join(umbrellaSrc, 'index.ts'))).toBe(false);
  });

  // A dynamic `import(` anywhere but the listed modules is a judge loaded by path at run
  // time — the shape whose failure lands as a fail-closed exit instead of a build-time error.
  it('no umbrella module outside bin.ts contains a dynamic import', () => {
    const offenders = umbrellaSources().filter(
      (rel) =>
        !DYNAMIC_IMPORT_MODULES.has(rel) &&
        /\bimport\(/.test(stripComments(readFileSync(join(umbrellaSrc, rel), 'utf-8'))),
    );
    expect(offenders).toEqual([]);
  });
});

/**
 * Every module specifier a source file names: `import … from`, `export … from`, a bare
 * side-effect `import '…'`, and — when `dynamic` is set — the string literal of an
 * `import('…')` call. Type-only imports count too: the chain has no reason to name memory.
 */
function specifiersOf(text: string, dynamic: boolean): string[] {
  const src = stripComments(text);
  const found = [
    ...src.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/g),
    ...src.matchAll(/(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g),
    ...(dynamic ? src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g) : []),
  ];
  return found.map((m) => m[1] as string);
}

/**
 * The bare (non-relative) specifiers reachable from `roots` through relative imports —
 * static ones, plus dynamic ones when `dynamic` is set. Relative edges are followed to
 * the `.ts` file they spell.
 */
function reachableSpecifiers(roots: string[], dynamic: boolean): Set<string> {
  const seen = new Set<string>();
  const bare = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of specifiersOf(readFileSync(file, 'utf-8'), dynamic)) {
      if (spec.startsWith('.')) queue.push(resolve(join(file, '..'), spec));
      else bare.add(spec);
    }
  }
  return bare;
}

describe('the judgment chain never reaches memory', () => {
  const chainRoots = [
    join(umbrellaSrc, 'covenant-check.ts'),
    ...umbrellaSources()
      .filter((rel) => rel.startsWith('covenant/'))
      .map((rel) => join(umbrellaSrc, rel)),
  ];

  // One import of the memory package or its SQLite store anywhere under the judge makes
  // every consumer without the optional peer fail closed on every call, and a corrupt
  // index changes a verdict. The vocabulary specifier pins that the walk followed edges.
  it('no specifier reachable from covenant-check.ts or src/covenant/ names @polydeukes/memory or node:sqlite', () => {
    const reached = reachableSpecifiers(chainRoots, true);

    expect(reached.has(VOCABULARY_SPECIFIER)).toBe(true);
    expect(MEMORY_SPECIFIERS.filter((spec) => reached.has(spec))).toEqual([]);
  });

  // ESM imports are eager: a static import of memory anywhere bin.ts reaches statically
  // resolves before argv is read, so `pdks covenant check` and `pdks docs` die at node's
  // exit 1 in every tree that did not install the optional peer. Dynamic edges are left
  // out: the memory branch loads its module on the call alone.
  it('nothing bin.ts reaches through static imports names @polydeukes/memory or node:sqlite', () => {
    const reached = reachableSpecifiers([join(umbrellaSrc, 'bin.ts')], false);

    expect(reached.has(BIN_STATIC_SPECIFIER)).toBe(true);
    expect(MEMORY_SPECIFIERS.filter((spec) => reached.has(spec))).toEqual([]);
  });
});

describe('the judge module carries every verb the roots call', () => {
  // A spread or cast mistake leaves one member undefined; the type still checks and
  // assembly only fails at call time, on the first payload that routes to it.
  it('covenantModule has exactly the seven verbs, each a function', () => {
    expect(Object.keys(covenantModule).sort()).toEqual(COVENANT_MEMBERS);
    expect(Object.values(covenantModule).map((member) => typeof member)).toEqual(
      COVENANT_MEMBERS.map(() => 'function'),
    );
  });

  // The import above resolves to SOURCE; the hook loads dist. A dist whose literal lost a
  // member passes every source-level check while refusing every session call, so the
  // built artifact is read too. Skipped, never rebuilt, when no build exists.
  const builtModule = join(umbrellaDist, 'covenant', 'module.js');
  it.skipIf(!existsSync(builtModule))(
    'the built dist carries the same seven verbs, each a function',
    async () => {
      const built = (await import(pathToFileURL(builtModule).href)) as {
        covenantModule: Record<string, unknown>;
      };
      expect(Object.keys(built.covenantModule).sort()).toEqual(COVENANT_MEMBERS);
      expect(Object.values(built.covenantModule).map((member) => typeof member)).toEqual(
        COVENANT_MEMBERS.map(() => 'function'),
      );
    },
  );
});

describe('explain speaks of input modes, not hosts', () => {
  // The two headers name what is judged (a call IR, a `--diff` change set); a host, VCS,
  // or hook name left in the module puts a surface name back into the header of a
  // command that no longer has one.
  it('explain.ts spells no host, VCS, or hook name', () => {
    const text = readFileSync(join(umbrellaSrc, 'explain.ts'), 'utf-8');
    const found = EXPLAIN_FOREIGN_WORDS.filter((word) =>
      new RegExp(`(?<![\\w])${word}(?![\\w])`).test(text),
    );
    expect(found).toEqual([]);
  });
});

describe('the root config protects the dists that exist', () => {
  const config = parse(readFileSync(join(repoRoot, 'polydeukes.config.yaml'), 'utf-8')) as {
    protectedPaths: string[];
  };

  // An entry for a directory that no build produces matches nothing and reads as still
  // protected; the umbrella entry beside it is what the folded judge's dist now sits under.
  it('lists the umbrella dist and no entry under the retired package path', () => {
    expect(config.protectedPaths).toContain(UMBRELLA_DIST_ENTRY);
    expect(config.protectedPaths.filter((entry) => entry.startsWith(RETIRED_PACKAGE_PATH))).toEqual(
      [],
    );
  });
});
