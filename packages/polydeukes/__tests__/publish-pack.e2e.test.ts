import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// DIST-03 AC-1/AC-2 — the five publish tarballs, verified as artifacts. `pnpm pack` is the
// same producer `pnpm publish -r` runs (§3-b), so what these tests enumerate is what a
// registry would serve. Tarball paths are discovered by globbing each pack destination —
// never spelled with a version literal (§5 invariant 5: the pipeline is version-agnostic).
//
// Helpers stay file-local (the init-claude-code.e2e precedent): clean-install.e2e.test.ts
// packs its own tarballs too, so each suite runs standalone.

const repoRoot = resolve(import.meta.dirname, '../../..');

/**
 * The publishable package directories (§3-a) — derived from the same domain
 * `pnpm -r publish` acts on (workspace packages whose manifest is not private), so a
 * new package enters this suite the moment it exists instead of waiting on a checklist
 * (review of PR #49).
 */
const PACKAGE_DIRS = readdirSync(join(repoRoot, 'packages')).filter((dir) => {
  const manifest = JSON.parse(
    readFileSync(join(repoRoot, 'packages', dir, 'package.json'), 'utf-8'),
  ) as { private?: boolean };
  return manifest.private !== true;
});

/** §3-a presence enumeration — every tarball must carry these. */
const REQUIRED_ENTRIES = ['package/package.json', 'package/README.md', 'package/LICENSE'];
const DIST_PREFIX = 'package/dist/';

/** The package whose tarball carries the docs bundle (DOCS-02 §3-a). */
const UMBRELLA_DIR = 'polydeukes';
const DOCS_PREFIX = 'package/dist/docs/';
/**
 * The DOCS-02 §3-a bundle, enumerated. That table is the source of truth and this is its
 * second copy on purpose: the copy step reads its own list, so a test deriving the list
 * from the same place would go green on a bundle that silently lost a member.
 */
const BUNDLED_DOCS = [
  'installation.md',
  'configuration.md',
  'troubleshooting.md',
  'reference/configuration.md',
  'reference/polydeukes.md',
  'reference/core.md',
  'reference/covenant.md',
  'reference/adapter-claude-code.md',
  'reference/adapter-git.md',
];

/** §3-a absence enumeration — development-only files that must never ship. */
const FORBIDDEN_PREFIXES = ['package/src/', 'package/__tests__/'];
const FORBIDDEN_ENTRIES = [
  'package/tsconfig.json',
  'package/tsconfig.build.json',
  'package/vitest.config.ts',
];

let packRoot: string;
const tarballs = new Map<string, string>();

beforeAll(() => {
  // Pack from built dist; turbo caching makes repeat builds ~1s.
  execSync('pnpm turbo run build', { cwd: repoRoot, stdio: 'pipe' });
  packRoot = mkdtempSync(join(tmpdir(), 'pdks-publish-pack-'));
  for (const dir of PACKAGE_DIRS) {
    tarballs.set(dir, packOne(dir));
  }
}, 240_000);

afterAll(() => {
  // Guard: a beforeAll failure leaves packRoot undefined, and rmSync(undefined) would
  // bury the real error under ERR_INVALID_ARG_TYPE (review of PR #49).
  if (packRoot) rmSync(packRoot, { recursive: true, force: true });
});

/** `pnpm pack` one package into its own destination; the single `.tgz` there is the result. */
function packOne(dir: string): string {
  const destination = join(packRoot, dir);
  mkdirSync(destination, { recursive: true });
  const result = spawnSync('pnpm', ['pack', '--pack-destination', destination], {
    cwd: join(repoRoot, 'packages', dir),
    encoding: 'utf-8',
  });
  if (result.status !== 0) {
    throw new Error(`pnpm pack failed for ${dir}: ${result.stderr}`);
  }
  const packed = readdirSync(destination).filter((name) => name.endsWith('.tgz'));
  if (packed.length !== 1) {
    throw new Error(`expected one tarball for ${dir}, found: ${packed.join(', ') || 'none'}`);
  }
  return join(destination, packed[0]);
}

function tarballOf(dir: string): string {
  const path = tarballs.get(dir);
  if (path === undefined) {
    throw new Error(`no tarball packed for ${dir}`);
  }
  return path;
}

