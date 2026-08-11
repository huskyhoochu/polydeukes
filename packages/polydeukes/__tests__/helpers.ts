import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readRecords } from '@polydeukes/core';

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

/** The default `languages.typescript.productionGlob` every check suite's config carries. */
export const DEFAULT_PRODUCTION_GLOB = 'lib/**/*.ts';

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

  const writeConfig = (extra: Record<string, unknown>): void => {
    const config = {
      languages: { typescript: { productionGlob, testCmd: 'echo {scope}' } },
      telemetry: { logPath: telemetryPath },
      ...extra,
    };
    writeFileSync(join(repoRoot, 'polydeukes.config.json'), JSON.stringify(config, null, 2));
  };

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
