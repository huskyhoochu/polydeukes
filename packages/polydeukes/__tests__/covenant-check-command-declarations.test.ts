import { readRecords } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// The commit surface has no shell call and no session. A `forbidden-command` declaration
// reads the world's `command`, which no staged change carries and whose scope-less body
// therefore has nothing to route — it leaves no row. A `precedent` declaration reads the
// session under `supply: pass`; the session is absent here by construction, so every
// matched staged change lands one `skipped` row with the reason `supply-pass`.
//
// Each case builds a real throwaway git repo and writes its own config, so no protected
// path of THIS repository is ever referenced.
import { runCovenantCheck } from '../src/covenant-check.ts';
import { type CheckRepo, createCheckRepo } from './helpers.ts';

/** Injected fixture values — ids, sources, patterns. */
const BAN_ID = 'pnpm-only';
const PRECEDENT_ID = 'lib-needs-npm-view';
const SESSION = 'session';
const SUPPLY_PASS_REASON = 'supply-pass';
const SHELL_TOOL = 'Bash';
const LIB_A = 'lib/a.ts';
const LIB_B = 'lib/b.ts';

const banEntry = {
  id: BAN_ID,
  why: 'this repository installs with pnpm alone',
  declare: {
    mechanism: 'forbidden-command',
    scope: { source: 'command' },
    extract: {
      hits: [
        { op: 'source', of: 'command' },
        { op: 'lines' },
        { op: 'matches', re: '\\bnpm (install|i|add|link)\\b' },
      ],
    },
    relate: [{ id: 'no-npm-mutation', relation: { op: 'empty', of: 'hits' }, message: '{value}' }],
  },
};

const precedentEntry = {
  id: PRECEDENT_ID,
  why: 'a lib edit follows a registry check',
  declare: {
    mechanism: 'precedent',
    scope: { source: 'target.path', include: ['^lib/'] },
    sources: { [SESSION]: { transcript: true } },
    supply: { [SESSION]: 'pass' },
    extract: {
      npmView: [
        { op: 'source', of: SESSION },
        { op: 'toolUses', names: [SHELL_TOOL] },
        { op: 'select', path: 'args.command' },
        { op: 'matches', re: '\\bnpm view ' },
      ],
    },
    relate: [
      {
        id: 'npm-view',
        relation: { op: 'nonEmpty', of: 'npmView' },
        message: 'no npm view precedes this edit',
      },
    ],
  },
};

let repo: CheckRepo;
let repoRoot: string;
let telemetryPath: string;
let git: CheckRepo['git'];
let write: CheckRepo['write'];
let writeConfig: CheckRepo['writeConfig'];

/** Commit the config alone first: loadConfig protects its own file. */
function commitConfig(): void {
  git('add', 'polydeukes.config.json');
  git('commit', '--quiet', '-m', 'config');
}

/** Every row under `label`, as `[event, subject, reason]`. */
function rowsOf(label: string): [string, string, string | undefined][] {
  return readRecords(telemetryPath)
    .records.filter((record) => record.label === label)
    .map((record) => [record.event, record.subject, record.reason]);
}

beforeEach(() => {
  repo = createCheckRepo('pdks-check-command-declarations-');
  ({ repoRoot, telemetryPath, git, write, writeConfig } = repo);
});

afterEach(() => {
  repo.cleanup();
});

describe('covenant check — a forbidden-command declaration on the commit surface', () => {
  it('a staged change leaves no row under the ban and the run exits 0', async () => {
    // Exit 0 is what says the config loaded and the run judged; the empty row set is what
    // says the ban had nothing to observe. A root that fabricates a `command` for a staged
    // change (or a call world beside it) lands a `passed` row for a judgment that never
    // had a command line to read.
    writeConfig({ disciplines: [banEntry] });
    commitConfig();
    write(LIB_A, 'export const x = 1;\n');
    git('add', LIB_A);

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(0);
    expect(rowsOf(BAN_ID)).toEqual([]);
  });
});

describe('covenant check — a precedent declaration on the commit surface', () => {
  it('each matched staged change lands one skipped row with reason supply-pass', async () => {
    // The declaration's own `supply: pass` disposes of the absent session, and the row is
    // the declared limit showing itself. A root that drops history declarations at
    // assembly (the deleted family filter) leaves no row; one that judges them against a
    // noop session lands `advised` on every lib edit.
    writeConfig({ disciplines: [precedentEntry] });
    commitConfig();
    write(LIB_A, 'export const x = 1;\n');
    write(LIB_B, 'export const y = 2;\n');
    git('add', LIB_A, LIB_B);

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(0);
    expect(rowsOf(PRECEDENT_ID).sort()).toEqual([
      ['skipped', LIB_A, SUPPLY_PASS_REASON],
      ['skipped', LIB_B, SUPPLY_PASS_REASON],
    ]);
  });
});
