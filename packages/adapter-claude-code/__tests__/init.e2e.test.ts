import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readRecords } from '@polydeukes/core';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// The generated artifacts EXECUTE: the built `pdks-claude-code init` installs into a
// throwaway tree wired to the real install graph by symlink, and the generated delegator
// is spawned as the session host would spawn it. init.test.ts judges the same artifacts as
// text; only a spawn proves that the delegator loads this package, that `runHook` finds and
// spawns `pdks`, and that the child judges the payload against the GENERATED config.

const checkoutRoot = resolve(import.meta.dirname, '../../..');
const ADAPTER_BIN = resolve(import.meta.dirname, '../dist/bin.js');
/** The registration artifact init generates — the file every case spawns. */
const HOOK_REL = '.claude/hooks/covenant-pretooluse.mjs';
/** The gate entry the block case targets — protected by the GENERATED config. */
const SETTINGS_REL = '.claude/settings.json';
/** Everything one install must leave behind: four registration artifacts, two scaffold ones. */
const ARTIFACTS = [
  HOOK_REL,
  SETTINGS_REL,
  '.claude/rules/polydeukes.md',
  '.claude/skills/discipline-draft/SKILL.md',
  'polydeukes.config.yaml',
  '.gitignore',
];
/**
 * A path this repository's own config protects and the generated config does not. Only
 * such a target catches a repoRoot mutant: a hook or a child anchored on the runner's cwd
 * lands on THIS checkout and reads its config — an ordinary target would pass there too.
 */
const DOGFOODING_ONLY_PROTECTED = 'lefthook.yml';
/** The generated config names no log path, so the child writes the default under the project. */
const TELEMETRY_REL = '.polydeukes/roi.log';
/** The label the runner's unrouted pass row carries — the only writer of rows on this path. */
const RUNNER_LABEL = 'covenant-check';

let projectRoot: string;

beforeAll(() => {
  // The adapter bin and the umbrella bin it spawns both come from dist; turbo caching makes
  // repeat runs cheap.
  execSync('pnpm turbo run build', { cwd: checkoutRoot, stdio: 'pipe' });
}, 120_000);

beforeEach(() => {
  // Realpath'd so the delegator's own location, the child's cwd, and the paths this file
  // builds agree on macOS, where tmpdir is a symlink.
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-adapter-init-e2e-')));
});

afterEach(() => {
  // rmSync removes symlinks themselves, never what they point at.
  rmSync(projectRoot, { recursive: true, force: true });
});

/**
 * The whole real install graph, one symlink, then the built installer. `polydeukes` and
 * this package then resolve from the fixture to their real builds — which is what makes
 * the default preflight and the `pdks` lookup succeed from a tree under tmpdir at all.
 */
function installIntoFixture() {
  symlinkSync(join(checkoutRoot, 'node_modules'), join(projectRoot, 'node_modules'), 'dir');
  return spawnSync(process.execPath, [ADAPTER_BIN, 'init'], {
    cwd: projectRoot,
    encoding: 'utf-8',
  });
}

/**
 * Spawn the fixture's generated delegator with one payload. No cwd on purpose: the hook
 * inherits the runner's working directory, so only its own file location can name the
 * project it defends.
 */
function spawnGeneratedHook(payload: unknown) {
  return spawnSync(process.execPath, [join(projectRoot, HOOK_REL)], {
    input: JSON.stringify(payload),
    encoding: 'utf-8',
  });
}

/** Every telemetry row under the fixture as [event, label, subject]. */
function rows(): [string, string, string][] {
  const path = join(projectRoot, TELEMETRY_REL);
  if (!existsSync(path)) return [];
  return readRecords(path).records.map((record) => [record.event, record.label, record.subject]);
}

/** One Write payload, projectRoot-relative — the proven-mutation-target branch. */
function writePayload(filePath: string, content: string) {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_input: { file_path: filePath, content },
  };
}

describe('pdks-claude-code init on a real install graph', () => {
  it('exits 0, leaves the six artifacts, and reports every one as skipped on a re-run', () => {
    // The installer's end-to-end contract: preflight passes through the symlinked graph,
    // the umbrella scaffold runs in the fixture (config + ignore line land HERE, not in the
    // runner's cwd), and the four registration artifacts follow. The re-run pins that
    // nothing is rewritten and that the report says so.
    const first = installIntoFixture();

    expect(first.status, first.stderr).toBe(0);
    for (const rel of ARTIFACTS) {
      expect(existsSync(join(projectRoot, rel)), rel).toBe(true);
    }
    expect(readFileSync(join(projectRoot, '.gitignore'), 'utf-8').split('\n')).toContain(
      '.polydeukes/',
    );

    const second = spawnSync(process.execPath, [ADAPTER_BIN, 'init'], {
      cwd: projectRoot,
      encoding: 'utf-8',
    });
    expect(second.status).toBe(0);
    expect(second.stdout).not.toMatch(/^created /m);
    for (const rel of ARTIFACTS) {
      expect(second.stdout, rel).toContain(`skipped ${rel}`);
    }
  });

  it('refuses any argv but `init` with usage on stderr and exit 2', () => {
    // An unknown argument must never be read as `init`: a typo would install into the cwd.
    const result = spawnSync(process.execPath, [ADAPTER_BIN, 'install'], {
      cwd: projectRoot,
      encoding: 'utf-8',
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/usage/i);
    expect(existsSync(join(projectRoot, HOOK_REL))).toBe(false);
  });
});

describe('the generated delegator judges real payloads', () => {
  it('passes a Write only the dogfooding config would block: exit 0, exactly one runner row', () => {
    // Two failures, one spawn. A repoRoot anchored near the runner's cwd reads THIS
    // checkout's config, which protects this target — exit 2 instead of 0 — and a bare
    // process.cwd() anchor finds no config at all and fails closed to the same exit. The row
    // pin separates a pass from the defect class: a pass with NO row is a hook that never
    // reached the judge, and a row under any label but the runner's is a writer this path
    // must not have.
    expect(installIntoFixture().status).toBe(0);

    const result = spawnGeneratedHook(
      writePayload(DOGFOODING_ONLY_PROTECTED, 'pre-commit:\n  commands: {}\n'),
    );

    expect(result.status, result.stderr).toBe(0);
    const recorded = rows();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.slice(0, 2)).toEqual(['passed', RUNNER_LABEL]);
  });

  it('blocks a Write into the generated settings registration: exit 2, reason on stderr, self-mod row', () => {
    // The gate entry executing rather than grep'd: the generated config's own entry blocks
    // a mutation of the file that registers the judge. The exact-row pin separates a verdict
    // from a fail-closed crash on the same exit code: a crash records under the runner's
    // label, never under self-mod. The child's stderr is inherited through the delegator,
    // so the break reason reaches the host.
    expect(installIntoFixture().status).toBe(0);

    const result = spawnGeneratedHook(writePayload(SETTINGS_REL, '{}'));

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(SETTINGS_REL);
    expect(rows()).toContainEqual(['blocked', 'self-mod', SETTINGS_REL]);
    expect(rows().filter(([event]) => event === 'blocked')).toHaveLength(1);
  });
});
