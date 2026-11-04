import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkCovenant } from '../src/check-covenant.ts';
import type { CovenantInput } from '../src/ir.ts';

// `checkCovenant` against the BUILT `pdks`: a throwaway tree scaffolded by `pdks init`,
// with one protected path of its own. Only a
// real spawn proves that the SDK invokes the selected executable, that the
// child reads the consumer's config, and that the row the child writes is the judge's own.
// check-covenant.test.ts pins the same contract through the injected seam.

const checkoutRoot = resolve(import.meta.dirname, '../../..');
const PDKS_BIN = process.env.POLYDEUKES_E2E_PDKS ?? resolve(checkoutRoot, 'target/debug/pdks');

/** Injected fixture values — the consumer's roster, its protected directory, its targets. */
const WRITE_FILE = 'writeFile';
const RM = 'rm';
const EXEC = 'exec';
const COMMAND_ARG = 'command';
const PROTECTED_DIR = 'pipeline/gates';
const PROTECTED_TARGET = `${PROTECTED_DIR}/policy.json`;
const ORDINARY_TARGET = 'src/answer.ts';
const TELEMETRY_REL = 'roi.log';
/** The meta-covenant that judges a write under a protected path. */
const SELF_MOD_LABEL = 'self-mod';

let projectRoot: string;

beforeEach(() => {
  vi.stubEnv('PATH', '');
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-sdk-ts-e2e-')));
});

afterEach(() => {
  // rmSync removes symlinks themselves, never what they point at.
  vi.unstubAllEnvs();
  rmSync(projectRoot, { recursive: true, force: true });
});

/**
 * `pdks init` for the scaffold, then the consumer's own config over the scaffolded one: one
 * protected directory and a telemetry path inside the fixture, so the rows this suite reads
 * are this tree's alone. The executable sits in the fixture root, which is the only PATH entry.
 */
function scaffoldConsumer(): void {
  expect(existsSync(PDKS_BIN), `${PDKS_BIN} is missing: run \`cargo build -p pdks\` first`).toBe(
    true,
  );
  symlinkSync(PDKS_BIN, join(projectRoot, 'pdks'));
  vi.stubEnv('PATH', projectRoot);
  const init = spawnSync(PDKS_BIN, ['init'], { cwd: projectRoot, encoding: 'utf-8' });
  expect(init.status, init.stderr).toBe(0);
  writeFileSync(
    join(projectRoot, 'polydeukes.config.yaml'),
    [
      'protectedPaths:',
      `  - '${PROTECTED_DIR}'`,
      'telemetry:',
      `  logPath: '${join(projectRoot, TELEMETRY_REL)}'`,
      '',
    ].join('\n'),
  );
}

/** The consumer-built IR for one `writeFile` under its own roster — no `session`, no `actor`. */
function writeInput(path: string, content: string): CovenantInput {
  return {
    toolCalls: [
      {
        name: WRITE_FILE,
        args: { path, content },
        fileChange: { kind: 'create', path, post: content },
      },
    ],
    subagentSpawns: [],
    userMessages: [],
    tools: { mutating: [WRITE_FILE, RM], shell: [EXEC], commandArgs: [COMMAND_ARG] },
  };
}

/** Every telemetry row at an absolute path as [event, label, subject]; rows are tab-separated `timestamp event label subject`. */
function rowsAt(path: string): [string, string, string][] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [, event = '', label = '', subject = ''] = line.split('\t');
      return [event, label, subject];
    });
}

function rows(): [string, string, string][] {
  return rowsAt(join(projectRoot, TELEMETRY_REL));
}

describe('checkCovenant against the built pdks', () => {
  it('a writeFile under the protected path → blocked, with the reason and one self-mod row', async () => {
    // The exact row separates a verdict from a fail-closed crash on the same status: a
    // crash records under the runner's label, never under self-mod. The reason must name
    // the protected entry, because that text is all an unattended consumer can act on.
    scaffoldConsumer();

    const verdict = await checkCovenant({
      repoRoot: projectRoot,
      input: writeInput(PROTECTED_TARGET, '{}\n'),
    });

    expect(verdict).toMatchObject({ verdict: 'blocked' });
    expect(verdict).toHaveProperty('reason', expect.stringContaining(PROTECTED_DIR));
    expect(rows()).toContainEqual(['blocked', SELF_MOD_LABEL, PROTECTED_DIR]);
    expect(rows().filter(([event]) => event === 'blocked')).toHaveLength(1);
  });

  it('a writeFile outside every protected path → upheld, and no blocked row', async () => {
    // The over-blocking end, and the repoRoot end: a child anchored on the runner's cwd
    // would read THIS checkout's config, under which `src/` edits meet the disciplines.
    scaffoldConsumer();

    const verdict = await checkCovenant({
      repoRoot: projectRoot,
      input: writeInput(ORDINARY_TARGET, 'export const answer = 42;\n'),
    });

    expect(verdict).toMatchObject({ verdict: 'upheld' });
    expect(rows().filter(([event]) => event === 'blocked')).toEqual([]);
  });
});
