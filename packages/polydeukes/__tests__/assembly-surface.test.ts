import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { CovenantInput } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { covenantModule } from '../src/covenant/module.ts';
import { assembleCheckRegistrations } from '../src/covenant-check.ts';
import { loadConfig } from '../src/load-config.ts';
import { writeConfigAt } from './helpers.ts';

// The surface is the input mode. `assembleCheckRegistrations` takes `surface: 'session' |
// 'changeSet'` and compiles `disciplines` plus the one list that surface observes; nothing
// about the IR — a `session` key present or absent — chooses the list. The text oracles
// below pin the two consequences in source: the compiler no longer carries a change-set
// flag or its skip branch, and the bin passes `'changeSet'` only under `--diff`.

const umbrellaSrc = resolve(import.meta.dirname, '../src');

/** Injected fixture values — ids and the paths the fixture entries scope on. */
const SHARED_ID = 'shared-vocabulary';
const SESSION_ID = 'session-only-command';
const CHANGE_SET_ID = 'change-set-only-pairing';
const SHARED_SCOPE = '^lib/';
const DOC_SCOPE = '\\.md$';

const sharedEntry = {
  id: SHARED_ID,
  declare: {
    mechanism: 'added-only',
    scope: { source: 'target.path', include: [SHARED_SCOPE] },
    supply: { pre: 'empty', post: 'empty' },
    extract: {
      before: [{ op: 'source', of: 'pre' }, { op: 'lines' }, { op: 'keyByPattern', re: '(TODO)' }],
      after: [{ op: 'source', of: 'post' }, { op: 'lines' }, { op: 'keyByPattern', re: '(TODO)' }],
      added: [{ op: 'onlyIn', of: 'after', notIn: 'before' }],
    },
    relate: [
      { id: 'nothing-added', relation: { op: 'empty', of: 'added' }, message: 'adds {key}' },
    ],
  },
};
const sessionEntry = {
  id: SESSION_ID,
  declare: {
    mechanism: 'forbidden-command',
    scope: { source: 'command' },
    extract: {
      hits: [
        { op: 'source', of: 'command' },
        { op: 'lines' },
        { op: 'matches', re: 'rm -rf hooks' },
      ],
    },
    relate: [{ id: 'no-hit', relation: { op: 'empty', of: 'hits' }, message: '{value}' }],
  },
};
const changeSetEntry = {
  id: CHANGE_SET_ID,
  declare: {
    mechanism: 'companion',
    scope: { source: 'target.path', include: [DOC_SCOPE] },
    extract: {
      en: [
        { op: 'source', of: 'target.path' },
        { op: 'keyByPattern', re: '^(.+?)(?<!\\.ko)\\.md$' },
      ],
      koChanged: [
        { op: 'source', of: 'changes' },
        { op: 'items' },
        { op: 'keyByPattern', re: '^(.+)\\.ko\\.md$' },
      ],
    },
    relate: [
      {
        id: 'ko-follows',
        relation: { op: 'implies', of: 'en', requires: 'koChanged' },
        message: 'm',
      },
    ],
  },
};

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'pdks-assembly-surface-'));
  writeConfigAt(repoRoot, join(repoRoot, 'roi.log'), {
    disciplines: [sharedEntry],
    sessionDisciplines: [sessionEntry],
    changeSetDisciplines: [changeSetEntry],
  });
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

function labelsFor(surface: 'session' | 'changeSet', session?: CovenantInput['session']): string[] {
  const { config } = loadConfig({ rootDir: repoRoot });
  return assembleCheckRegistrations({
    config,
    rootDir: repoRoot,
    covenant: covenantModule,
    surface,
    ...(session === undefined ? {} : { session }),
  }).map((registration) => registration.label);
}

