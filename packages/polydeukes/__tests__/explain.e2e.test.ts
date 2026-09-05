// `pdks explain` on the built bin.
import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { writeConfigAt } from './helpers.ts';

const repoRoot = resolve(import.meta.dirname, '../../..');
const BIN = resolve(import.meta.dirname, '../dist/bin.js');

const SESSION_HEADER = 'surface: session (claude-code hook)';
const COMMIT_HEADER = 'surface: commit (git pre-commit)';

const ENTRY_ID = 'no-fixme-anywhere';
const DECLARE_ID = 'db-only-under-knowledge';
const declareEntry = {
  id: DECLARE_ID,
  why: 'a *.db file may exist only under memory/knowledge/',
  declare: {
    // A path convention: `naming` admits `empty` on the change axis, scoped on target.path.
    mechanism: 'naming',
    scope: { source: 'target.path', include: ['\\.db$'] },
    extract: {
      outside: [
        { op: 'source', of: 'target.path' },
        { op: 'matches', re: '^(?!memory/knowledge/)' },
      ],
    },
    relate: [
      {
        id: 'placed',
        relation: { op: 'empty', of: 'outside' },
        message: '{value} is outside memory/knowledge/',
      },
    ],
  },
};

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

describe('pdks explain on the built bin', () => {
  it('prints both surfaces to stdout and exits 0 with a valid config in cwd', () => {
    writeConfigAt(projectRoot, join(projectRoot, 'roi.log'), {
      disciplines: [
        {
          id: ENTRY_ID,
          declare: {
            mechanism: 'added-only',
            scope: { source: 'target.path', include: ['^lib/'] },
            supply: { pre: 'empty', post: 'empty' },
            extract: {
              before: [
                { op: 'source', of: 'pre' },
                { op: 'lines' },
                { op: 'keyByPattern', re: '(FIXME)' },
              ],
              after: [
                { op: 'source', of: 'post' },
                { op: 'lines' },
                { op: 'keyByPattern', re: '(FIXME)' },
              ],
              added: [{ op: 'onlyIn', of: 'after', notIn: 'before' }],
            },
            relate: [
              {
                id: 'nothing-added',
                relation: { op: 'empty', of: 'added' },
                message: 'adds {key}',
              },
            ],
          },
        },
      ],
    });

    const result = spawnExplain();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(SESSION_HEADER);
    expect(result.stdout).toContain(COMMIT_HEADER);
    expect(result.stdout).toContain(ENTRY_ID);
    expect(result.stderr).not.toContain('pdks explain:');
  });

  it('renders a declare entry through the built bin: exit 0, the `declare` kind and the id on stdout', () => {
    // The bin reads the shipped dist, so a config carrying `declare` must be accepted by
    // the built core and rendered by the built explain — an in-process pass proves neither.
    writeConfigAt(projectRoot, join(projectRoot, 'roi.log'), { disciplines: [declareEntry] });

    const result = spawnExplain();

    expect(result.status).toBe(0);
    // The kind column, not the word: the tally line says `declare N` for every config, so
    // only a row whose kind is `declare` proves the built core accepted the key.
    expect(result.stdout).toMatch(new RegExp(`^\\s+declare\\s+${DECLARE_ID}\\s`, 'm'));
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
