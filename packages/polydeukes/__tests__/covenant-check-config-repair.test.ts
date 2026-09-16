import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CovenantInput, TelemetryRecord } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findUnattributed } from '../src/baseline.ts';
// The config-repair exception of `runCovenantCheck`: while the one discovered config file
// does not load, the session surface lets through exactly one shape — a single tool call
// whose file-change evidence modifies that file, starting from the bytes on disk, and whose
// `post` is a text the loader accepts. That call exits 0 with one `advised` row under the runner's own
// label, subject = the config path. Every other config-load failure stays fail-closed
// (exit 2, one `blocked` row, subject `-`), and on the session surface the fail-closed
// line names the repair path.
import { runCovenantCheck } from '../src/covenant-check.ts';
import { explain } from '../src/explain.ts';
import { telemetryRows, writeConfigAt } from './helpers.ts';

/** Injected fixture values. */
const CONFIG_FILE = 'polydeukes.config.json';
const SECOND_CONFIG_FILE = 'polydeukes.config.yaml';
const OTHER_FILE = 'other.txt';
const EDIT_TOOL = 'Edit';
const WRITE_TOOL = 'Write';
const SHELL_TOOL = 'Bash';
/** The umbrella's protected-paths registration label — an observable contract, not a fixture choice. */
const SELF_MOD_LABEL = 'self-mod';
/** The runner's own label — the row a config-load outcome lands under. */
const CHECK_LABEL = 'covenant-check';
/** The subject a run that failed closed before judging writes. */
const NO_SUBJECT = '-';
/** The loader's message for the validation fixture below (a `union` over three names). */
const VALIDATION_MESSAGE = "takes 'of' as two extract names";
/** The loader's message fragments for zero and for two config files. */
const NO_CONFIG_MESSAGE = 'no Polydeukes config found';
const AMBIGUOUS_CONFIG_MESSAGE = 'ambiguous Polydeukes config';
/** The stderr fragments the contract fixes. */
const ADVISED_MESSAGE = 'advised, not judged';
const REPAIR_SENTENCE = `fix ${CONFIG_FILE} in one Edit or Write`;
/** A config text no parser accepts. */
const TRUNCATED_JSON = '{ "languages": ';

let repoRoot: string;
/** Telemetry lives outside the observed directory. */
let outside: string;
let telemetryPath: string;
let stderrWrites: string[];

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'pdks-config-repair-'));
  outside = mkdtempSync(join(tmpdir(), 'pdks-config-repair-outside-'));
  telemetryPath = join(outside, 'roi.log');
  stderrWrites = [];
  vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
    stderrWrites.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function stderrText(): string {
  return stderrWrites.join('');
}

/** The object `writeConfigAt` writes, as text — the `post` a repair leaves on disk. */
function validConfigText(): string {
  return JSON.stringify({
    languages: { typescript: { productionGlob: 'lib/**/*.ts', testCmd: 'echo {scope}' } },
    telemetry: { logPath: telemetryPath },
  });
}

/** A config that parses but fails `defineConfig`: `union` given three extract names. */
function writeValidationFailure(): void {
  writeConfigAt(repoRoot, telemetryPath, {
    sessionDisciplines: [
      {
        id: 'bad',
        why: 'x',
        declare: {
          mechanism: 'precedent',
          sources: { session: { transcript: true } },
          extract: { a: [{ op: 'union', of: ['a', 'b', 'c'] }] },
          relate: [{ id: 'r', relation: { op: 'nonEmpty', of: 'a' }, message: 'm' }],
        },
      },
    ],
  });
}

/** A config that does not parse at all. */
function writeParseFailure(): void {
  writeFileSync(join(repoRoot, CONFIG_FILE), TRUNCATED_JSON);
}

function ir(toolCalls: CovenantInput['toolCalls']): CovenantInput {
  return { toolCalls, subagentSpawns: [], userMessages: [] };
}

/**
 * The config file's text on disk, or the empty string where no config was written — the
 * fixtures with no config on disk are blocked before any evidence is read.
 */
function onDiskConfigText(): string {
  return existsSync(join(repoRoot, CONFIG_FILE))
    ? readFileSync(join(repoRoot, CONFIG_FILE), 'utf-8')
    : '';
}

/**
 * One Edit whose evidence rewrites `path` from the config file's on-disk text into `post` —
 * a repair starts from the bytes the loader read.
 */
function editCall(path: string, post: string): CovenantInput['toolCalls'][number] {
  return {
    name: EDIT_TOOL,
    args: { file_path: path },
    fileChange: {
      kind: 'modify',
      path,
      pre: onDiskConfigText(),
      post,
    },
  };
}

