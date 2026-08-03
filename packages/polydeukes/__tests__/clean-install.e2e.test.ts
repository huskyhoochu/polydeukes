import type { SpawnSyncReturns } from 'node:child_process';
import { execSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readRecords } from '@polydeukes/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// DIST-03 AC-3/AC-4/AC-5 — the clean-install e2e (§3-c). The consumer tree's only inputs
// are the five tarballs this suite packs and the public registry (yaml, picomatch): the
// install graph is real, which is precisely what the symlink trees of init-claude-code.e2e
// could not fake (§5 invariant 4). The `readRecords` import above is the repo-side
// assertion reader (vitest aliases it to core's source); every SPAWNED process below
// resolves through the tarball install alone.
//
// Pack helpers are file-local (the init-claude-code.e2e precedent): publish-pack.e2e.test.ts
// carries its own copy so each suite runs standalone.

const repoRoot = resolve(import.meta.dirname, '../../..');

/** The five publishable package directories (§3-a) — the tarball set the consumer installs. */
const PACKAGE_DIRS = ['core', 'covenant', 'adapter-claude-code', 'adapter-git', 'polydeukes'];
const UMBRELLA_DIR = 'polydeukes';

/** The artifacts `pdks init claude-code` generates, as consumer-root-relative paths. */
const HOOK_REL = '.claude/hooks/covenant-pretooluse.mjs';
const CONFIG_REL = 'polydeukes.config.yaml';
/** On the GENERATED config's protection list — the block/witness cases' target. */
const SETTINGS_REL = '.claude/settings.json';
/** Not on the generated protection list — the clean pass case's target. */
const CLEAN_TARGET = 'docs/notes.md';
/** One segment past a protected entry — the near-miss the generated list must NOT match. */
const NEAR_MISS_TARGET = '.claude/settings.json.bak';
/** Where a judgment lands by default in the tree the hook defends. */
const TELEMETRY_REL = '.polydeukes/roi.log';
/** The funnel supplement's label — the row a clean judged call leaves. */
const ADAPTER_LABEL = 'adapter-claude-code';
/** The AC-5 subpath — the consumer-side spelling under measurement for DOCS-01. */
const CORE_SCHEMA_SPECIFIER = '@polydeukes/core/schema.json';

let packRoot: string;
let consumerRoot: string;
let initResult: SpawnSyncReturns<string>;
const tarballs = new Map<string, string>();

