import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The package contract, checked as source text: which entry points a
// manifest may declare, that every code entry point's barrel is re-exports only, and that a
// README names no symbol outside its entry points' barrels. This file reads source text ONLY — it must
// never rebuild dist (no `beforeAll` build step, ever): a rebuild while the tree is
// mid-change locks the session behind the fail-closed hook.
//
// The ratchet: a (package, check) pair listed in KNOWN_VIOLATIONS must still fail its check
// (so the list cannot rot), its violations must all come from the listed entry point (so a
// second entry point cannot decay behind the first), and every unlisted pair must be clean.
// Application tickets shrink the list to [].

const repoRoot = resolve(import.meta.dirname, '../../..');

type Check = '①' | '②' | '⑤';
const CHECKS: readonly Check[] = ['①', '②', '⑤'];
interface Violation {
  package: string;
  check: Check;
  detail: string;
}

/**
 * Current violations, each scoped to the one entry point that carries it. Application tickets
 * shrink this; it ends as []. Adding an entry is a review event.
 */
const KNOWN_VIOLATIONS: { package: string; check: Check; entryPoint: string }[] = [
  { package: '@polydeukes/core', check: '②', entryPoint: '.' }, // index.ts defines FileChange, CovenantInput, CovenantVerdict, parseInput, allFileChanges, verdictToExitCode
  { package: '@polydeukes/adapter-git', check: '②', entryPoint: '.' }, // index.ts defines STAGED_WRITE, STAGED_DELETE, StagedChange, covenantInputFromStagedChanges
  { package: 'polydeukes', check: '②', entryPoint: './claude-code' }, // points at src/claude-code-hook.ts, a module, not a barrel
];

/** The only manifest allowed to publish surface entry points. */
const UMBRELLA_NAME = 'polydeukes';
/**
 * The closed list of surface entry points. Adding a surface means editing this literal —
 * the diff is the deliberate friction that shows "a surface grew" in review.
 */
const SURFACE_ENTRY_POINTS: readonly string[] = ['./claude-code'];

type ExportsMap = Record<string, string | Record<string, string>>;
/** A package as the checks see it: a name, an exports map, and text reachable by relative path. */
interface Pkg {
  name: string;
  exports: ExportsMap;
  /** `src/index.ts`, `README.md`, … — `undefined` when the package has no such file. */
  readFile: (rel: string) => string | undefined;
  /** Relative paths of every `.ts` file under `src/`. */
  srcFiles: string[];
}

const IDENT = '[A-Za-z_][A-Za-z0-9_]*';

const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** Non-blank `;`-terminated statements of a source file, comments removed. */
const statements = (text: string): string[] =>
  stripComments(text)
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

const RE_EXPORT = /^export\s+(type\s+)?\{[^}]*\}\s+from\s+['"]([^'"]+)['"]$/;

/** Resolves an exports value to its import target (string form or `import`/`default` condition). */
const importTarget = (value: string | Record<string, string>): string | undefined =>
  typeof value === 'string' ? value : (value.import ?? value.default);

/** A data entry point is a `.json` subpath that also points at a `.json` file. */
const isDataEntryPoint = (key: string, value: string | Record<string, string>): boolean =>
  key.endsWith('.json') && (importTarget(value)?.endsWith('.json') ?? false);

/** Every code entry point with the barrel source it points at (`./dist/<name>.js` ↔ `src/<name>.ts`). */
const codeEntryPoints = (
  exports: ExportsMap,
): { key: string; target: string | undefined; barrel: string | undefined }[] =>
  Object.entries(exports)
    .filter(([key, value]) => !isDataEntryPoint(key, value))
    .map(([key, value]) => {
      const target = importTarget(value);
      const module = target?.match(/^\.\/dist\/(.+)\.js$/)?.[1];
      return { key, target, barrel: module === undefined ? undefined : `src/${module}.ts` };
    });

const walkTs = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walkTs(path);
    return name.endsWith('.ts') ? [path] : [];
  });

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

