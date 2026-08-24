// DIAG-01 §4.4 / §5 AC-6 — the `covenant check` argv table on the built bin: the three
// domain forms exit 0 on a clean repository; every other combination is usage exit 2,
// and the usage line names both new flags.
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { writeConfigAt } from './helpers';

const repoRoot = resolve(import.meta.dirname, '../../..');
const BIN = resolve(import.meta.dirname, '../dist/bin.js');

let projectRoot: string;
let logDir: string;

beforeAll(() => {
  execSync('pnpm turbo run build', { cwd: repoRoot, stdio: 'pipe' });
}, 120_000);

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'pdks-check-bin-e2e-'));
  // Telemetry outside the repository so the log is never an untracked worktree change.
  logDir = mkdtempSync(join(tmpdir(), 'pdks-check-bin-e2e-log-'));
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: projectRoot, encoding: 'utf-8' });
  git('init', '--quiet');
  git('config', 'user.email', 'test@polydeukes.local');
  git('config', 'user.name', 'Polydeukes Test');
  git('config', 'commit.gpgsign', 'false');
  writeConfigAt(projectRoot, join(logDir, 'roi.log'), {});
  git('add', 'polydeukes.config.json');
  git('commit', '--quiet', '-m', 'config');
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(logDir, { recursive: true, force: true });
});

function spawnCheck(...extra: string[]) {
  return spawnSync(process.execPath, [BIN, 'covenant', 'check', ...extra], {
    cwd: projectRoot,
    encoding: 'utf-8',
  });
}

describe('§5 AC-6 pdks covenant check — the three domain forms on a clean repository', () => {
  it.each([
    ['staged (no flags)', []],
    ['--worktree', ['--worktree']],
    ['--range HEAD..HEAD', ['--range', 'HEAD..HEAD']],
    ['--range HEAD...HEAD', ['--range', 'HEAD...HEAD']],
  ])('%s exits 0 without a usage line', (_name, extra) => {
    // Mutation caught: a valid form rejected by the argv comparison (usage exit 2), or
    // a form that reached the runner but failed closed — both exit 2, so the absence of
    // `usage:` and of the fail-closed prefix on stderr separates them from a judgment.
    const result = spawnCheck(...extra);

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('usage:');
    expect(result.stderr).not.toContain('failed closed');
  });
});

describe('§5 AC-6 pdks covenant check — every other combination is usage exit 2', () => {
  it.each([
    ['--range with no argument', ['--range']],
    ['--range without `..`', ['--range', 'HEAD']],
    ['--worktree combined with --range', ['--worktree', '--range', 'HEAD..HEAD']],
    ['--range followed by --worktree (the flag is not a ref name)', ['--range', '--worktree']],
    ['an unknown flag', ['--bogus']],
  ])('%s prints usage naming both flags and exits 2', (_name, extra) => {
    // Mutation caught: a single-ref `--range X` accepted (git would diff X against the
    // worktree — a domain the table does not have), the flag pair accepted with one
    // silently winning, or an unknown flag ignored and judged as staged (fail-open: the
    // caller asked for something else and got a green exit). `--range --worktree` catches
    // a parser that takes argv[n+1] as the ref unconditionally: git would then name the
    // flag as an unresolvable ref and exit 2 without a usage line — same code, wrong path.
    const result = spawnCheck(...extra);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage:');
    expect(result.stderr).toContain('--worktree');
    expect(result.stderr).toContain('--range');
  });
});
