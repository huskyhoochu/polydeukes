import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readRecords } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// ADAPTER-git §4.3 — the assembled `pdks covenant check` runner. Tested here as a
// library function (the design contract below); the thin argv bin is a shim whose E2E
// lands with the lefthook wiring in a later phase of this ticket (PRD §6, decision D),
// so no spawn-the-bin E2E is written here — the runner-level tests cover the assembly.
//
// Contract asserted (the implementer matches this named export):
//   runCovenantCheck({ repoRoot, telemetryPath?, ttyPrompt? }): Promise<{ exitCode }>
//     - async because the dispatcher spawns covenant bodies (CORE-01 protocol) — a sync
//       runner would require reimplementing the judge, which the single-dispatcher rule
//       forbids.
//     - ttyPrompt is the injected TTY-valve seam: a function returning the line a human
//       typed (the full witness token to bypass), or null/undefined for no input.
//     - ABSENCE of ttyPrompt models a non-TTY environment (CI, AI-spawned git): the
//       valve must never open (PRD §4.4 / AC-3 human-only arming).
import { runCovenantCheck } from '../src/index.ts';

// ---------------------------------------------------------------------------
// Each test builds a real throwaway git repo AND writes its own tmp config file, so
// no protected path from THIS repository is ever referenced — the fixture configs are
// absolute tmp paths and safe to author.
// ---------------------------------------------------------------------------

const WITNESS_TOKEN = 'i-accept-this-commit-covenant';

let repoRoot: string;
let telemetryPath: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf-8' });
}

function write(relPath: string, content: string): void {
  const absolute = join(repoRoot, relPath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

/** Minimal valid config (languages is required) plus the caller's extra keys. */
function writeConfig(extra: Record<string, unknown>): void {
  const config = {
    languages: {
      typescript: { productionGlob: 'lib/**/*.ts', testCmd: 'echo {scope}' },
    },
    telemetry: { logPath: telemetryPath },
    ...extra,
  };
  writeFileSync(join(repoRoot, 'polydeukes.config.json'), JSON.stringify(config, null, 2));
}

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'pdks-check-'));
  telemetryPath = join(repoRoot, 'roi.log');
  git('init', '--quiet');
  git('config', 'user.email', 'test@polydeukes.local');
  git('config', 'user.name', 'Polydeukes Test');
  git('config', 'commit.gpgsign', 'false');
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('§5 AC-2 same-judge blocking on a protected path', () => {
  it('blocks (exit 2) when a staged change touches a protectedPaths file', async () => {
    // P0: a commit that mutates a declared protected path must fail closed at commit time,
    // exactly as the session hook blocks the same edit. Mutation caught: self-mod judge
    // dropped from the assembly, or a blocking verdict not mapped to exit 2.
    writeConfig({ protectedPaths: ['secret.txt'] });
    write('secret.txt', 'sensitive\n');
    git('add', 'secret.txt', 'polydeukes.config.json');

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(2);
  });

  it('passes (exit 0) when the staged change is unrelated to any protected path', async () => {
    // The other side of the branch: an unrelated file must NOT be blocked (no fail-open
    // AND no over-blocking). Mutation caught: self-mod matching every path.
    // The config file is committed FIRST and not staged here: loadConfig attaches the
    // discovered config file to its own protection surface (CONFIG-03 schema rule 6), so
    // staging it alongside would be a protected write and block by design.
    writeConfig({ protectedPaths: ['secret.txt'] });
    git('add', 'polydeukes.config.json');
    git('commit', '--quiet', '-m', 'config');
    write('ordinary.txt', 'nothing special\n');
    git('add', 'ordinary.txt');

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(0);
  });
});

