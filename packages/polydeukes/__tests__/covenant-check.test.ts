import { join } from 'node:path';
import { readRecords } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// The assembled `pdks covenant check` runner, tested as a library function.
//
//   runCovenantCheck({ repoRoot, telemetryPath?, ttyPrompt? }): Promise<{ exitCode }>
//     - ttyPrompt is the injected TTY-valve seam: a function returning the line a human
//       typed (the full witness token), or null/undefined for no input.
//     - ABSENCE of ttyPrompt models a non-TTY environment (CI, AI-spawned git), where
//       the valve must never open.
//
// Each test builds a real throwaway git repo and writes its own tmp config, so no
// protected path of THIS repository is ever referenced.
import { runCovenantCheck } from '../src/covenant-check.ts';
import { type CheckRepo, createCheckRepo, telemetryRows } from './helpers.ts';

const WITNESS_TOKEN = 'i-accept-this-commit-covenant';

let repo: CheckRepo;
let repoRoot: string;
let telemetryPath: string;
let git: CheckRepo['git'];
let write: CheckRepo['write'];
let writeConfig: CheckRepo['writeConfig'];

beforeEach(() => {
  repo = createCheckRepo('pdks-check-');
  ({ repoRoot, telemetryPath, git, write, writeConfig } = repo);
});

afterEach(() => {
  repo.cleanup();
});

/** Rows written by the protected-paths meta-covenant (never by the fail-closed handler). */
function selfModRows(): [string, string][] {
  return readRecords(telemetryPath)
    .records.filter((record) => record.label === 'self-mod')
    .map((record) => [record.event, record.subject]);
}

describe('same-judge blocking on a protected path', () => {
  it('blocks (exit 2) when a staged change touches a protectedPaths file', async () => {
    // A commit mutating a declared protected path fails closed at commit time, exactly as
    // the session hook blocks the same edit.
    writeConfig({ protectedPaths: ['secret.txt'] });
    write('secret.txt', 'sensitive\n');
    git('add', 'secret.txt', 'polydeukes.config.json');

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

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

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(0);
  });
});

describe('discipline delta family — new violation vs pre-existing debt', () => {
  // `enforce: block` is explicit because an absent level is advise, and this block
  // exercises the judgment itself rather than the default.
  const disciplines = [
    { id: 'no-todo', forbid: { added: 'TODO' }, in: 'lib/**/*.ts', enforce: 'block' },
  ];

  it('blocks when the staged delta ADDS a forbidden match', async () => {
    // The delta family judges only what this commit adds, so a newly introduced match
    // blocks.
    writeConfig({ disciplines });
    write('lib/a.ts', 'export const x = 1;\n');
    git('add', 'lib/a.ts', 'polydeukes.config.json');
    git('commit', '--quiet', '-m', 'initial');
    write('lib/a.ts', 'export const x = 1;\n// TODO fix later\n');
    git('add', 'lib/a.ts');

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

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

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(0);
  });
});

describe('TTY witness valve — human-only arming', () => {
  function stageProtectedChange(): void {
    writeConfig({
      protectedPaths: ['secret.txt'],
      witness: { token: WITNESS_TOKEN, ttlMinutes: 5 },
    });
    write('secret.txt', 'sensitive\n');
    git('add', 'secret.txt', 'polydeukes.config.json');
  }

  it('passes (exit 0) and records witnessed when the TTY seam returns the exact token', async () => {
    // A full-match token opens the valve for this one commit AND is measured as
    // witnessed — never folded into passed or blocked.
    stageProtectedChange();

    const result = await runCovenantCheck({
      repoRoot,
      telemetryPath,
      ttyPrompt: () => WITNESS_TOKEN,
    });

    expect(result.exitCode).toBe(0);
    const { records } = readRecords(telemetryPath);
    expect(records.some((record) => record.event === 'witnessed')).toBe(true);
  });

  it('blocks (exit 2) when the TTY seam returns a partial token (substring, not full match)', async () => {
    // The comparison is full equality, never includes() or startsWith(): a prefix of the
    // token must not open the valve, or a typo or mid-sentence mention would.
    stageProtectedChange();

    const result = await runCovenantCheck({
      repoRoot,
      telemetryPath,
      ttyPrompt: () => WITNESS_TOKEN.slice(0, WITNESS_TOKEN.length - 1),
    });

    expect(result.exitCode).toBe(2);
    const { records } = readRecords(telemetryPath);
    expect(records.some((record) => record.event === 'witnessed')).toBe(false);
  });

  it('blocks (exit 2) when the TTY seam returns a wrong token', async () => {
    stageProtectedChange();

    const result = await runCovenantCheck({
      repoRoot,
      telemetryPath,
      ttyPrompt: () => 'totally-wrong-phrase',
    });

    expect(result.exitCode).toBe(2);
  });

  it('blocks (exit 2) with NO prompt attempt when no TTY seam is injected (non-interactive)', async () => {
    // Human-only arming: an absent TTY blocks. A session-spawned AI git commit has no
    // TTY, so the valve is structurally unreachable and the AI can never open it for
    // itself. An env-var or default-answer fallback would make it forgeable.
    stageProtectedChange();

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(2);
    const { records } = readRecords(telemetryPath);
    expect(records.some((record) => record.event === 'witnessed')).toBe(false);
  });
});

