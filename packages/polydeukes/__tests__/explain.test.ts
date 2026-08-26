// CLI-01 — `pdks explain` renders both surfaces' registration sets without judging.
// Contract: explain({ repoRoot }) → { text }, throws on any config failure;
// assembleCommitRegistrations / assembleSessionRegistrations export each root's assembly.
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
import { REAL_COVENANT_DIST, writeConfigAt } from './helpers';

/** The covenant module both `explain` and the direct assemblies below judge with — loaded
 * from the real dist so the render and the assembly cannot diverge on which judges exist. */
const realCovenant = await loadCovenantModule(REAL_COVENANT_DIST);

const COMMON_PATHS = ['gate-a', 'gate-b'];
const GIT_ONLY_PATHS = ['gate-c'];

const VOCAB_ID = 'covenant-vocabulary';
const vocabEntry = {
  id: VOCAB_ID,
  why: 'vocabulary is binding',
  in: ['lib/**', 'src/**'],
  except: 'lib/legacy/**',
  forbid: 'TODO',
};
const ANY_FILE_ID = 'no-fixme-anywhere';
const anyFileEntry = { id: ANY_FILE_ID, forbid: 'FIXME' };
const CHANGELOG_ID = 'changelog-immutable';
const changelogEntry = {
  id: CHANGELOG_ID,
  why: 'history is append-only',
  immutable: 'CHANGELOG.md',
};
const HOOKS_ID = 'hooks-stay-armed';
const hooksEntry = {
  id: HOOKS_ID,
  why: 'the valve must not be cut',
  forbidCommand: 'rm -rf hooks',
};
const NPM_VIEW_ID = 'manifest-needs-npm-view';
const npmViewEntry = {
  id: NPM_VIEW_ID,
  in: 'manifest.json',
  requirePrecedent: { command: 'npm view ' },
};
const CONTEXT7_ID = 'manifest-needs-context7';
const context7Entry = {
  id: CONTEXT7_ID,
  why: 'read the docs first',
  in: 'manifest.json',
  requirePrecedent: { tool: 'context7' },
};

const LIVE_LIKE_DISCIPLINES = [
  vocabEntry,
  anyFileEntry,
  changelogEntry,
  hooksEntry,
  npmViewEntry,
  context7Entry,
];

const SESSION_HEADER = 'surface: session (claude-code hook)';
const COMMIT_HEADER = 'surface: commit (git pre-commit)';
const KINDS = ['meta', 'judge', 'skip', 'excluded'] as const;
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
    const match = /^\s+(meta|judge|skip|excluded)\s+(\S+)/.exec(line);
    if (match !== null) rows.push([match[1] as Kind, match[2]]);
  }
  return rows;
}

