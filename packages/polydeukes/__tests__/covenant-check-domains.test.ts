import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectRangeChanges,
  collectStagedChanges,
  collectWorktreeChanges,
  type StagedChange,
} from '@polydeukes/adapter-git';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// DIAG-01 §4.2 / §4.3 / §5 AC-3, AC-4, AC-5 RED phase — `runCovenantCheck` gains a
// `domain` (staged | worktree | range). One judge, three observation points: the same
// violation must collect identically, exit identically, and leave the same telemetry
// rows under the one `covenant-check` label. The witness valve stands on staged alone.
import { runCovenantCheck } from '../src/index.ts';
import { type CheckRepo, createCheckRepo, telemetryRows } from './helpers.ts';

const WITNESS_TOKEN = 'i-accept-this-commit-covenant';
const PROTECTED_ENTRY = 'secret.txt';
const DISCIPLINE_ID = 'no-todo';
const DISCIPLINE_SCOPE = 'lib/**/*.ts';
const SCOPED_SOURCE = 'lib/a.ts';
const FORBIDDEN_TOKEN = 'TODO';
const VIOLATION_BRANCH = 'violation';
/** The umbrella's protected-paths registration label — an observable contract, not a fixture choice. */
const SELF_MOD_LABEL = 'self-mod';
/** The label a run that failed closed before judging writes its one blocked row under. */
const FAIL_CLOSED_LABEL = 'covenant-check';

let repo: CheckRepo;
let repoRoot: string;
let git: CheckRepo['git'];
let write: CheckRepo['write'];
let writeConfig: CheckRepo['writeConfig'];
/** Telemetry lives OUTSIDE the repository: a log inside it would be an untracked file the worktree domain collects. */
let logDir: string;

function logPath(name: string): string {
  return join(logDir, `${name}.log`);
}

beforeEach(() => {
  repo = createCheckRepo('pdks-check-domains-', DISCIPLINE_SCOPE);
  ({ repoRoot, git, write, writeConfig } = repo);
  logDir = mkdtempSync(join(tmpdir(), 'pdks-check-domains-log-'));
});

