import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { type CovenantInput, readRecords } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// Whether the host proved a session decides which pre-state reader the assembly injects,
// and the session-free one answers `undefined` for every location. That answer means one
// location failed to read, which fails the call closed — the right reading for a surface
// that has the channel and lost a location, and the wrong one for a surface that never had
// it. Read the second way, a shell write in the call blocked every discipline judging it,
// including the ones that read only the command line, with no reason on stderr and no
// witness list in the row.
import { runCovenantCheck } from '../src/covenant-check.ts';
import { telemetryRows, writeConfigAt } from './helpers.ts';

const SHELL_TOOL = 'shell-tool';
const COMMAND_ARG = 'command';
const TOOLS = { mutating: ['session-write'], shell: [SHELL_TOOL], commandArgs: [COMMAND_ARG] };
const COMMAND_SCOPED_ID = 'work-stays-recoverable';
const FILE_SCOPED_ID = 'lib-stays-annotated';
const SCOPED_DIR = 'lib';

/** Reads the command line alone — no file world of the call can change its verdict. */
const COMMAND_SCOPED_ENTRY = {
  id: COMMAND_SCOPED_ID,
  enforce: 'block',
  declare: {
    mechanism: 'forbidden-command',
    scope: { source: 'command' },
    extract: {
      hits: [
        { op: 'source', of: 'command' },
        { op: 'lines' },
        { op: 'matches', re: 'git reset\\b.*--hard' },
      ],
    },
    relate: [
      {
        id: 'recoverable',
        relation: { op: 'empty', of: 'hits' },
        message: 'command line forecloses recovery: {value}',
      },
    ],
  },
};

/** Reads the written file's own text, so a shell write is evidence it would consume. */
const FILE_SCOPED_ENTRY = {
  id: FILE_SCOPED_ID,
  enforce: 'block',
  declare: {
    mechanism: 'naming',
    scope: { source: 'target.path', include: [`^${SCOPED_DIR}/`] },
    extract: {
      hits: [{ op: 'source', of: 'post' }, { op: 'lines' }, { op: 'matches', re: 'forbidden' }],
    },
    relate: [
      {
        id: 'annotated',
        relation: { op: 'empty', of: 'hits' },
        message: 'the written text carries a forbidden line: {value}',
      },
    ],
  },
};

function ir(command: string): CovenantInput {
  return {
    toolCalls: [{ name: SHELL_TOOL, args: { [COMMAND_ARG]: command } }],
    subagentSpawns: [],
    userMessages: [],
    actor: {},
    tools: TOOLS,
  } as CovenantInput;
}

/** The same observation with the host's session evidence proved, and carrying no history. */
function withSession(input: CovenantInput): CovenantInput {
  return { ...input, session: { userMessages: [], toolCalls: [] } };
}

let repoRoot: string;
let telemetryPath: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'pdks-session-free-shell-'));
  telemetryPath = join(repoRoot, 'roi.log');
  writeConfigAt(repoRoot, telemetryPath, {
    disciplines: [COMMAND_SCOPED_ENTRY, FILE_SCOPED_ENTRY],
  });
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

/** Write a repo-relative file so a shell write to it is a modify rather than a create. */
function write(relPath: string, content: string): void {
  const absolute = join(repoRoot, relPath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

describe('a shell write does not change what a session-free surface judges', () => {
  it('judges a command the same with and without a session', async () => {
    // The target is outside the repository, so no fixture could make its pre-state
    // readable — the shape a real `/tmp` redirect has.
    const outside = join(mkdtempSync(join(tmpdir(), 'pdks-outside-')), 'y.ts');
    const input = ir(`echo x > ${outside}`);

    const sessionFree = await runCovenantCheck({
      repoRoot,
      input,
      telemetryPath,
      enforce: 'block',
    });
    const sessionFreeRows = telemetryRows(telemetryPath);
    rmSync(telemetryPath, { force: true });

    const sessioned = await runCovenantCheck({
      repoRoot,
      input: withSession(input),
      telemetryPath,
      enforce: 'block',
    });

    expect(sessionFree.exitCode).toBe(0);
    expect(sessioned.exitCode).toBe(0);
    expect(sessionFreeRows).toContainEqual(['passed', COMMAND_SCOPED_ID, '-']);
    // The session's own comparison rows are not the entry's verdict, so the two logs are
    // compared over the entry's row rather than whole.
    expect(telemetryRows(telemetryPath)).toContainEqual(['passed', COMMAND_SCOPED_ID, '-']);
  });

  it('breaks on a forbidden command with no session, naming the reason on stderr', async () => {
    const outside = join(mkdtempSync(join(tmpdir(), 'pdks-outside-')), 'y.ts');
    const written: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    let outcome: { exitCode: number };
    try {
      outcome = await runCovenantCheck({
        repoRoot,
        input: ir(`git reset --hard > ${outside}`),
        telemetryPath,
        enforce: 'block',
      });
    } finally {
      process.stderr.write = original;
    }

    expect(outcome.exitCode).toBe(2);
    expect(telemetryRows(telemetryPath)).toContainEqual(['blocked', COMMAND_SCOPED_ID, '-']);
    expect(written.join('')).toContain(`discipline '${COMMAND_SCOPED_ID}' broken`);
  });

  it('completes a shell write into the file world when a session supplies the pre-state', async () => {
    // The channel exists here, so the derivation runs and the written text is judged: the
    // fix withholds the enrichment only where the surface can never answer for it.
    const target = `${SCOPED_DIR}/a.ts`;
    write(target, 'clean\n');

    const outcome = await runCovenantCheck({
      repoRoot,
      input: withSession(ir(`echo forbidden > ${join(repoRoot, target)}`)),
      telemetryPath,
      enforce: 'block',
    });

    expect(outcome.exitCode).toBe(2);
    expect(telemetryRows(telemetryPath)).toContainEqual(['blocked', FILE_SCOPED_ID, target]);
  });
});

describe('a session-free surface records the shell write it cannot judge', () => {
  it('leaves a skipped row with a reason where a session would judge the written text', async () => {
    // The write is COMPUTABLE from the command text and its target is in the file-scoped
    // entry's scope, so routing reaches that entry; only the pre-state the surface lacks
    // stops the world from being built. Without the skip arm the entry answers `passed`
    // for a file it never read.
    const target = `${SCOPED_DIR}/a.ts`;
    write(target, 'clean\n');

    const outcome = await runCovenantCheck({
      repoRoot,
      input: ir(`echo forbidden > ${join(repoRoot, target)}`),
      telemetryPath,
      enforce: 'block',
    });

    const rows = telemetryRows(telemetryPath);
    expect(outcome.exitCode).toBe(0);
    expect(rows).toContainEqual(['skipped', FILE_SCOPED_ID, target]);
    expect(rows).not.toContainEqual(['passed', FILE_SCOPED_ID, target]);
  });

  it('names the reason in the row so the absence is legible', async () => {
    const target = `${SCOPED_DIR}/a.ts`;
    write(target, 'clean\n');

    await runCovenantCheck({
      repoRoot,
      input: ir(`echo forbidden > ${join(repoRoot, target)}`),
      telemetryPath,
      enforce: 'block',
    });

    const skipped = readRecords(telemetryPath).records.find(
      (record) => record.event === 'skipped' && record.label === FILE_SCOPED_ID,
    );
    expect(skipped?.reason).toBe('no-observation');
  });
});
