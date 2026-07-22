import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readRecords } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// CONFIG-06 §4.6 RED phase. The `covenant check` runner's advise behavior. Same assembled
// runner as covenant-check.test.ts; imported from the package entry point.
//   runCovenantCheck({ repoRoot, telemetryPath?, ttyPrompt? }): Promise<{ exitCode }>
// Under adapters.git.enforce advise the runner MUST: pass a protected-path commit (exit 0),
// record it as `advised`, NEVER assemble the TTY-valve hatch (ttyPrompt never called), and
// emit exactly one stderr advisory line. Fail-closed paths (validator throw) stay exit 2.
// The advised outcome does NOT exist yet, so these are RED by construction.
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
  repoRoot = mkdtempSync(join(tmpdir(), 'pdks-check-advise-'));
  telemetryPath = join(repoRoot, 'roi.log');
  git('init', '--quiet');
  git('config', 'user.email', 'test@polydeukes.local');
  git('config', 'user.name', 'Polydeukes Test');
  git('config', 'commit.gpgsign', 'false');
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('CONFIG-06 §4.6 covenant check — advise passes and records', () => {
  it('exit 0 (not 2) with an advised record and the TTY valve NEVER consulted for a protected-path commit', async () => {
    // §4.6 core: under advise a protected-path commit is recorded and passed, and the
    // hatch is structurally not assembled — even with a waiver configured and a ttyPrompt
    // that would return the exact token, the prompt is never called (so `bypassed` cannot
    // occur under advise). Mutation caught: advise threaded but the hatch still assembled
    // (prompt fires), or the verdict still mapped to exit 2.
    writeConfig({
      protectedPaths: ['secret.txt'],
      waiver: { token: WAIVER_TOKEN, ttlMinutes: 5 },
      adapters: { git: { enforce: 'advise' } },
    });
    write('secret.txt', 'sensitive\n');
    git('add', 'secret.txt', 'polydeukes.config.json');
    const ttyPrompt = vi.fn(() => WAIVER_TOKEN);

    const result = await runCovenantCheck({ repoRoot, telemetryPath, ttyPrompt });

    expect(result.exitCode).toBe(0);
    expect(ttyPrompt).not.toHaveBeenCalled();
    const { records } = readRecords(telemetryPath);
    expect(records.some((record) => record.event === 'advised')).toBe(true);
    expect(records.some((record) => record.event === 'bypassed')).toBe(false);
  });

  it('emits exactly one stderr advisory line mentioning the commit is allowed', async () => {
    // §4.6: advise is not silent measurement — it emits an advisory so the reason a commit
    // was allowed is visible. Mutation caught: the advisory omitted (advise degrades into
    // measure), or emitted more than once per run.
    writeConfig({
      protectedPaths: ['secret.txt'],
      adapters: { git: { enforce: 'advise' } },
    });
    write('secret.txt', 'sensitive\n');
    git('add', 'secret.txt', 'polydeukes.config.json');
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    await runCovenantCheck({ repoRoot, telemetryPath });

    const advisoryLines = stderrWrite.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => /covenant advisory \(enforce: advise\)/.test(line));
    expect(advisoryLines).toHaveLength(1);
    expect(advisoryLines[0]).toMatch(/commit allowed/);
  });

  it('an unrelated staged file under advise passes (exit 0) with zero telemetry records', async () => {
    // The other side: advise does not fabricate verdicts. A commit touching no protected
    // path is a clean pass with nothing recorded. Mutation caught: advise emitting an
    // advised record for every commit regardless of any verdict.
    writeConfig({
      protectedPaths: ['secret.txt'],
      adapters: { git: { enforce: 'advise' } },
    });
    git('add', 'polydeukes.config.json');
    git('commit', '--quiet', '-m', 'config');
    write('ordinary.txt', 'nothing special\n');
    git('add', 'ordinary.txt');

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(0);
    const { records } = readRecords(telemetryPath);
    expect(records).toHaveLength(0);
  });
});

describe('CONFIG-06 §4.6 covenant check — advise misconfiguration never softens (fail-closed)', () => {
  it('a reserved enforce level (measure) fails closed: exit 2 + one blocked record', async () => {
    // §4.6 invariant: the namespace validator throws on the reserved level, and a
    // validation throw is outside the level axis — it must block, never fall back to any
    // level. Mutation caught: the validator throw swallowed into a pass, or advise-family
    // misconfiguration softening the verdict instead of blocking.
    writeConfig({
      protectedPaths: ['secret.txt'],
      adapters: { git: { enforce: 'measure' } },
    });
    write('secret.txt', 'sensitive\n');
    git('add', 'secret.txt', 'polydeukes.config.json');

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(2);
    const { records } = readRecords(telemetryPath);
    expect(records.some((record) => record.event === 'blocked')).toBe(true);
  });
});

describe('CONFIG-06 §4.6 covenant check — block regression (default fill)', () => {
  it('an empty git namespace (default fill block) still blocks a protected-path commit at exit 2', async () => {
    // §4.6 / §4.2 fixture 2: an empty adapters.git resolves to block, so the current
    // blocking behavior is unchanged. Mutation caught: the default fill flipped to advise,
    // silently relaxing every repo that does not opt in.
    writeConfig({
      protectedPaths: ['secret.txt'],
      adapters: { git: {} },
    });
    write('secret.txt', 'sensitive\n');
    git('add', 'secret.txt', 'polydeukes.config.json');

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(2);
  });
});