afterEach(() => {
  repo.cleanup();
  rmSync(logDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** Commit the config, a clean scoped source, and the protected entry, so HEAD is the clean baseline. */
function commitCleanBaseline(extraConfig: Record<string, unknown> = {}): string {
  writeConfig({
    protectedPaths: [PROTECTED_ENTRY],
    disciplines: [
      { id: DISCIPLINE_ID, forbid: FORBIDDEN_TOKEN, in: DISCIPLINE_SCOPE, enforce: 'block' },
    ],
    ...extraConfig,
  });
  write(SCOPED_SOURCE, 'export const x = 1;\n');
  write(PROTECTED_ENTRY, 'sensitive\n');
  git('add', 'polydeukes.config.json', SCOPED_SOURCE, PROTECTED_ENTRY);
  git('commit', '--quiet', '-m', 'baseline');
  return git('rev-parse', 'HEAD').trim();
}

/** Write both violations to disk only — the worktree observation point. */
function writeViolations(): void {
  write(SCOPED_SOURCE, `export const x = 1;\n// ${FORBIDDEN_TOKEN}: forbidden marker\n`);
  write(PROTECTED_ENTRY, 'sensitive, edited\n');
}

function byPath(changes: StagedChange[]): StagedChange[] {
  return [...changes].sort((a, b) => a.path.localeCompare(b.path));
}

function sortedRows(path: string): [string, string, string][] {
  return [...telemetryRows(path)].sort((a, b) => a.join('|').localeCompare(b.join('|')));
}

describe('§5 AC-3 covenant check — the three domains judge one violation identically', () => {
  it('collects the same (path, status, pre, post) rows, exits the same, and records the same (event, label, subject) set', async () => {
    // The symmetry is checked at every layer, not just the exit code (dev-log
    // "symmetry-checked-at-one-layer-only"): a collector that read post from the wrong
    // source, a domain branch that skipped the discipline registrations, or a range run
    // that fell into the fail-closed catch would each still exit 2. Mutation caught:
    // any one domain diverging from the other two at the collector, the exit, or the
    // rows — and the expected rows are pinned explicitly so three runs that all crashed
    // with a lone `covenant-check` row cannot pass as "equal".
    const base = commitCleanBaseline();
    writeViolations();

    // worktree: disk dirty, index clean.
    const worktreeChanges = byPath(collectWorktreeChanges(repoRoot));
    const worktree = await runCovenantCheck({
      repoRoot,
      telemetryPath: logPath('worktree'),
      domain: { kind: 'worktree' },
    });

    // staged: same bytes, now in the index.
    git('add', SCOPED_SOURCE, PROTECTED_ENTRY);
    const stagedChanges = byPath(collectStagedChanges(repoRoot));
    const staged = await runCovenantCheck({
      repoRoot,
      telemetryPath: logPath('staged'),
      domain: { kind: 'staged' },
    });

    // range: same bytes, committed on a branch and observed from the baseline commit.
    git('checkout', '--quiet', '-b', VIOLATION_BRANCH);
    git('commit', '--quiet', '-m', 'violation');
    const rangeChanges = byPath(collectRangeChanges(repoRoot, `${base}..${VIOLATION_BRANCH}`));
    const range = await runCovenantCheck({
      repoRoot,
      telemetryPath: logPath('range'),
      domain: { kind: 'range', base, head: VIOLATION_BRANCH },
    });

    expect(worktreeChanges).toEqual(stagedChanges);
    expect(rangeChanges).toEqual(stagedChanges);
    expect(stagedChanges.map((change) => change.path)).toEqual([SCOPED_SOURCE, PROTECTED_ENTRY]);

    expect(staged.exitCode).toBe(2);
    expect(worktree.exitCode).toBe(2);
    expect(range.exitCode).toBe(2);

    const stagedRows = sortedRows(logPath('staged'));
    expect(sortedRows(logPath('worktree'))).toEqual(stagedRows);
    expect(sortedRows(logPath('range'))).toEqual(stagedRows);
    expect(stagedRows).toContainEqual(['blocked', SELF_MOD_LABEL, PROTECTED_ENTRY]);
    expect(stagedRows).toContainEqual(['blocked', DISCIPLINE_ID, SCOPED_SOURCE]);
    expect(stagedRows.some((row) => row[1] === FAIL_CLOSED_LABEL)).toBe(false);
  });

  it('omitting `domain` judges the staged diff (the lefthook path is unchanged)', async () => {
    // Mutation caught: the default flipped to worktree — a dirty-but-unstaged file would
    // then block a commit that does not contain it. Disk carries the violation; the
    // index is clean, so a staged default exits 0 with zero rows.
    commitCleanBaseline();
    writeViolations();

    const result = await runCovenantCheck({ repoRoot, telemetryPath: logPath('default') });

    expect(result.exitCode).toBe(0);
    expect(telemetryRows(logPath('default'))).toEqual([]);
  });
});

describe('§5 AC-4 covenant check — the witness valve stands on staged only', () => {
  // Staged prompting is pinned by covenant-check-prompt.test.ts.

  it('under worktree a protected-path break never consults ttyPrompt and exits 2', async () => {
    // Mutation caught: the valve assembled for every domain — a diagnostic run would
    // then hang on /dev/tty asking to open a commit that does not exist, and the
    // answer would be recorded as `witnessed` (exit 0) with nothing witnessed.
    commitCleanBaseline({ witness: { token: WITNESS_TOKEN, ttlMinutes: 5 } });
    writeViolations();
    const ttyPrompt = vi.fn((_prompt: string) => WITNESS_TOKEN);

    const result = await runCovenantCheck({
      repoRoot,
      telemetryPath: logPath('worktree'),
      domain: { kind: 'worktree' },
      ttyPrompt,
    });

    expect(result.exitCode).toBe(2);
    expect(ttyPrompt).toHaveBeenCalledTimes(0);
    const rows = telemetryRows(logPath('worktree'));
    expect(rows.some((row) => row[0] === 'witnessed')).toBe(false);
    expect(rows).toContainEqual(['blocked', SELF_MOD_LABEL, PROTECTED_ENTRY]);
  });

  it('under range a protected-path break never consults ttyPrompt and exits 2', async () => {
    // Same mutation as above on the range branch — the two diagnostic domains are
    // separate dispatch arms, so one being valve-free proves nothing about the other.
    const base = commitCleanBaseline({ witness: { token: WITNESS_TOKEN, ttlMinutes: 5 } });
    writeViolations();
    git('checkout', '--quiet', '-b', VIOLATION_BRANCH);
    git('add', SCOPED_SOURCE, PROTECTED_ENTRY);
    git('commit', '--quiet', '-m', 'violation');
    const ttyPrompt = vi.fn((_prompt: string) => WITNESS_TOKEN);

    const result = await runCovenantCheck({
      repoRoot,
      telemetryPath: logPath('range'),
      domain: { kind: 'range', base, head: VIOLATION_BRANCH },
      ttyPrompt,
    });

    expect(result.exitCode).toBe(2);
    expect(ttyPrompt).toHaveBeenCalledTimes(0);
    const rows = telemetryRows(logPath('range'));
    expect(rows.some((row) => row[0] === 'witnessed')).toBe(false);
    expect(rows).toContainEqual(['blocked', SELF_MOD_LABEL, PROTECTED_ENTRY]);
  });
});

describe('§5 AC-5 covenant check — empty domains and an unresolvable range', () => {
  it('an empty range (HEAD..HEAD) exits 0 with zero rows', async () => {
    // Same short-circuit on the range arm.
    commitCleanBaseline();

    const result = await runCovenantCheck({
      repoRoot,
      telemetryPath: logPath('range'),
      domain: { kind: 'range', base: 'HEAD', head: 'HEAD' },
    });

    expect(result.exitCode).toBe(0);
    expect(telemetryRows(logPath('range'))).toEqual([]);
  });

  it('an unresolvable range ref exits 2 with exactly one blocked row under the covenant-check label', async () => {
    // Fail-closed with a record: a collector throw on a typo'd ref must not become an
    // empty domain (exit 0) nor an unrecorded rejection. Mutation caught: the range arm's
    // try dropped (throw escapes the runner), or the throw swallowed into [].
    commitCleanBaseline();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const result = await runCovenantCheck({
      repoRoot,
      telemetryPath: logPath('range'),
      domain: { kind: 'range', base: 'no-such-ref', head: 'HEAD' },
    });

    expect(result.exitCode).toBe(2);
    expect(telemetryRows(logPath('range'))).toEqual([['blocked', FAIL_CLOSED_LABEL, '-']]);
    expect(stderr).toHaveBeenCalledTimes(1);
  });
});
