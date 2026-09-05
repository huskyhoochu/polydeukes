// `pdks explain` renders both surfaces' registration sets without judging.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { CovenantRegistration } from '@polydeukes/covenant';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assembleSessionRegistrations } from '../src/claude-code-hook.ts';
import { assembleCommitRegistrations } from '../src/covenant-check.ts';
import { loadCovenantModule } from '../src/covenant-module.ts';
import { explain } from '../src/explain.ts';
import { loadConfig } from '../src/load-config.ts';
import { REAL_COVENANT_DIST, writeConfigAt } from './helpers.ts';

/** The covenant module both `explain` and the direct assemblies below judge with — loaded
 * from the real dist so the render and the assembly cannot diverge on which judges exist. */
const realCovenant = await loadCovenantModule(REAL_COVENANT_DIST);

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

const SESSION_HEADER = 'surface: session (claude-code hook)';
const COMMIT_HEADER = 'surface: commit (git pre-commit)';
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

function writeFixtureConfig(disciplines: unknown[]): void {
  writeConfigAt(repoRoot, telemetryPath, {
    protectedPaths: COMMON_PATHS,
    adapters: { git: { protectedPaths: GIT_ONLY_PATHS } },
    disciplines,
  });
}

function surfaceSection(text: string, header: string): string {
  const start = text.indexOf(header);
  expect(start, `surface header missing: ${header}`).toBeGreaterThanOrEqual(0);
  const rest = text.slice(start + header.length);
  const next = rest.indexOf('\nsurface:');
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
  it('renders the commit surface in the exact label order assembleCommitRegistrations returns', async () => {
    writeFixtureConfig(LIVE_LIKE_DISCIPLINES);
    const { config } = loadConfig({ rootDir: repoRoot });

    const expected = assembleCommitRegistrations({
      config,
      rootDir: repoRoot,
      covenant: realCovenant,
    }).map((registration: CovenantRegistration) => registration.label);
    const { text } = await explain({ repoRoot });
    const rendered = kindLabelRows(surfaceSection(text, COMMIT_HEADER)).map(([, label]) => label);

    expect(rendered).toEqual(expected);
  });

  it('renders the session surface in the exact label order assembleSessionRegistrations returns', async () => {
    writeFixtureConfig(LIVE_LIKE_DISCIPLINES);
    const { config } = loadConfig({ rootDir: repoRoot });

    const expected = assembleSessionRegistrations({
      config,
      rootDir: repoRoot,
      covenant: realCovenant,
      transcriptPath: join(repoRoot, 'session.jsonl'),
    }).map((registration: CovenantRegistration) => registration.label);
    const { text } = await explain({ repoRoot });
    const rendered = kindLabelRows(surfaceSection(text, SESSION_HEADER)).map(([, label]) => label);

    expect(rendered).toEqual(expected);
  });
});

describe('the skip reasons surface with their entry', () => {
  it("renders a declare entry's shell-skip arm under the entry id with its reason", async () => {
    writeFixtureConfig([vocabEntry]);

    const session = surfaceSection((await explain({ repoRoot })).text, SESSION_HEADER);

    expect(linesOf(session, 'declare', VOCAB_ID)).toHaveLength(1);
    expect(linesOf(session, 'skip', VOCAB_ID).join('\n')).toContain('shell write in scope');
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
  it('renders a command-reading declaration on both surfaces', async () => {
    // The commit surface observes no shell call, so the declaration lands no row there at
    // judgment time — but the entry is still assembled, and explain renders the table that
    // would judge rather than the rows a run produced.
    writeFixtureConfig([hooksEntry]);

    const { text } = await explain({ repoRoot });

    for (const header of [SESSION_HEADER, COMMIT_HEADER]) {
      expect(linesOf(surfaceSection(text, header), 'declare', HOOKS_ID)).toHaveLength(1);
    }
  });

  it('self-mod counts the common list (+config) on session and the git union on commit', async () => {
    writeFixtureConfig([]);

    const { text } = await explain({ repoRoot });

    expect(lineOf(text, SESSION_HEADER, 'meta', 'self-mod')).toMatch(/paths 3\b/);
    expect(lineOf(text, COMMIT_HEADER, 'meta', 'self-mod')).toMatch(/paths 4\b/);
  });

  it('shell-mod and transcript-mod exist only on the session surface', async () => {
    writeFixtureConfig([]);

    const { text } = await explain({ repoRoot });
    const session = surfaceSection(text, SESSION_HEADER);
    const commit = surfaceSection(text, COMMIT_HEADER);

    expect(linesOf(session, 'meta', 'shell-mod')).toHaveLength(1);
    expect(linesOf(session, 'meta', 'transcript-mod')).toHaveLength(1);
    expect(linesOf(commit, 'meta', 'shell-mod')).toHaveLength(0);
    expect(linesOf(commit, 'meta', 'transcript-mod')).toHaveLength(0);
  });
});

describe('routing scope and the why mark', () => {
  it('renders a command-scoped declaration with its mechanism coordinate', async () => {
    writeFixtureConfig([hooksEntry]);

    const line = lineOf((await explain({ repoRoot })).text, SESSION_HEADER, 'declare', HOOKS_ID);

    expect(line).toContain('forbidden-command');
  });

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

  it('disciplines: [] — the smallest assembly is 4 session rows and 2 commit rows', async () => {
    writeFixtureConfig([]);

    const { text } = await explain({ repoRoot });

    expect(summary(surfaceSection(text, SESSION_HEADER))).toEqual({
      registrations: 4,
      declare: 0,
      skip: 1,
      meta: 3,
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
      registrations: 11,
      declare: 4,
      skip: 4,
      meta: 3,
    });
    expect(summary(surfaceSection(text, COMMIT_HEADER))).toEqual({
      registrations: 6,
      declare: 4,
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

describe('the commit surface names its enforce level', () => {
  it('renders enforce: block by default and enforce: advise when the namespace says so', async () => {
    writeFixtureConfig([]);
    expect(surfaceSection((await explain({ repoRoot })).text, COMMIT_HEADER)).toContain(
      'enforce: block',
    );

    writeConfigAt(repoRoot, telemetryPath, {
      protectedPaths: COMMON_PATHS,
      adapters: { git: { enforce: 'advise', protectedPaths: GIT_ONLY_PATHS } },
      disciplines: [],
    });
    expect(surfaceSection((await explain({ repoRoot })).text, COMMIT_HEADER)).toContain(
      'enforce: advise',
    );
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

describe('the roots assemble through the extracted functions', () => {
  it.each([
    ['claude-code-hook.ts', 'assembleSessionRegistrations'],
    ['covenant-check.ts', 'assembleCommitRegistrations'],
  ])('%s compiles disciplines in exactly one place and the root calls %s', (file, fn) => {
    const source = readFileSync(resolve(import.meta.dirname, `../src/${file}`), 'utf-8');

    expect(source.match(/compileDisciplineRegistrations\(/g)).toHaveLength(1);
    expect(source.match(new RegExp(`${fn}\\(`, 'g'))?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});

describe('explain stays off the covenant check load path', () => {
  it('bin.ts imports ./explain only dynamically', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../src/bin.ts'), 'utf-8');

    expect(source).toContain("import('./explain.ts')");
    expect(source).not.toMatch(/^import\s[^;]*['"]\.\/explain(\.js)?['"]/m);
  });
});
