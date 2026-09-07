import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { CovenantInput } from '@polydeukes/core';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// The built bin under the two argv forms it accepts: `covenant check` reads an IR JSON from
// stdin, `covenant check --diff` reads a unified diff from stdin. Every spawn pipes all
// three stdio fds and passes its own `input` — the child never inherits the runner's stdin,
// so a bin that reads any fd other than its own stdin has nothing to read and fails.
import { STAGED_WRITE } from '../src/diff-ir.ts';
import { telemetryRows, writeConfigAt } from './helpers.ts';

const repoRoot = resolve(import.meta.dirname, '../../..');
const BIN = resolve(import.meta.dirname, '../dist/bin.js');

/** Injected fixture values. */
const PROTECTED_ENTRY = 'secret.txt';
const ORDINARY_FILE = 'ordinary.txt';
const ORDINARY_TEXT = 'nothing special\n';
/** The umbrella's protected-paths registration label — an observable contract, not a fixture choice. */
const SELF_MOD_LABEL = 'self-mod';
/** The runner's own label — the row an unrouted call leaves (one call, one record). */
const CHECK_LABEL = 'covenant-check';
/** The label a run that failed closed before judging writes its one blocked row under. */
const FAIL_CLOSED_LABEL = 'covenant-check';

let projectRoot: string;
let logDir: string;
let logPath: string;
let git: (...args: string[]) => string;

beforeAll(() => {
  execSync('pnpm turbo run build', { cwd: repoRoot, stdio: 'pipe' });
}, 120_000);

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'pdks-check-stdin-e2e-'));
  // Telemetry outside the repository so the log is never a staged or untracked change.
  logDir = mkdtempSync(join(tmpdir(), 'pdks-check-stdin-e2e-log-'));
  logPath = join(logDir, 'roi.log');
  git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: projectRoot, encoding: 'utf-8' });
  git('init', '--quiet');
  git('config', 'user.email', 'test@polydeukes.local');
  git('config', 'user.name', 'Polydeukes Test');
  git('config', 'commit.gpgsign', 'false');
  writeConfigAt(projectRoot, logPath, { protectedPaths: [PROTECTED_ENTRY] });
  git('add', 'polydeukes.config.json');
  git('commit', '--quiet', '-m', 'config');
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(logDir, { recursive: true, force: true });
});

/** Spawn the bin with `input` on stdin and nothing inherited. */
function spawnCheck(input: string, ...extra: string[]) {
  return spawnSync(process.execPath, [BIN, 'covenant', 'check', ...extra], {
    cwd: projectRoot,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    input,
  });
}

function stage(relPath: string, content: string): void {
  writeFileSync(join(projectRoot, relPath), content);
  git('add', relPath);
}

/** The IR the diff of one staged creation translates to, written by hand. */
function creationIr(path: string, post: string): CovenantInput {
  return {
    toolCalls: [
      { name: STAGED_WRITE, args: { file_path: path }, fileChange: { kind: 'create', path, post } },
    ],
    subagentSpawns: [],
    userMessages: [],
  };
}

describe('--diff: a real git diff --cached on stdin', () => {
  it('one ordinary staged file exits 0 with exactly one telemetry row', () => {
    // The judged path — a bin that exits 0 without dispatching leaves no row; one that
    // fails closed on the diff leaves a covenant-check row and exit 2.
    stage(ORDINARY_FILE, ORDINARY_TEXT);

    const result = spawnCheck(git('diff', '--cached'), '--diff');

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('usage:');
    expect(telemetryRows(logPath)).toEqual([['passed', CHECK_LABEL, ORDINARY_FILE]]);
  });

  it('a staged protected path exits 0 with an advised self-mod row by default', () => {
    stage(PROTECTED_ENTRY, 'sensitive\n');

    const result = spawnCheck(git('diff', '--cached'), '--diff');

    expect(result.status).toBe(0);
    expect(telemetryRows(logPath)).toEqual([['advised', SELF_MOD_LABEL, PROTECTED_ENTRY]]);
  });

  it('a staged protected path exits 2 with a blocked self-mod row under --enforce block, in either flag order', () => {
    stage(PROTECTED_ENTRY, 'sensitive\n');

    const first = spawnCheck(git('diff', '--cached'), '--diff', '--enforce', 'block');
    const firstRows = telemetryRows(logPath);
    writeFileSync(logPath, '');
    const second = spawnCheck(git('diff', '--cached'), '--enforce', 'block', '--diff');

    expect(first.status).toBe(2);
    expect(second.status).toBe(2);
    expect(firstRows).toEqual([['blocked', SELF_MOD_LABEL, PROTECTED_ENTRY]]);
    expect(telemetryRows(logPath)).toEqual(firstRows);
  });

  it('a diff forced to color exits 2 with one blocked covenant-check row — never an empty pass', () => {
    // `color.ui=always` pushes SGR escapes through the pipe. The translator recognizes no
    // block and the run fails closed; a bin that landed exit 0 here would pass a whole
    // commit, protected paths included, without a row.
    stage(PROTECTED_ENTRY, 'sensitive\n');
    const colored = execFileSync('git', ['-c', 'color.ui=always', 'diff', '--cached'], {
      cwd: projectRoot,
      encoding: 'utf-8',
    });
    expect(colored).toContain('\u001b[');

    const result = spawnCheck(colored, '--diff');

    expect(result.status).toBe(2);
    expect(telemetryRows(logPath)).toEqual([['blocked', FAIL_CLOSED_LABEL, '-']]);
  });

  it('the lefthook shape — sh -c "git diff --cached | node bin covenant check --diff" — exits 0', () => {
    // The pipe is what the checked-in hook runs. /bin/sh is pinned: the ambient shell is
    // not the hook's shell.
    stage(ORDINARY_FILE, ORDINARY_TEXT);
    const command = `git diff --cached | ${JSON.stringify(process.execPath)} ${JSON.stringify(BIN)} covenant check --diff`;

    const result = spawnSync('/bin/sh', ['-c', command], {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      input: '',
    });

    expect(result.status).toBe(0);
    expect(telemetryRows(logPath)).toEqual([['passed', CHECK_LABEL, ORDINARY_FILE]]);
  });

  it('zero bytes on stdin exit 0 with no row — nothing staged is nothing to judge', () => {
    const result = spawnCheck('', '--diff');

    expect(result.status).toBe(0);
    expect(telemetryRows(logPath)).toEqual([]);
  });

  it('a combined diff on stdin exits 2 with one blocked covenant-check row', () => {
    // The translator's throw must land as fail-closed, never as node's exit 1 crash and
    // never as an empty pass.
    const combined = [
      'diff --cc f.txt',
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@@ -1 -1 +1 @@@',
      '++merged',
      '',
    ].join('\n');

    const result = spawnCheck(combined, '--diff');

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('failed closed');
    expect(telemetryRows(logPath)).toEqual([['blocked', FAIL_CLOSED_LABEL, '-']]);
  });
});