const checkEntryPoints = ({ name, exports }: Pkg): Violation[] => {
  const keys = Object.keys(exports);
  const out: Violation[] = [];
  if (!keys.includes('.'))
    out.push({ package: name, check: '①', detail: 'missing "." entry point' });
  for (const key of keys) {
    if (key === '.' || isDataEntryPoint(key, exports[key] as string)) continue;
    if (key.endsWith('.json')) {
      out.push({
        package: name,
        check: '①',
        detail: `data entry point ${key} must point at a .json file`,
      });
      continue;
    }
    if (name === UMBRELLA_NAME && SURFACE_ENTRY_POINTS.includes(key)) continue;
    out.push({ package: name, check: '①', detail: `entry point not allowed: ${key}` });
  }
  return out;
};

const checkBarrels = ({ name, exports, readFile }: Pkg): Violation[] => {
  const out: Violation[] = [];
  for (const { key, target, barrel } of codeEntryPoints(exports)) {
    if (barrel === undefined) {
      out.push({
        package: name,
        check: '②',
        detail: `${key} target is not ./dist/<name>.js (${target})`,
      });
      continue;
    }
    for (const stmt of statements(readFile(barrel) ?? '')) {
      const m = stmt.match(RE_EXPORT);
      const firstLine = stmt.split('\n')[0] as string;
      if (!m) {
        out.push({ package: name, check: '②', detail: `${key} (${barrel}): ${firstLine}` });
      } else if (name === UMBRELLA_NAME && m[2]?.startsWith('@polydeukes/') && !m[1]) {
        out.push({
          package: name,
          check: '②',
          detail: `${key} runtime re-export from sibling: ${firstLine}`,
        });
      }
    }
  }
  return out;
};

const checkReadme = ({ name, exports, readFile, srcFiles }: Pkg): Violation[] => {
  const readme = readFile('README.md') ?? '';
  const srcExports = new Set<string>();
  for (const file of srcFiles) {
    for (const n of exportedNames(readFile(file) ?? '')) srcExports.add(n);
  }
  // The contract is the union of every code entry point's barrel, not `.` alone.
  const barrelExports = new Set<string>();
  for (const { barrel } of codeEntryPoints(exports)) {
    for (const n of exportedNames(readFile(barrel ?? '') ?? '')) barrelExports.add(n);
  }
  const named = new Set(
    [...readme.matchAll(new RegExp(`\`(${IDENT})\``, 'g'))].map((m) => m[1] as string),
  );
  return [...named]
    .filter((id) => srcExports.has(id) && !barrelExports.has(id))
    .map((id) => ({
      package: name,
      check: '⑤' as const,
      detail: `README names ${id}, exported in src but not by the barrel`,
    }));
};

const collect = (pkg: Pkg): Violation[] => [
  ...checkEntryPoints(pkg),
  ...checkBarrels(pkg),
  ...checkReadme(pkg),
];

interface Manifest {
  name: string;
  private?: boolean;
  exports?: ExportsMap;
}