describe('telemetry — every judged call is recorded', () => {
  it('appends one record per judged call across a multi-file staged batch', async () => {
    // N judged calls leave N records, never one aggregate row.
    writeConfig({ protectedPaths: ['secret.txt', 'guarded.txt'] });
    write('secret.txt', 'a\n');
    write('guarded.txt', 'b\n');
    git('add', 'secret.txt', 'guarded.txt', 'polydeukes.config.json');

    await runCovenantCheck({ repoRoot, telemetryPath });

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

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(2);
  });

  it('passes (exit 0) when the staging area is empty', async () => {
    // Zero staged changes is an explicit pass — nothing to judge — not a fail-closed 2.
    writeConfig({ protectedPaths: ['secret.txt'] });
    // Nothing staged (config file left unstaged in the worktree).

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(0);
  });
});

// The commit surface consumes the UNION of the common protectedPaths and the
// adapters.git additive list. Every blocked case below pins the self-mod row — label
// plus matched-entry subject, so an additive-only entry as subject proves additive
// origin — rather than the exit code alone: a validator that rejects the additive key
// fails closed at the SAME exit 2, and an exit-code-only assertion would go green for
// that wrong reason.

describe('commit surface — union of common and git-additive protected paths', () => {
  it('blocks (exit 2) via a self-mod verdict when a staged file sits under a git-additive path', async () => {
    // 'packages/core/src' is listed ONLY in adapters.git, so this block proves the union
    // reached the judge.
    writeConfig({
      protectedPaths: ['gatefile.txt'],
      adapters: { git: { enforce: 'block', protectedPaths: ['packages/core/src'] } },
    });
    git('add', 'polydeukes.config.json');
    git('commit', '--quiet', '-m', 'config');
    write('packages/core/src/judge.ts', 'export const judge = 1;\n');
    git('add', 'packages/core/src/judge.ts');

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(2);
    expect(selfModRows()).toEqual([['blocked', 'packages/core/src']]);
  });

  it('blocks (exit 2) the staged DELETION of a file under a git-additive path', async () => {
    // `git rm` on a judge-chain source travels the staged-delete evidence branch, not the
    // write branch the sibling case covers: a union wired only into the write and modify
    // kinds would let a staged deletion of the judge chain pass.
    writeConfig({
      protectedPaths: ['gatefile.txt'],
      adapters: { git: { enforce: 'block', protectedPaths: ['packages/core/src'] } },
    });
    write('packages/core/src/judge.ts', 'export const judge = 1;\n');
    git('add', 'polydeukes.config.json', 'packages/core/src/judge.ts');
    git('commit', '--quiet', '-m', 'config and source');
    git('rm', '--quiet', 'packages/core/src/judge.ts');

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(2);
    expect(selfModRows()).toEqual([['blocked', 'packages/core/src']]);
  });

  it('opens (exit 0, witnessed) for a git-additive block when the TTY seam returns the token', async () => {
    // The additive registration must carry the SAME witness as the common one, or every
    // commit staging a judge-chain source becomes impossible to open even for the human
    // at the terminal.
    writeConfig({
      protectedPaths: ['gatefile.txt'],
      witness: { token: WITNESS_TOKEN, ttlMinutes: 5 },
      adapters: { git: { enforce: 'block', protectedPaths: ['packages/core/src'] } },
    });
    git('add', 'polydeukes.config.json');
    git('commit', '--quiet', '-m', 'config');
    write('packages/core/src/judge.ts', 'export const judge = 1;\n');
    git('add', 'packages/core/src/judge.ts');

    const result = await runCovenantCheck({
      repoRoot,
      telemetryPath,
      ttyPrompt: () => WITNESS_TOKEN,
    });

    expect(result.exitCode).toBe(0);
    expect(selfModRows()).toEqual([['witnessed', 'packages/core/src']]);
  });

  it('passes (exit 0) an unrelated staged file when the git namespace carries an additive list', async () => {
    // The over-blocking half of the pair: the union must not match every path, and the
    // namespace resolution must accept the additive key rather than throwing.
    writeConfig({
      protectedPaths: ['gatefile.txt'],
      adapters: { git: { enforce: 'block', protectedPaths: ['packages/core/src'] } },
    });
    git('add', 'polydeukes.config.json');
    git('commit', '--quiet', '-m', 'config');
    write('ordinary.txt', 'nothing special\n');
    git('add', 'ordinary.txt');

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(0);
  });

  it('still blocks (exit 2) a staged file under the COMMON list while an additive list is present', async () => {
    // The union must APPEND, never replace: normalizing the additive list alone would
    // leave every common entry unwatched on the commit surface.
    writeConfig({
      protectedPaths: ['gate.txt'],
      adapters: { git: { enforce: 'block', protectedPaths: ['packages/core/src'] } },
    });
    git('add', 'polydeukes.config.json');
    git('commit', '--quiet', '-m', 'config');
    write('gate.txt', 'gate definition\n');
    git('add', 'gate.txt');

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(2);
    expect(selfModRows()).toEqual([['blocked', 'gate.txt']]);
  });

  it('records advised (exit 0), not blocked, for a git-additive violation under enforce advise', async () => {
    // The enforce axis crosses the scope axis: the additive list must reach the advise
    // branch too. Exit 0 alone cannot carry this — a no-match run also exits 0 — so the
    // advised row is what proves the union was consulted.
    writeConfig({
      protectedPaths: ['gatefile.txt'],
      adapters: { git: { enforce: 'advise', protectedPaths: ['packages/core/src'] } },
    });
    git('add', 'polydeukes.config.json');
    git('commit', '--quiet', '-m', 'config');
    write('packages/core/src/judge.ts', 'export const judge = 1;\n');
    git('add', 'packages/core/src/judge.ts');

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(0);
    // A fail-closed collapse leaves no self-mod row at all, and a block-branch-only
    // union leaves a blocked row; only the union under advise leaves this exact row.
    expect(selfModRows()).toEqual([['advised', 'packages/core/src']]);
  });
});

