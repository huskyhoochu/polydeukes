import type { SpawnSyncReturns } from 'node:child_process';
import { execSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOPICS } from '../src/docs-query.ts';
import { BASELINE_FIRST_RUN_ROW, telemetryRows } from './helpers';

// DIST-03 AC-3/AC-4/AC-5 — the clean-install e2e (§3-c). The consumer tree's only inputs
// are the tarballs this suite packs and the public registry (yaml, picomatch): the
// install graph is real, which is precisely what the symlink trees of init-claude-code.e2e
// could not fake (§5 invariant 4). The telemetryRows helper reads rows repo-side (vitest
// aliases core to source); every SPAWNED process below resolves through the tarball
// install alone.
//
// Pack helpers are file-local (the init-claude-code.e2e precedent): publish-pack.e2e.test.ts
// carries its own copy so each suite runs standalone.

const repoRoot = resolve(import.meta.dirname, '../../..');

/**
 * The publishable package directories — derived from the same domain `pnpm -r publish`
 * acts on (workspace packages whose manifest is not private), so a new package enters
 * this suite the moment it exists instead of waiting on a checklist (review of PR #49).
 */
const PACKAGE_DIRS = readdirSync(join(repoRoot, 'packages')).filter((dir) => {
  const manifest = JSON.parse(
    readFileSync(join(repoRoot, 'packages', dir, 'package.json'), 'utf-8'),
  ) as { private?: boolean };
  return manifest.private !== true;
});
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
/** DIST-05 AC-2's subpath — the umbrella spelling, for runtime code that reads the schema. */
const UMBRELLA_SCHEMA_SPECIFIER = 'polydeukes/schema.json';
/**
 * DIST-05 AC-3's spelling: the FILE path a `$schema` line carries, relative to the directory
 * the config sits in. §3-b's consumer row, measured here on a pnpm install — the one package
 * manager this suite runs.
 */
const UMBRELLA_SCHEMA_FILE_REL = 'node_modules/polydeukes/dist/schema/polydeukes.schema.json';

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
  // Guard: a beforeAll failure leaves these undefined, and rmSync(undefined) would bury
  // the real error under ERR_INVALID_ARG_TYPE (review of PR #49).
  if (packRoot) rmSync(packRoot, { recursive: true, force: true });
  if (consumerRoot) rmSync(consumerRoot, { recursive: true, force: true });
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

/**
 * Every telemetry row in the consumer tree as [event, label, subject]. Each spawn clears
 * `.polydeukes/` first, so every row list opens with the state comparison's first-run row
 * (COVENANT-14 §2-e).
 */
const rows = () => telemetryRows(join(consumerRoot, TELEMETRY_REL));

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
    expect(rows()).toEqual([BASELINE_FIRST_RUN_ROW, ['passed', ADAPTER_LABEL, '-']]);
  }, 60_000);

  it('a Write one segment past a protected entry passes: the generated list matches segments, not prefixes', () => {
    // Mutation caught: the generated protection list (or the packed matcher) widening to
    // prefix matching — `.claude/settings.json.bak` would then block, and every consumer
    // path that merely neighbors a protected entry becomes a witness trip. The pin is the
    // discrimination pair to the block case below: same directory, one segment longer.
    const result = spawnConsumerHook(writePayload(NEAR_MISS_TARGET, '{}'));

    expect(result.status, `hook stderr: ${result.stderr}`).toBe(0);
    expect(rows()).toEqual([BASELINE_FIRST_RUN_ROW, ['passed', ADAPTER_LABEL, '-']]);
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
      BASELINE_FIRST_RUN_ROW,
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
      BASELINE_FIRST_RUN_ROW,
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
      BASELINE_FIRST_RUN_ROW,
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
    // Pin the stable tail so a schema file move fails here instead of silently
    // invalidating what DOCS-01 wrote down (review of PR #49); the machine-specific
    // head stays unpinned.
    expect(resolved.endsWith('/@polydeukes/core/schema/polydeukes.schema.json')).toBe(true);
    // The measured consumer-side form — DIST-03 §7 hands this line to DOCS-01.
    console.info(`AC-5 measured: ${CORE_SCHEMA_SPECIFIER} resolves to ${resolved}`);
  }, 60_000);
});