describe('IR mode: CovenantInput JSON on stdin', () => {
  it('the hand-written IR of an ordinary creation lands the same exit and row as its diff', () => {
    // Fixture parity: one change, two encodings, one judgment.
    stage(ORDINARY_FILE, ORDINARY_TEXT);
    const fromDiff = spawnCheck(git('diff', '--cached'), '--diff');
    const diffRows = telemetryRows(logPath);
    writeFileSync(logPath, '');

    const fromIr = spawnCheck(JSON.stringify(creationIr(ORDINARY_FILE, ORDINARY_TEXT.trimEnd())));

    expect(fromDiff.status).toBe(0);
    expect(fromIr.status).toBe(0);
    expect(telemetryRows(logPath)).toEqual(diffRows);
    expect(diffRows).toEqual([['passed', CHECK_LABEL, ORDINARY_FILE]]);
  });

  it('the hand-written IR of a protected-path creation lands the same exit 2 and blocked row as its diff under --enforce block', () => {
    stage(PROTECTED_ENTRY, 'sensitive\n');
    const fromDiff = spawnCheck(git('diff', '--cached'), '--diff', '--enforce', 'block');
    const diffRows = telemetryRows(logPath);
    writeFileSync(logPath, '');

    const fromIr = spawnCheck(
      JSON.stringify(creationIr(PROTECTED_ENTRY, 'sensitive')),
      '--enforce',
      'block',
    );

    expect(fromDiff.status).toBe(2);
    expect(fromIr.status).toBe(2);
    expect(telemetryRows(logPath)).toEqual(diffRows);
    expect(diffRows).toEqual([['blocked', SELF_MOD_LABEL, PROTECTED_ENTRY]]);
  });

  it('zero bytes on stdin exit 2 — an empty payload is not an IR', () => {
    // The two modes disagree on empty input by design: a diff of nothing is nothing,
    // an IR of nothing is unparseable.
    const result = spawnCheck('');

    expect(result.status).toBe(2);
    expect(result.stderr).not.toContain('usage:');
  });

  it.each([
    ['text that is not JSON', 'not json'],
    ['a top-level array', '[]'],
    ['an object with no toolCalls', '{"subagentSpawns":[],"userMessages":[]}'],
  ])(
    '%s on stdin exits 2 with one blocked covenant-check row and no usage line',
    (_name, payload) => {
      // The shape check is the dispatcher's; what the bin owes is landing that refusal as
      // exit 2 with a row, never as node's exit 1 crash and never as a usage error.
      const result = spawnCheck(payload);

      expect(result.status).toBe(2);
      expect(result.stderr).not.toContain('usage:');
      expect(telemetryRows(logPath)).toEqual([['blocked', FAIL_CLOSED_LABEL, '-']]);
    },
  );

  it('an IR carrying a top-level world key exits 2 with one blocked row', () => {
    const withWorld = { ...creationIr(ORDINARY_FILE, ORDINARY_TEXT), world: { files: {} } };

    const result = spawnCheck(JSON.stringify(withWorld));

    expect(result.status).toBe(2);
    expect(telemetryRows(logPath)).toEqual([['blocked', FAIL_CLOSED_LABEL, '-']]);
  });
});

describe('every other argv is usage exit 2 naming --diff', () => {
  it.each([
    ['--worktree', ['--worktree']],
    ['--range a..b', ['--range', 'a..b']],
    ['--diff with an extra argument', ['--diff', 'extra']],
    ['--enforce with no level', ['--enforce']],
    ['--enforce with an unknown level', ['--enforce', 'warn']],
    ['--diff twice', ['--diff', '--diff']],
  ])('%s prints the usage line and exits 2 without reading stdin', (_name, extra) => {
    // The removed flags must not be accepted silently as the stdin form; stdin carries a
    // valid diff so a bin that ignored the flag and judged would exit 0.
    stage(ORDINARY_FILE, ORDINARY_TEXT);

    const result = spawnCheck(git('diff', '--cached'), ...extra);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage:');
    expect(result.stderr).toContain('--diff');
    expect(telemetryRows(logPath)).toEqual([]);
  });
});
