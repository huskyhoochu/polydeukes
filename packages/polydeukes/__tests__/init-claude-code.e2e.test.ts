import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// DIST-02 AC-6/AC-7 — the generated artifacts EXECUTE: initClaudeCode installs into a
// throwaway tree wired to the real install graph by symlink, and the generated hook is
// spawned as the session host would spawn it. init-claude-code.test.ts judges the same
// artifacts as text; only a spawn proves §3-b (the delegator judges) and §3-c (the
// subpath keeps the git adapter out of the session's module graph).
//
// Harness lineage: the spawn/rows/payload helpers follow assembly.e2e.test.ts's shape but
// stay file-local — they spawn hooks GENERATED INTO the fixture, not this repository's own
// hook. The covenant-dist mirror pair F9 flagged as thrice-duplicated (REAL_COVENANT_DIST +
// distWithout) is NOT copied a fourth time: this file's mirror interposes one level up, on
// the umbrella's node_modules, a subject none of those copies touch.
import { initClaudeCode } from '../src/init-claude-code.ts';
import { telemetryRows } from './helpers';

const repoRoot = resolve(import.meta.dirname, '../../..');
const umbrellaRoot = resolve(import.meta.dirname, '..');
/** The registration artifact init generates — the file every case spawns. */
const HOOK_REL = '.claude/hooks/covenant-pretooluse.mjs';
/** The §3-d gate entry the block cases target — protected by the GENERATED config. */
const SETTINGS_REL = '.claude/settings.json';
/**
 * A path this repository's own config protects and the generated config does not (it is
 * not in the §3-d four). Only such a target can catch a repoRoot mutant: the runner's cwd
 * is packages/polydeukes, so a hook deriving repoRoot from cwd's `../..` lands on THIS
 * repository's root and reads its config — an ordinary target would pass there too.
 */
const DOGFOODING_ONLY_PROTECTED = 'lefthook.yml';
/** The funnel supplement's label — the row a clean judged call leaves. */
const ADAPTER_LABEL = 'adapter-claude-code';
/** The scope entry AC-7 swaps for a dist-less stand-in. */
const GIT_ADAPTER_ENTRY = 'adapter-git';

let projectRoot: string;
let telemetryPath: string;

beforeAll(() => {
  // The generated hook loads `polydeukes/claude-code` from the built dist; turbo caching
  // makes repeat runs ~1s (the assembly.e2e precedent).
  execSync('pnpm turbo run build', { cwd: repoRoot, stdio: 'pipe' });
}, 120_000);

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'pdks-init-e2e-'));
  telemetryPath = join(projectRoot, 'roi.log');
});

afterEach(() => {
  // rmSync removes symlinks themselves, never what they point at (assembly.e2e precedent).
  rmSync(projectRoot, { recursive: true, force: true });
});

/**
 * AC-6 wiring: the whole real install graph, one symlink. `polydeukes` then resolves to
 * the real umbrella package and every dependency to its real build. This link must exist
 * BEFORE init runs — it is what makes the DEFAULT §3-g preflight's succeeding direction
 * reachable from a fixture at all (§5-c; the unit suite could only reach its failing one).
 */
function wireRealGraph(): void {
  symlinkSync(join(repoRoot, 'node_modules'), join(projectRoot, 'node_modules'), 'dir');
  initClaudeCode({ projectRoot });
}

/**
 * AC-7 wiring: the umbrella package mirrored per-entry (package.json + dist symlinked),
 * its node_modules mirrored per-entry, and inside the @polydeukes scope the git adapter
 * either linked whole (complete) or replaced by a stand-in carrying its real manifest and
 * NO dist — a checkout nobody built, one level above distWithout()'s covenant mirror.
 *
 * The mirror only interposes under a --preserve-symlinks spawn: default ESM resolution
 * realpaths a symlinked module file, so the umbrella dist's bare specifiers would walk the
 * REAL packages/polydeukes/node_modules and find the real adapter-git regardless (measured
 * 2026-08-03). The property AC-7 proves — which packages the subpath entry's module graph
 * loads — belongs to the import specifiers, not to the resolution mode, and AC-6 above
 * covers the flagless production-shaped spawn.
 */
function wireMirroredGraph(spec: { gitAdapterBuilt: boolean }): void {
  const mirrorPkg = join(projectRoot, 'node_modules', 'polydeukes');
  mkdirSync(mirrorPkg, { recursive: true });
  symlinkSync(join(umbrellaRoot, 'package.json'), join(mirrorPkg, 'package.json'));
  symlinkSync(join(umbrellaRoot, 'dist'), join(mirrorPkg, 'dist'), 'dir');

  const realDeps = join(umbrellaRoot, 'node_modules');
  const mirrorDeps = join(mirrorPkg, 'node_modules');
  mkdirSync(mirrorDeps);
  for (const entry of readdirSync(realDeps)) {
    if (entry !== '@polydeukes') {
      symlinkSync(join(realDeps, entry), join(mirrorDeps, entry), 'dir');
      continue;
    }
    const scope = join(mirrorDeps, entry);
    mkdirSync(scope);
    for (const pkg of readdirSync(join(realDeps, entry))) {
      if (pkg === GIT_ADAPTER_ENTRY && !spec.gitAdapterBuilt) {
        const standIn = join(scope, pkg);
        mkdirSync(standIn);
        // The manifest is real so resolution reaches its exports map; the dist the map
        // names is what is absent — ERR_MODULE_NOT_FOUND for whoever imports the package.
        symlinkSync(
          join(repoRoot, 'packages', GIT_ADAPTER_ENTRY, 'package.json'),
          join(standIn, 'package.json'),
        );
        continue;
      }
      symlinkSync(join(realDeps, entry, pkg), join(scope, pkg), 'dir');
    }
  }
  initClaudeCode({ projectRoot });
}