/** Every entry name in one tarball, as `tar -tzf` lists them. */
function tarEntries(dir: string): string[] {
  const result = spawnSync('tar', ['-tzf', tarballOf(dir)], { encoding: 'utf-8' });
  if (result.status !== 0) {
    throw new Error(`tar -tzf failed for ${dir}: ${result.stderr}`);
  }
  return result.stdout.split('\n').filter((line) => line.length > 0);
}

/** The manifest INSIDE one tarball — the text a registry serves, not the workspace copy. */
function tarManifest(dir: string): string {
  const result = spawnSync('tar', ['-xzOf', tarballOf(dir), 'package/package.json'], {
    encoding: 'utf-8',
  });
  if (result.status !== 0) {
    throw new Error(`tar -xzOf failed for ${dir}: ${result.stderr}`);
  }
  return result.stdout;
}

describe('DIST-03 AC-1 — tarball contents match the §3-a enumeration', () => {
  it.each(
    PACKAGE_DIRS,
  )('the %s tarball ships the runnable set: manifest, dist, README, LICENSE', (dir) => {
    // Mutation caught: a `files` whitelist entry dropped — a dist-less tarball installs a
    // package whose every hook call fails closed — or the license text lost. Measured
    // 2026-08-03: pnpm pack inherits the workspace root LICENSE when the package has none,
    // so this pin holds across both producing arrangements (root inheritance, per-package
    // copies) and breaks when a producer swap or file move ships MIT-declared packages
    // carrying no license text.
    const entries = tarEntries(dir);
    for (const required of REQUIRED_ENTRIES) {
      expect(entries).toContain(required);
    }
    expect(entries.some((entry) => entry.startsWith(DIST_PREFIX))).toBe(true);
  }, 30_000);

  it.each(PACKAGE_DIRS)('the %s tarball ships no development-only files', (dir) => {
    // Mutation caught: the `files` whitelist deleted or widened — npm then packs the
    // whole directory and src/, tests, and tsconfigs ride into every consumer install.
    // The two enumerations break in opposite directions, so neither test can stand in
    // for the other.
    const entries = tarEntries(dir);
    expect(entries.filter((e) => FORBIDDEN_PREFIXES.some((p) => e.startsWith(p)))).toEqual([]);
    for (const forbidden of FORBIDDEN_ENTRIES) {
      expect(entries).not.toContain(forbidden);
    }
  }, 30_000);
});

describe('DOCS-02 AC-1 — the umbrella tarball carries the docs bundle', () => {
  it('ships the eight English documents under dist/docs', () => {
    // Mutation caught: the copy step dropped from the build script, a member lost from its
    // list, or `dist/docs` excluded from what npm packs. Any of those installs a package
    // whose `pdks docs` exits 2 for the missing topic, and nothing consumer-side explains
    // why — §3-a names that the symptom this enumeration exists to prevent.
    const entries = tarEntries(UMBRELLA_DIR);

    for (const relative of BUNDLED_DOCS) {
      expect(entries).toContain(`${DOCS_PREFIX}${relative}`);
    }
  }, 30_000);

  it('ships no Korean mirror in the bundle', () => {
    // The absence half, breaking in the opposite direction: a copy step widened into a
    // directory sweep pulls in the mirrors, the whitepaper, and the build-in-public posts.
    // The presence test above stays green through exactly that mutation.
    const entries = tarEntries(UMBRELLA_DIR);
    const bundled = entries.filter((entry) => entry.startsWith(DOCS_PREFIX));

    expect(bundled.filter((entry) => entry.endsWith('.ko.md'))).toEqual([]);
    expect(bundled).toHaveLength(BUNDLED_DOCS.length);
  }, 30_000);
});

describe('DIST-03 AC-2 — packed manifests carry no workspace-only specifier', () => {
  it.each(
    PACKAGE_DIRS,
  )('the %s packed manifest has zero workspace: and zero catalog: occurrences', (dir) => {
    // Mutation caught: packing with npm instead of pnpm (§3-b) — npm leaves `workspace:^`
    // and `catalog:` unrewritten, and every install of the published manifest then fails
    // on a specifier no registry can resolve. String-zero over the whole manifest text
    // covers every dependency field at once, devDependencies included.
    const manifest = tarManifest(dir);
    expect(manifest).not.toContain('workspace:');
    expect(manifest).not.toContain('catalog:');
  }, 30_000);
});
