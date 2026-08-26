// `pdks explain` on the built bin.
import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { writeConfigAt } from './helpers';

const repoRoot = resolve(import.meta.dirname, '../../..');
const BIN = resolve(import.meta.dirname, '../dist/bin.js');

const SESSION_HEADER = 'surface: session (claude-code hook)';
const COMMIT_HEADER = 'surface: commit (git pre-commit)';

const ENTRY_ID = 'no-fixme-anywhere';

let projectRoot: string;

beforeAll(() => {
  execSync('pnpm turbo run build', { cwd: repoRoot, stdio: 'pipe' });
}, 120_000);

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'pdks-explain-e2e-'));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

function spawnExplain(...extra: string[]) {
  return spawnSync(process.execPath, [BIN, 'explain', ...extra], {
    cwd: projectRoot,
    encoding: 'utf-8',
  });
}

describe('CLI-01 AC-9 — pdks explain on the built bin', () => {
  it('prints both surfaces to stdout and exits 0 with a valid config in cwd', () => {
    writeConfigAt(projectRoot, join(projectRoot, 'roi.log'), {
      disciplines: [{ id: ENTRY_ID, forbid: 'FIXME' }],
    });

    const result = spawnExplain();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(SESSION_HEADER);
    expect(result.stdout).toContain(COMMIT_HEADER);
    expect(result.stdout).toContain(ENTRY_ID);
    expect(result.stderr).not.toContain('pdks explain:');
  });

  it('refuses a surplus argument with usage on stderr and exit 2', () => {
    writeConfigAt(projectRoot, join(projectRoot, 'roi.log'), {});

    const result = spawnExplain('x');

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage:');
    expect(result.stderr).toContain('pdks explain');
    expect(result.stdout).toBe('');
  });

  it('with no config: exit 2, stdout at zero bytes, stderr prefixed `pdks explain:`', () => {
    const result = spawnExplain();

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr.startsWith('pdks explain:')).toBe(true);
  });
});
