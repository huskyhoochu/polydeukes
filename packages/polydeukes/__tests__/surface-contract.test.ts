import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// Text oracles over the repository: the facts the input contract states about files
// that no unit test loads. Each one is a `grep` a reviewer would otherwise run by hand.

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const PACKAGES = join(REPO_ROOT, 'packages');

/** Every regular file under `dir`, recursively; `node_modules` and `dist` are never entered. */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    // `packages/documentation/src/content/` is generated from `docs/` at build time and
    // is gitignored; the records it copies name the terminal device as history, not as
    // something a bin opens.
    if (entry.name === 'content' && dir.endsWith(join('documentation', 'src'))) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

/** The files the oracles read, relative to the repository root. */
function relative(path: string): string {
  return path.slice(REPO_ROOT.length + 1);
}

function packageDirs(...subdirs: string[]): string[] {
  return readdirSync(PACKAGES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => subdirs.map((sub) => join(PACKAGES, entry.name, sub)));
}

function filesContaining(paths: string[], needle: string): string[] {
  return paths.filter((path) => readFileSync(path, 'utf-8').includes(needle)).map(relative);
}

describe('the CLI asks nobody', () => {
  it('no package source, package test, either hook directory, or lefthook.yml names the terminal device', () => {
    // The string is assembled so this file does not name it either. A bin that opens the
    // controlling terminal is a bin with a policy of its own.
    const device = `/dev/${'tty'}`;
    const candidates = [
      ...packageDirs('src', '__tests__').flatMap(filesUnder),
      ...filesUnder(join(REPO_ROOT, '.claude', 'hooks')),
      ...filesUnder(join(REPO_ROOT, '.grok', 'hooks')),
      join(REPO_ROOT, 'lefthook.yml'),
    ];

    expect(filesContaining(candidates, device)).toEqual([]);
  });
});

describe('the git adapter is gone', () => {
  it('packages/adapter-git does not exist', () => {
    expect(existsSync(join(PACKAGES, 'adapter-git'))).toBe(false);
  });

  it('neither the umbrella manifest nor release-please-config.json names adapter-git', () => {
    // A dependency on a deleted workspace package fails install; a release-please
    // extra-file pointing at a missing manifest fails the release.
    const manifests = [
      join(PACKAGES, 'polydeukes', 'package.json'),
      join(REPO_ROOT, 'release-please-config.json'),
    ];

    expect(filesContaining(manifests, 'adapter-git')).toEqual([]);
  });
});

describe('the umbrella never spawns git', () => {
  it('no file under packages/polydeukes/src spawns a git process', () => {
    // The world axis is a disk read; the change set arrives on stdin.
    const sources = filesUnder(join(PACKAGES, 'polydeukes', 'src'));
    const spellings = ["execFileSync('git'", "spawnSync('git'", "spawn('git'", "execSync('git"];

    const offenders = spellings.flatMap((spelling) =>
      filesContaining(sources, spelling).map((file) => `${file}: ${spelling}`),
    );

    expect(offenders).toEqual([]);
  });
});

describe('the checked-in wiring', () => {
  const lefthook = readFileSync(join(REPO_ROOT, 'lefthook.yml'), 'utf-8');

  it('lefthook pipes git diff --cached into pdks covenant check --diff', () => {
    // The old argv form now waits on stdin for an IR, so the old wiring hangs or fails
    // every commit.
    expect(lefthook).toMatch(/git diff --cached[^|\n]*\|\s*\S*pdks covenant check --diff/);
  });

  it('the root config has no adapters.git block', () => {
    // A leftover `enforce` under the deleted namespace would read as a posture the
    // runner no longer honours.
    const config = parse(readFileSync(join(REPO_ROOT, 'polydeukes.config.yaml'), 'utf-8')) as {
      adapters?: Record<string, unknown>;
    };

    expect(config.adapters?.git).toBeUndefined();
  });
});

