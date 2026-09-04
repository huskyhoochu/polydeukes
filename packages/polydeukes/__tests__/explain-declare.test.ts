// `pdks explain` renders a `declare` entry on BOTH surfaces as its own kind with a
// description that names the scope source, the regex list sizes, the relate ids, and the
// why mark; the tally gains a `declare` bucket that `judged` never absorbs. A declaration
// the engine cannot compile renders as a `skip` row naming the offending step.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { explain } from '../src/explain.ts';
import { writeConfigAt } from './helpers';

const SESSION_HEADER = 'surface: session (claude-code hook)';
const COMMIT_HEADER = 'surface: commit (git pre-commit)';
const SURFACE_HEADERS = [SESSION_HEADER, COMMIT_HEADER] as const;

const DECLARE_ID = 'db-only-under-knowledge';
const DECLARE_WHY = 'a *.db file may exist only under memory/knowledge/';
const RELATE_ID = 'placed';
const SCOPE_SOURCE = 'target.path';
const declareBody = {
  scope: { source: SCOPE_SOURCE, include: ['\\.db$'] },
  extract: {
    outside: [
      { op: 'source', of: SCOPE_SOURCE },
      { op: 'matches', re: '^(?!memory/knowledge/)' },
    ],
  },
  relate: [
    {
      id: RELATE_ID,
      relation: { op: 'Empty', of: 'outside' },
      message: '{value} is outside memory/knowledge/',
    },
  ],
};
const declareEntry = { id: DECLARE_ID, why: DECLARE_WHY, declare: declareBody };

/** A step name outside the engine's registry — a config fault at compile time, not a throw. */
const UNREGISTERED_OP = 'sha256';
const faultEntry = {
  id: DECLARE_ID,
  why: DECLARE_WHY,
  declare: {
    ...declareBody,
    extract: { outside: [{ op: 'source', of: SCOPE_SOURCE }, { op: UNREGISTERED_OP }] },
  },
};

let repoRoot: string;
let telemetryPath: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'pdks-explain-declare-'));
  telemetryPath = join(repoRoot, 'roi.log');
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

function writeFixtureConfig(disciplines: unknown[]): void {
  writeConfigAt(repoRoot, telemetryPath, { disciplines });
}

function surfaceSection(text: string, header: string): string {
  const start = text.indexOf(header);
  expect(start, `surface header missing: ${header}`).toBeGreaterThanOrEqual(0);
  const rest = text.slice(start + header.length);
  const next = rest.indexOf('\nsurface:');
  return next === -1 ? rest : rest.slice(0, next);
}

/** The rendered lines of the given kind+label in a surface section. */
function linesOf(section: string, kind: string, label: string): string[] {
  return section
    .split('\n')
    .filter((line) => new RegExp(`^\\s+${kind}\\s+${label}(\\s|$)`).test(line));
}

/** The single `<kind> <label>` row of a surface, failing if it is missing or doubled. */
function rowOf(text: string, header: string, kind: string, label: string): string {
  const lines = linesOf(surfaceSection(text, header), kind, label);
  expect(lines, `${kind} ${label} on '${header}'`).toHaveLength(1);
  return lines[0];
}

/** The tally line's numbers in their fixed word order — a reordering fails the match. */
const TALLY =
  /registrations (\d+) · judged (\d+) · declare (\d+) · skip (\d+) · meta (\d+) · excluded (\d+) · draft (\d+)/;

function tallyOf(section: string): Record<string, number> {
  const match = TALLY.exec(section);
  expect(match, 'tally line missing or out of order').not.toBeNull();
  const [, registrations, judged, declare, skip, meta, excluded, draft] = match as RegExpExecArray;
  return {
    registrations: Number(registrations),
    judged: Number(judged),
    declare: Number(declare),
    skip: Number(skip),
    meta: Number(meta),
    excluded: Number(excluded),
    draft: Number(draft),
  };
}

describe('explain renders a declare entry as its own kind on both surfaces', () => {
  it('renders `declare <id>` with the scope source, list sizes, relate id, and why ✓', async () => {
    // A declare entry rendered as `judge` (the family fallback) or with the include count
    // read from the wrong list would both leave a containment check green; the whole
    // description is pinned so the counts and their labels cannot swap.
    writeFixtureConfig([declareEntry]);

    const { text } = await explain({ repoRoot });

    for (const header of SURFACE_HEADERS) {
      expect(surfaceSection(text, header)).toMatch(
        /^\s+declare\s+db-only-under-knowledge\s+scope target\.path · include 1 · exclude 0 · relate placed · why ✓$/m,
      );
    }
  });

  it('appends ` · enforce: block` when the entry is promoted', async () => {
    // The promotion rung is the one choice that keeps a declare entry at exit 2 on the
    // session surface; a renderer that builds the description without the level suffix
    // would hide it.
    writeFixtureConfig([{ ...declareEntry, enforce: 'block' }]);

    const { text } = await explain({ repoRoot });

    for (const header of SURFACE_HEADERS) {
      const row = rowOf(text, header, 'declare', DECLARE_ID);
      expect(row.endsWith(' · enforce: block')).toBe(true);
    }
  });

  it('renders a scope-less entry as `scope every world` with zero lists and why —', async () => {
    // Absent scope means every world routes; a renderer reading `scope.source` off an
    // undefined block would print `undefined` or throw, and the why mark must follow the
    // entry, not the family.
    const { why: _why, ...withoutWhy } = declareEntry;
    const { scope: _scope, ...bodyWithoutScope } = declareBody;
    writeFixtureConfig([{ ...withoutWhy, declare: bodyWithoutScope }]);

    const { text } = await explain({ repoRoot });

    for (const header of SURFACE_HEADERS) {
      expect(rowOf(text, header, 'declare', DECLARE_ID)).toContain(
        'scope every world · include 0 · exclude 0 · relate placed · why —',
      );
    }
  });
});

