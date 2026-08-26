import { readRecords } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// The `covenant check` runner under `adapters.git.enforce: advise`: a protected-path
// commit passes (exit 0), is recorded as `advised`, never assembles the TTY witness
// valve, and emits exactly one stderr advisory line. Fail-closed paths stay exit 2.
//
// Each test builds a real throwaway git repo and writes its own tmp config, so no
// protected path of THIS repository is ever referenced.
import { runCovenantCheck } from '../src/index.ts';
import { type CheckRepo, createCheckRepo } from './helpers.ts';

const WITNESS_TOKEN = 'i-accept-this-commit-covenant';

let repo: CheckRepo;
let repoRoot: string;
let telemetryPath: string;
let git: CheckRepo['git'];
let write: CheckRepo['write'];
let writeConfig: CheckRepo['writeConfig'];

beforeEach(() => {
  repo = createCheckRepo('pdks-check-advise-');
  ({ repoRoot, telemetryPath, git, write, writeConfig } = repo);
});

afterEach(() => {
  repo.cleanup();
  vi.restoreAllMocks();
});

describe('covenant check — advise passes and records', () => {
  it('exit 0 (not 2) with an advised record and the TTY valve NEVER consulted for a protected-path commit', async () => {
    // Under advise the witness is structurally not assembled: even with a witness
    // configured and a ttyPrompt returning the exact token, the prompt is never called,
    // so `witnessed` cannot occur at this level.
    writeConfig({
      protectedPaths: ['secret.txt'],
      witness: { token: WITNESS_TOKEN, ttlMinutes: 5 },
      adapters: { git: { enforce: 'advise' } },
    });
    write('secret.txt', 'sensitive\n');
    git('add', 'secret.txt', 'polydeukes.config.json');
    const ttyPrompt = vi.fn(() => WITNESS_TOKEN);

    const result = await runCovenantCheck({ repoRoot, telemetryPath, ttyPrompt });

    expect(result.exitCode).toBe(0);
    expect(ttyPrompt).not.toHaveBeenCalled();
    const { records } = readRecords(telemetryPath);
    expect(records.some((record) => record.event === 'advised')).toBe(true);
    expect(records.some((record) => record.event === 'witnessed')).toBe(false);
  });

  it('emits exactly one stderr advisory line mentioning the commit is allowed', async () => {
    // Advise is not silent measurement: the advisory makes the reason a commit was
    // allowed visible, exactly once per run.
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
      .filter((line) => /covenant advisory/.test(line));
    expect(advisoryLines).toHaveLength(1);
    expect(advisoryLines[0]).toMatch(/commit allowed/);
  });

  it('an unrelated staged file under advise passes (exit 0) with zero telemetry records', async () => {
    // Advise does not fabricate verdicts: a commit touching no protected path is a
    // clean pass with nothing recorded.
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

describe('covenant check — advise misconfiguration never softens (fail-closed)', () => {
  it('a reserved enforce level (measure) fails closed: exit 2 + one blocked record', async () => {
    // A validation throw is outside the enforce-level axis: it must block, never fall
    // back to any level.
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

describe('covenant check — block regression (default fill)', () => {
  it('an empty git namespace (default fill block) still blocks a protected-path commit at exit 2', async () => {
    // An empty adapters.git resolves to block; a default fill of advise would silently
    // relax every repository that does not opt in.
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
