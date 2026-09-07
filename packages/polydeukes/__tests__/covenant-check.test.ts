import { join } from 'node:path';
import { readRecords } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// The assembled `pdks covenant check` runner, tested as a library function.
//
//   runCovenantCheck({ repoRoot, input, telemetryPath? }): Promise<{ exitCode }>
//
// Each test builds a real throwaway git repo and writes its own tmp config, so no
// protected path of THIS repository is ever referenced. The staged diff is translated to
// the IR the runner judges, which is what a caller pipes in through `--diff`.
import { runCovenantCheck } from '../src/covenant-check.ts';
import { covenantInputFromUnifiedDiff } from '../src/diff-ir.ts';
import { type CheckRepo, createCheckRepo, telemetryRows } from './helpers.ts';

/** The label a run that failed closed before judging writes its one blocked row under. */
const FAIL_CLOSED_LABEL = 'covenant-check';

let repo: CheckRepo;
let repoRoot: string;
let telemetryPath: string;
let git: CheckRepo['git'];

/** The staged diff of the fixture repository, translated to the IR the runner judges. */
function stagedInput() {
  return covenantInputFromUnifiedDiff({ text: git('diff', '--cached') });
}

let write: CheckRepo['write'];
let writeConfig: CheckRepo['writeConfig'];

beforeEach(() => {
  repo = createCheckRepo('pdks-check-');
  ({ repoRoot, telemetryPath, git, write, writeConfig } = repo);
});

afterEach(() => {
  repo.cleanup();
});

describe('same-judge blocking on a protected path', () => {
  it('blocks (exit 2) under enforce: block when a staged change touches a protectedPaths file', async () => {
    // A commit mutating a declared protected path fails closed at commit time when the
    // caller opted into block, exactly as the session hook blocks the same edit.
    writeConfig({ protectedPaths: ['secret.txt'] });
    write('secret.txt', 'sensitive\n');
    git('add', 'secret.txt', 'polydeukes.config.json');

    const result = await runCovenantCheck({
      repoRoot,
      telemetryPath,
      input: stagedInput(),
      enforce: 'block',
    });

    expect(result.exitCode).toBe(2);
  });

  it('passes (exit 0) when the staged change is unrelated to any protected path', async () => {
    // The over-blocking side: an unrelated file must not be blocked. The config file is
    // committed FIRST and not staged, because loadConfig attaches the discovered config
    // file to its own protection surface — staging it alongside would be a protected
    // write and block by design.
    writeConfig({ protectedPaths: ['secret.txt'] });
    git('add', 'polydeukes.config.json');
    git('commit', '--quiet', '-m', 'config');
    write('ordinary.txt', 'nothing special\n');
    git('add', 'ordinary.txt');

    const result = await runCovenantCheck({ repoRoot, telemetryPath, input: stagedInput() });

    expect(result.exitCode).toBe(0);
  });
});

