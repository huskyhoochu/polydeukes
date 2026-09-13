// `pdks explain` renders both surfaces' registration sets without judging.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type AlgebraDeclarationBody, declarationChannels } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CovenantRegistration } from '../src/covenant/dispatch.ts';
import { covenantModule } from '../src/covenant/module.ts';
import {
  assembleChangeSetRegistrations,
  assembleCheckRegistrations,
} from '../src/covenant-check.ts';
import { explain } from '../src/explain.ts';
import { loadConfig } from '../src/load-config.ts';
import { writeConfigAt } from './helpers.ts';

/** The judge module both `explain` and the direct assemblies below judge with — the one
 * static import, so the render and the assembly cannot diverge on which judges exist. */
const realCovenant = covenantModule;

const COMMON_PATHS = ['gate-a', 'gate-b'];
const GIT_ONLY_PATHS = ['gate-c'];

const VOCAB_ID = 'covenant-vocabulary';
const vocabEntry = {
  id: VOCAB_ID,
  why: 'vocabulary is binding',
  declare: {
    mechanism: 'added-only',
    scope: { source: 'target.path', include: ['^lib/', '^src/'], exclude: ['^lib/legacy/'] },
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
const HOOKS_ID = 'hooks-stay-armed';
const hooksEntry = {
  id: HOOKS_ID,
  why: 'the valve must not be cut',
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
const SESSION = 'session';
const MANIFEST_RE = '^manifest\\.json$';
const NPM_VIEW_ID = 'manifest-needs-npm-view';
const npmViewEntry = {
  id: NPM_VIEW_ID,
  declare: {
    mechanism: 'precedent',
    scope: { source: 'target.path', include: [MANIFEST_RE] },
    sources: { [SESSION]: { transcript: true } },
    supply: { [SESSION]: 'pass' },
    extract: {
      npmView: [
        { op: 'source', of: SESSION },
        { op: 'toolUses', names: ['Bash'] },
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
const CONTEXT7_ID = 'manifest-needs-context7';
const context7Entry = {
  id: CONTEXT7_ID,
  why: 'read the docs first',
  declare: {
    mechanism: 'precedent',
    scope: { source: 'target.path', include: [MANIFEST_RE] },
    sources: { [SESSION]: { transcript: true } },
    supply: { [SESSION]: 'pass' },
    extract: {
      docs: [
        { op: 'source', of: SESSION },
        { op: 'toolUses' },
        { op: 'field', name: 'name' },
        { op: 'matches', re: 'context7' },
      ],
    },
    relate: [
      {
        id: 'context7',
        relation: { op: 'nonEmpty', of: 'docs' },
        message: 'no context7 call precedes this edit',
      },
    ],
  },
};

const LIVE_LIKE_DISCIPLINES = [vocabEntry, hooksEntry, npmViewEntry, context7Entry];

const SESSION_HEADER = 'input: call IR (one call, stdin)';
const COMMIT_HEADER = 'input: --diff (change set, stdin)';
const KINDS = ['meta', 'declare', 'skip'] as const;
type Kind = (typeof KINDS)[number];

let repoRoot: string;
let telemetryPath: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'pdks-explain-'));
  telemetryPath = join(repoRoot, 'roi.log');
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

/**
 * Write the fixture config, routing each entry to the list its declaration's channels
 * belong in — every fixture here is either file-shaped or session-only, so the split is
 * `disciplines` against `sessionDisciplines`.
 */
function writeFixtureConfig(entries: unknown[]): void {
  const typed = entries as { declare: AlgebraDeclarationBody }[];
  writeConfigAt(repoRoot, telemetryPath, {
    protectedPaths: COMMON_PATHS,
    adapters: { git: { protectedPaths: GIT_ONLY_PATHS } },
    disciplines: typed.filter((entry) => declarationChannels(entry.declare).length === 0),
    sessionDisciplines: typed.filter((entry) => declarationChannels(entry.declare).length > 0),
  });
}

function surfaceSection(text: string, header: string): string {
  const start = text.indexOf(header);
  expect(start, `surface header missing: ${header}`).toBeGreaterThanOrEqual(0);
  const rest = text.slice(start + header.length);
  const next = rest.indexOf('\ninput:');
  return next === -1 ? rest : rest.slice(0, next);
}

function kindLabelRows(section: string): [Kind, string][] {
  const rows: [Kind, string][] = [];
  for (const line of section.split('\n')) {
    const match = /^\s+(meta|judge|declare|skip)\s+(\S+)/.exec(line);
    if (match !== null) rows.push([match[1] as Kind, match[2]]);
  }
  return rows;
}

function summary(section: string): Record<string, number> {
  const match = /registrations (\d+) · declare (\d+) · skip (\d+) · meta (\d+)/.exec(section);
  expect(match, 'summary line missing').not.toBeNull();
  const [, registrations, declare, skip, meta] = match as RegExpExecArray;
  return {
    registrations: Number(registrations),
    declare: Number(declare),
    skip: Number(skip),
    meta: Number(meta),
  };
}

function linesOf(section: string, kind: Kind, label: string): string[] {
  return section
    .split('\n')
    .filter((line) => new RegExp(`^\\s+${kind}\\s+${label}(\\s|$)`).test(line));
}

function lineOf(text: string, header: string, kind: Kind, label: string): string {
  return linesOf(surfaceSection(text, header), kind, label).join('\n');
}

describe("explain renders the roots' own assembly", () => {
  it('renders the change-set surface in the exact label order assembleChangeSetRegistrations returns', async () => {
    writeFixtureConfig(LIVE_LIKE_DISCIPLINES);
    const { config } = loadConfig({ rootDir: repoRoot });

    const expected = assembleChangeSetRegistrations({
      surface: 'changeSet',
      config,
      rootDir: repoRoot,
      covenant: realCovenant,
    }).map((registration: CovenantRegistration) => registration.label);
    const { text } = await explain({ repoRoot });
    const rendered = kindLabelRows(surfaceSection(text, COMMIT_HEADER)).map(([, label]) => label);

    expect(rendered).toEqual(expected);
  });

  it('renders the session surface in the exact label order the session assembly returns', async () => {
    writeFixtureConfig(LIVE_LIKE_DISCIPLINES);
    const { config } = loadConfig({ rootDir: repoRoot });

    const expected = assembleCheckRegistrations({
      surface: 'session',
      config,
      rootDir: repoRoot,
      covenant: realCovenant,
      session: {
        evidencePath: join(repoRoot, 'transcript.jsonl'),
        userMessages: [],
        toolCalls: [],
      },
    }).map((registration: CovenantRegistration) => registration.label);
    const { text } = await explain({ repoRoot });
    const rendered = kindLabelRows(surfaceSection(text, SESSION_HEADER)).map(([, label]) => label);

    expect(rendered).toEqual(expected);
  });
});

describe('the skip reasons surface with their entry', () => {
  it('renders a declare entry once, with no shell-skip arm beside it', async () => {
    // The shell arm exists only where a shell roster does, and a roster is what an adapter
    // loads onto a call; a renderer that reads the config alone has none to name, so the
    // entry renders as its judgment and nothing else.
    writeFixtureConfig([vocabEntry]);

    const session = surfaceSection((await explain({ repoRoot })).text, SESSION_HEADER);

    expect(linesOf(session, 'declare', VOCAB_ID)).toHaveLength(1);
    expect(linesOf(session, 'skip', VOCAB_ID)).toHaveLength(0);
  });

  it('renders the shell-unjudgeable backstop with its reason on both surfaces', async () => {
    writeFixtureConfig([]);

    const { text } = await explain({ repoRoot });

    for (const header of [SESSION_HEADER, COMMIT_HEADER]) {
      expect(lineOf(text, header, 'skip', 'shell-unjudgeable')).toContain(
        'write target this layer cannot determine',
      );
    }
  });

  it('session surface: a history declaration renders as declare, not as a skip', async () => {
    // The session model carries a transcript, so the declaration that reads it is a
    // rendered judgment rather than a channel the surface does not have.
    writeFixtureConfig([npmViewEntry, context7Entry]);

    const session = surfaceSection((await explain({ repoRoot })).text, SESSION_HEADER);

    expect(linesOf(session, 'declare', NPM_VIEW_ID)).toHaveLength(1);
    expect(linesOf(session, 'declare', CONTEXT7_ID)).toHaveLength(1);
    expect(session).not.toContain('no session transcript to read');
  });
});

describe('surface placement', () => {
  it('self-mod counts the common list (+config) on both surfaces — one list, one count', async () => {
    // The change-set surface reads the same protected list the session one does; a second,
    // commit-only list would make the two counts disagree.
    writeFixtureConfig([]);

    const { text } = await explain({ repoRoot });

    expect(lineOf(text, SESSION_HEADER, 'meta', 'self-mod')).toMatch(/paths 3\b/);
    expect(lineOf(text, COMMIT_HEADER, 'meta', 'self-mod')).toMatch(/paths 3\b/);
  });

  it('transcript-mod exists only on the session surface, and shell-mod on neither', async () => {
    // transcript-mod follows the session's evidence path, which is the one session fact a
    // config reader knows. shell-mod follows the roster, which it does not, so no surface
    // rendered from the config alone carries it.
    writeFixtureConfig([]);

    const { text } = await explain({ repoRoot });
    const session = surfaceSection(text, SESSION_HEADER);
    const commit = surfaceSection(text, COMMIT_HEADER);

    expect(linesOf(session, 'meta', 'transcript-mod')).toHaveLength(1);
    expect(linesOf(commit, 'meta', 'transcript-mod')).toHaveLength(0);
    expect(linesOf(session, 'meta', 'shell-mod')).toHaveLength(0);
    expect(linesOf(commit, 'meta', 'shell-mod')).toHaveLength(0);
  });
});

describe('routing scope and the why mark', () => {
  it('renders a scoped history declaration with its mechanism and its scope', async () => {
    writeFixtureConfig([npmViewEntry, context7Entry]);

    const { text } = await explain({ repoRoot });

    const line = lineOf(text, SESSION_HEADER, 'declare', NPM_VIEW_ID);
    expect(line).toContain('precedent');
    expect(line).toContain('scope target.path');
    expect(lineOf(text, SESSION_HEADER, 'declare', CONTEXT7_ID)).toContain('precedent');
  });
});

describe('the tallies are the rendered lines', () => {
  it('a multi-entry config: registrations N equals the counted registration lines on each surface', async () => {
    writeFixtureConfig(LIVE_LIKE_DISCIPLINES);

    const { text } = await explain({ repoRoot });

    for (const header of [SESSION_HEADER, COMMIT_HEADER]) {
      const section = surfaceSection(text, header);
      const rows = kindLabelRows(section);
      const count = (kind: Kind) => rows.filter(([k]) => k === kind).length;
      expect(summary(section)).toEqual({
        registrations: count('meta') + count('declare') + count('skip'),
        declare: count('declare'),
        skip: count('skip'),
        meta: count('meta'),
      });
    }
  });

  it('disciplines: [] — the smallest assembly is 3 session rows and 2 commit rows', async () => {
    writeFixtureConfig([]);

    const { text } = await explain({ repoRoot });

    expect(summary(surfaceSection(text, SESSION_HEADER))).toEqual({
      registrations: 3,
      declare: 0,
      skip: 1,
      meta: 2,
    });
    expect(summary(surfaceSection(text, COMMIT_HEADER))).toEqual({
      registrations: 2,
      declare: 0,
      skip: 1,
      meta: 1,
    });
  });

  it('the multi-entry config: absolute tallies differ per surface', async () => {
    writeFixtureConfig(LIVE_LIKE_DISCIPLINES);

    const { text } = await explain({ repoRoot });

    expect(summary(surfaceSection(text, SESSION_HEADER))).toEqual({
      registrations: 7,
      declare: 4,
      skip: 1,
      meta: 2,
    });
    // The change-set surface compiles the shared list alone: the three session-only
    // entries stand only where their channels exist.
    expect(summary(surfaceSection(text, COMMIT_HEADER))).toEqual({
      registrations: 3,
      declare: 1,
      skip: 1,
      meta: 1,
    });
  });

  it('names the config file in the header and never spells the telemetry event', async () => {
    writeFixtureConfig(LIVE_LIKE_DISCIPLINES);

    const { text } = await explain({ repoRoot });

    expect(text.split('\n')[0]).toContain('pdks explain — ');
    expect(text.split('\n')[0]).toContain('polydeukes.config.json');
    expect(text).not.toMatch(/\bskipped\b/);
  });
});

describe('the live config format', () => {
  it('reads a yaml config and names it in the header', async () => {
    writeFileSync(
      join(repoRoot, 'polydeukes.config.yaml'),
      [
        'languages:',
        '  typescript:',
        "    productionGlob: 'src/**/*.ts'",
        "    testCmd: 'echo {scope}'",
        'disciplines:',
        `  - id: '${VOCAB_ID}'`,
        '    declare:',
        "      mechanism: 'added-only'",
        "      supply: { pre: 'empty', post: 'empty' }",
        '      extract:',
        '        after:',
        "          - { op: 'source', of: 'post' }",
        "          - { op: 'lines' }",
        "          - { op: 'keyByPattern', re: '(FIXME)' }",
        '      relate:',
        "        - id: 'nothing-added'",
        "          relation: { op: 'empty', of: 'after' }",
        "          message: 'adds {key}'",
        '',
      ].join('\n'),
    );

    const { text } = await explain({ repoRoot });

    expect(text.split('\n')[0]).toContain('polydeukes.config.yaml');
    expect(lineOf(text, COMMIT_HEADER, 'declare', VOCAB_ID)).toContain('added-only');
  });
});

describe('failure shape — explain observes, never judges', () => {
  it('writes no telemetry row and no baseline file', async () => {
    writeFixtureConfig(LIVE_LIKE_DISCIPLINES);

    await explain({ repoRoot });

    expect(existsSync(telemetryPath)).toBe(false);
    expect(existsSync(join(repoRoot, '.polydeukes', 'baseline.json'))).toBe(false);
    expect(existsSync(join(repoRoot, '.polydeukes', 'roi.log'))).toBe(false);
  });

  it('rejects naming the config when the repository has none', async () => {
    // `rejects`, never a synchronous toThrow: explain is async since it imports the
    // covenant dist, and a wrapped call would resolve the assertion unconditionally while
    // the rejection escaped as an unhandled promise.
    await expect(explain({ repoRoot })).rejects.toThrow(/config/);
  });
});

describe('explain stays off the covenant check load path', () => {
  it('bin.ts imports ./explain only dynamically', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../src/bin.ts'), 'utf-8');

    expect(source).toContain("import('./explain.ts')");
    expect(source).not.toMatch(/^import\s[^;]*['"]\.\/explain(\.js)?['"]/m);
  });
});

describe('each surface header names the two lists it compiles, with their counts', () => {
  // Two shared entries against one entry per surface list, so the two counts differ and a
  // header printing one number for both, or the other surface's list name, lands here.
  const SECOND_SHARED_ID = 'comments-state-facts';
  const secondSharedEntry = { ...vocabEntry, id: SECOND_SHARED_ID };
  const CHANGE_SET_ID = 'docs-stay-bilingual';
  const changeSetEntry = {
    id: CHANGE_SET_ID,
    declare: {
      mechanism: 'companion',
      scope: { source: 'target.path', include: ['\\.md$'] },
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

  function writeThreeLists(): void {
    writeConfigAt(repoRoot, telemetryPath, {
      protectedPaths: COMMON_PATHS,
      disciplines: [vocabEntry, secondSharedEntry],
      sessionDisciplines: [hooksEntry],
      changeSetDisciplines: [changeSetEntry],
    });
  }

  it('the session header says `disciplines 2 · sessionDisciplines 1` and never the change-set list', async () => {
    writeThreeLists();

    const section = surfaceSection((await explain({ repoRoot })).text, SESSION_HEADER);

    expect(section).toMatch(/disciplines 2 · sessionDisciplines 1/);
    expect(section).not.toContain('changeSetDisciplines');
    expect(linesOf(section, 'declare', HOOKS_ID)).toHaveLength(1);
    expect(kindLabelRows(section).map(([, label]) => label)).not.toContain(CHANGE_SET_ID);
  });

  it('the change-set header says `disciplines 2 · changeSetDisciplines 1` and never the session list', async () => {
    writeThreeLists();

    const section = surfaceSection((await explain({ repoRoot })).text, COMMIT_HEADER);

    expect(section).toMatch(/disciplines 2 · changeSetDisciplines 1/);
    expect(section).not.toContain('sessionDisciplines');
    expect(linesOf(section, 'declare', CHANGE_SET_ID)).toHaveLength(1);
    expect(kindLabelRows(section).map(([, label]) => label)).not.toContain(HOOKS_ID);
  });

  it('an absent surface list prints as 0, not as a missing name', async () => {
    // The header is where a reader learns the list exists; dropping the name when the
    // list is absent hides the grammar from exactly the config that has not adopted it.
    writeFixtureConfig([vocabEntry]);

    const { text } = await explain({ repoRoot });

    expect(surfaceSection(text, SESSION_HEADER)).toMatch(/disciplines 1 · sessionDisciplines 0/);
    expect(surfaceSection(text, COMMIT_HEADER)).toMatch(/disciplines 1 · changeSetDisciplines 0/);
  });
});