beforeAll(() => {
  // Pack from built dist; turbo caching makes repeat builds ~1s.
  execSync('pnpm turbo run build', { cwd: repoRoot, stdio: 'pipe' });
  packRoot = mkdtempSync(join(tmpdir(), 'pdks-clean-install-pack-'));
  for (const dir of PACKAGE_DIRS) {
    tarballs.set(dir, packOne(dir));
  }

  // The consumer: a fresh tree in OS tmp, outside this repository. The umbrella arrives as
  // a direct file: dependency; the four scoped packages arrive through pnpm.overrides
  // pointing at their tarballs — the rewritten `^` ranges in the umbrella's packed manifest
  // would otherwise hit the registry, where nothing is published yet.
  consumerRoot = mkdtempSync(join(tmpdir(), 'pdks-clean-install-consumer-'));
  const overrides = Object.fromEntries(
    PACKAGE_DIRS.filter((dir) => dir !== UMBRELLA_DIR).map((dir) => [
      packageNameOf(dir),
      `file:${tarballOf(dir)}`,
    ]),
  );
  writeFileSync(
    join(consumerRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'pdks-clean-install-consumer',
        private: true,
        dependencies: { [packageNameOf(UMBRELLA_DIR)]: `file:${tarballOf(UMBRELLA_DIR)}` },
        pnpm: { overrides },
      },
      null,
      2,
    )}\n`,
  );

  const install = spawnSync('pnpm', ['install'], { cwd: consumerRoot, encoding: 'utf-8' });
  if (install.status !== 0) {
    throw new Error(`pnpm install failed in the consumer tree: ${install.stderr}`);
  }

  // AC-3 first half, run once and asserted in its own case below: subsequent cases spawn
  // the artifacts this command generates.
  initResult = spawnSync(
    join(consumerRoot, 'node_modules', '.bin', 'pdks'),
    ['init', 'claude-code'],
    { cwd: consumerRoot, encoding: 'utf-8' },
  );
}, 600_000);

afterAll(() => {
  rmSync(packRoot, { recursive: true, force: true });
  rmSync(consumerRoot, { recursive: true, force: true });
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

/** A package's published name, read from its workspace manifest — never hardcoded here. */
function packageNameOf(dir: string): string {
  const manifest = JSON.parse(
    readFileSync(join(repoRoot, 'packages', dir, 'package.json'), 'utf-8'),
  ) as { name: string };
  return manifest.name;
}

/**
 * Spawn the consumer's generated hook with one payload. cwd is the consumer root — the
 * production spawn shape (the session host runs hooks at the project root), and it keeps
 * any misdirected write inside the throwaway tree. The log is reset first: the exact-row
 * pins below are per-judgment, and the suite shares one installed tree because the install
 * is the expensive fixture.
 */
function spawnConsumerHook(payload: unknown): SpawnSyncReturns<string> {
  rmSync(join(consumerRoot, '.polydeukes'), { recursive: true, force: true });
  return spawnSync(process.execPath, [join(consumerRoot, HOOK_REL)], {
    cwd: consumerRoot,
    input: JSON.stringify(payload),
    encoding: 'utf-8',
  });
}

/** Every telemetry row in the consumer tree as [event, label, subject]. */
function rows(): [string, string, string][] {
  return readRecords(join(consumerRoot, TELEMETRY_REL)).records.map((record) => [
    record.event,
    record.label,
    record.subject,
  ]);
}

/** One Write payload, consumer-root-relative — the proven-mutation-target branch. */
function writePayload(filePath: string, content: string) {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_input: { file_path: filePath, content },
  };
}

/** One Bash payload — the shell-axis branch, judged from the command line alone. */
function bashPayload(command: string) {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command },
  };
}

/**
 * The generated config's witness token, extracted textually (the assembly.e2e precedent):
 * the fixture reads what init actually wrote, so a token change in the generator cannot
 * silently diverge from what this suite types.
 */
function generatedToken(): string {
  const config = readFileSync(join(consumerRoot, CONFIG_REL), 'utf-8');
  const match = /^\s*token:\s*'([^']+)'/m.exec(config);
  if (!match) {
    throw new Error(`witness token not found in generated ${CONFIG_REL}`);
  }
  return match[1];
}

describe('DIST-03 AC-3 — tarball install, init, and two real judgments', () => {
  it('pdks init claude-code exits 0 from the tarball install and writes the hook and config', () => {
    // Mutation caught: a packaging defect anywhere in the chain — the bin not shipped or
    // not executable, the session subpath missing from the packed exports map, a scoped
    // tarball the umbrella cannot resolve — surfaces as a non-zero exit on the first
    // command a consumer ever runs. The symlink trees of init-claude-code.e2e pass all of
    // those mutants; only a real install graph reaches them.
    expect(initResult.status, `init stderr: ${initResult.stderr}`).toBe(0);
    expect(existsSync(join(consumerRoot, HOOK_REL))).toBe(true);
    expect(existsSync(join(consumerRoot, CONFIG_REL))).toBe(true);
  }, 60_000);

  it('the generated hook judges a clean Write through the real install graph: exit 0, one passed row', () => {
    // Mutation caught: a scoped tarball shipping without a piece its dist needs — the
    // delegator's fail-closed catch then answers exit 2 with NO row — and the over-block
    // direction: a generated protection list matching ordinary consumer work sends every
    // consumer to the witness. The row pin is the funnel contract: a pass with no row is
    // the defect class, not a pass.
    const result = spawnConsumerHook(writePayload(CLEAN_TARGET, 'hello\n'));

    expect(result.status, `hook stderr: ${result.stderr}`).toBe(0);
    expect(rows()).toEqual([['passed', ADAPTER_LABEL, '-']]);
  }, 60_000);

  it('a Write one segment past a protected entry passes: the generated list matches segments, not prefixes', () => {
    // Mutation caught: the generated protection list (or the packed matcher) widening to
    // prefix matching — `.claude/settings.json.bak` would then block, and every consumer
    // path that merely neighbors a protected entry becomes a witness trip. The pin is the
    // discrimination pair to the block case below: same directory, one segment longer.
    const result = spawnConsumerHook(writePayload(NEAR_MISS_TARGET, '{}'));

    expect(result.status, `hook stderr: ${result.stderr}`).toBe(0);
    expect(rows()).toEqual([['passed', ADAPTER_LABEL, '-']]);
  }, 60_000);

  it('a Bash sed -i on the generated settings registration blocks on the shell axis: exit 2', () => {
    // Audit gap closed: the packed shell-mod body had only been observed PASSING (as the
    // sibling row of the Write block). Mutation caught: the covenant tarball shipping a
    // shell-mod body that loads but never blocks — the shell axis would then be open in
    // every consumer install while the tool axis still blocks. Both meta bodies judge the
    // call (run-all); the mirror of the Write block's rows: each axis upholds the other's
    // call and blocks its own.
    const result = spawnConsumerHook(bashPayload(`sed -i 's/x/y/' ${SETTINGS_REL}`));

    expect(result.status).toBe(2);
    expect(rows()).toEqual([
      ['passed', 'self-mod', SETTINGS_REL],
      ['blocked', 'shell-mod', SETTINGS_REL],
    ]);
  }, 60_000);

  it('a Write into the generated settings registration blocks: exit 2, blocked verdict row', () => {
    // Fail-open is the defect class this suite exists for: the packed artifact must still
    // BLOCK a mutation of the file that registers the judge. The rows pin WHO answered —
    // a fail-closed crash exits 2 under the adapter label with no self-mod verdict, so
    // the exit code alone could go green while the judge never judged.
    const result = spawnConsumerHook(writePayload(SETTINGS_REL, '{}'));

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(SETTINGS_REL);
    expect(rows()).toEqual([
      ['blocked', 'self-mod', SETTINGS_REL],
      ['passed', 'shell-mod', SETTINGS_REL],
    ]);
  }, 60_000);
});

describe('DIST-03 AC-4 — the witness valve spawns live in the generated tree', () => {
  it('a human transcript carrying the generated token first-line-alone opens the block: exit 0, witnessed row', () => {
    // DIST-02 §7's deferred item, closed here: the valve executes in a generated tree for
    // the first time. Mutation caught: the generated witness block dropped, or its token
    // diverging from what the assembled judge reads — the consumer's first real block
    // would then freeze the project with no valve a human could open. The `witnessed` row
    // pins the valve as recorded-never-silent, and the second message line proves the
    // match is first-line scoped rather than whole-message equality. Provenance is the
    // origin marking, not the role: only `origin.kind === 'human'` qualifies.
    const transcriptPath = join(consumerRoot, 'session-transcript.jsonl');
    writeFileSync(
      transcriptPath,
      `${JSON.stringify({
        type: 'user',
        origin: { kind: 'human' },
        timestamp: new Date().toISOString(),
        message: {
          role: 'user',
          content: `${generatedToken()}\nproceed with the settings change`,
        },
      })}\n`,
    );

    const result = spawnConsumerHook({
      ...writePayload(SETTINGS_REL, '{}'),
      transcript_path: transcriptPath,
    });

    expect(result.status, `hook stderr: ${result.stderr}`).toBe(0);
    expect(rows()).toEqual([
      ['witnessed', 'self-mod', SETTINGS_REL],
      ['passed', 'shell-mod', SETTINGS_REL],
    ]);
  }, 60_000);
});

describe('DIST-03 AC-5 — the core schema resolves from the installed tree', () => {
  it('the schema subpath resolves through the real pnpm layout and the file exists', () => {
    // AC-5 is a measurement with a pass condition: in a real pnpm layout only direct
    // dependencies surface in the consumer's node_modules, so this resolution must walk
    // the umbrella's own dependency links. Mutation caught: `schema` dropped from core's
    // files whitelist or the `./schema.json` subpath dropped from its exports map —
    // editor validation would then be unreachable from every install. The anchor is
    // realpathed because default resolution realpaths a loaded module before walking:
    // the literal symlink path would walk the consumer root instead.
    const umbrellaManifest = realpathSync(
      join(consumerRoot, 'node_modules', UMBRELLA_DIR, 'package.json'),
    );
    const consumerRequire = createRequire(umbrellaManifest);
    const resolved = consumerRequire.resolve(CORE_SCHEMA_SPECIFIER);

    expect(existsSync(resolved)).toBe(true);
    // The measured consumer-side form — DIST-03 §7 hands this line to DOCS-01.
    console.info(`AC-5 measured: ${CORE_SCHEMA_SPECIFIER} resolves to ${resolved}`);
  }, 60_000);
});
