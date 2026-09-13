import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRecords } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// A `file` source naming a path that is itself in the change set. The session surface
// hands the declaration the call's whole `post`; a diff-translated change carries only the
// hunk's `+` lines as `post`, so on the change-set surface the declaration must read the
// file from the tree — a hunk fragment handed to `json` is "not valid JSON" and the run
// fails closed on a commit that changed nothing the declaration disagrees with.
import { runCovenantCheck } from '../src/covenant-check.ts';
import { covenantInputFromUnifiedDiff } from '../src/diff-ir.ts';
import { type CheckRepo, createCheckRepo } from './helpers.ts';

const PAIRING_ID = 'names-agree';
const ENTRY = 'schema/entry.json';
const GRAMMAR = 'schema/grammar.json';
const BASE = JSON.stringify({ names: ['alpha', 'beta'], note: 'base' }, null, 2);
const EDITED = JSON.stringify({ names: ['alpha', 'beta'], note: 'edited' }, null, 2);
const DISAGREEING = JSON.stringify({ names: ['alpha', 'gamma'], note: 'edited' }, null, 2);

/** The live `schema-enums-agree` shape: two `file` sources compared by `equal`. */
const pairingEntry = {
  id: PAIRING_ID,
  declare: {
    mechanism: 'pairing',
    scope: { source: 'target.path', include: ['^schema/'] },
    sources: { entry: { file: ENTRY }, grammar: { file: GRAMMAR } },
    extract: {
      entryNames: [{ op: 'source', of: 'entry' }, { op: 'json' }, { op: 'select', path: 'names' }],
      grammarNames: [
        { op: 'source', of: 'grammar' },
        { op: 'json' },
        { op: 'select', path: 'names' },
      ],
    },
    relate: [
      {
        id: 'same-names',
        relation: { op: 'equal', of: ['entryNames', 'grammarNames'] },
        message: 'names differ: {value}',
      },
    ],
  },
};

let repo: CheckRepo;
let logDir: string;
let telemetryPath: string;

beforeEach(() => {
  repo = createCheckRepo('pdks-change-set-file-source-');
  logDir = mkdtempSync(join(tmpdir(), 'pdks-change-set-file-source-log-'));
  telemetryPath = join(logDir, 'roi.log');
  repo.writeConfig({ disciplines: [pairingEntry] });
  repo.write(ENTRY, BASE);
  repo.write(GRAMMAR, BASE);
  repo.git('add', '-A');
  repo.git('commit', '--quiet', '-m', 'baseline');
});

afterEach(() => {
  repo.cleanup();
  rmSync(logDir, { recursive: true, force: true });
});

async function checkStaged(): Promise<{ exitCode: number }> {
  return runCovenantCheck({
    surface: 'changeSet',
    repoRoot: repo.repoRoot,
    input: covenantInputFromUnifiedDiff({ text: repo.git('diff', '--cached') }),
    telemetryPath,
  });
}

function rows(): [string, string][] {
  return readRecords(telemetryPath)
    .records.filter((record) => record.label === PAIRING_ID)
    .map((record) => [record.event, record.subject]);
}

describe('a file source that is also a staged change reads the tree on the change-set surface', () => {
  it('a one-line edit to the entry file that keeps the names equal passes — the hunk is not the file', async () => {
    repo.write(ENTRY, EDITED);
    repo.git('add', ENTRY);

    const result = await checkStaged();

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([['passed', ENTRY]]);
  });

  it('a one-line edit that makes the names differ lands advised, judged over the whole file', async () => {
    repo.write(ENTRY, DISAGREEING);
    repo.git('add', ENTRY);

    const result = await checkStaged();

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([['advised', ENTRY]]);
  });
});

describe('a created file is whole in its diff', () => {
  it('a staged create the tree no longer holds is judged from the diff, not failed closed', async () => {
    // `git diff HEAD~1 HEAD`, a PR diff from CI, a hand-made diff: the change set's producer
    // need not be this working tree. A create's `+` lines are the file, so the binding reads
    // them even where the tree has nothing at the path.
    const created = 'schema/new.json';
    repo.writeConfig({
      disciplines: [
        {
          ...pairingEntry,
          declare: {
            ...pairingEntry.declare,
            sources: { entry: { file: created }, grammar: { file: GRAMMAR } },
          },
        },
      ],
    });
    repo.write(created, BASE);
    repo.git('add', created);
    const diff = repo.git('diff', '--cached');
    rmSync(join(repo.repoRoot, created));

    const result = await runCovenantCheck({
      surface: 'changeSet',
      repoRoot: repo.repoRoot,
      input: covenantInputFromUnifiedDiff({ text: diff }),
      telemetryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([['passed', created]]);
  });
});