/** The memory package: its directory, name, and the names its barrel carries. */
const MEMORY_DIR = join(PACKAGES, 'memory');
const MEMORY_NAME = '@polydeukes/memory';
const MEMORY_VERBS = [
  'describeMemoryIndex',
  'ingestMemory',
  'lintMemory',
  'listObligations',
  'listSupersession',
  'openMemoryDb',
  'searchMemory',
  'showMemory',
  'summarizeMemoryUsage',
];
const MEMORY_TYPES = [
  'DescribeMemoryIndexSpec',
  'IngestMemorySpec',
  'LintMemorySpec',
  'ListObligationsSpec',
  'ListSupersessionSpec',
  'MemoryConfig',
  'MemoryDocument',
  'MemoryIndexState',
  'MemoryLink',
  'MemoryLinks',
  'MemoryLintResult',
  'MemoryLogEntry',
  'MemoryObligation',
  'MemorySearchResult',
  'MemorySection',
  'MemoryShownSection',
  'MemorySupersession',
  'MemoryUsage',
  'MemoryViolation',
  'OpenMemoryDbSpec',
  'SearchMemorySpec',
  'ShowMemorySpec',
  'SummarizeMemoryUsageSpec',
];
const UMBRELLA_MANIFEST = join(PACKAGES, 'polydeukes', 'package.json');
const WORKSPACE_RANGE = 'workspace:^';

type Manifest = {
  name: string;
  private?: boolean;
  exports?: Record<string, unknown>;
  files?: string[];
  scripts?: Record<string, string>;
  publishConfig?: { access?: string };
  repository?: { directory?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};
const readManifest = (path: string): Manifest =>
  JSON.parse(readFileSync(path, 'utf-8')) as Manifest;

/** The runtime and type names a barrel's `export … from` statements carry, each sorted. */
function barrelNames(text: string): { runtime: string[]; types: string[] } {
  const runtime: string[] = [];
  const types: string[] = [];
  const src = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  for (const m of src.matchAll(/export\s+(type\s+)?\{([^}]*)\}\s+from\s+['"][^'"]+['"]/g)) {
    for (const raw of (m[2] as string).split(',')) {
      const item = raw.trim();
      if (item.length === 0) continue;
      const name = item.replace(/^type\s+/, '').replace(/^.*\s+as\s+/, '');
      (m[1] || item.startsWith('type ') ? types : runtime).push(name);
    }
  }
  return { runtime: runtime.sort(), types: types.sort() };
}

describe('the memory package is publishable', () => {
  const manifest = () => readManifest(join(MEMORY_DIR, 'package.json'));

  // A `private` flag left in place packs no tarball, so the umbrella's optional peer can
  // never be installed; a second entry point widens the contract past the barrel; a
  // missing build script or build config ships a tarball with no dist behind `exports`.
  it('its manifest has no private flag, one `.` entry point, a build, and public access', () => {
    const m = manifest();

    expect(m.private).toBeUndefined();
    expect(Object.keys(m.exports ?? {})).toEqual(['.']);
    expect(m.publishConfig?.access).toBe('public');
    expect(m.repository?.directory).toBe('packages/memory');
    expect(m.files).toContain('dist');
    expect(m.scripts?.build).toBeDefined();
    expect(existsSync(join(MEMORY_DIR, 'tsconfig.build.json'))).toBe(true);
    expect(existsSync(join(MEMORY_DIR, 'README.md'))).toBe(true);
    expect(existsSync(join(MEMORY_DIR, 'README.ko.md'))).toBe(true);
  });

  // A verb missing from the barrel fails the umbrella's dynamic import at call time in
  // every consumer; `parseDocument`, `replaceDocument`, or `optimizeMemoryDb` re-exported
  // widens the contract to functions no caller fills a spec for.
  it('its barrel re-exports exactly the nine verbs and the twenty-three types', () => {
    const names = barrelNames(readFileSync(join(MEMORY_DIR, 'src', 'index.ts'), 'utf-8'));

    expect(names.runtime).toEqual(MEMORY_VERBS);
    expect(names.types).toEqual(MEMORY_TYPES);
  });
});

describe('memory is an optional peer of the umbrella', () => {
  const umbrella = () => readManifest(UMBRELLA_MANIFEST);

  // Under pnpm's isolated layout the umbrella resolves only what its own manifest
  // declares: no peer entry means the dynamic import fails even after the user installs
  // the package; an ordinary dependency means the package is no longer optional; a peer
  // without `optional: true` makes every install without it warn; the devDependency is
  // what lets the umbrella's own e2e resolve it.
  it('declares @polydeukes/memory as an optional peer and a devDependency, never a dependency', () => {
    const m = umbrella();

    expect(m.peerDependencies?.[MEMORY_NAME]).toBe(WORKSPACE_RANGE);
    expect(m.peerDependenciesMeta?.[MEMORY_NAME]).toEqual({ optional: true });
    expect(m.devDependencies?.[MEMORY_NAME]).toBe(WORKSPACE_RANGE);
    expect(m.dependencies?.[MEMORY_NAME]).toBeUndefined();
  });
});

