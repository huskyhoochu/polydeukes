import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// The generated artifacts EXECUTE: initClaudeCode installs into a throwaway tree wired to
// the real install graph by symlink, and the generated hook is spawned as the session host
// would spawn it. init-claude-code.test.ts judges the same artifacts as text; only a spawn
// proves that the delegator judges and that the session subpath keeps the git adapter out
// of the session's module graph.
//
// The spawn/rows/payload helpers stay file-local: they spawn hooks GENERATED INTO the
// fixture, not this repository's own hook. This file's covenant-dist mirror interposes one
// level up, on the umbrella's node_modules, which the shared helpers do not touch.
import { initClaudeCode } from '../src/init-claude-code.ts';
import { BASELINE_FIRST_RUN_ROW, telemetryRows } from './helpers';

const repoRoot = resolve(import.meta.dirname, '../../..');
const umbrellaRoot = resolve(import.meta.dirname, '..');
/** The registration artifact init generates — the file every case spawns. */
const HOOK_REL = '.claude/hooks/covenant-pretooluse.mjs';
/** The gate entry the block cases target — protected by the GENERATED config. */
const SETTINGS_REL = '.claude/settings.json';
/**
 * A path this repository's own config protects and the generated config does not. Only
 * such a target catches a repoRoot mutant: the runner's cwd is packages/polydeukes, so a
 * hook deriving repoRoot from cwd's `../..` lands on THIS repository's root and reads its
 * config — an ordinary target would pass there too.
 */
const DOGFOODING_ONLY_PROTECTED = 'lefthook.yml';
/** The funnel supplement's label — the row a clean judged call leaves. */
const ADAPTER_LABEL = 'adapter-claude-code';
/** The scope entry the isolation case swaps for a dist-less stand-in. */
const GIT_ADAPTER_ENTRY = 'adapter-git';

let projectRoot: string;
let telemetryPath: string;

beforeAll(() => {
  // The generated hook loads `polydeukes/claude-code` from the built dist; turbo caching
  // makes repeat runs cheap.
  execSync('pnpm turbo run build', { cwd: repoRoot, stdio: 'pipe' });
}, 120_000);

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'pdks-init-e2e-'));
  telemetryPath = join(projectRoot, 'roi.log');
});

afterEach(() => {
  // rmSync removes symlinks themselves, never what they point at.
  rmSync(projectRoot, { recursive: true, force: true });
});

/**
 * The whole real install graph, one symlink. `polydeukes` then resolves to the real
 * umbrella package and every dependency to its real build. This link must exist BEFORE
 * init runs — it is what makes the default preflight's succeeding direction reachable from
 * a fixture at all; the unit suite can only reach its failing one.
 */
function wireRealGraph(): void {
  symlinkSync(join(repoRoot, 'node_modules'), join(projectRoot, 'node_modules'), 'dir');
  initClaudeCode({ projectRoot });
}

/**
 * The umbrella package mirrored per-entry (package.json + dist symlinked), its
 * node_modules mirrored per-entry, and inside the @polydeukes scope the git adapter either
 * linked whole or replaced by a stand-in carrying its real manifest and NO dist — a
 * checkout nobody built, one level above distWithout()'s covenant mirror.
 *
 * The mirror only interposes under a --preserve-symlinks spawn: default ESM resolution
 * realpaths a symlinked module file, so the umbrella dist's bare specifiers would walk the
 * REAL packages/polydeukes/node_modules and find the real adapter-git regardless (measured
 * 2026-08-03). What these cases prove — which packages the subpath entry's module graph
 * loads — belongs to the import specifiers, not to the resolution mode, and the case above
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
 * project it defends.
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

/**
 * Every telemetry row as [event, label, subject] — the label separates who answered. Each
 * case wires a fresh projectRoot, so every row list opens with the state comparison's
 * first-run row.
 */
const rows = () => telemetryRows(telemetryPath);

