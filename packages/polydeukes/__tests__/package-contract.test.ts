import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The package contract, checked as source text: which entry points a
// manifest may declare, that every code entry point's barrel is re-exports only, and that a
// README names no symbol outside its entry points' barrels. Three more read the same text:
// every executor verb a barrel carries takes one `<Name>Spec` parameter and returns one named
// type; every constant an executor barrel carries is consumed by a sibling package's src; and
// no test file imports its own package's barrel. This file reads source text ONLY — it must
// never rebuild dist (no `beforeAll` build step, ever): a rebuild while the tree is
// mid-change locks the session behind the fail-closed hook.
//
// The ratchet: a (package, check) pair listed in KNOWN_VIOLATIONS must still fail its check
// (so the list cannot rot), its violations must all come from the listed entry point (so a
// second entry point cannot decay behind the first), and every unlisted pair must be clean.
// Application tickets shrink the list to [].

const repoRoot = resolve(import.meta.dirname, '../../..');

type Check = '①' | '②' | '③' | '④' | '⑤' | '⑥';
const CHECKS: readonly Check[] = ['①', '②', '③', '④', '⑤', '⑥'];
interface Violation {
  package: string;
  check: Check;
  detail: string;
}

/**
 * Current violations, each scoped to the one entry point that carries it. Application tickets
 * shrink this; it ends as []. Adding an entry is a review event.
 */
const KNOWN_VIOLATIONS: { package: string; check: Check; entryPoint: string }[] = [];

/** The only manifest allowed to publish surface entry points. */
const UMBRELLA_NAME = 'polydeukes';
/** The vocabulary package: its functions are positional, so the verb and constant checks skip it. */
const VOCABULARY_NAME = '@polydeukes/core';
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
  /** Relative paths of every `.ts` file under `__tests__/`. */
  testFiles: string[];
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

/**
 * Runtime names a barrel re-exports from its own package, each with the home module that
 * defines it (`./m.js` beside the barrel ↔ `src/m.ts`). `export type { … }` statements,
 * `type`-prefixed names, and sibling-package re-exports carry no runtime symbol of this
 * package and are left out. An aliased name is reported by its local (defining) name.
 */
const runtimeReExports = (barrel: string, text: string): { name: string; module: string }[] => {
  const out: { name: string; module: string }[] = [];
  for (const stmt of statements(text)) {
    const m = stmt.match(RE_EXPORT);
    if (!m || m[1] || !(m[2] as string).startsWith('./')) continue;
    const module = posix.join(posix.dirname(barrel), (m[2] as string).replace(/\.js$/, '.ts'));
    const list = stmt.slice(stmt.indexOf('{') + 1, stmt.indexOf('}'));
    for (const raw of list.split(',')) {
      const item = raw.trim();
      if (item.length === 0 || /^type\s/.test(item)) continue;
      out.push({ name: (item.split(/\s+as\s+/)[0] as string).trim(), module });
    }
  }
  return out;
};

const OPENERS = '([{<';
const CLOSERS = ')]}>';
/** Bracket depth step for one character; the `>` of an arrow `=>` is not a closer. */
const depthStep = (text: string, i: number): number => {
  const ch = text[i] as string;
  if (ch === '>' && text[i - 1] === '=') return 0;
  if (OPENERS.includes(ch)) return 1;
  if (CLOSERS.includes(ch)) return -1;
  return 0;
};

/** Index of the bracket closing the one at `open`, or -1 when the text runs out first. */
const matchingBracket = (text: string, open: number): number => {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    depth += depthStep(text, i);
    if (depth === 0) return i;
  }
  return -1;
};

/** Splits on commas outside every bracket pair; a trailing comma yields no extra piece. */
const splitTopLevelCommas = (text: string): string[] => {
  const pieces: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    depth += depthStep(text, i);
    if (depth === 0 && text[i] === ',') {
      pieces.push(text.slice(start, i));
      start = i + 1;
    }
  }
  pieces.push(text.slice(start));
  return pieces.map((p) => p.trim()).filter((p) => p.length > 0);
};

interface Signature {
  /** Text between the parameter list's parentheses. */
  params: string;
  /** Text of the return annotation, `undefined` when the definition has none. */
  returns: string | undefined;
}

/**
 * The parameter list and return annotation of `export (async )?function <name>` in a module,
 * sliced by bracket matching rather than by `;`: a signature spans lines and an object type
 * inside it carries `;` separators. `undefined` when the module defines no such function.
 */