describe('§5 AC-4 discipline delta family — new violation vs pre-existing debt', () => {
  const disciplines = [{ id: 'no-todo', forbid: { added: 'TODO' }, in: 'lib/**/*.ts' }];

  it('blocks when the staged delta ADDS a forbidden match', async () => {
    // P0: the delta family judges only what this commit adds. A newly introduced TODO
    // must block. Mutation caught: compileDisciplineRegistrations dropped from assembly,
    // or the delta judge inverted.
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
    // P0 (the forgiveness half): a TODO that already existed in HEAD is forgiven; a change
    // touching that file without adding a NEW match must pass. Mutation caught: the judge
    // reading the absolute post count instead of the added delta (which would block on
    // pre-existing debt and make the discipline unadoptable on a legacy codebase).
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

describe('§5 AC-3 TTY witness valve — human-only arming', () => {
  function stageProtectedChange(): void {
    writeConfig({
      protectedPaths: ['secret.txt'],
      witness: { token: WITNESS_TOKEN, ttlMinutes: 5 },
    });
    write('secret.txt', 'sensitive\n');
    git('add', 'secret.txt', 'polydeukes.config.json');
  }

  it('passes (exit 0) and records witnessed when the TTY seam returns the exact token', async () => {
    // P0 valve-open path: a full-match token from the injected TTY seam opens the valve
    // for this one commit AND is measured as witnessed. Mutation caught: the valve not
    // consulted, or a bypass recorded as passed/blocked (witnessed must be first-class).
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
    // P0 valve-shut path: COVENANT-15 forbids substring acceptance. A prefix of the token
    // must NOT open the valve. Mutation caught: full-equality relaxed to includes()/
    // startsWith(), which would let a typo or a mid-sentence mention through.
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
    // Mutation caught: token comparison dropped entirely (any input accepted).
    stageProtectedChange();

    const result = await runCovenantCheck({
      repoRoot,
      telemetryPath,
      ttyPrompt: () => 'totally-wrong-phrase',
    });

    expect(result.exitCode).toBe(2);
  });

  it('blocks (exit 2) with NO prompt attempt when no TTY seam is injected (non-interactive)', async () => {
    // P0 human-only arming (AC-3): absent TTY = block. A session-spawned AI git commit has
    // no TTY, so the valve is structurally unreachable — the AI can never open it for
    // itself. Mutation caught: an env-var or default-answer fallback substituting for the
    // missing TTY seam (an AI-forgeable valve, forbidden by PRD §7).
    stageProtectedChange();

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(2);
    const { records } = readRecords(telemetryPath);
    expect(records.some((record) => record.event === 'witnessed')).toBe(false);
  });
});

describe('§5 AC-6 telemetry — every judged call is recorded', () => {
  it('appends one record per judged call across a multi-file staged batch', async () => {
    // AC-6: N judged calls → N records. Two protected staged files → at least two judged
    // outcomes on the log. Mutation caught: telemetry append omitted for some verdicts, or
    // only the aggregate written once.
    writeConfig({ protectedPaths: ['secret.txt', 'guarded.txt'] });
    write('secret.txt', 'a\n');
    write('guarded.txt', 'b\n');
    git('add', 'secret.txt', 'guarded.txt', 'polydeukes.config.json');

    await runCovenantCheck({ repoRoot, telemetryPath });

    const { records } = readRecords(telemetryPath);
    expect(records.length).toBeGreaterThanOrEqual(2);
  });
});

describe('§5 AC-7 fail-closed and empty-staging boundaries', () => {
  it('blocks (exit 2) when no config file exists in the repo root', async () => {
    // P0 fail-closed: loadConfig throws on a missing config, and the runner must translate
    // that into exit 2, never pass vacuously. Mutation caught: the loadConfig throw
    // swallowed into exit 0.
    write('anything.txt', 'x\n');
    git('add', 'anything.txt');

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(2);
  });

  it('passes (exit 0) when the staging area is empty', async () => {
    // Boundary AC-7: zero staged changes is an explicit pass (nothing to judge), not a
    // block. Mutation caught: an empty batch mis-defaulting to fail-closed 2.
    writeConfig({ protectedPaths: ['secret.txt'] });
    // Nothing staged (config file left unstaged in the worktree).

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CONFIG-08 §4.2 — the commit surface consumes the UNION of the common
// protectedPaths and the adapters.git additive list. The additive entries live in
// the git adapter's own namespace vocabulary (§4.1), so a block caused by one can
// come from nothing but the union wiring. Every blocked assertion below pins the
// self-mod row (label + matched-entry subject — the dispatcher records the protected
// entry that matched, so an additive-only entry as subject proves additive origin),
// not just the exit code: the current
// validator throws on the unknown `protectedPaths` key and fails closed at the SAME
// exit 2, so an exit-code-only test would go green for the wrong reason.
// ---------------------------------------------------------------------------

describe('CONFIG-08 §4.2 commit surface — union of common and git-additive protected paths', () => {
  /** Rows written by the protected-paths meta-covenant (never by the fail-closed handler). */
  function selfModRows(): [string, string][] {
    return readRecords(telemetryPath)
      .records.filter((record) => record.label === 'self-mod')
      .map((record) => [record.event, record.subject]);
  }

  it('blocks (exit 2) via a self-mod verdict when a staged file sits under a git-additive path', async () => {
    // §5 commit-block AC: 'packages/core/src' is listed ONLY in adapters.git, so this
    // block proves the union reached the judge. Mutation caught: the additive list never
    // concatenated (exit 0), or exit 2 reached only through the fail-closed unknown-key
    // handler (no self-mod row — the wrong-reason green this pin exists to refuse).
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
    // The most direct disarming this ticket exists to stop: `git rm` on a judge-chain
    // source travels the STAGED_DELETE evidence branch (kind 'delete'), not the write
    // branch the sibling pin covers. Mutation caught: the union wired only into the
    // write/modify evidence kinds, letting a staged deletion of the judge chain pass.
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
    // §7 lockout class: the additive registration must carry the SAME witness as
    // the common one, or every commit staging a judge-chain source becomes impossible to witness
    // even for the human at the terminal. Mutation caught: the union implemented as a
    // second registration wired without witness.
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
    // The over-blocking half of the pair, and the honest RED today: the unknown-key
    // throw currently fails this run closed at exit 2, so accepting the vocabulary is
    // exactly what turns it green. Mutation caught: the union matching every path, or
    // the namespace resolution still throwing on protectedPaths.
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
    // The other end of the common↔additive axis: the union must APPEND, never replace.
    // A consumer wiring normalizeProtectedPaths(gitAdditive) alone would leave every
    // common entry unwatched on the commit surface — the fail-open mirror of the
    // additive-block test above. Mutation caught: the common half dropped from the
    // concatenation.
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
    // The enforce axis crosses the new scope axis: the additive list must reach the
    // advise branch too. Exit 0 alone cannot carry this pin — a no-match run also exits
    // 0 — so the advised row is what proves the union was consulted. Mutation caught:
    // the union threaded only into the block branch, silently un-measuring the additive
    // scope wherever a repo dials the commit surface down to advise.
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
    // The exact-row form (sibling pins' shape): a fail-closed collapse leaves no
    // self-mod row at all, and a block-branch-only union leaves a blocked row — both
    // refute this single advised row with the additive-only subject.
    expect(selfModRows()).toEqual([['advised', 'packages/core/src']]);
  });
});

describe('CONFIG-08 §4.2 the union is normalized as ONE list (consumer-side normalization)', () => {
  function selfModRows(): [string, string][] {
    return readRecords(telemetryPath)
      .records.filter((record) => record.label === 'self-mod')
      .map((record) => [record.event, record.subject]);
  }

  it('judges normally (one verdict, exit 2) when the same path is listed in BOTH lists', async () => {
    // §4.2: dedupe belongs to the normalizer, and the union must survive a cross-list
    // duplicate — first-occurrence dedupe, one registration, one verdict per staged
    // change. Mutation caught: the concatenation bypassing normalizeProtectedPaths (a
    // duplicate rejected as a config error → fail-closed, zero self-mod rows) or the
    // duplicated entry double-judging the same staged change (two rows).
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
    // §4.1 hands additive entries over VERBATIM, so normalization must happen downstream
    // of the concatenation for the two lists to be one vocabulary. Whitespace padding is
    // the one spelling pathSegments does NOT forgive (a ./ prefix is stripped either
    // way), so only this fixture refutes a union appended AFTER normalization — there
    // the padded entry's segments carry spaces and match nothing (silent fail-open).
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
