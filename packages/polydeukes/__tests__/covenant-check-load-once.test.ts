import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// DIAG-01 §6 invariant 10 / §5 AC-7 RED phase — one `runCovenantCheck` call reads the
// config ONCE, whichever domain it observes (CONFIG-10 AC-5 carried over). The spy wraps
// the real loader so the run still judges a real config.
import { runCovenantCheck } from '../src/covenant-check.ts';
import { loadConfig } from '../src/load-config.ts';
import { type CheckRepo, createCheckRepo } from './helpers.ts';

vi.mock('../src/load-config.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/load-config.ts')>();
  return { ...mod, loadConfig: vi.fn(mod.loadConfig) };
});

const CLEAN_SOURCE = 'lib/a.ts';

let repo: CheckRepo;
let repoRoot: string;
let base: string;
/** Telemetry lives OUTSIDE the repository so the worktree domain never collects the log. */
let logDir: string;

beforeEach(() => {
  repo = createCheckRepo('pdks-check-load-once-');
  ({ repoRoot } = repo);
  logDir = mkdtempSync(join(tmpdir(), 'pdks-check-load-once-log-'));
  repo.writeConfig({});
  repo.write(CLEAN_SOURCE, 'export const x = 1;\n');
  repo.git('add', 'polydeukes.config.json', CLEAN_SOURCE);
  repo.git('commit', '--quiet', '-m', 'baseline');
  base = repo.git('rev-parse', 'HEAD').trim();
  vi.mocked(loadConfig).mockClear();
});

afterEach(() => {
  repo.cleanup();
  rmSync(logDir, { recursive: true, force: true });
});

describe('§6 invariant 10 — loadConfig is read once per runCovenantCheck call', () => {
  it.each([
    ['staged', () => ({ kind: 'staged' as const })],
    ['worktree', () => ({ kind: 'worktree' as const })],
    ['range', () => ({ kind: 'range' as const, base, head: 'HEAD' })],
  ])('%s domain calls loadConfig exactly once', async (name, domain) => {
    // Mutation caught: the three-way split (settleConfig / collectDomain / judgeChanges)
    // re-reading the config in a later stage — a second read of a file that changed
    // between stages would judge with one config and record under another. Zero calls
    // would mean the run never settled a config at all.
    await runCovenantCheck({
      repoRoot,
      telemetryPath: join(logDir, `${name}.log`),
      domain: domain(),
    });

    expect(vi.mocked(loadConfig).mock.calls.length).toBe(1);
  });
});