const functionSignature = (moduleText: string, name: string): Signature | undefined => {
  const src = stripComments(moduleText);
  const head = new RegExp(`export\\s+(?:default\\s+)?(?:async\\s+)?function\\s+${name}\\b`).exec(
    src,
  );
  if (!head) return undefined;
  let i = head.index + head[0].length;
  const skipSpace = () => {
    while (/\s/.test(src[i] ?? '')) i++;
  };
  skipSpace();
  if (src[i] === '<') {
    i = matchingBracket(src, i) + 1;
    skipSpace();
  }
  if (src[i] !== '(') return undefined;
  const close = matchingBracket(src, i);
  const params = src.slice(i + 1, close);
  i = close + 1;
  skipSpace();
  if (src[i] !== ':') return { params, returns: undefined };
  const start = i + 1;
  // The body brace is the first depth-0 `{` that follows a completed type — one after an
  // identifier, `]`, `)`, `}`, or a generic's `>`; a `{` after `:`, `&`, `|`, or `=>` opens
  // an object type instead.
  let depth = 0;
  for (i = start; i < src.length; i++) {
    if (src[i] === '{' && depth === 0) {
      const before = src.slice(start, i).trimEnd();
      if (/[A-Za-z0-9_\])}>]$/.test(before) && !before.endsWith('=>')) break;
    }
    depth += depthStep(src, i);
  }
  return { params, returns: src.slice(start, i).trim() };
};

const NAMED = `${IDENT}(?:\\[\\])?`;
/** A named result: a `|` union of identifiers (array form allowed), bare or inside `Promise<…>`. */
const UNION = `${NAMED}(?:\\s*\\|\\s*${NAMED})*`;
const NAMED_RETURN_FORMS: readonly RegExp[] = [
  new RegExp(`^${UNION}$`),
  new RegExp(`^Promise<\\s*${UNION}\\s*>$`),
];