describe('the tally counts declare in its own bucket', () => {
  it('a declare-only config tallies `declare 1` and `judged 0` in the fixed word order', async () => {
    // `judged` counts the four glob families only; a tally that folds the declare row into
    // `judged` — or omits the `declare` word — fails the ordered match.
    writeFixtureConfig([declareEntry]);

    const { text } = await explain({ repoRoot });

    for (const header of SURFACE_HEADERS) {
      const tally = tallyOf(surfaceSection(text, header));
      expect(tally.declare).toBe(1);
      expect(tally.judged).toBe(0);
      expect(tally.draft).toBe(0);
      expect(tally.excluded).toBe(0);
    }
  });

  it('a declaration with an unregistered step renders as `skip` naming the step, and tallies declare 0', async () => {
    // A config fault must become a skip row that tells the author where, not a declare row
    // that claims a judgment, and not a thrown assembly that takes the sibling rows with it.
    writeFixtureConfig([faultEntry]);

    const { text } = await explain({ repoRoot });

    for (const header of SURFACE_HEADERS) {
      const section = surfaceSection(text, header);
      expect(rowOf(text, header, 'skip', DECLARE_ID)).toContain(UNREGISTERED_OP);
      expect(linesOf(section, 'declare', DECLARE_ID)).toHaveLength(0);
      const tally = tallyOf(section);
      expect(tally.declare).toBe(0);
      expect(tally.skip).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('a declaration reading the change set renders per surface capability', () => {
  // The bilingual declaration reads `changes`, which only the commit surface observes.
  // Ids, patterns, and the reason fragment are fixture values the live config carries.
  const BILINGUAL_ID = 'docs-stay-bilingual';
  const KO_FOLLOWS = 'ko-follows';
  const EN_FOLLOWS = 'en-follows';
  const EN_PATTERN = '^(.+?)(?<!\\.ko)\\.md$';
  const KO_PATTERN = '^(.+)\\.ko\\.md$';
  const bilingualEntry = {
    id: BILINGUAL_ID,
    why: 'English is the default and Korean mirrors live in *.ko.md.',
    declare: {
      scope: {
        source: SCOPE_SOURCE,
        include: ['\\.md$'],
        exclude: ['^\\.claude/', '^CLAUDE\\.md$'],
      },
      extract: {
        en: [
          { op: 'source', of: SCOPE_SOURCE },
          { op: 'keyByPattern', re: EN_PATTERN },
        ],
        ko: [
          { op: 'source', of: SCOPE_SOURCE },
          { op: 'keyByPattern', re: KO_PATTERN },
        ],
        enChanged: [
          { op: 'source', of: 'changes' },
          { op: 'items' },
          { op: 'keyByPattern', re: EN_PATTERN },
        ],
        koChanged: [
          { op: 'source', of: 'changes' },
          { op: 'items' },
          { op: 'keyByPattern', re: KO_PATTERN },
        ],
      },
      relate: [
        {
          id: KO_FOLLOWS,
          relation: { op: 'Implies', of: 'en', requires: 'koChanged' },
          message: '{value} changed without {key}.ko.md',
        },
        {
          id: EN_FOLLOWS,
          relation: { op: 'Implies', of: 'ko', requires: 'enChanged' },
          message: '{value} changed without {key}.md',
        },
      ],
    },
  };

  it('the session surface renders a `skip` row naming the change set and no `declare` row for the id', async () => {
    // The session surface observes one call, so the assembly it renders must be the one
    // the hook runs: a `declare` row here promises a judgment the surface records as
    // `skipped`, and a skip reason that does not name the change set reads as a config
    // fault the author is expected to fix.
    writeFixtureConfig([bilingualEntry]);

    const { text } = await explain({ repoRoot });

    // The id already owns a shell-arm skip row on every surface, so the change-set skip is
    // found among the id's skip lines rather than asserted as the only one.
    const section = surfaceSection(text, SESSION_HEADER);
    const skipLines = linesOf(section, 'skip', BILINGUAL_ID);
    expect(skipLines.some((line) => line.includes('change set'))).toBe(true);
    expect(linesOf(section, 'declare', BILINGUAL_ID)).toHaveLength(0);
    expect(tallyOf(section).declare).toBe(0);
  });

  it('the commit surface renders a `declare` row with exclude 2 and both relate ids, and tallies declare 1', async () => {
    // The commit surface observes the staged set and judges; the same entry must not be
    // rendered as a skip there, or the batch display shows a declaration no surface runs.
    // The description is pinned whole so `exclude 2` and the two-id spelling cannot drift.
    writeFixtureConfig([bilingualEntry]);

    const { text } = await explain({ repoRoot });

    const section = surfaceSection(text, COMMIT_HEADER);
    expect(rowOf(text, COMMIT_HEADER, 'declare', BILINGUAL_ID)).toMatch(
      /scope target\.path · include 1 · exclude 2 · relate ko-follows, en-follows · why ✓$/,
    );
    const skipLines = linesOf(section, 'skip', BILINGUAL_ID);
    expect(skipLines.some((line) => line.includes('change set'))).toBe(false);
    expect(tallyOf(section).declare).toBe(1);
  });
});