function summary(section: string): Record<string, number> {
  const match =
    /registrations (\d+) · judged (\d+) · skip (\d+) · meta (\d+) · excluded (\d+)/.exec(section);
  expect(match, 'summary line missing').not.toBeNull();
  const [, registrations, judged, skip, meta, excluded] = match as RegExpExecArray;
  return {
    registrations: Number(registrations),
    judged: Number(judged),
    skip: Number(skip),
    meta: Number(meta),
    excluded: Number(excluded),
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

describe("CLI-01 §7 invariant 1 / AC-2 — explain renders the roots' own assembly", () => {
  it('renders the commit surface in the exact label order assembleCommitRegistrations returns', async () => {
    writeFixtureConfig(LIVE_LIKE_DISCIPLINES);
    const { config } = loadConfig(repoRoot);

    const expected = assembleCommitRegistrations({
      config,
      rootDir: repoRoot,
      covenant: realCovenant,
    }).map((registration: CovenantRegistration) => registration.label);
    const { text } = await explain({ repoRoot });
    const rendered = kindLabelRows(surfaceSection(text, COMMIT_HEADER))
      .filter(([kind]) => kind !== 'excluded')
      .map(([, label]) => label);

    expect(rendered).toEqual(expected);
  });

  it('renders the session surface in the exact label order assembleSessionRegistrations returns', async () => {
    writeFixtureConfig(LIVE_LIKE_DISCIPLINES);
    const { config } = loadConfig(repoRoot);

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

describe('CLI-01 AC-3 — the four skip reasons surface with their entry', () => {
  it('commit surface: a requirePrecedent command entry skips with the absent-transcript reason', async () => {
    writeFixtureConfig([npmViewEntry]);

    const { text } = await explain({ repoRoot });

    expect(lineOf(text, COMMIT_HEADER, 'skip', NPM_VIEW_ID)).toContain(
      'no session transcript to read',
    );
  });

  it('commit surface: a requirePrecedent tool entry skips with the absent-evaluator reason', async () => {
    writeFixtureConfig([context7Entry]);

    const { text } = await explain({ repoRoot });

    expect(lineOf(text, COMMIT_HEADER, 'skip', CONTEXT7_ID)).toContain(
      'no precedent evaluator injected',
    );
  });

  it("renders a delta entry's shell-skip arm under the entry id with its reason", async () => {
    writeFixtureConfig([vocabEntry]);

    const session = surfaceSection((await explain({ repoRoot })).text, SESSION_HEADER);

    expect(linesOf(session, 'judge', VOCAB_ID)).toHaveLength(1);
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

  it('session surface: a context entry is a judge, not a skip — the model carries a transcript', async () => {
    writeFixtureConfig([npmViewEntry, context7Entry]);

    const session = surfaceSection((await explain({ repoRoot })).text, SESSION_HEADER);

    expect(linesOf(session, 'judge', NPM_VIEW_ID)).toHaveLength(1);
    expect(linesOf(session, 'judge', CONTEXT7_ID)).toHaveLength(1);
    expect(session).not.toContain('no session transcript to read');
    expect(session).not.toContain('transcript threw');
  });
});

describe('CLI-01 AC-4 / AC-5 — surface placement', () => {
  it('renders a forbidCommand entry as excluded on the commit surface and as judge on the session surface', async () => {
    writeFixtureConfig([hooksEntry]);

    const { text } = await explain({ repoRoot });
    const commit = surfaceSection(text, COMMIT_HEADER);
    const session = surfaceSection(text, SESSION_HEADER);

    expect(linesOf(commit, 'excluded', HOOKS_ID).join('\n')).toContain('no shell axis');
    expect(linesOf(commit, 'judge', HOOKS_ID)).toHaveLength(0);
    expect(linesOf(session, 'judge', HOOKS_ID)).toHaveLength(1);
    expect(linesOf(session, 'excluded', HOOKS_ID)).toHaveLength(0);
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

describe('CLI-01 AC-6 / AC-7 — routing scope per family and the why mark', () => {
  it('renders the delta scope as `in` globs and the `except` globs, with why ✓', async () => {
    writeFixtureConfig([vocabEntry]);

    const line = lineOf((await explain({ repoRoot })).text, SESSION_HEADER, 'judge', VOCAB_ID);

    expect(line).toContain('forbid');
    expect(line).toContain('in lib/**, src/**');
    expect(line).toContain('except lib/legacy/**');
    expect(line).toContain('why ✓');
  });

  it('renders a delta entry with no `in` as `every file`, with why —', async () => {
    writeFixtureConfig([anyFileEntry]);

    const line = lineOf((await explain({ repoRoot })).text, SESSION_HEADER, 'judge', ANY_FILE_ID);

    expect(line).toContain('every file');
    expect(line).not.toContain('except');
    expect(line).toContain('why —');
  });

  it('renders the path family as `immutable <glob>`', async () => {
    writeFixtureConfig([changelogEntry]);

    const line = lineOf((await explain({ repoRoot })).text, COMMIT_HEADER, 'judge', CHANGELOG_ID);

    expect(line).toContain('immutable CHANGELOG.md');
    expect(line).not.toContain('every file');
  });

  it('renders the command family as `(no path scope)`', async () => {
    writeFixtureConfig([hooksEntry]);

    const line = lineOf((await explain({ repoRoot })).text, SESSION_HEADER, 'judge', HOOKS_ID);

    expect(line).toContain('forbidCommand');
    expect(line).toContain('(no path scope)');
  });

  it('renders the context family with its evidence key and `in` scope', async () => {
    writeFixtureConfig([npmViewEntry, context7Entry]);

    const { text } = await explain({ repoRoot });

    expect(lineOf(text, SESSION_HEADER, 'judge', NPM_VIEW_ID)).toContain(
      'requirePrecedent command',
    );
    expect(lineOf(text, SESSION_HEADER, 'judge', NPM_VIEW_ID)).toContain('in manifest.json');
    expect(lineOf(text, SESSION_HEADER, 'judge', CONTEXT7_ID)).toContain('requirePrecedent tool');
  });
});

describe('CLI-01 AC-8 / §7 inv. 2 — the tallies are the rendered lines', () => {
  it('a multi-entry config: registrations N equals the counted registration lines on each surface', async () => {
    writeFixtureConfig(LIVE_LIKE_DISCIPLINES);

    const { text } = await explain({ repoRoot });

    for (const header of [SESSION_HEADER, COMMIT_HEADER]) {
      const section = surfaceSection(text, header);
      const rows = kindLabelRows(section);
      const count = (kind: Kind) => rows.filter(([k]) => k === kind).length;
      expect(summary(section)).toEqual({
        registrations: count('meta') + count('judge') + count('skip'),
        judged: count('judge'),
        skip: count('skip'),
        meta: count('meta'),
        excluded: count('excluded'),
      });
    }
  });

  it('disciplines: [] — the smallest assembly is 4 session rows and 2 commit rows', async () => {
    writeFixtureConfig([]);

    const { text } = await explain({ repoRoot });

    expect(summary(surfaceSection(text, SESSION_HEADER))).toEqual({
      registrations: 4,
      judged: 0,
      skip: 1,
      meta: 3,
      excluded: 0,
    });
    expect(summary(surfaceSection(text, COMMIT_HEADER))).toEqual({
      registrations: 2,
      judged: 0,
      skip: 1,
      meta: 1,
      excluded: 0,
    });
  });

  it('the multi-entry config: absolute tallies differ per surface and count the excluded entry', async () => {
    writeFixtureConfig(LIVE_LIKE_DISCIPLINES);

    const { text } = await explain({ repoRoot });

    expect(summary(surfaceSection(text, SESSION_HEADER))).toEqual({
      registrations: 14,
      judged: 6,
      skip: 5,
      meta: 3,
      excluded: 0,
    });
    expect(summary(surfaceSection(text, COMMIT_HEADER))).toEqual({
      registrations: 7,
      judged: 3,
      skip: 3,
      meta: 1,
      excluded: 1,
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

describe('CLI-01 — the commit surface names its enforce level', () => {
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

describe('CLI-01 — the live config format', () => {
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
        "    forbid: 'FIXME'",
        '',
      ].join('\n'),
    );

    const { text } = await explain({ repoRoot });

    expect(text.split('\n')[0]).toContain('polydeukes.config.yaml');
    expect(lineOf(text, COMMIT_HEADER, 'judge', VOCAB_ID)).toContain('forbid');
  });
});

describe('CLI-01 §7 inv. 2-3 / failure shape — explain observes, never judges', () => {
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

describe('CLI-01 §7 inv. 1 — the roots assemble through the extracted functions', () => {
  it.each([
    ['claude-code-hook.ts', 'assembleSessionRegistrations'],
    ['covenant-check.ts', 'assembleCommitRegistrations'],
  ])('%s compiles disciplines in exactly one place and the root calls %s', (file, fn) => {
    const source = readFileSync(resolve(import.meta.dirname, `../src/${file}`), 'utf-8');

    expect(source.match(/compileDisciplineRegistrations\(/g)).toHaveLength(1);
    expect(source.match(new RegExp(`${fn}\\(`, 'g'))?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});

describe('CLI-01 AC-10 — explain stays off the covenant check load path', () => {
  it('bin.ts imports ./explain only dynamically', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../src/bin.ts'), 'utf-8');

    expect(source).toContain("import('./explain.js')");
    expect(source).not.toMatch(/^import\s[^;]*['"]\.\/explain(\.js)?['"]/m);
  });
});
