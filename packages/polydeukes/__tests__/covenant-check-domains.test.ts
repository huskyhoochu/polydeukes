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
// `runCovenantCheck`'s `domain` (staged | worktree | range): one judge, three
// observation points. The same violation must collect identically, exit identically,
// and leave the same telemetry rows. The witness valve stands on staged alone.
import { runCovenantCheck } from '../src/covenant-check.ts';
import { type CheckRepo, createCheckRepo, telemetryRows } from './helpers.ts';

const WITNESS_TOKEN = 'i-accept-this-commit-covenant';
const PROTECTED_ENTRY = 'secret.txt';
const DISCIPLINE_ID = 'no-todo';
const DISCIPLINE_SCOPE = 'lib/**/*.ts';
const SCOPED_SOURCE = 'lib/a.ts';
const FORBIDDEN_TOKEN = 'TODO';
/** The same scope as a declaration's regex over the repo-relative path. */
const DISCIPLINE_SCOPE_RE = '^lib/.*\\.ts$';

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
      {
        id: DISCIPLINE_ID,
        declare: {
          mechanism: 'added-only',
          scope: { source: 'target.path', include: [DISCIPLINE_SCOPE_RE] },
          supply: { pre: 'empty', post: 'empty' },
          extract: {
            before: [
              { op: 'source', of: 'pre' },
              { op: 'lines' },
              { op: 'keyByPattern', re: `(${FORBIDDEN_TOKEN})` },
            ],
            after: [
              { op: 'source', of: 'post' },
              { op: 'lines' },
              { op: 'keyByPattern', re: `(${FORBIDDEN_TOKEN})` },
            ],
            added: [{ op: 'onlyIn', of: 'after', notIn: 'before' }],
          },
          relate: [
            { id: 'nothing-added', relation: { op: 'empty', of: 'added' }, message: 'adds {key}' },
          ],
        },
        enforce: 'block',
      },
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

describe('covenant check — the three domains judge one violation identically', () => {
  it('collects the same (path, status, pre, post) rows, exits the same, and records the same (event, label, subject) set', async () => {
    // The symmetry is checked at every layer, not just the exit code: a collector reading
    // post from the wrong source, a domain branch skipping the discipline registrations,
    // and a range run falling into the fail-closed catch would each still exit 2. The
    // expected rows are pinned explicitly so three runs that all crashed with a lone
    // `covenant-check` row cannot pass as "equal".
    const base = commitCleanBaseline();
    writeViolations();

    // worktree: disk dirty, index clean.
    const worktreeChanges = byPath(collectWorktreeChanges({ repoRoot: repoRoot }));
    const worktree = await runCovenantCheck({
      repoRoot,
      telemetryPath: logPath('worktree'),
      domain: { kind: 'worktree' },
    });

    // staged: same bytes, now in the index.
    git('add', SCOPED_SOURCE, PROTECTED_ENTRY);
    const stagedChanges = byPath(collectStagedChanges({ repoRoot: repoRoot }));
    const staged = await runCovenantCheck({
      repoRoot,
      telemetryPath: logPath('staged'),
      domain: { kind: 'staged' },
    });

    // range: same bytes, committed on a branch and observed from the baseline commit.
    git('checkout', '--quiet', '-b', VIOLATION_BRANCH);
    git('commit', '--quiet', '-m', 'violation');
    const rangeChanges = byPath(
      collectRangeChanges({ repoRoot: repoRoot, range: `${base}..${VIOLATION_BRANCH}` }),
    );
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
    // A default of worktree would let a dirty-but-unstaged file block a commit that does
    // not contain it. Disk carries the violation and the index is clean, so a staged
    // default exits 0 with zero rows.
    commitCleanBaseline();
    writeViolations();

    const result = await runCovenantCheck({ repoRoot, telemetryPath: logPath('default') });

    expect(result.exitCode).toBe(0);
    expect(telemetryRows(logPath('default'))).toEqual([]);
  });
});

describe('covenant check — the witness valve stands on staged only', () => {
  // Staged prompting is pinned by covenant-check-prompt.test.ts.

  it('under worktree a protected-path break never consults ttyPrompt and exits 2', async () => {
    // A valve assembled for every domain would make a diagnostic run hang on /dev/tty
    // asking to open a commit that does not exist, and record the answer as `witnessed`
    // with nothing witnessed.
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
    // The two diagnostic domains are separate dispatch arms, so one being valve-free
    // proves nothing about the other.
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

describe('covenant check — empty domains and an unresolvable range', () => {
  it('an empty range (HEAD..HEAD) exits 0 with zero rows', async () => {
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
    // Fail-closed with a record: a collector throw on a typo'd ref must become neither an
    // empty domain (exit 0) nor an unrecorded rejection.
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
