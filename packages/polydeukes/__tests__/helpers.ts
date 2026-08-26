import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { readRecords } from '@polydeukes/core';
import { expect } from 'vitest';

/**
 * Every telemetry row at `telemetryPath` as `[event, label, subject]` — the three-column
 * projection the umbrella suites pin verdicts with. Extracted at the fourth copy (the
 * covenant package's helpers.ts precedent fires at the third): a change to the record
 * shape now lands here once instead of drifting across suites.
 */
export function telemetryRows(telemetryPath: string): [string, string, string][] {
  return readRecords(telemetryPath).records.map((record) => [
    record.event,
    record.label,
    record.subject,
  ]);
}

/**
 * The row the session surface's state comparison leaves on its FIRST call in a repository
 * (COVENANT-14 §2-e): the baseline file is absent, so it is re-established and the absence
 * is recorded, subject = the baseline file. Every suite here builds a fresh repoRoot per
 * case, so every case's first hook call carries it ahead of that call's judgment rows.
 */
export const BASELINE_FIRST_RUN_ROW: [string, string, unknown] = [
  'unattributed',
  'baseline',
  expect.stringMatching(/baseline\.json$/),
];

/** The default `languages.typescript.productionGlob` every check suite's config carries. */
export const DEFAULT_PRODUCTION_GLOB = 'lib/**/*.ts';

/** The real built covenant dist — the "body present" end of the unbuilt-body axis. */
export const REAL_COVENANT_DIST = resolve(import.meta.dirname, '../../covenant/dist');

/**
 * A covenant dist under `repoRoot` mirroring the real build entry-by-entry, with at most
 * ONE judge body omitted — the state a source-side addition leaves behind when nobody
 * rebuilt. Every other file is present, so only a per-FILE existence proof tells this
 * apart from a good build. Pass `null` to omit nothing (the control end of the axis).
 *
 * The entries are SYMLINKS, not copies: Node resolves a module to its real path before
 * looking up `node_modules`, so a symlinked body still reaches the real build's
 * dependencies and actually runs. A copied body cannot — it dies at import with
 * ERR_MODULE_NOT_FOUND, which is body exit 1, which `advise` records as a verdict. That
 * would make every "present body" row a fabricated judgment and leave the fixture green
 * even if body execution broke entirely.
 */
export function distWithout(repoRoot: string, omitBody: string | null): string {
  const fixtureDist = join(repoRoot, 'covenant-dist-fixture');
  mkdirSync(fixtureDist, { recursive: true });
  for (const entry of readdirSync(REAL_COVENANT_DIST)) {
    if (entry === omitBody) continue;
    symlinkSync(join(REAL_COVENANT_DIST, entry), join(fixtureDist, entry));
  }
  return fixtureDist;
}

/**
 * A covenant dist mirroring the real build with ONE module replaced: `self-mod.js` re-exports
 * the real one but overrides `selfModRegistration` to answer the unjudgeable outcome (exit-2
 * equivalent) for every payload. The barrel still loads and every other registration behaves
 * normally, so what a run observes is a judge that cannot judge — the in-process successor of
 * the `process.exit(2)` stub body.
 */
export function stubDistWithUnjudgeableSelfMod(repoRoot: string): string {
  const stubDist = join(repoRoot, 'covenant-dist-stub');
  mkdirSync(stubDist, { recursive: true });
  const overridden = 'self-mod.js';
  for (const entry of readdirSync(REAL_COVENANT_DIST)) {
    if (entry === overridden) continue;
    symlinkSync(join(REAL_COVENANT_DIST, entry), join(stubDist, entry));
  }
  // Written beside the symlinks rather than symlinked: this is the one module whose
  // behaviour the fixture replaces. It imports the real module by absolute path, so the
  // re-exports the barrel needs still resolve to the real build.
  const realSelfMod = join(REAL_COVENANT_DIST, overridden);
  writeFileSync(
    join(stubDist, overridden),
    `export * from ${JSON.stringify(realSelfMod)};\n` +
      'export function selfModRegistration(spec) {\n' +
      '  return {\n' +
      "    label: 'self-mod',\n" +
      '    protectedPaths: spec.protectedPaths,\n' +
      '    body: async () => ({ exitCode: 2 }),\n' +
      '    ...(spec.witness !== undefined ? { witness: spec.witness } : {}),\n' +
      '  };\n' +
      '}\n',
  );
  return stubDist;
}

/**
 * Write `polydeukes.config.json` into `repoRoot`: the minimal valid config (`languages`
 * is required) plus the caller's keys.
 *
 * Separate from {@link createCheckRepo} because the session-surface suites need this
 * writer without the git repository around it — they drive the hook, which never reads
 * git. Both surfaces' fixtures therefore share one definition of what a minimal config
 * looks like, so a schema change lands here once.
 */
export function writeConfigAt(
  repoRoot: string,
  telemetryPath: string,
  extra: Record<string, unknown>,
  productionGlob: string = DEFAULT_PRODUCTION_GLOB,
): void {
  const config = {
    languages: { typescript: { productionGlob, testCmd: 'echo {scope}' } },
    telemetry: { logPath: telemetryPath },
    ...extra,
  };
  writeFileSync(join(repoRoot, 'polydeukes.config.json'), JSON.stringify(config, null, 2));
}

/** A throwaway git repository plus the three writers the check suites drive it with. */
export type CheckRepo = {
  /** Absolute path to the repository root — a fresh mkdtemp per call. */
  repoRoot: string;
  /** Where the run under test appends telemetry: `<repoRoot>/roi.log`. */
  telemetryPath: string;
  /** Run git inside the repository, returning stdout. */
  git: (...args: string[]) => string;
  /** Write a file at a repo-relative path, creating parent directories. */
  write: (relPath: string, content: string) => void;
  /** Write `polydeukes.config.json`: the minimal valid config plus the caller's keys. */
  writeConfig: (extra: Record<string, unknown>) => void;
  /** Remove the repository. */
  cleanup: () => void;
};

/**
 * Build a throwaway git repository for one `covenant check` case.
 *
 * The suites call this from `beforeEach` and `cleanup` from `afterEach`, so every case
 * judges a repository no other case has touched. The writers are returned rather than
 * imported because each closes over THIS call's `repoRoot` — a module-level helper would
 * have to read a mutable binding the suite reassigns, which is the shape that made five
 * copies of this fixture drift apart in the first place.
 *
 * `prefix` names the mkdtemp directory (suites pass their own so a leaked temp directory
 * still says which suite made it). `productionGlob` defaults to the value every suite
 * uses; the two that also register a discipline over the same glob pass their own
 * constant so the config and the discipline scope cannot drift apart.
 */
export function createCheckRepo(
  prefix: string,
  productionGlob: string = DEFAULT_PRODUCTION_GLOB,
): CheckRepo {
  const repoRoot = mkdtempSync(join(tmpdir(), prefix));
  const telemetryPath = join(repoRoot, 'roi.log');

  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repoRoot, encoding: 'utf-8' });

  const write = (relPath: string, content: string): void => {
    const absolute = join(repoRoot, relPath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  };

  const writeConfig = (extra: Record<string, unknown>): void =>
    writeConfigAt(repoRoot, telemetryPath, extra, productionGlob);

  git('init', '--quiet');
  git('config', 'user.email', 'test@polydeukes.local');
  git('config', 'user.name', 'Polydeukes Test');
  git('config', 'commit.gpgsign', 'false');

  return {
    repoRoot,
    telemetryPath,
    git,
    write,
    writeConfig,
    cleanup: () => rmSync(repoRoot, { recursive: true, force: true }),
  };
}
