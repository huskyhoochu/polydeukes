import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type CovenantInput, readRecords } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkCovenant } from '../src/check-covenant.ts';

// `checkCovenant` against the BUILT `pdks`: a throwaway tree scaffolded by `pdks init`,
// wired to the real install graph by symlink, with one protected path of its own. Only a
// real spawn proves that the SDK finds the umbrella from the consumer's repoRoot, that the
// child reads the consumer's config, and that the row the child writes is the judge's own.
// check-covenant.test.ts pins the same contract through the injected seam.

const checkoutRoot = resolve(import.meta.dirname, '../../..');
const UMBRELLA_BIN = resolve(checkoutRoot, 'packages/polydeukes/dist/bin.js');

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
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-sdk-ts-e2e-')));
});

afterEach(() => {
  // rmSync removes symlinks themselves, never what they point at.
  rmSync(projectRoot, { recursive: true, force: true });
});

/**
 * The whole real install graph by one symlink, `pdks init` for the scaffold, then the
 * consumer's own config over the scaffolded one: one protected directory and a telemetry
 * path inside the fixture, so the rows this suite reads are this tree's alone.
 */
function scaffoldConsumer(): void {
  symlinkSync(join(checkoutRoot, 'node_modules'), join(projectRoot, 'node_modules'), 'dir');
  writeFileSync(join(projectRoot, 'package.json'), '{"name":"consumer","private":true}\n');
  const init = spawnSync(process.execPath, [UMBRELLA_BIN, 'init'], {
    cwd: projectRoot,
    encoding: 'utf-8',
  });
  expect(init.status, init.stderr).toBe(0);
  writeFileSync(
    join(projectRoot, 'polydeukes.config.yaml'),
    [
      'languages:',
      '  typescript:',
      "    productionGlob: 'src/**/*.ts'",
      "    testCmd: 'echo {scope}'",
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

/** Every telemetry row under the fixture as [event, label, subject]. */
function rows(): [string, string, string][] {
  const path = join(projectRoot, TELEMETRY_REL);
  if (!existsSync(path)) return [];
  return readRecords(path).records.map((record) => [record.event, record.label, record.subject]);
}

describe('checkCovenant on a real install graph', () => {
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

  it('a tree with no polydeukes in its install graph → unjudged, and no row anywhere', async () => {
    // No symlink, no config: nothing to spawn and no writer for a row. `upheld` here is
    // an absent judge passing every call.
    writeFileSync(join(projectRoot, 'package.json'), '{"name":"consumer","private":true}\n');

    const verdict = await checkCovenant({
      repoRoot: projectRoot,
      input: writeInput(ORDINARY_TARGET, 'x\n'),
    });

    expect(verdict).toMatchObject({ verdict: 'unjudged' });
    expect(rows()).toEqual([]);
  });
});