describe('assembleCheckRegistrations — the surface picks the list', () => {
  it("'session' compiles disciplines + sessionDisciplines and never the change-set entry", () => {
    // Compiling the change-set entry here is the defect this split removes: an IR-mode
    // call with no `changes` channel would judge a companion over an absent source.
    const labels = labelsFor('session', {
      evidencePath: join(repoRoot, 'transcript.jsonl'),
      userMessages: [],
      toolCalls: [],
    });

    expect(labels).toContain(SHARED_ID);
    expect(labels).toContain(SESSION_ID);
    expect(labels).not.toContain(CHANGE_SET_ID);
  });

  it("'changeSet' compiles disciplines + changeSetDisciplines and never the session entry", () => {
    // The mirror: a command-line entry on the change-set surface has no command line to
    // read, and a registration for it is a row (or a pass) about nothing.
    const labels = labelsFor('changeSet');

    expect(labels).toContain(SHARED_ID);
    expect(labels).toContain(CHANGE_SET_ID);
    expect(labels).not.toContain(SESSION_ID);
  });

  it("'session' with no `session` key on the input still leaves the change-set entry out", () => {
    // The Grok shape: that host carries no `session` key. Inferring the surface from the
    // key's absence assembled such a call as the change-set surface — one `.md` edit
    // could then be reported as a bilingual-docs break.
    const labels = labelsFor('session');

    expect(labels).toContain(SESSION_ID);
    expect(labels).not.toContain(CHANGE_SET_ID);
  });

  it('the shared list compiles before the surface list on both surfaces', () => {
    // Registration order is the row order and the `explain` order; the shared entries
    // come first so the two surfaces' shared prefix reads the same.
    const session = labelsFor('session');
    const changeSet = labelsFor('changeSet');

    expect(session.indexOf(SHARED_ID)).toBeLessThan(session.indexOf(SESSION_ID));
    expect(changeSet.indexOf(SHARED_ID)).toBeLessThan(changeSet.indexOf(CHANGE_SET_ID));
  });

  it('each surface registers each of its discipline ids exactly once', () => {
    // A surface that concatenates all three lists, or the shared list twice, lands here.
    for (const [surface, own] of [
      ['session', SESSION_ID],
      ['changeSet', CHANGE_SET_ID],
    ] as const) {
      const labels = labelsFor(surface);
      expect(labels.filter((label) => label === SHARED_ID)).toHaveLength(1);
      expect(labels.filter((label) => label === own)).toHaveLength(1);
    }
  });
});

describe('assembleCheckRegistrations — a config missing one or both surface lists', () => {
  it('disciplines alone assembles on both surfaces with exactly the shared id', () => {
    // The config every consumer has today. An assembly that indexes an absent list throws
    // and fails every call closed; one that falls back to `disciplines` for the missing
    // list compiles it twice.
    writeConfigAt(repoRoot, join(repoRoot, 'roi.log'), { disciplines: [sharedEntry] });

    for (const surface of ['session', 'changeSet'] as const) {
      const labels = labelsFor(surface).filter((label) =>
        [SHARED_ID, SESSION_ID, CHANGE_SET_ID].includes(label),
      );
      expect(labels, surface).toEqual([SHARED_ID]);
    }
  });

  it('sessionDisciplines alone: the session surface has its id, the change-set surface has no discipline', () => {
    // No `disciplines` key at all — an assembly that reads `config.disciplines.length`
    // before checking presence throws here, and one that widens the session list onto
    // both surfaces registers a command-line entry where there is no command line.
    writeConfigAt(repoRoot, join(repoRoot, 'roi.log'), { sessionDisciplines: [sessionEntry] });

    const session = labelsFor('session');
    const changeSet = labelsFor('changeSet');

    expect(session).toContain(SESSION_ID);
    expect(
      changeSet.filter((label) => [SHARED_ID, SESSION_ID, CHANGE_SET_ID].includes(label)),
    ).toEqual([]);
  });
});

const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const walkTs = (dir: string): string[] => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walkTs(path);
    return name.endsWith('.ts') ? [path] : [];
  });
};

/** `file: count` for every source file under `dir` whose comment-stripped text matches `needle`. */
function carriers(dir: string, needle: RegExp): string[] {
  const found: string[] = [];
  for (const file of walkTs(dir)) {
    const count = stripComments(readFileSync(file, 'utf-8')).match(needle)?.length ?? 0;
    if (count > 0) found.push(`${file.slice(dir.length + 1)}: ${count}`);
  }
  return found.sort();
}

describe('the change-set flag and its second channel derivation are gone', () => {
  it.each(['observesChangeSet', 'readsChangeSet'])('`%s` occurs nowhere under src', (name) => {
    // The flag drove a skip branch no call can reach once the change-set list is compiled
    // only under `--diff`; the second derivation answered the same question core's
    // `declarationChannels` answers, and two answers drift.
    const found = carriers(umbrellaSrc, new RegExp(`\\b${name}\\b`, 'g'));
    expect(found, `${name} in umbrella src:\n${found.join('\n')}`).toEqual([]);
  });
});

describe('bin.ts passes the surface by input mode', () => {
  it("names both literals, and 'changeSet' only on a line that reads the --diff flag", () => {
    // A bin that hard-codes one surface judges every diff as a session or every call as a
    // change set; one that picks by anything but `--diff` re-introduces inference.
    const source = stripComments(readFileSync(join(umbrellaSrc, 'bin.ts'), 'utf-8'));

    expect(source).toContain("'changeSet'");
    expect(source).toContain("'session'");
    const changeSetLines = source.split('\n').filter((line) => line.includes("'changeSet'"));
    expect(changeSetLines.length).toBeGreaterThan(0);
    for (const line of changeSetLines) expect(line).toMatch(/diffMode/);
  });
});