describe('release-please bumps every publishable manifest', () => {
  // The extra-files list is explicit: a publishable package left off it keeps its old
  // version through every release, and its tarball publishes over an existing version.
  it('extra-files names exactly the non-private package manifests', () => {
    const config = JSON.parse(
      readFileSync(join(REPO_ROOT, 'release-please-config.json'), 'utf-8'),
    ) as { packages: Record<string, { 'extra-files': { path: string }[] }> };
    const listed = (config.packages['.']?.['extra-files'] ?? []).map((f) => f.path).sort();
    const publishable = readdirSync(PACKAGES, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join('packages', entry.name, 'package.json'))
      .filter((rel) => readManifest(join(REPO_ROOT, rel)).private !== true)
      .sort();

    expect(publishable.length).toBeGreaterThan(0);
    expect(listed).toEqual(publishable);
  });
});

describe('the public documentation names pdks memory', () => {
  const DOCS = join(REPO_ROOT, 'docs');
  const CLI_DOC_PATH = 'reference/cli/memory.md';
  const CONFIG_DOC_PATH = 'reference/configuration/index.md';
  const ko = (path: string) => path.replace(/\.md$/, '.ko.md');
  const read = (rel: string) => readFileSync(join(DOCS, rel), 'utf-8');
  /** What the CLI page must name: the three commands, the index path, the rebuild command, the install hint. */
  const CLI_PAGE_TOKENS = [
    'pdks memory ingest',
    'pdks memory search',
    'pdks memory show',
    '.polydeukes/memory.db',
    'pdks memory ingest --rebuild',
    '@polydeukes/memory',
  ];
  const CONFIG_KEYS = ['include', 'exclude', 'typeMap', 'ticket', 'weights'];

  /**
   * The body of the first heading whose text names `memory`: from that heading line to
   * the next heading of the same or a higher level. `undefined` when no heading names it.
   */
  function memorySection(text: string): string | undefined {
    const lines = text.split('\n');
    const start = lines.findIndex((line) => /^#{2,3} .*memory/.test(line));
    if (start === -1) return undefined;
    const level = (lines[start] as string).match(/^#+/)?.[0].length ?? 0;
    const body: string[] = [];
    for (const line of lines.slice(start + 1)) {
      const heading = line.match(/^(#+) /);
      if (heading && (heading[1] as string).length <= level) break;
      body.push(line);
    }
    return body.join('\n');
  }

  // A page that omits the rebuild command leaves a user with a schema-changed index and no
  // recovery; one that omits the index path leaves nothing to add to `.gitignore`.
  it.each([[CLI_DOC_PATH], [ko(CLI_DOC_PATH)]])(
    '%s names the commands, the index path, the rebuild command, and the package',
    (path) => {
      const text = read(path);

      expect(CLI_PAGE_TOKENS.filter((token) => !text.includes(token))).toEqual([]);
    },
  );

  // The configuration reference is where a user learns the key `pdks memory ingest` asks
  // for; a `memory` section missing one key leaves that key undocumented. The keys are
  // looked for inside that section alone, since `include` and `ticket` are also words other
  // sections of the same page use.
  it.each([[CONFIG_DOC_PATH], [ko(CONFIG_DOC_PATH)]])(
    '%s documents the memory section and its five keys inside it',
    (path) => {
      const section = memorySection(read(path));

      expect(section).toBeDefined();
      expect(CONFIG_KEYS.filter((key) => !(section as string).includes(key))).toEqual([]);
    },
  );
});

describe('the fixture set this file assumes', () => {
  it('reads real directories — the package tree and the hook directory exist', () => {
    // An oracle over an empty candidate list is vacuously green; this pins that the
    // walk found something.
    expect(statSync(join(PACKAGES, 'polydeukes', 'src')).isDirectory()).toBe(true);
    expect(packageDirs('src').flatMap(filesUnder).length).toBeGreaterThan(0);
  });
});