describe('discipline delta family — new violation vs pre-existing debt', () => {
  // `enforce: block` is explicit because an absent level is advise, and this block
  // exercises the judgment itself rather than the default.
  const disciplines = [
    {
      id: 'no-todo',
      declare: {
        mechanism: 'added-only',
        scope: { source: 'target.path', include: ['^lib/.*\\.ts$'] },
        supply: { pre: 'empty', post: 'empty' },
        extract: {
          before: [
            { op: 'source', of: 'pre' },
            { op: 'lines' },
            { op: 'keyByPattern', re: '(TODO)' },
          ],
          after: [
            { op: 'source', of: 'post' },
            { op: 'lines' },
            { op: 'keyByPattern', re: '(TODO)' },
          ],
          added: [{ op: 'onlyIn', of: 'after', notIn: 'before' }],
        },
        relate: [
          { id: 'nothing-added', relation: { op: 'empty', of: 'added' }, message: 'adds {key}' },
        ],
      },
      enforce: 'block',
    },
  ];

  it('blocks under enforce: block when the staged delta ADDS a forbidden match', async () => {
    // The delta family judges only what this commit adds, so a newly introduced match
    // blocks when the caller opted into block.
    writeConfig({ disciplines });
    write('lib/a.ts', 'export const x = 1;\n');
    git('add', 'lib/a.ts', 'polydeukes.config.json');
    git('commit', '--quiet', '-m', 'initial');
    write('lib/a.ts', 'export const x = 1;\n// TODO fix later\n');
    git('add', 'lib/a.ts');

    const result = await runCovenantCheck({
      repoRoot,
      telemetryPath,
      input: stagedInput(),
      enforce: 'block',
    });

    expect(result.exitCode).toBe(2);
  });

  it('passes when a file carries only pre-existing debt and the staged change adds none', async () => {
    // The forgiveness half: a match that already existed in HEAD is forgiven, so a change
    // touching that file without adding a new one passes. A judge reading the absolute
    // post count would block on pre-existing debt and make the discipline unadoptable on
    // a legacy codebase.
    writeConfig({ disciplines });
    write('lib/b.ts', '// TODO ancient debt\nexport const y = 1;\n');
    git('add', 'lib/b.ts', 'polydeukes.config.json');
    git('commit', '--quiet', '-m', 'initial');
    write('lib/b.ts', '// TODO ancient debt\nexport const y = 2;\n');
    git('add', 'lib/b.ts');

    const result = await runCovenantCheck({ repoRoot, telemetryPath, input: stagedInput() });

    expect(result.exitCode).toBe(0);
  });
});

describe('telemetry — every judged call is recorded', () => {
  it('appends one record per judged call across a multi-file staged batch', async () => {
    // N judged calls leave N records, never one aggregate row.
    writeConfig({ protectedPaths: ['secret.txt', 'guarded.txt'] });
    write('secret.txt', 'a\n');
    write('guarded.txt', 'b\n');
    git('add', 'secret.txt', 'guarded.txt', 'polydeukes.config.json');

    await runCovenantCheck({ repoRoot, telemetryPath, input: stagedInput() });

    const { records } = readRecords(telemetryPath);
    expect(records.length).toBeGreaterThanOrEqual(2);
  });
});

describe('fail-closed and empty-staging boundaries', () => {
  it('blocks (exit 2) when no config file exists in the repo root', async () => {
    // loadConfig throws on a missing config, and the runner translates that into exit 2
    // rather than passing vacuously.
    write('anything.txt', 'x\n');
    git('add', 'anything.txt');

    const result = await runCovenantCheck({ repoRoot, telemetryPath, input: stagedInput() });

    expect(result.exitCode).toBe(2);
  });

  it('passes (exit 0) when the staging area is empty', async () => {
    // Zero staged changes is an explicit pass — nothing to judge — not a fail-closed 2.
    writeConfig({ protectedPaths: ['secret.txt'] });
    // Nothing staged (config file left unstaged in the worktree).

    const result = await runCovenantCheck({ repoRoot, telemetryPath, input: stagedInput() });

    expect(result.exitCode).toBe(0);
  });
});

// The commit surface reads the common protectedPaths list. Every blocked case below
// pins the self-mod row — label plus matched-entry subject — rather than the exit code
// alone: an assembly that fails closed lands at the SAME exit 2, and an exit-code-only
// assertion would go green for
// that wrong reason.

