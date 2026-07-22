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
//       typed (the full waiver token to bypass), or null/undefined for no input.
//     - ABSENCE of ttyPrompt models a non-TTY environment (CI, AI-spawned git): the
//       valve must never open (PRD §4.4 / AC-3 human-only arming).
import { runCovenantCheck } from '../src/index.ts';

// ---------------------------------------------------------------------------
// Each test builds a real throwaway git repo AND writes its own tmp config file, so
// no protected path from THIS repository is ever referenced — the fixture configs are
// absolute tmp paths and safe to author.
// ---------------------------------------------------------------------------

const WAIVER_TOKEN = 'i-accept-this-commit-covenant';

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

describe('§5 AC-3 TTY waiver valve — human-only arming', () => {
  function stageProtectedChange(): void {
    writeConfig({ protectedPaths: ['secret.txt'], waiver: { token: WAIVER_TOKEN, ttlMinutes: 5 } });
    write('secret.txt', 'sensitive\n');
    git('add', 'secret.txt', 'polydeukes.config.json');
  }

  it('passes (exit 0) and records bypassed when the TTY seam returns the exact token', async () => {
    // P0 valve-open path: a full-match token from the injected TTY seam opens the valve
    // for this one commit AND is measured as bypassed. Mutation caught: the valve not
    // consulted, or a bypass recorded as passed/blocked (bypassed must be first-class).
    stageProtectedChange();

    const result = await runCovenantCheck({
      repoRoot,
      telemetryPath,
      ttyPrompt: () => WAIVER_TOKEN,
    });

    expect(result.exitCode).toBe(0);
    const { records } = readRecords(telemetryPath);
    expect(records.some((record) => record.event === 'bypassed')).toBe(true);
  });

  it('blocks (exit 2) when the TTY seam returns a partial token (substring, not full match)', async () => {
    // P0 valve-shut path: COVENANT-15 forbids substring acceptance. A prefix of the token
    // must NOT open the valve. Mutation caught: full-equality relaxed to includes()/
    // startsWith(), which would let a typo or a mid-sentence mention through.
    stageProtectedChange();

    const result = await runCovenantCheck({
      repoRoot,
      telemetryPath,
      ttyPrompt: () => WAIVER_TOKEN.slice(0, WAIVER_TOKEN.length - 1),
    });

    expect(result.exitCode).toBe(2);
    const { records } = readRecords(telemetryPath);
    expect(records.some((record) => record.event === 'bypassed')).toBe(false);
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
    expect(records.some((record) => record.event === 'bypassed')).toBe(false);
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