/** Publishable packages — same domain `pnpm -r publish` acts on (manifest not private). */
const PACKAGES: Pkg[] = readdirSync(join(repoRoot, 'packages'))
  .map((dirName): { dir: string; manifest: Manifest } => {
    const dir = join(repoRoot, 'packages', dirName);
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')) as Manifest;
    return { dir, manifest };
  })
  .filter((p) => p.manifest.private !== true)
  .map(({ dir, manifest }) => ({
    name: manifest.name,
    exports: manifest.exports ?? {},
    readFile: (rel: string) => {
      try {
        return readFileSync(join(dir, rel), 'utf-8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },
    srcFiles: walkTs(join(dir, 'src')).map((path) => relative(dir, path)),
  }));

describe('package contract', () => {
  for (const pkg of PACKAGES) {
    const name = pkg.name;
    for (const check of CHECKS) {
      const listed = KNOWN_VIOLATIONS.find((k) => k.package === name && k.check === check);
      // ①: a new subpath (e.g. `./extra`) or a dropped `.` goes green.
      // ②: a definition, `import`, or `export *` in a barrel goes green; an umbrella runtime
      //    re-export from a sibling goes green.
      // ⑤: a README naming an internal-module export the barrel dropped goes green.
      // Listed pairs: a fixed violation left in KNOWN_VIOLATIONS lets the list rot, and a
      //    violation on an entry point other than the listed one hides behind the debt.
      it(`${check} ${name}${listed ? ' (listed in KNOWN_VIOLATIONS)' : ''}`, () => {
        const details = collect(pkg)
          .filter((v) => v.check === check)
          .map((v) => v.detail);
        if (listed) {
          const scoped = details.filter((d) => d.startsWith(`${listed.entryPoint} `));
          expect(
            scoped.length,
            'expected violation is gone — remove it from KNOWN_VIOLATIONS',
          ).toBeGreaterThan(0);
          const elsewhere = details.filter((d) => !scoped.includes(d));
          expect(
            elsewhere,
            `${check} violations in ${name} outside ${listed.entryPoint}:\n${elsewhere.join('\n')}`,
          ).toEqual([]);
        } else {
          expect(details, `${check} violations in ${name}:\n${details.join('\n')}`).toEqual([]);
        }
      });
    }
  }

  // A KNOWN_VIOLATIONS entry naming a package that no longer exists would never fire.
  it('every KNOWN_VIOLATIONS entry names a publishable package', () => {
    const names = PACKAGES.map((p) => p.name);
    expect(KNOWN_VIOLATIONS.filter((k) => !names.includes(k.package))).toEqual([]);
  });

  // Dropping `./claude-code` from the umbrella manifest would pass ① silently (the closed
  // list only bounds what may exist, not what must).
  it('umbrella exports every surface entry point in the closed list', () => {
    const umbrella = PACKAGES.find((p) => p.name === UMBRELLA_NAME);
    expect(Object.keys(umbrella?.exports ?? {})).toEqual(
      expect.arrayContaining([...SURFACE_ENTRY_POINTS]),
    );
  });
});

// Both ends of each axis, on packages built in memory: the repo happens to sit at one end of
// most of them, and mutating it to reach the other end is what the ratchet forbids.
const synthetic = (name: string, files: Record<string, string>, exports: ExportsMap): Pkg => ({
  name,
  exports,
  readFile: (rel) => files[rel],
  srcFiles: Object.keys(files).filter((rel) => rel.endsWith('.ts')),
});

const BARREL_ENTRY: ExportsMap = { '.': { import: './dist/index.js' } };
const barrelPkg = (name: string, index: string): Pkg =>
  synthetic(name, { 'src/index.ts': index, 'README.md': '' }, BARREL_ENTRY);

interface Row {
  label: string;
  check: Check;
  pkg: Pkg;
  violates: boolean;
}

const ROWS: Row[] = [
  {
    label: '① `./extra` on a sibling is not an allowed entry point',
    check: '①',
    pkg: synthetic('@polydeukes/sib', {}, { '.': './dist/index.js', './extra': './dist/x.js' }),
    violates: true,
  },
  {
    label: "① `./claude-code` on a sibling — the surface list is the umbrella's alone",
    check: '①',
    pkg: synthetic(
      '@polydeukes/sib',
      {},
      { '.': './dist/index.js', './claude-code': './dist/c.js' },
    ),
    violates: true,
  },
  {
    label: '① a manifest with no `.` entry point',
    check: '①',
    pkg: synthetic('@polydeukes/sib', {}, { './schema.json': './schema.json' }),
    violates: true,
  },
  {
    label: '① a `.json` subpath is a data entry point',
    check: '①',
    pkg: synthetic(
      '@polydeukes/sib',
      {},
      { '.': './dist/index.js', './anything.json': './a.json' },
    ),
    violates: false,
  },
  {
    label: '① a `.json` subpath pointing at a `.js` module is not a data entry point',
    check: '①',
    pkg: synthetic(
      '@polydeukes/sib',
      {},
      { '.': './dist/index.js', './config.json': './dist/anything.js' },
    ),
    violates: true,
  },
  {
    label: '② `export *` in a barrel',
    check: '②',
    pkg: barrelPkg('@polydeukes/sib', `export * from './x.js';`),
    violates: true,
  },
  {
    label: '② `export * as ns` in a barrel — a namespace is the whole module, not a name',
    check: '②',
    pkg: barrelPkg('@polydeukes/sib', `export * as ns from './x.js';`),
    violates: true,
  },
  {
    label: '② `import type` in a barrel — a re-export needs no import',
    check: '②',
    pkg: barrelPkg(
      '@polydeukes/sib',
      `import type { A } from './a.js';\nexport type { A } from './a.js';`,
    ),
    violates: true,
  },
  {
    label: '② a definition in a barrel',
    check: '②',
    pkg: barrelPkg('@polydeukes/sib', `export const X = 1;`),
    violates: true,
  },
  {
    label: '② an `import` in a barrel, even beside a valid re-export',
    check: '②',
    pkg: barrelPkg('@polydeukes/sib', `import { a } from './a.js';\nexport { a } from './a.js';`),
    violates: true,
  },
  {
    label: '② comments and a `export type … from` line',
    check: '②',
    pkg: barrelPkg(
      '@polydeukes/sib',
      `// line comment\n/* block */\nexport type { A } from './a.js';`,
    ),
    violates: false,
  },
  {
    label: '② the umbrella re-exporting a sibling verb at runtime',
    check: '②',
    pkg: barrelPkg(UMBRELLA_NAME, `export { runX } from '@polydeukes/core';`),
    violates: true,
  },
  {
    label: '② the umbrella re-exporting a sibling type',
    check: '②',
    pkg: barrelPkg(UMBRELLA_NAME, `export type { T } from '@polydeukes/core';`),
    violates: false,
  },
  {
    label: '⑤ README names a symbol src exports and the barrel dropped',
    check: '⑤',
    pkg: synthetic(
      '@polydeukes/sib',
      {
        'src/index.ts': `export { shown } from './m.js';`,
        'src/m.ts': `export const shown = 1;\nexport const hidden = 2;`,
        'README.md': 'Call `hidden` to do the thing.',
      },
      BARREL_ENTRY,
    ),
    violates: true,
  },
  {
    label: '⑤ README names a `export default function` the barrel dropped',
    check: '⑤',
    pkg: synthetic(
      '@polydeukes/sib',
      {
        'src/index.ts': `export { shown } from './m.js';`,
        'src/m.ts': `export const shown = 1;\nexport default function hidden() {}`,
        'README.md': 'Call `hidden` to do the thing.',
      },
      BARREL_ENTRY,
    ),
    violates: true,
  },
  {
    label: '⑤ README names a symbol carried by a second code entry point',
    check: '⑤',
    pkg: synthetic(
      UMBRELLA_NAME,
      {
        'src/index.ts': `export { a } from './a.js';`,
        'src/claude-code.ts': `export { runHook } from './hook.js';`,
        'src/a.ts': `export const a = 1;`,
        'src/hook.ts': `export const runHook = () => 0;`,
        'README.md': 'Call `runHook` from the session surface.',
      },
      { '.': { import: './dist/index.js' }, './claude-code': { import: './dist/claude-code.js' } },
    ),
    violates: false,
  },
  {
    label: '⑤ README names a config key no src module exports',
    check: '⑤',
    pkg: synthetic(
      '@polydeukes/sib',
      {
        'src/index.ts': `export { shown } from './m.js';`,
        'src/m.ts': `export const shown = 1;`,
        'README.md': 'The `forbid` key takes a pattern.',
      },
      BARREL_ENTRY,
    ),
    violates: false,
  },
  {
    label: '⑤ README names the alias a barrel re-exports under',
    check: '⑤',
    pkg: synthetic(
      '@polydeukes/sib',
      {
        'src/index.ts': `export { a as b } from './m.js';`,
        'src/m.ts': `export const a = 1;`,
        'README.md': 'Call `b` to do the thing.',
      },
      BARREL_ENTRY,
    ),
    violates: false,
  },
];

describe('synthetic fixtures', () => {
  it.each(ROWS)('$label', ({ check, pkg, violates }) => {
    const details = collect(pkg)
      .filter((v) => v.check === check)
      .map((v) => v.detail);
    if (violates) expect(details.length, 'expected a violation, got none').toBeGreaterThan(0);
    else expect(details, `unexpected ${check} violations:\n${details.join('\n')}`).toEqual([]);
  });
});