describe('the union is normalized as ONE list (consumer-side normalization)', () => {
  it('judges normally (one verdict, exit 2) when the same path is listed in BOTH lists', async () => {
    // Dedupe belongs to the normalizer, so the union must survive a cross-list duplicate:
    // first-occurrence dedupe, one registration, one verdict per staged change. Bypassing
    // the normalizer either rejects the duplicate as a config error or double-judges the
    // same staged change.
    writeConfig({
      protectedPaths: ['shared/secret.txt'],
      adapters: { git: { enforce: 'block', protectedPaths: ['shared/secret.txt'] } },
    });
    git('add', 'polydeukes.config.json');
    git('commit', '--quiet', '-m', 'config');
    write('shared/secret.txt', 'sensitive\n');
    git('add', 'shared/secret.txt');

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(2);
    expect(selfModRows()).toEqual([['blocked', 'shared/secret.txt']]);
  });

  it('blocks (exit 2) a staged file under an additive entry spelled with surrounding whitespace', async () => {
    // Additive entries arrive VERBATIM, so normalization must happen downstream of the
    // concatenation for the two lists to be one vocabulary. Whitespace padding is the one
    // spelling pathSegments does not forgive (a ./ prefix is stripped either way), so only
    // this fixture refutes a union appended AFTER normalization — there the padded entry's
    // segments carry spaces and match nothing.
    writeConfig({
      protectedPaths: ['gatefile.txt'],
      adapters: { git: { enforce: 'block', protectedPaths: [' packages/core/src '] } },
    });
    git('add', 'polydeukes.config.json');
    git('commit', '--quiet', '-m', 'config');
    write('packages/core/src/judge.ts', 'export const judge = 1;\n');
    git('add', 'packages/core/src/judge.ts');

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(2);
    expect(selfModRows()).toEqual([['blocked', 'packages/core/src']]);
  });
});

// The telemetry path has three sources with a fixed precedence: spec.telemetryPath, then
// the config's telemetry.logPath, then the default <repoRoot>/.polydeukes/roi.log settled
// BEFORE config load. Every case above injects telemetryPath, so the un-injected calls
// below are the only place the default and config terms are observable — and the real
// caller, the pdks bin, injects nothing.

/** The label the runner's fail-closed catch records under — never a judge's label. */
const FAIL_CLOSED_LABEL = 'covenant-check';

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

    await expect(runCovenantCheck({ repoRoot })).resolves.toEqual({ exitCode: 2 });

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

    await expect(runCovenantCheck({ repoRoot })).resolves.toEqual({ exitCode: 2 });

    expect(telemetryRows(telemetryPath)).toContainEqual(['blocked', 'self-mod', 'secret.txt']);
    expect(defaultRows()).toEqual([]);
  });

  it('writes the config-failure row to the INJECTED path, never the default, when both exist', async () => {
    // The spec term inside the failure branch: spec.telemetryPath wins over the
    // provisional default, or every injected suite's fail-closed rows scatter into
    // <repoRoot>/.polydeukes/roi.log.
    write('polydeukes.config.json', JSON.stringify({ languages: 'not-an-object' }));

    await expect(runCovenantCheck({ repoRoot, telemetryPath })).resolves.toEqual({ exitCode: 2 });

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

    await expect(runCovenantCheck({ repoRoot })).resolves.toEqual({ exitCode: 2 });

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

    await expect(runCovenantCheck({ repoRoot, telemetryPath: injectedPath })).resolves.toEqual({
      exitCode: 2,
    });

    expect(telemetryRows(injectedPath)).toContainEqual(['blocked', 'self-mod', 'secret.txt']);
    expect(telemetryRows(telemetryPath)).toEqual([]);
  });
});