/** Every way a signature leaves the executor skeleton, in words a reader can act on. */
const verbShapeFaults = ({ params, returns }: Signature): string[] => {
  const out: string[] = [];
  const list = splitTopLevelCommas(params);
  if (list.length !== 1) {
    out.push(`takes ${list.length} parameters, expected 1`);
  } else {
    const param = list[0] as string;
    let colon = -1;
    let depth = 0;
    for (let i = 0; i < param.length && colon === -1; i++) {
      depth += depthStep(param, i);
      if (depth === 0 && param[i] === ':') colon = i;
    }
    const annotation = colon === -1 ? undefined : param.slice(colon + 1).trim();
    if (annotation === undefined) out.push('parameter has no type annotation');
    else if (!new RegExp(`^${IDENT}$`).test(annotation) || !annotation.endsWith('Spec'))
      out.push(`parameter type is \`${annotation}\`, expected one identifier ending in Spec`);
  }
  if (returns === undefined) {
    out.push('return type is missing');
  } else {
    const flat = returns.replace(/\s+/g, ' ');
    if (!NAMED_RETURN_FORMS.some((re) => re.test(flat)))
      out.push(
        `return type is \`${flat}\`, expected a named type, Promise<named>, or a union of named types`,
      );
  }
  return out;
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

/** Every runtime symbol an executor barrel carries, with its home module's text. */
const executorSymbols = ({
  exports,
  readFile,
}: Pkg): { key: string; barrel: string; symbol: string; moduleText: string }[] =>
  codeEntryPoints(exports).flatMap(({ key, barrel }) =>
    barrel === undefined
      ? []
      : runtimeReExports(barrel, readFile(barrel) ?? '').map(({ name, module }) => ({
          key,
          barrel,
          symbol: name,
          moduleText: readFile(module) ?? '',
        })),
  );

const ARROW_CONST = (symbol: string): RegExp =>
  new RegExp(
    `export\\s+const\\s+${symbol}\\s*(?::[^=]*)?=\\s*(?:async\\s*)?(?:\\(|[A-Za-z_$][\\w$]*\\s*=>)`,
  );

const checkVerbs = (pkg: Pkg): Violation[] => {
  if (pkg.name === VOCABULARY_NAME) return [];
  const out: Violation[] = [];
  for (const { key, barrel, symbol, moduleText } of executorSymbols(pkg)) {
    const signature = functionSignature(moduleText, symbol);
    if (signature === undefined) {
      // A verb spelled as an arrow constant has no `function` head to slice, so it would
      // fall through to ④ as a constant and never be shape-checked.
      if (ARROW_CONST(symbol).test(stripComments(moduleText))) {
        out.push({
          package: pkg.name,
          check: '③',
          detail: `${key} (${barrel}): ${symbol} — declared as an arrow constant, not a function`,
        });
      }
      continue;
    }
    for (const reason of verbShapeFaults(signature)) {
      out.push({
        package: pkg.name,
        check: '③',
        detail: `${key} (${barrel}): ${symbol} — ${reason}`,
      });
    }
  }
  return out;
};

const checkConstants = (pkg: Pkg, siblings: Pkg[]): Violation[] => {
  if (pkg.name === VOCABULARY_NAME) return [];
  const siblingSrc = siblings
    .filter((s) => s.name !== pkg.name)
    .flatMap((s) => s.srcFiles.map((file) => stripComments(s.readFile(file) ?? '')))
    .join('\n');
  const out: Violation[] = [];
  for (const { key, barrel, symbol, moduleText } of executorSymbols(pkg)) {
    const isConstant = new RegExp(`export\\s+const\\s+${symbol}\\b`).test(
      stripComments(moduleText),
    );
    if (!isConstant) continue;
    if (!new RegExp(`\\b${symbol}\\b`).test(siblingSrc)) {
      out.push({
        package: pkg.name,
        check: '④',
        detail: `${key} (${barrel}): ${symbol} — no sibling package's src consumes it`,
      });
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

/** Any relative spelling of the barrel, from any depth under `__tests__`. */
const BARREL_IMPORT = /from\s+['"](?:\.\.\/)+src\/index(?:\.[tj]s)?['"]/;

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A test reaches its own barrel two ways: the relative path, or the package's own name. */
const importsOwnBarrel = (name: string, text: string): boolean =>
  BARREL_IMPORT.test(text) || new RegExp(`from\\s+['"]${escapeRegExp(name)}['"]`).test(text);

const checkTestImports = ({ name, readFile, testFiles }: Pkg): Violation[] =>
  testFiles
    .filter((file) => importsOwnBarrel(name, readFile(file) ?? ''))
    .map((file) => ({ package: name, check: '⑥' as const, detail: `${file}: imports the barrel` }));

const collect = (pkg: Pkg, siblings: Pkg[]): Violation[] => [
  ...checkEntryPoints(pkg),
  ...checkBarrels(pkg),
  ...checkVerbs(pkg),
  ...checkConstants(pkg, siblings),
  ...checkReadme(pkg),
  ...checkTestImports(pkg),
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
    testFiles: existsSync(join(dir, '__tests__'))
      ? walkTs(join(dir, '__tests__')).map((path) => relative(dir, path))
      : [],
  }));

describe('package contract', () => {
  for (const pkg of PACKAGES) {
    const name = pkg.name;
    for (const check of CHECKS) {
      const listed = KNOWN_VIOLATIONS.find((k) => k.package === name && k.check === check);
      // ①: a new subpath (e.g. `./extra`) or a dropped `.` goes green.
      // ②: a definition, `import`, or `export *` in a barrel goes green; an umbrella runtime
      //    re-export from a sibling goes green.
      // ③: an executor verb taking a second positional parameter, an inline spec literal, or
      //    returning an anonymous literal goes green.
      // ④: a barrel constant no sibling package consumes goes green.
      // ⑤: a README naming an internal-module export the barrel dropped goes green.
      // ⑥: a test importing its own package's barrel goes green.
      // Listed pairs: a fixed violation left in KNOWN_VIOLATIONS lets the list rot, and a
      //    violation on an entry point other than the listed one hides behind the debt.
      it(`${check} ${name}${listed ? ' (listed in KNOWN_VIOLATIONS)' : ''}`, () => {
        const details = collect(pkg, PACKAGES)
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
  srcFiles: Object.keys(files).filter((rel) => rel.startsWith('src/') && rel.endsWith('.ts')),
  testFiles: Object.keys(files).filter(
    (rel) => rel.startsWith('__tests__/') && rel.endsWith('.ts'),
  ),
});

const BARREL_ENTRY: ExportsMap = { '.': { import: './dist/index.js' } };
const barrelPkg = (name: string, index: string): Pkg =>
  synthetic(name, { 'src/index.ts': index, 'README.md': '' }, BARREL_ENTRY);

/** An executor package whose barrel re-exports `names` from one module holding `module`. */
const verbPkg = (module: string, names = 'run', name = '@polydeukes/sib'): Pkg =>
  synthetic(
    name,
    { 'src/index.ts': `export { ${names} } from './m.ts';`, 'src/m.ts': module, 'README.md': '' },
    BARREL_ENTRY,
  );

/** A package whose one test file holds `test`. */
const testPkg = (test: string): Pkg =>
  synthetic(
    '@polydeukes/sib',
    { 'src/index.ts': '', 'README.md': '', '__tests__/a.test.ts': test },
    BARREL_ENTRY,
  );

// This file is itself under ⑥, so the barrel specifier the fixtures import is assembled
// rather than written out.
const BARREL_SPECIFIER = ['..', 'src', 'index'].join('/');

interface Row {
  label: string;
  check: Check;
  pkg: Pkg;
  /** Packages the check may read alongside `pkg`; the live suite passes every publishable one. */
  siblings?: Pkg[];
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
    pkg: barrelPkg('@polydeukes/sib', `export * from './x.ts';`),
    violates: true,
  },
  {
    label: '② `export * as ns` in a barrel — a namespace is the whole module, not a name',
    check: '②',
    pkg: barrelPkg('@polydeukes/sib', `export * as ns from './x.ts';`),
    violates: true,
  },
  {
    label: '② `import type` in a barrel — a re-export needs no import',
    check: '②',
    pkg: barrelPkg(
      '@polydeukes/sib',
      `import type { A } from './a.ts';\nexport type { A } from './a.ts';`,
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
    pkg: barrelPkg('@polydeukes/sib', `import { a } from './a.ts';\nexport { a } from './a.ts';`),
    violates: true,
  },
  {
    label: '② comments and a `export type … from` line',
    check: '②',
    pkg: barrelPkg(
      '@polydeukes/sib',
      `// line comment\n/* block */\nexport type { A } from './a.ts';`,
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
        'src/index.ts': `export { shown } from './m.ts';`,
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
        'src/index.ts': `export { shown } from './m.ts';`,
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
        'src/index.ts': `export { a } from './a.ts';`,
        'src/claude-code.ts': `export { runHook } from './hook.ts';`,
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
        'src/index.ts': `export { shown } from './m.ts';`,
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
        'src/index.ts': `export { a as b } from './m.ts';`,
        'src/m.ts': `export const a = 1;`,
        'README.md': 'Call `b` to do the thing.',
      },
      BARREL_ENTRY,
    ),
    violates: false,
  },
  {
    label: '③ one Spec parameter and a `Promise<Named>` return',
    check: '③',
    pkg: verbPkg(
      `export async function run(spec: RunSpec): Promise<RunOutcome> { return go(spec); }`,
    ),
    violates: false,
  },
  {
    label: '③ a union of named results',
    check: '③',
    pkg: verbPkg(`export function run(spec: RunSpec): Compiled | ConfigFault { return go(spec); }`),
    violates: false,
  },
  {
    label: '③ a union of named results inside `Promise<…>`',
    check: '③',
    pkg: verbPkg(
      `export async function run(spec: RunSpec): Promise<Compiled | ConfigFault> { return go(spec); }`,
    ),
    violates: false,
  },
  {
    label: '③ a verb spelled as an arrow constant is not shape-checked and therefore breaks',
    check: '③',
    pkg: verbPkg(`export const run = async (spec: RunSpec): Promise<Outcome> => go(spec);`),
    violates: true,
  },
  {
    label: '③ an `export default function` is read like any other verb',
    check: '③',
    pkg: verbPkg(`export default function run(a: string, b: string): Outcome { return go(a, b); }`),
    violates: true,
  },
  {
    label: '③ an array of a named result',
    check: '③',
    pkg: verbPkg(`export function run(spec: RunSpec): Registration[] { return go(spec); }`),
    violates: false,
  },
  {
    label:
      '③ a multi-line parameter list with a trailing comma, the spec type declared above with `;`',
    check: '③',
    pkg: verbPkg(
      [
        'export interface RunSpec {',
        '  rootDir: string;',
        '  readers: Map<string, { read: (path: string) => string; kind: string }>;',
        '}',
        'export async function run(',
        '  spec: RunSpec,',
        '): Promise<RunOutcome> {',
        '  return go(spec);',
        '}',
      ].join('\n'),
    ),
    violates: false,
  },
  {
    label: '③ a second positional parameter',
    check: '③',
    pkg: verbPkg(`export function run(compiled: Compiled, world: World): Verdict { return go(); }`),
    violates: true,
  },
  {
    label: '③ no parameter at all',
    check: '③',
    pkg: verbPkg(`export function run(): Verdict { return go(); }`),
    violates: true,
  },
  {
    label: '③ an inline spec literal',
    check: '③',
    pkg: verbPkg(
      `export function run(spec: { rootDir: string; range: string }): Verdict { return go(spec); }`,
    ),
    violates: true,
  },
  {
    label: '③ a parameter type not ending in Spec',
    check: '③',
    pkg: verbPkg(`export function run(decl: AlgebraDeclaration): Verdict { return go(decl); }`),
    violates: true,
  },
  {
    label: '③ an anonymous literal inside `Promise<…>`',
    check: '③',
    pkg: verbPkg(
      `export async function run(spec: RunSpec): Promise<{ exitCode: 0 | 2 }> { return go(spec); }`,
    ),
    violates: true,
  },
  {
    label: '③ a function-type return',
    check: '③',
    pkg: verbPkg(
      `export function run(spec: RunSpec): (input: string) => boolean { return () => true; }`,
    ),
    violates: true,
  },
  {
    label: '③ an intersection return',
    check: '③',
    pkg: verbPkg(
      `export function run(spec: RunSpec): Registration & { body: Body } { return go(spec); }`,
    ),
    violates: true,
  },
  {
    label: '③ a missing return annotation',
    check: '③',
    pkg: verbPkg(`export function run(spec: RunSpec) { return go(spec); }`),
    violates: true,
  },
  {
    label: '③ does not read the vocabulary package — a positional core function passes',
    check: '③',
    pkg: verbPkg(
      `export function run(a: string, b: number) { return a + b; }`,
      'run',
      VOCABULARY_NAME,
    ),
    violates: false,
  },
  {
    label: '③ ignores `export type { … }` statements and `type`-prefixed names',
    check: '③',
    pkg: synthetic(
      '@polydeukes/sib',
      {
        'src/index.ts': [
          `export type { two } from './m.ts';`,
          `export { type three, run } from './m.ts';`,
        ].join('\n'),
        'src/m.ts': [
          `export function two(a: string, b: string) { return a + b; }`,
          `export function three(a: string, b: string, c: string) { return a + b + c; }`,
          `export function run(spec: RunSpec): Verdict { return go(spec); }`,
        ].join('\n'),
        'README.md': '',
      },
      BARREL_ENTRY,
    ),
    violates: false,
  },
  {
    label: '③ a barrel constant is not a verb',
    check: '③',
    pkg: verbPkg(`export const LIMIT = 3;`, 'LIMIT'),
    violates: false,
  },
  {
    label: '④ a constant a sibling package consumes',
    check: '④',
    pkg: verbPkg(`export const LIMIT = 3;`, 'LIMIT'),
    siblings: [
      synthetic('@polydeukes/other', { 'src/use.ts': `const n = LIMIT + 1;` }, BARREL_ENTRY),
    ],
    violates: false,
  },
  {
    label: '④ a constant no sibling package consumes',
    check: '④',
    pkg: verbPkg(`export const LIMIT = 3;`, 'LIMIT'),
    siblings: [synthetic('@polydeukes/other', { 'src/use.ts': `const n = 1;` }, BARREL_ENTRY)],
    violates: true,
  },
  {
    label: '④ a sibling mentioning a longer name is not a consumer',
    check: '④',
    pkg: verbPkg(`export const LIMIT = 3;`, 'LIMIT'),
    siblings: [
      synthetic('@polydeukes/other', { 'src/use.ts': `const n = LIMITS + 1;` }, BARREL_ENTRY),
    ],
    violates: true,
  },
  {
    label: "④ the package's own src is not a sibling",
    check: '④',
    pkg: verbPkg(`export const LIMIT = 3;\nconst n = LIMIT + 1;`, 'LIMIT'),
    siblings: [verbPkg(`export const LIMIT = 3;\nconst n = LIMIT + 1;`, 'LIMIT')],
    violates: true,
  },
  {
    label: '④ a verb is not a constant',
    check: '④',
    pkg: verbPkg(`export function run(spec: RunSpec): Verdict { return go(spec); }`),
    siblings: [],
    violates: false,
  },
  {
    label: '④ does not read the vocabulary package',
    check: '④',
    pkg: verbPkg(`export const LIMIT = 3;`, 'LIMIT', VOCABULARY_NAME),
    siblings: [],
    violates: false,
  },
  {
    label: "⑥ a test importing `'../src/index.ts'`",
    check: '⑥',
    pkg: testPkg(`import { run } from '${BARREL_SPECIFIER}.ts';`),
    violates: true,
  },
  {
    label: '⑥ a test importing `"../src/index"`',
    check: '⑥',
    pkg: testPkg(`import { run } from "${BARREL_SPECIFIER}";`),
    violates: true,
  },
  {
    label: "⑥ a test importing `'../src/index.js'` — the ESM spelling of the same barrel",
    check: '⑥',
    pkg: testPkg(`import { run } from '${BARREL_SPECIFIER}.js';`),
    violates: true,
  },
  {
    label: '⑥ a test two directories down importing `../../src/index.ts`',
    check: '⑥',
    pkg: synthetic(
      '@polydeukes/sib',
      {
        'src/index.ts': '',
        'README.md': '',
        '__tests__/deep/a.test.ts': `import { run } from '../${BARREL_SPECIFIER}.ts';`,
      },
      BARREL_ENTRY,
    ),
    violates: true,
  },
  {
    label: '⑥ a test importing its own package by name — the barrel by another spelling',
    check: '⑥',
    pkg: testPkg(`import { run } from '@polydeukes/sib';`),
    violates: true,
  },
  {
    label: '⑥ a test importing a module',
    check: '⑥',
    pkg: testPkg(`import { run } from '../src/m.ts';`),
    violates: false,
  },
  {
    label: "⑥ a test importing a sibling package's barrel — a consumer import",
    check: '⑥',
    pkg: testPkg(`import { parseInput } from '@polydeukes/core';`),
    violates: false,
  },
];

describe('synthetic fixtures', () => {
  it.each(ROWS)('$label', ({ check, pkg, siblings, violates }) => {
    const details = collect(pkg, siblings ?? [])
      .filter((v) => v.check === check)
      .map((v) => v.detail);
    if (violates) expect(details.length, 'expected a violation, got none').toBeGreaterThan(0);
    else expect(details, `unexpected ${check} violations:\n${details.join('\n')}`).toEqual([]);
  });

  // The ratchet scopes a listed violation by the `<entryPoint> ` prefix of its detail; a
  // detail that drops the prefix or the verb name would never be scoped and never be read.
  it('③ names the entry point, the barrel, the verb, and the parameter count', () => {
    const pkg = verbPkg(`export function run(compiled: Compiled, world: World): Verdict {}`);
    expect(collect(pkg, []).filter((v) => v.check === '③')).toEqual([
      {
        package: '@polydeukes/sib',
        check: '③',
        detail: '. (src/index.ts): run — takes 2 parameters, expected 1',
      },
    ]);
  });
});

// The umbrella's session entry point, pinned by symbol: check ② proves the barrel shape,
// but an empty barrel passes it — and a `./claude-code` that stops carrying
// `runClaudeCodeHook` crashes the live hook on import, before any verdict, where the
// witness valve is never consulted.
describe('the ./claude-code entry point', () => {
  const umbrella = PACKAGES.find((p) => p.name === UMBRELLA_NAME);

  // A map target left on the hook module serves consumers the module's whole export
  // surface instead of the one-line barrel.
  it('resolves both conditions to the claude-code barrel dist', () => {
    expect(umbrella?.exports['./claude-code']).toEqual({
      types: './dist/claude-code.d.ts',
      import: './dist/claude-code.js',
    });
  });

  // Dropping the verb strands the delegator; dropping the spec or outcome type leaves a
  // caller no name for the argument or the result. An added name widens the surface without
  // review.
  it('re-exports exactly the hook verb, its spec type, and its outcome type', () => {
    const names = exportedNames(umbrella?.readFile('src/claude-code.ts') ?? '');
    expect([...names].sort()).toEqual([
      'ClaudeCodeHookOutcome',
      'ClaudeCodeHookSpec',
      'runClaudeCodeHook',
    ]);
  });
});