describe('DIST-05 AC-2/AC-3/AC-4 — the umbrella ships the schema at one consumer spelling', () => {
  it('the umbrella schema subpath resolves from the installed tree (AC-2, module axis)', () => {
    // The runtime axis: code that READS the schema reaches it by module specifier, and
    // resolution is what a `./schema.json` exports entry buys. Mutation caught: the
    // subpath registered against a path the build does not produce (a `schema/` entry
    // copied from core's manifest, where the file sits outside `dist/`) — resolution then
    // throws in every install while the repo-side tree still has the file one directory
    // over. The realpathed anchor follows the DIST-03 AC-5 case: default resolution
    // realpaths a loaded module before walking, so the literal symlink path would walk the
    // consumer root instead of the umbrella's own dependency links.
    const umbrellaManifest = realpathSync(
      join(consumerRoot, 'node_modules', UMBRELLA_DIR, 'package.json'),
    );
    const resolved = createRequire(umbrellaManifest).resolve(UMBRELLA_SCHEMA_SPECIFIER);

    expect(existsSync(resolved)).toBe(true);
    expect(resolved.endsWith('/polydeukes/dist/schema/polydeukes.schema.json')).toBe(true);
  }, 60_000);

  it('the consumer-root-relative file path exists on disk (AC-3, editor axis)', () => {
    // A DIFFERENT axis from the case above, and the one this ticket exists for. What a
    // consumer writes on the config's first line is a static string an editor reads: no
    // module resolver runs, no exports map is consulted, no symlink is realpathed. So the
    // literal path is walked from the consumer root with existsSync, never resolved.
    // Mutation caught: the schema shipped ONLY through the exports map — under pnpm's
    // strict layout `node_modules/polydeukes` is a link into the store and the file is
    // reachable, but any change that leaves the copy outside `dist/` (or drops it from the
    // tarball's `files` reach) breaks this path while the module-axis case above stays
    // green. That is exactly the failure DIST-05 §3-b separates the two rows for.
    expect(existsSync(join(consumerRoot, UMBRELLA_SCHEMA_FILE_REL))).toBe(true);
  }, 60_000);

  it('the shipped file is byte-identical to the core schema in the same install (AC-1/AC-4)', () => {
    // §5 invariant 2 measured on the artifact rather than on the build step: core owns the
    // one source and the umbrella's copy is derived. Mutation caught: the copy reading a
    // stale or hand-edited file — a divergence that the byte check in copy-schema.test.ts
    // cannot see, because that suite feeds the script its own source. Here both files
    // arrive from tarballs packed in the same run, so any difference is the build's. Byte
    // equality also carries AC-4: a truncated write, a text-mode copy, or a placeholder
    // file all leave a file where AC-3 looks, and all three differ from core's bytes.
    const umbrellaManifest = realpathSync(
      join(consumerRoot, 'node_modules', UMBRELLA_DIR, 'package.json'),
    );
    const coreSchema = createRequire(umbrellaManifest).resolve(CORE_SCHEMA_SPECIFIER);

    expect(
      readFileSync(join(consumerRoot, UMBRELLA_SCHEMA_FILE_REL)).equals(readFileSync(coreSchema)),
    ).toBe(true);
  }, 60_000);
});

describe('DOCS-02 AC-7 — the bundled docs answer from the installed tree', () => {
  /**
   * Spawn the consumer's own `pdks`, the binary a user's PATH reaches. cwd is the consumer
   * root and the tree sits outside this repository, so an answer cannot have come from the
   * working copy of `docs/` — only from what the tarball installed.
   */
  function spawnDocs(...args: string[]): SpawnSyncReturns<string> {
    return spawnSync(join(consumerRoot, 'node_modules', '.bin', 'pdks'), ['docs', ...args], {
      cwd: consumerRoot,
      encoding: 'utf-8',
    });
  }

  it.each([...TOPICS])('answers %s from the tarball install alone', (topic) => {
    // The Exit Criteria clause this ticket exists to close, measured on the real install
    // graph. Mutation caught: a bundle member missing from the tarball, a docs root
    // resolved from the working directory instead of the module's own location, or a
    // topic in the map with no shipped document behind it — all three pass the repo-side
    // unit suite, where `docs/` is one directory away.
    const result = spawnDocs(topic);

    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout.trim().length).toBeGreaterThan(0);
  }, 60_000);

  it('lists every topic when called with no argument', () => {
    // §3-b's discovery form on the shipped artifact: an agent learns what it may ask ONLY
    // from this listing, so a topic missing here is one that is never queried.
    const result = spawnDocs();

    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    for (const topic of TOPICS) {
      expect(result.stdout, topic).toMatch(new RegExp(`\\b${topic}\\b`));
    }
  }, 60_000);

  it('refuses an unknown topic with exit 2 and an empty stdout', () => {
    // §3-b's failure direction end to end. Mutation caught: the bin answering a bad topic
    // with a partial document, or exiting 0 on an error path — a half-written answer is
    // one an agent reads as the document and quotes onward.
    const result = spawnDocs('nonexistent-topic');

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('nonexistent-topic');
  }, 60_000);

  it('answers even when the packages only the commit surface needs are gone', () => {
    // The bootstrap direction: `pdks docs install` is what an agent runs to find out how to
    // install and build, so it has to answer in a tree where the build has not happened.
    // Mutation caught: `runCovenantCheck` imported at the top of bin.ts — ESM imports are
    // eager, so the git adapter, the core, and the judge would all have to resolve before
    // argv is even read, and this query would die at node's exit 1 with a module-resolution
    // stack trace instead of the documented 0 or 2. Moving the package aside reproduces the
    // unbuilt/pruned tree without needing one.
    // Resolved through the umbrella's own realpath, never the consumer root: under pnpm the
    // scoped packages are transitive and never surface at the top level (the DIST-03
    // measurement), so they live beside the umbrella inside the store.
    const umbrellaDir = dirname(
      realpathSync(join(consumerRoot, 'node_modules', UMBRELLA_DIR, 'package.json')),
    );
    const adapterDir = join(dirname(umbrellaDir), '@polydeukes', 'adapter-git');
    if (!existsSync(adapterDir)) {
      throw new Error(`the layout this case moves aside is not where it expected: ${adapterDir}`);
    }
    const stashed = join(packRoot, 'adapter-git-stashed');
    renameSync(adapterDir, stashed);
    try {
      const result = spawnDocs('install');

      expect(result.status, `stderr: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain('# Installing Polydeukes');
    } finally {
      // Restored for the cases below, which spawn the same tree.
      renameSync(stashed, adapterDir);
    }
  }, 60_000);

  it('refuses a two-argument form with the usage line', () => {
    // The argv half of §3-b, which no unit test reaches: `docs` is the bin's first form
    // taking a variable argument count, so the arity bound lives only here. Mutation
    // caught: the bound dropped — `pdks docs install extra` would then answer as though
    // the trailing word were not there.
    const result = spawnDocs('install', 'extra');

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('usage:');
  }, 60_000);
});
