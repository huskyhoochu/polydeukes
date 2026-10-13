import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { CovenantInput } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// The built bin under the two argv forms it accepts: `covenant check` reads an IR JSON from
// stdin, `covenant check --diff` reads a unified diff from stdin. Every spawn pipes all
// three stdio fds and passes its own `input` — the child never inherits the runner's stdin,
// so a bin that reads any fd other than its own stdin has nothing to read and fails.
import { STAGED_WRITE } from '../src/diff-ir.ts';
import { BASELINE_FIRST_RUN_ROW, telemetryRows, writeConfigAt } from './helpers.ts';

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
/** The exit of a run that could not read its input — distinct from a verdict's 0 and 2. */
const EXIT_INPUT_UNREAD = 3;

/** The one stderr line an input-stage failure writes, the reason after the fixed prefix. */
function failedClosedLine(reason: string): string {
  return `covenant check failed closed: ${reason}\n`;
}

let projectRoot: string;
let logDir: string;
let logPath: string;
let git: (...args: string[]) => string;

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

describe('--input-failure: an explicit refusal on stdin', () => {
  it('reports the supplied reason once, exits 3, and writes only one blocked runner row', () => {
    // Routing the object as IR or judging an empty input could manufacture a passed row.
    const reason = 'the adapter cannot translate this outside-project patch';
    const result = spawnCheck(JSON.stringify({ reason }), '--input-failure');
    expect(result.status, result.stderr).toBe(EXIT_INPUT_UNREAD);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(failedClosedLine(reason));
    expect(telemetryRows(logPath)).toEqual([['blocked', FAIL_CLOSED_LABEL, '-']]);
  });

  it.each([
    ['malformed JSON', '{', /JSON/i],
    ['missing reason', '{}', /reason/i],
    ['empty reason', '{"reason":""}', /reason/i],
    ['numeric reason', '{"reason":7}', /reason/i],
  ])('refuses %s with its actual input error and one blocked row', (_name, input, diagnostic) => {
    // Invalid failure input must remain an input failure, never a normal empty judgment.
    const result = spawnCheck(input as string, '--input-failure');
    expect(result.status, result.stderr).toBe(EXIT_INPUT_UNREAD);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(diagnostic as RegExp);
    expect(telemetryRows(logPath)).toEqual([['blocked', FAIL_CLOSED_LABEL, '-']]);
  });

  it.each([
    ['--input-failure', '--diff'],
    ['--diff', '--input-failure'],
    ['--input-failure', '--input-failure'],
  ])('rejects incompatible or repeated input modes %j before judging', (...flags) => {
    // Silently choosing one mode can judge a refusal payload as an empty diff.
    const result = spawnCheck('{"reason":"refusal"}', ...flags);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/usage/i);
    expect(telemetryRows(logPath)).toEqual([]);
  });
});