function repairCall(): CovenantInput['toolCalls'][number] {
  return editCall(CONFIG_FILE, validConfigText());
}

async function runSession(toolCalls: CovenantInput['toolCalls']) {
  return runCovenantCheck({ surface: 'session', repoRoot, telemetryPath, input: ir(toolCalls) });
}

describe('config repair — the one call that passes while the config does not load', () => {
  it('a validation failure on disk plus one Edit whose post loads exits 0 with an advised row naming the config path', async () => {
    // The feature itself: a runner that still fails closed on every loader throw exits 2
    // here; one that lets the repair through without a row, or under `passed`, or with
    // subject `-`, leaves the next call's baseline comparison to flag the same change.
    writeValidationFailure();

    const result = await runSession([repairCall()]);

    expect(result.exitCode).toBe(0);
    expect(telemetryRows(telemetryPath)).toEqual([['advised', CHECK_LABEL, CONFIG_FILE]]);
    expect(stderrText()).toContain(VALIDATION_MESSAGE);
    expect(stderrText()).toContain(ADVISED_MESSAGE);
  });

  it('a parse failure on disk plus one Edit whose post loads exits 0 with an advised row', async () => {
    // The other failure kind the exception covers. A branch keyed on ConfigValidationError
    // alone leaves the most common lockout (a typo that breaks parsing) fail-closed.
    writeParseFailure();

    const result = await runSession([repairCall()]);

    expect(result.exitCode).toBe(0);
    expect(telemetryRows(telemetryPath)).toEqual([['advised', CHECK_LABEL, CONFIG_FILE]]);
    expect(stderrText()).toContain(ADVISED_MESSAGE);
  });

  it('a repair whose post still does not load stays blocked and the line names the repair path', async () => {
    // Condition four: dropping the check on `post` turns the exception into "any edit of
    // the config passes", which is one more unjudgeable call let through.
    writeValidationFailure();

    const result = await runSession([editCall(CONFIG_FILE, TRUNCATED_JSON)]);

    expect(result.exitCode).toBe(2);
    expect(telemetryRows(telemetryPath)).toEqual([['blocked', CHECK_LABEL, NO_SUBJECT]]);
    expect(stderrText()).toContain(REPAIR_SENTENCE);
  });

  it('a valid config text written to another path stays blocked', async () => {
    // Condition three, the path half: matching on the post's validity alone lets any file
    // be written while the config is broken, as long as its content happens to load.
    writeValidationFailure();

    const result = await runSession([editCall(OTHER_FILE, validConfigText())]);

    expect(result.exitCode).toBe(2);
    expect(telemetryRows(telemetryPath)).toEqual([['blocked', CHECK_LABEL, NO_SUBJECT]]);
    expect(stderrText()).toContain(REPAIR_SENTENCE);
  });

  it('the repair call accompanied by a second call stays blocked', async () => {
    // Condition three, the count half: a runner that looks for the repair among the calls
    // (`some`) instead of requiring it to be the only one lets the second call ride along
    // unjudged.
    writeValidationFailure();

    const result = await runSession([repairCall(), editCall(OTHER_FILE, 'text\n')]);

    expect(result.exitCode).toBe(2);
    expect(telemetryRows(telemetryPath)).toEqual([['blocked', CHECK_LABEL, NO_SUBJECT]]);
  });

  it('a shell call carrying no file-change evidence stays blocked under an invalid config', async () => {
    // `git status` under a broken config is still exit 2. A runner that treats "no evidence" as "nothing to compare, let it pass"
    // fails open here.
    writeValidationFailure();

    const result = await runSession([{ name: SHELL_TOOL, args: { command: 'git status' } }]);

    expect(result.exitCode).toBe(2);
    expect(telemetryRows(telemetryPath)).toEqual([['blocked', CHECK_LABEL, NO_SUBJECT]]);
  });

  it('no config file at all stays blocked with the loader message and no repair sentence', async () => {
    // Condition two, the zero end: there is no "that file" to repair, so a runner that
    // accepts a Write creating the config would be inventing one. The stderr line also
    // must not promise a repair path that does not exist.
    const result = await runSession([repairCall()]);

    expect(result.exitCode).toBe(2);
    expect(telemetryRows(telemetryPath)).toEqual([['blocked', CHECK_LABEL, NO_SUBJECT]]);
    expect(stderrText()).toContain(NO_CONFIG_MESSAGE);
    expect(stderrText()).not.toContain(`fix ${CONFIG_FILE}`);
  });

  it('two config files stay blocked with the ambiguity message', async () => {
    // Condition two, the two-plus end: a discovery that picks the first candidate and
    // then offers a repair of it would let the collision be edited around instead of
    // resolved by deleting one file.
    writeConfigAt(repoRoot, telemetryPath, {});
    writeFileSync(join(repoRoot, SECOND_CONFIG_FILE), 'languages: {}\n');

    const result = await runSession([repairCall()]);

    expect(result.exitCode).toBe(2);
    expect(telemetryRows(telemetryPath)).toEqual([['blocked', CHECK_LABEL, NO_SUBJECT]]);
    expect(stderrText()).toContain(AMBIGUOUS_CONFIG_MESSAGE);
  });

  it('the change-set surface offers no repair — the same single call stays blocked', async () => {
    // Condition one: on that surface `post` is a hunk, so the result cannot be checked.
    // A runner that forgets the surface test opens the repair path on a diff.
    writeValidationFailure();

    const result = await runCovenantCheck({
      surface: 'changeSet',
      repoRoot,
      telemetryPath,
      input: ir([repairCall()]),
    });

    expect(result.exitCode).toBe(2);
    expect(telemetryRows(telemetryPath)).toEqual([['blocked', CHECK_LABEL, NO_SUBJECT]]);
  });

  it('a valid config on disk plus one Edit targeting the config file is judged by the assembled registrations, not by the repair path', async () => {
    // The exception is keyed on the LOAD FAILURE, not on the target path: a runner that
    // routes every edit of the config file through the repair branch turns the loader's
    // self-protection of its own file into an advised pass whenever the edit happens to
    // load. With a valid config the self-mod meta-covenant judges — the IR carries the
    // host's tool roster so the Edit routes to it — and under the session bin's
    // `enforce: block` it blocks.
    writeConfigAt(repoRoot, telemetryPath, { protectedPaths: [] });

    const result = await runCovenantCheck({
      surface: 'session',
      repoRoot,
      telemetryPath,
      input: {
        ...ir([repairCall()]),
        tools: { mutating: [EDIT_TOOL, WRITE_TOOL], shell: [SHELL_TOOL], commandArgs: ['command'] },
      },
      enforce: 'block',
    });

    expect(result.exitCode).toBe(2);
    const rows = telemetryRows(telemetryPath);
    expect(rows).toContainEqual(['blocked', SELF_MOD_LABEL, CONFIG_FILE]);
    expect(rows.filter(([event]) => event === 'advised')).toEqual([]);
    expect(rows.filter(([, label]) => label === CHECK_LABEL)).toEqual([]);
  });

  it.each([
    ['a ./-prefixed path repairs', (): string => `./${CONFIG_FILE}`, 0],
    ['an absolute path repairs', (): string => join(repoRoot, CONFIG_FILE), 0],
    ['a path under a subdirectory stays blocked', (): string => `sub/${CONFIG_FILE}`, 2],
  ] as const)(
    'the evidence path is relativized before comparing — %s',
    async (_name, path, exit) => {
      // The host passes the absolute `file_path` it observed, while the loader names the file
      // relative to the root, so the evidence path is relativized before the comparison. A
      // spelling that relativizes to a different file is not the config.
      writeValidationFailure();

      const result = await runSession([editCall(path(), validConfigText())]);

      expect(result.exitCode).toBe(exit);
      expect(telemetryRows(telemetryPath)).toEqual(
        exit === 0
          ? [['advised', CHECK_LABEL, CONFIG_FILE]]
          : [['blocked', CHECK_LABEL, NO_SUBJECT]],
      );
      if (exit === 2) expect(stderrText()).toContain(REPAIR_SENTENCE);
    },
  );

  it('a create evidence on the discovered config file stays blocked', async () => {
    // Discovery found the file, so evidence claiming it did not exist describes some other
    // state than the one the loader just read.
    writeValidationFailure();

    const result = await runSession([
      {
        name: WRITE_TOOL,
        args: { file_path: CONFIG_FILE },
        fileChange: { kind: 'create', path: CONFIG_FILE, post: validConfigText() },
      },
    ]);

    expect(result.exitCode).toBe(2);
    expect(telemetryRows(telemetryPath)).toEqual([['blocked', CHECK_LABEL, NO_SUBJECT]]);
    expect(stderrText()).toContain(REPAIR_SENTENCE);
  });

  it('an edit whose pre is not the on-disk text stays blocked', async () => {
    // The repair is checked as a whole file: evidence that starts from other bytes leaves a
    // result nobody verified, whether it was composed by the caller or is one cell of a
    // notebook rather than the file.
    writeValidationFailure();

    const result = await runSession([
      {
        name: EDIT_TOOL,
        args: { file_path: CONFIG_FILE },
        fileChange: {
          kind: 'modify',
          path: CONFIG_FILE,
          pre: 'other text\n',
          post: validConfigText(),
        },
      },
    ]);

    expect(result.exitCode).toBe(2);
    expect(telemetryRows(telemetryPath)).toEqual([['blocked', CHECK_LABEL, NO_SUBJECT]]);
    expect(stderrText()).toContain(REPAIR_SENTENCE);
  });

  it('the repair passes under enforce block, the posture the session hook spawns with', async () => {
    // The session hook always asks for `block`, so a repair that read the posture would
    // never run in a real session.
    writeValidationFailure();

    const result = await runCovenantCheck({
      surface: 'session',
      repoRoot,
      telemetryPath,
      input: ir([repairCall()]),
      enforce: 'block',
    });

    expect(result.exitCode).toBe(0);
    expect(telemetryRows(telemetryPath)).toEqual([['advised', CHECK_LABEL, CONFIG_FILE]]);
  });

  it('the advised row lands at the repaired config’s own log path', async () => {
    // The next call's baseline comparison reads the path the loaded config names, so a row
    // written to the provisional default is a row that comparison never sees.
    writeValidationFailure();
    const previousEnv = process.env.POLYDEUKES_TELEMETRY_PATH;
    delete process.env.POLYDEUKES_TELEMETRY_PATH;

    try {
      const post = JSON.stringify({
        languages: { typescript: { productionGlob: 'lib/**/*.ts', testCmd: 'echo {scope}' } },
        telemetry: { logPath: 'logs/pdks.log' },
      });

      const result = await runCovenantCheck({
        surface: 'session',
        repoRoot,
        input: ir([editCall(CONFIG_FILE, post)]),
      });

      expect(result.exitCode).toBe(0);
      expect(telemetryRows(join(repoRoot, 'logs/pdks.log'))).toEqual([
        ['advised', CHECK_LABEL, CONFIG_FILE],
      ]);
      expect(telemetryRows(join(repoRoot, '.polydeukes/roi.log'))).toEqual([]);
    } finally {
      if (previousEnv === undefined) delete process.env.POLYDEUKES_TELEMETRY_PATH;
      else process.env.POLYDEUKES_TELEMETRY_PATH = previousEnv;
    }
  });

  it('a null tool call under an invalid config fails closed rather than throwing', async () => {
    // A throw here escapes the runner and leaves no row at all, which is the one outcome
    // fail-closed does not have.
    writeValidationFailure();

    const result = await runSession([null as never]);

    expect(result.exitCode).toBe(2);
    expect(telemetryRows(telemetryPath)).toEqual([['blocked', CHECK_LABEL, NO_SUBJECT]]);
  });

  it('an empty toolCalls list under an invalid config still fails closed', async () => {
    // The degenerate form of condition three: a runner written as "no call other than the
    // repair" (`every`) is vacuously satisfied by zero calls and exits 0 with nothing judged.
    writeValidationFailure();

    const result = await runSession([]);

    expect(result.exitCode).toBe(2);
    expect(telemetryRows(telemetryPath)).toEqual([['blocked', CHECK_LABEL, NO_SUBJECT]]);
  });

  it('explain keeps failing closed on an invalid config', async () => {
    // `explain` renders the assembly and there is none to render; the loader split must
    // not hand it a discovered path to describe in place of the throw.
    writeValidationFailure();

    await expect(explain({ repoRoot })).rejects.toThrow(VALIDATION_MESSAGE);
  });
});

describe('baseline attribution — the repair row explains the config hash change', () => {
  const TIMESTAMP = '2026-09-16T12:00:00.000Z';

  function repairRow(event: TelemetryRecord['event']): TelemetryRecord {
    return { timestamp: TIMESTAMP, event, label: CHECK_LABEL, subject: CONFIG_FILE };
  }

  it('an advised covenant-check row with the config path as subject attributes the change', () => {
    // The reason the row is `advised` rather than `skipped`: a comparator matching on the
    // self-mod label instead of the subject alone would flag the repaired config as
    // unattributed on the very next call.
    const result = findUnattributed({
      previous: { [CONFIG_FILE]: 'h1' },
      current: { [CONFIG_FILE]: 'h2' },
      records: [repairRow('advised')],
    });

    expect(result).toEqual([]);
  });
});
