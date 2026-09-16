import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// One `runCovenantCheck` call reads the config ONCE: one discovery, one parse of what it
// read. The spies wrap the real loader steps so the run still judges a real config.
import { runCovenantCheck } from '../src/covenant-check.ts';
import { covenantInputFromUnifiedDiff } from '../src/diff-ir.ts';
import { discoverConfigPath, parseConfigSource } from '../src/load-config.ts';
import { type CheckRepo, createCheckRepo } from './helpers.ts';

vi.mock('../src/load-config.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/load-config.ts')>();
  return {
    ...mod,
    discoverConfigPath: vi.fn(mod.discoverConfigPath),
    parseConfigSource: vi.fn(mod.parseConfigSource),
  };
});

const CLEAN_SOURCE = 'lib/a.ts';

let repo: CheckRepo;
let repoRoot: string;
/** Telemetry lives OUTSIDE the repository so the log is never one of the judged changes. */
let logDir: string;

beforeEach(() => {
  repo = createCheckRepo('pdks-check-load-once-');
  ({ repoRoot } = repo);
  logDir = mkdtempSync(join(tmpdir(), 'pdks-check-load-once-log-'));
  repo.writeConfig({});
  repo.write(CLEAN_SOURCE, 'export const x = 1;\n');
  repo.git('add', 'polydeukes.config.json', CLEAN_SOURCE);
  repo.git('commit', '--quiet', '-m', 'baseline');
  repo.write(CLEAN_SOURCE, 'export const x = 2;\n');
  repo.git('add', CLEAN_SOURCE);
  vi.mocked(discoverConfigPath).mockClear();
  vi.mocked(parseConfigSource).mockClear();
});

afterEach(() => {
  repo.cleanup();
  rmSync(logDir, { recursive: true, force: true });
});

describe('the config is read once per runCovenantCheck call', () => {
  it('a run over a staged change discovers and parses the config exactly once', async () => {
    // A second read of a file that changed between stages would judge with one config
    // and record under another; zero reads would mean the run never settled a config.
    await runCovenantCheck({
      surface: 'changeSet',
      repoRoot,
      telemetryPath: join(logDir, 'run.log'),
      input: covenantInputFromUnifiedDiff({ text: repo.git('diff', '--cached') }),
    });

    expect(vi.mocked(discoverConfigPath).mock.calls.length).toBe(1);
    expect(vi.mocked(parseConfigSource).mock.calls.length).toBe(1);
  });
});