describe('telemetry path precedence — spec, then config, then default', () => {
  /** Rows at the DEFAULT path — where the run must write when nobody names a path. */
  function defaultRows(): [string, string, string][] {
    return telemetryRows(join(repoRoot, '.polydeukes', 'roi.log'));
  }

  it('records ONE blocked row at the default path when config validation fails and nothing is injected', async () => {
    // A config failure with no injected path must still leave its record. Two independent
    // ways it can vanish: the path settled only AFTER loadConfig, so the failure branch
    // records against an undefined and returns silently; or the row written through the
    // mkdir-free append, which cannot create <repoRoot>/.polydeukes and fails open on
    // ENOENT. Either leaves a fail-closed exit 2 with no row at all — a defect, not a
    // declared limit, which would leave a skipped row. This tmp root has no .polydeukes
    // directory, the same shape `pdks init` leaves a consumer in.
    write('polydeukes.config.json', JSON.stringify({ languages: 'not-an-object' }));

    await expect(
      runCovenantCheck({ repoRoot, input: stagedInput(), enforce: 'block' }),
    ).resolves.toEqual({
      exitCode: 2,
    });

    expect(defaultRows()).toEqual([['blocked', FAIL_CLOSED_LABEL, '-']]);
  });

  it('writes judgment rows to the path the CONFIG names once the load succeeds (no injection)', async () => {
    // The post-load term: after a successful load, telemetry.logPath REPLACES the
    // provisional default. Keeping the provisional value would break every consumer's
    // configured log path while all the injecting cases above stayed green.
    writeConfig({ protectedPaths: ['secret.txt'] });
    git('add', 'polydeukes.config.json');
    git('commit', '--quiet', '-m', 'config');
    write('secret.txt', 'sensitive\n');
    git('add', 'secret.txt');

    await expect(
      runCovenantCheck({ repoRoot, input: stagedInput(), enforce: 'block' }),
    ).resolves.toEqual({
      exitCode: 2,
    });

    expect(telemetryRows(telemetryPath)).toContainEqual(['blocked', 'self-mod', 'secret.txt']);
    expect(defaultRows()).toEqual([]);
  });

  it('writes the config-failure row to the INJECTED path, never the default, when both exist', async () => {
    // The spec term inside the failure branch: spec.telemetryPath wins over the
    // provisional default, or every injected suite's fail-closed rows scatter into
    // <repoRoot>/.polydeukes/roi.log.
    write('polydeukes.config.json', JSON.stringify({ languages: 'not-an-object' }));

    await expect(
      runCovenantCheck({ repoRoot, telemetryPath, input: stagedInput() }),
    ).resolves.toEqual({ exitCode: 2 });

    expect(telemetryRows(telemetryPath)).toEqual([['blocked', FAIL_CLOSED_LABEL, '-']]);
    expect(defaultRows()).toEqual([]);
  });

  it('resolves the loader-filled default when the config omits the telemetry block', async () => {
    // The shape `pdks init` actually generates: its scaffolded config carries no telemetry
    // block, while this suite's helper always fills one. What this covers is the
    // COMPOSITION of two defaults — the loader fills the default log path and the runner
    // resolves it against repoRoot — and the run must land its rows where that points.
    //
    // It kills no mutant of the runner's own precedence: deleting the post-load
    // recomputation leaves this case green (its sibling above catches it) because both
    // terms compute the same string. Discrimination returns only if either default is
    // ever respelled to differ.
    write(
      'polydeukes.config.json',
      JSON.stringify({
        languages: { typescript: { productionGlob: 'src/**', testCmd: 'echo {scope}' } },
        protectedPaths: ['secret.txt'],
      }),
    );
    git('add', 'polydeukes.config.json');
    git('commit', '--quiet', '-m', 'config');
    write('secret.txt', 'sensitive\n');
    git('add', 'secret.txt');

    await expect(
      runCovenantCheck({ repoRoot, input: stagedInput(), enforce: 'block' }),
    ).resolves.toEqual({
      exitCode: 2,
    });

    expect(defaultRows()).toContainEqual(['blocked', 'self-mod', 'secret.txt']);
  });

  it('writes judgment rows to the INJECTED path even when the config names another', async () => {
    // The spec term on the happy path. Every other case injects a telemetryPath EQUAL to
    // the config's logPath, so the two values coincide everywhere but here — only this
    // case can see the post-load update letting the config overwrite the injection.
    const injectedPath = join(repoRoot, 'injected.log');
    writeConfig({ protectedPaths: ['secret.txt'] });
    git('add', 'polydeukes.config.json');
    git('commit', '--quiet', '-m', 'config');
    write('secret.txt', 'sensitive\n');
    git('add', 'secret.txt');

    await expect(
      runCovenantCheck({
        repoRoot,
        telemetryPath: injectedPath,
        input: stagedInput(),
        enforce: 'block',
      }),
    ).resolves.toEqual({
      exitCode: 2,
    });

    expect(telemetryRows(injectedPath)).toContainEqual(['blocked', 'self-mod', 'secret.txt']);
    expect(telemetryRows(telemetryPath)).toEqual([]);
  });
});