/** One Write payload, projectRoot-relative — the proven-mutation-target branch. */
function writePayload(filePath: string, content: string) {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_input: { file_path: filePath, content },
  };
}

describe('the generated hook judges real payloads', () => {
  it('passes a Write only the dogfooding config would block (exit 0, one adapter passed row)', () => {
    // Two failures, one spawn. A repoRoot anchored anywhere near the runner's cwd reads
    // THIS repository's config, which protects this target — exit 2 instead of 0, and a
    // bare process.cwd() anchor finds no config at all and fails closed to the same exit.
    // Separately, a generated protection list matching ordinary consumer work blocks here,
    // the over-block direction that sends every consumer to the witness. The row pin is
    // what separates them: a pass with NO row is the defect class, not a pass.
    wireRealGraph();

    const result = spawnGeneratedHook(
      writePayload(DOGFOODING_ONLY_PROTECTED, 'pre-commit:\n  commands: {}\n'),
    );

    expect(result.status).toBe(0);
    expect(rows()).toEqual([BASELINE_FIRST_RUN_ROW, ['passed', ADAPTER_LABEL, '-']]);
  });

  it('blocks a Write into the generated settings registration: exit 2, reason on stderr, self-mod row', () => {
    // The gate entry executing rather than grep'd: the generated config's own entry blocks
    // a mutation of the file that registers the judge. Dropping the entry gives exit 0;
    // keeping the block reason off stderr leaves the session host with exit 2 alone, which
    // says nothing about WHAT to stop doing. The exact-row pin separates a verdict from a
    // fail-closed crash on the same exit code: a crash records under the hook label, never
    // under self-mod, and shell-mod's passed row pins that both meta bodies still ran.
    wireRealGraph();

    const result = spawnGeneratedHook(writePayload(SETTINGS_REL, '{}'));

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(SETTINGS_REL);
    expect(rows()).toEqual([
      BASELINE_FIRST_RUN_ROW,
      ['blocked', 'self-mod', SETTINGS_REL],
      ['passed', 'shell-mod', SETTINGS_REL],
    ]);
  });
});

describe('subpath isolation: the session never loads the git adapter', () => {
  it('the COMPLETE per-entry mirror judges normally (control: exit 0, one adapter passed row)', () => {
    // The premise both distless cases rest on: a mirror the resolver cannot walk — a
    // dropped dependency entry, a reversed link — dies at the same exit 2 a barrel import
    // produces, and the distless cases would go red while proving nothing about isolation.
    // A normal pass here leaves the git adapter's absent dist as the only variable between
    // the trees.
    wireMirroredGraph({ gitAdapterBuilt: true });

    const result = spawnGeneratedHook(writePayload('docs/notes.md', 'hello\n'), {
      preserveSymlinks: true,
    });

    expect(result.status).toBe(0);
    expect(rows()).toEqual([BASELINE_FIRST_RUN_ROW, ['passed', ADAPTER_LABEL, '-']]);
  });

  it('a clean Write still passes when the git adapter carries NO dist (exit 0, adapter row)', () => {
    // The isolation pin. A generated hook importing the package barrel instead of the
    // session subpath drags covenant-check.js and its static @polydeukes/adapter-git
    // import along, because barrel re-exports are eager. In this tree that import is
    // ERR_MODULE_NOT_FOUND, so the delegator's catch answers exit 2 with ZERO telemetry
    // rows (measured 2026-08-03). Both assertions refute it.
    wireMirroredGraph({ gitAdapterBuilt: false });

    const result = spawnGeneratedHook(writePayload('docs/notes.md', 'hello\n'), {
      preserveSymlinks: true,
    });

    expect(result.status).toBe(0);
    expect(rows()).toEqual([BASELINE_FIRST_RUN_ROW, ['passed', ADAPTER_LABEL, '-']]);
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
      BASELINE_FIRST_RUN_ROW,
      ['blocked', 'self-mod', SETTINGS_REL],
      ['passed', 'shell-mod', SETTINGS_REL],
    ]);
  });
});