/**
 * Spawn the fixture's generated hook with one payload. No cwd on purpose: the hook
 * inherits the runner's working directory, so only its own file location can name the
 * project it defends (§3-b).
 */
function spawnGeneratedHook(payload: unknown, opts?: { preserveSymlinks?: boolean }) {
  const hookPath = join(projectRoot, HOOK_REL);
  return spawnSync(
    process.execPath,
    opts?.preserveSymlinks ? ['--preserve-symlinks', hookPath] : [hookPath],
    {
      input: JSON.stringify(payload),
      encoding: 'utf-8',
      env: { ...process.env, POLYDEUKES_TELEMETRY_PATH: telemetryPath },
    },
  );
}

/** Every telemetry row as [event, label, subject] — the label separates who answered. */
const rows = () => telemetryRows(telemetryPath);

/** One Write payload, projectRoot-relative — the proven-mutation-target branch. */
function writePayload(filePath: string, content: string) {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_input: { file_path: filePath, content },
  };
}

describe('DIST-02 §3-b / AC-6 — the generated hook judges real payloads', () => {
  it('passes a Write only the dogfooding config would block (exit 0, one adapter passed row)', () => {
    // Two mutants, one spawn. A repoRoot anchored anywhere near the runner's cwd reads
    // THIS repository's config, which protects this target — exit 2 instead of 0 (a bare
    // process.cwd() anchor finds no config at all and fails closed to the same exit). And
    // a generated protection list matching ordinary consumer work blocks it here — the
    // over-block direction, which sends every consumer to the witness. The row pin is the
    // funnel contract: a pass with NO row is the defect class (blocker B7), not a pass.
    wireRealGraph();

    const result = spawnGeneratedHook(
      writePayload(DOGFOODING_ONLY_PROTECTED, 'pre-commit:\n  commands: {}\n'),
    );

    expect(result.status).toBe(0);
    expect(rows()).toEqual([['passed', ADAPTER_LABEL, '-']]);
  });

  it('blocks a Write into the generated settings registration: exit 2, reason on stderr, self-mod row', () => {
    // The §3-d gate half executing, not grep'd: the generated config's own entry blocks a
    // mutation of the file that registers the judge. Mutation caught: the entry dropped
    // from the generated protectedPaths (exit 0), or the block reason kept off stderr —
    // exit 2 alone tells the session host nothing about WHAT to stop doing. The exact-row
    // pin separates a verdict from a fail-closed crash on the same exit code: a crash
    // records under the hook label, never under self-mod, and shell-mod's passed row pins
    // run-all coexistence (the assembly.e2e precedent).
    wireRealGraph();

    const result = spawnGeneratedHook(writePayload(SETTINGS_REL, '{}'));

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(SETTINGS_REL);
    expect(rows()).toEqual([
      ['blocked', 'self-mod', SETTINGS_REL],
      ['passed', 'shell-mod', SETTINGS_REL],
    ]);
  });
});

describe('DIST-02 §3-c / AC-7 — subpath isolation: the session never loads the git adapter', () => {
  it('the COMPLETE per-entry mirror judges normally (control: exit 0, one adapter passed row)', () => {
    // The premise both distless cases rest on (the unbuilt-body COMPLETE-mirror
    // precedent): a mirror the resolver cannot walk — a dropped dependency entry, a
    // reversed link — dies at the same exit 2 the barrel mutant produces, and the
    // distless cases would go red while proving nothing about isolation. A normal pass
    // here leaves the git adapter's absent dist as the only variable between the trees.
    wireMirroredGraph({ gitAdapterBuilt: true });

    const result = spawnGeneratedHook(writePayload('docs/notes.md', 'hello\n'), {
      preserveSymlinks: true,
    });

    expect(result.status).toBe(0);
    expect(rows()).toEqual([['passed', ADAPTER_LABEL, '-']]);
  });

  it('a clean Write still passes when the git adapter carries NO dist (exit 0, adapter row)', () => {
    // THE AC-7 pin. Killing mutant: the generated hook's import reverted to the package
    // barrel — its re-exports are eager, so loading the judge drags covenant-check.js and
    // its static @polydeukes/adapter-git import along, and in this tree that import is
    // ERR_MODULE_NOT_FOUND: the delegator's catch answers exit 2 with ZERO telemetry rows,
    // the DIST-01 §3-d window this subpath exists to close (measured on the simulated
    // mutant, 2026-08-03). Both assertions refute it.
    wireMirroredGraph({ gitAdapterBuilt: false });

    const result = spawnGeneratedHook(writePayload('docs/notes.md', 'hello\n'), {
      preserveSymlinks: true,
    });

    expect(result.status).toBe(0);
    expect(rows()).toEqual([['passed', ADAPTER_LABEL, '-']]);
  });

  it('a protected Write in the same distless tree still blocks as a VERDICT, not a crash', () => {
    // The other end of "judgment works without the commit surface's adapter": clean calls
    // passing (above) could survive an assembly that only touches adapter-git on the
    // judging path, and a block that crashes instead of judging is exit 2 for the wrong
    // reason. The self-mod row — unreachable for an assembly that died before dispatch —
    // is what separates the two.
    wireMirroredGraph({ gitAdapterBuilt: false });

    const result = spawnGeneratedHook(writePayload(SETTINGS_REL, '{}'), {
      preserveSymlinks: true,
    });

    expect(result.status).toBe(2);
    expect(rows()).toEqual([
      ['blocked', 'self-mod', SETTINGS_REL],
      ['passed', 'shell-mod', SETTINGS_REL],
    ]);
  });
});