describe('--diff: a real git diff --cached on stdin', () => {
  it('one ordinary staged file exits 0 with exactly one telemetry row', () => {
    // The judged path — a bin that exits 0 without dispatching leaves no row; one that
    // fails closed on the diff leaves a covenant-check row and exit 3.
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

  it('a diff forced to color exits 3 with one blocked covenant-check row — never an empty pass', () => {
    // `color.ui=always` pushes SGR escapes through the pipe. The translator recognizes no
    // block and the run fails closed at the input stage; a bin that landed exit 0 here
    // would pass a whole commit, protected paths included, without a row.
    stage(PROTECTED_ENTRY, 'sensitive\n');
    const colored = execFileSync('git', ['-c', 'color.ui=always', 'diff', '--cached'], {
      cwd: projectRoot,
      encoding: 'utf-8',
    });
    expect(colored).toContain('\u001b[');

    const result = spawnCheck(colored, '--diff');

    expect(result.status).toBe(EXIT_INPUT_UNREAD);
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

  it('a combined diff on stdin exits 3 with one blocked covenant-check row and the failed-closed line', () => {
    // The translator's throw must land as fail-closed at the input-stage exit, never as
    // node's exit 1 crash, never as an empty pass, and never as the 2 a verdict uses — a
    // host reading 2 would report a covenant break over a diff nobody judged.
    const combined = [
      'diff --cc f.txt',
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@@ -1 -1 +1 @@@',
      '++merged',
      '',
    ].join('\n');

    const result = spawnCheck(combined, '--diff');

    expect(result.status).toBe(EXIT_INPUT_UNREAD);
    expect(result.stderr).toMatch(/^covenant check failed closed: \S.*\n$/);
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

  it('zero bytes on stdin exit 3 under the not-JSON reason — an empty payload is not an IR', () => {
    // The two modes disagree on empty input by design: a diff of nothing is nothing,
    // an IR of nothing is unparseable. The reason quotes JSON.parse, so a bin that
    // special-cases '' into its own message or into a usage error fails here.
    const result = spawnCheck('');

    expect(result.status).toBe(EXIT_INPUT_UNREAD);
    expect(result.stderr).toMatch(/^covenant check failed closed: input is not JSON: \S.*\n$/);
    expect(telemetryRows(logPath)).toEqual([['blocked', FAIL_CLOSED_LABEL, '-']]);
  });

  it.each([
    ['a top-level array', '[]', 'input is not a JSON object'],
    [
      'an object with no toolCalls',
      '{"subagentSpawns":[],"userMessages":[]}',
      'input carries no toolCalls array',
    ],
    [
      'an object with no subagentSpawns',
      '{"toolCalls":[],"userMessages":[]}',
      'input carries no subagentSpawns array',
    ],
    [
      'an object with no userMessages',
      '{"toolCalls":[],"subagentSpawns":[]}',
      'input carries no userMessages array',
    ],
    [
      'an actor that is a number',
      '{"toolCalls":[],"subagentSpawns":[],"userMessages":[],"actor":5}',
      'input carries a malformed actor',
    ],
  ])(
    '%s on stdin exits 3 with exactly the failed-closed line naming the key and one blocked covenant-check row',
    (_name, payload, reason) => {
      // Each payload misses or breaks exactly one key, so the reason names that key and no
      // other; what the bin owes is landing the refusal as exit 3 with the one line and a
      // row, never as node's exit 1 crash, never as a usage error, and never as the 2 a
      // host would read as a discipline's block over a call nobody judged.
      const result = spawnCheck(payload, '--enforce', 'block');

      expect(result.status).toBe(EXIT_INPUT_UNREAD);
      expect(result.stderr).toBe(failedClosedLine(reason));
      expect(telemetryRows(logPath)).toEqual([['blocked', FAIL_CLOSED_LABEL, '-']]);
    },
  );

  it('an IR carrying a top-level world key exits 3 with one blocked row', () => {
    // The parser accepts a well-formed world; refusing it is the runner's, and that refusal
    // still belongs to the input stage — a runner that lands it at 2 reports a verdict.
    const withWorld = { ...creationIr(ORDINARY_FILE, ORDINARY_TEXT), world: { files: {} } };

    const result = spawnCheck(JSON.stringify(withWorld));

    expect(result.status).toBe(EXIT_INPUT_UNREAD);
    expect(result.stderr).toMatch(/^covenant check failed closed: \S.*\n$/);
    expect(telemetryRows(logPath)).toEqual([['blocked', FAIL_CLOSED_LABEL, '-']]);
  });

  it('a missing config exits 2, not 3 — the run never reached its input', () => {
    // The config is loaded before the input is read. A bin that reads stdin first, or that
    // folds every pre-judgment failure into 3, tells a host its IR was wrong when the
    // project is what is unconfigured; the valid IR on stdin is what separates the two.
    rmSync(join(projectRoot, 'polydeukes.config.json'));

    const result = spawnCheck(JSON.stringify(creationIr(ORDINARY_FILE, ORDINARY_TEXT)));

    expect(result.status).toBe(2);
    expect(result.stderr).not.toContain('usage:');
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

// A session-shaped IR: the host roster under `tools`, the session evidence under
// `session`. The bin never reads git for it, so the fixture repository's commit is only
// what the earlier blocks need; these cases rewrite the config where the case needs a
// witness and hand the bin the IR alone.

/** Injected fixture values — the host's mutating tool name and the witness. */
const SESSION_WRITE_TOOL = 'session-write';
const SESSION_TOOLS = { mutating: [SESSION_WRITE_TOOL], shell: [], commandArgs: [] };
const SESSION_WITNESS_TOKEN = 'agreed-token';
const SESSION_TTL_MINUTES = 10;

/** The IR of one session write by the host's tool, evidence attached, no session. */
function sessionWriteIr(path: string, post: string): CovenantInput {
  return {
    toolCalls: [
      {
        name: SESSION_WRITE_TOOL,
        args: { file_path: path, content: post },
        fileChange: { kind: 'create', path, post },
      },
    ],
    subagentSpawns: [],
    userMessages: [],
  };
}

describe('IR mode: a session-shaped IR on stdin', () => {
  it('a protected write by a tool in tools.mutating exits 2 with a blocked self-mod row under --enforce block', () => {
    // The roster must reach the built bin's assembly: a bin that keeps the staged names as
    // its mutating roster leaves the host's write unrouted and exits 0.
    const withTools = { ...sessionWriteIr(PROTECTED_ENTRY, 'sensitive'), tools: SESSION_TOOLS };

    const result = spawnCheck(JSON.stringify(withTools), '--enforce', 'block');

    expect(result.status).toBe(2);
    expect(telemetryRows(logPath)).toEqual([['blocked', SELF_MOD_LABEL, PROTECTED_ENTRY]]);
  });

  it('the same IR without tools exits 0 with one passed row — the host tool is unrouted', () => {
    // The default roster is the staged names; a bin that hard-codes a host roster blocks
    // here, and one that fails closed on an unknown tool name exits 2.
    const result = spawnCheck(
      JSON.stringify(sessionWriteIr(PROTECTED_ENTRY, 'sensitive')),
      '--enforce',
      'block',
    );

    expect(result.status).toBe(0);
    expect(telemetryRows(logPath)).toEqual([['passed', expect.any(String), expect.any(String)]]);
  });

  it('a fresh token utterance in session.userMessages witnesses the block — exit 0, witnessed row', () => {
    // The valve through stdin: the timestamp is the IR's, so a bin that drops it or reads
    // the top-level `userMessages` instead exits 2 here.
    writeConfigAt(projectRoot, logPath, {
      protectedPaths: [PROTECTED_ENTRY],
      witness: { token: SESSION_WITNESS_TOKEN, ttlMinutes: SESSION_TTL_MINUTES },
    });
    const witnessed = {
      ...sessionWriteIr(PROTECTED_ENTRY, 'sensitive'),
      tools: SESSION_TOOLS,
      session: {
        userMessages: [
          { text: `${SESSION_WITNESS_TOKEN}\nproceed`, timestampMs: Date.now() - 1_000 },
        ],
        toolCalls: [],
      },
    };

    const result = spawnCheck(JSON.stringify(witnessed), '--enforce', 'block');

    expect(result.status).toBe(0);
    // A session input compares the protected entries against the stored baseline around
    // the judgment, so the first run in a fresh project records the absent baseline first.
    expect(telemetryRows(logPath)).toEqual([
      BASELINE_FIRST_RUN_ROW,
      ['witnessed', SELF_MOD_LABEL, PROTECTED_ENTRY],
    ]);
  });

  it('a session whose toolCalls is an object exits 3 with one blocked covenant-check row', () => {
    // A session the bin cannot read is a block before judgment, never a default: a bin
    // folding the object into `[]` would judge and exit 0 on the ordinary write, and one
    // landing the refusal at 2 reports a verdict the judge never reached.
    const malformed = {
      ...sessionWriteIr(ORDINARY_FILE, ORDINARY_TEXT),
      tools: SESSION_TOOLS,
      session: { userMessages: [], toolCalls: {} },
    };

    const result = spawnCheck(JSON.stringify(malformed), '--enforce', 'block');

    expect(result.status).toBe(EXIT_INPUT_UNREAD);
    expect(result.stderr).toMatch(/^covenant check failed closed: \S.*\n$/);
    expect(telemetryRows(logPath)).toEqual([['blocked', FAIL_CLOSED_LABEL, '-']]);
  });

  it('a tools roster whose mutating list is a string exits 3 with one blocked covenant-check row', () => {
    // The roster is read by the runner, after the shared parser accepted the IR; a string
    // in place of the list is the same input-stage refusal, and a bin that wraps it into a
    // one-name roster would judge the protected write and block it at 2 as self-mod.
    const malformed = {
      ...sessionWriteIr(PROTECTED_ENTRY, 'sensitive'),
      tools: { ...SESSION_TOOLS, mutating: SESSION_WRITE_TOOL },
    };

    const result = spawnCheck(JSON.stringify(malformed), '--enforce', 'block');

    expect(result.status).toBe(EXIT_INPUT_UNREAD);
    expect(result.stderr).toMatch(/^covenant check failed closed: \S.*\n$/);
    expect(telemetryRows(logPath)).toEqual([['blocked', FAIL_CLOSED_LABEL, '-']]);
  });
});
