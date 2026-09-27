import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { MemoryConfig } from '@polydeukes/memory';
import {
  describeMemoryIndex,
  lintMemory,
  listObligations,
  listSupersession,
  openMemoryDb,
  searchMemory,
  showMemory,
} from '@polydeukes/memory';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeConfigAt } from './helpers.ts';

// `pdks memory ingest | search | show` on the built bin, in a throwaway project the command
// is invoked from. The oracle for every `--json` answer is the memory verb called on the
// same database file with the same memory settings; the table forms are pinned by shape.
// Every path is cwd-relative: the config is discovered there and the index lives at
// `.polydeukes/memory.db` beneath it.

const BIN = resolve(import.meta.dirname, '../dist/bin.js');

/** Where the command keeps the index, relative to the directory it runs in. */
const DB_REL = '.polydeukes/memory.db';
const DB_DIR_REL = '.polydeukes';
const CONFIG_REL = 'polydeukes.config.json';
/** Where the query commands append one JSON line each, relative to the directory they run in. */
const LOG_REL = '.polydeukes/memory-log.jsonl';
/** ISO 8601 in UTC, as `Date#toISOString` writes it. */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/**
 * Globs, types, and weights are fixture values. The two documents that share a body carry
 * different types, and the weighted one is the one the unweighted ranking places second,
 * so a command that forgets to hand the memory settings to the search answers in the
 * other order.
 */
const INCLUDE = ['notes/**/*.md'];
const MEMORY: MemoryConfig = {
  include: INCLUDE,
  exclude: ['**/index.md'],
  typeMap: { decision: 'reference' },
  weights: { reference: 4 },
};
const EMPTY_INCLUDE = ['nothing/**/*.md'];
const SHARED_BODY = 'shared-term here.';
const DOCS: [string, string][] = [
  [
    'notes/alpha.md',
    `---\ntitle: Alpha\ntype: decision\n---\n## One\n\n${SHARED_BODY}\n\n## Two\n\nalpha only.\n`,
  ],
  ['notes/guides/zeta.md', `---\ntitle: Zeta\ntype: guide\n---\n## One\n\n${SHARED_BODY}\n`],
  ['notes/gamma.md', '---\ntitle: Gamma\ntype: note\n---\n## One\n\ngamma text.\n'],
  // Reached by the include glob and left out by MEMORY's exclude glob alone.
  ['notes/index.md', '---\ntitle: Excluded\n---\n## One\n\nexcluded.\n'],
];
const INDEXED_COUNT = 3;
const DOC_ID = 'notes/alpha';
const SECTION_ID = 'notes/alpha#two';
const UNKNOWN_ID = 'notes/nothing';
const SHARED_QUERY = 'shared-term';
/** Two words: `alpha` alone hits both alpha sections, the pair hits only the second. */
const JOINED_QUERY = ['alpha', 'only'];
const NO_HIT_QUERY = 'zz-no-such-term-491';
/** A document the shared query hits whose `stale_after` has passed; written only where the marker is asserted. */
const STALE_DOC_REL = 'notes/stale.md';
const STALE_DOC_TEXT = `---\ntitle: Stale\ntype: note\nstale_after: 2000-01-01T00:00:00Z\n---\n## One\n\n${SHARED_BODY}\n`;
const STALE_SECTION_ID = 'notes/stale#one';
const STALE_MARK = ', stale';
/**
 * A document linking out three ways — a wikilink that resolves to `gamma` by its unique
 * last path segment, one that resolves nowhere, and a markdown link to gamma's section —
 * written only where links are asserted. With it, `alpha` and `zeta` are the isolated pair.
 */
const LINKED_DOC_REL = 'notes/hub.md';
const LINKED_DOC_ID = 'notes/hub';
const LINKED_BODY = '[[gamma]] and [[nowhere]] and [g](gamma.md#one).';
const LINKED_DOC_TEXT = `---\ntitle: Hub\ntype: note\n---\n## One\n\n${LINKED_BODY}\n`;
const LINKED_TARGET_ID = 'notes/gamma';
/** A document with no `type`, written only where an untyped violation is asserted. */
const UNTYPED_DOC_REL = 'notes/untyped.md';
const UNTYPED_DOC_TEXT = '---\ntitle: Untyped\n---\n## One\n\nplain.\n';
/**
 * The ticket pattern is a fixture value no fixed document title matches. The three below
 * share a ticket, so each related block has two lines; the first one also links out, so its
 * related block has to land after its links block, and the second has no links at all.
 */
const TICKET_MEMORY: MemoryConfig = {
  ...MEMORY,
  ticket: [{ from: 'title', pattern: 'RQ-[0-9]+' }],
};
const PAIR_A_REL = 'notes/pair-a.md';
const PAIR_A_ID = 'notes/pair-a';
const PAIR_A_BODY = '[[gamma]] here.';
const PAIR_A_TEXT = `---\ntitle: Pair A RQ-7\ntype: note\n---\n## One\n\n${PAIR_A_BODY}\n`;
const PAIR_B_REL = 'notes/pair-b.md';
const PAIR_B_ID = 'notes/pair-b';
const PAIR_B_TEXT = '---\ntitle: Pair B RQ-7\ntype: note\n---\n## One\n\npair b text.\n';
const PAIR_C_REL = 'notes/pair-c.md';
const PAIR_C_ID = 'notes/pair-c';
const PAIR_C_TEXT = '---\ntitle: Pair C RQ-7\ntype: note\n---\n## One\n\npair c text.\n';

/**
 * A document whose path carries a space, so its section id does too. The query word is
 * unique to it, so the search answers exactly this one section.
 */
const SPACED_DOC_REL = 'notes/My Guide/setup.md';
const SPACED_DOC_TEXT = '---\ntitle: Setup\ntype: guide\n---\n## Install\n\nspaced-term here.\n';
const SPACED_SECTION_ID = 'notes/My Guide/setup#install';
const SPACED_QUERY = 'spaced-term';
/**
 * A Korean question whose two content words carry a particle and an ending, written only
 * where the question is asked. Taken literally neither word is in any document; with the
 * particle and ending off, both are in this one section.
 */
const KOREAN_DOC_REL = 'notes/korean.md';
const KOREAN_DOC_TEXT = '---\ntitle: Korean\ntype: note\n---\n## One\n\ncognee 제거 결정.\n';
const KOREAN_SECTION_ID = 'notes/korean#one';
const KOREAN_QUESTION = ['왜', 'cognee를', '제거했나'];
/** The one character between two columns of the `search` table form. */
const TABLE_SEPARATOR = '\t';
/** A config declaring the memory section and nothing else — the shape the memory docs show. */
const MEMORY_ONLY_CONFIG = { memory: { include: INCLUDE } };

const NO_INDEX_LINE = `pdks memory: no index at ${DB_REL} — run \`pdks memory ingest\` first`;
const indexedLine = (n: number) => `indexed ${n} document${n === 1 ? '' : 's'} into ${DB_REL}`;

let projectRoot: string;
const opened: DatabaseSync[] = [];

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'pdks-memory-command-e2e-'));
  for (const [relative, text] of DOCS) {
    const path = join(projectRoot, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
});

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  rmSync(projectRoot, { recursive: true, force: true });
});

function pdks(...args: string[]) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd: projectRoot, encoding: 'utf-8' });
}

function writeConfig(extra: Record<string, unknown>): void {
  writeConfigAt(projectRoot, join(projectRoot, 'roi.log'), extra);
}

/** The index the command wrote, opened read-side for the oracle calls. */
function openIndex(): DatabaseSync {
  const db = openMemoryDb({ path: join(projectRoot, DB_REL) });
  opened.push(db);
  return db;
}

function ingested(): void {
  writeConfig({ memory: MEMORY });
  const result = pdks('memory', 'ingest');
  if (result.status !== 0) throw new Error(`fixture ingest failed: ${result.stderr}`);
}

type Row = Record<string, unknown>;
/** Stored rows by their declared columns, so a rebuild's new rowids do not enter the comparison. */
const conceptRows = (db: DatabaseSync): Row[] =>
  db
    .prepare(
      'SELECT id, title, metadata, status, stale_after, doc_type, ticket, content_hash FROM concept ORDER BY id',
    )
    .all() as Row[];
const sectionRows = (db: DatabaseSync): Row[] =>
  db
    .prepare('SELECT id, concept_id, ord, doc_title, title, body FROM section ORDER BY id')
    .all() as Row[];

describe('pdks memory ingest', () => {
  // A command that drops `exclude` on the way to the ingest reports 4 (`index.md`
  // included); a database written
  // anywhere but `.polydeukes/memory.db` under cwd is one `search` never finds; a stamp
  // the command never writes leaves `ingestedAt` null.
  it('indexes the documents the include globs reach into .polydeukes/memory.db and stamps the ingest', () => {
    writeConfig({ memory: MEMORY });

    const before = Date.now();
    const result = pdks('memory', 'ingest');
    const after = Date.now();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(`${indexedLine(INDEXED_COUNT)}\n`);
    expect(result.stderr).toBe('');
    expect(existsSync(join(projectRoot, DB_REL))).toBe(true);
    const state = describeMemoryIndex({ db: openIndex() });
    expect(state.documents).toBe(INDEXED_COUNT);
    const stamped = Date.parse(state.ingestedAt as string);
    expect(stamped).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
    expect(stamped).toBeLessThanOrEqual(after);
  });

  // A row changed behind the content hash stands for any change the hash cannot see: a
  // plain ingest keeps it, so a `--rebuild` the command does not pass through keeps it
  // too; a rebuild that drops every row and forgets a document leaves a smaller row set.
  it('rebuilds to the rows of the first build after a row was tampered with, and exits 0', () => {
    ingested();
    const first = openIndex();
    const concepts = conceptRows(first);
    const sections = sectionRows(first);
    first.exec(`UPDATE concept SET title = 'tampered' WHERE id = '${DOC_ID}'`);
    expect(conceptRows(first)).not.toEqual(concepts);
    first.close();
    opened.pop();

    const result = pdks('memory', 'ingest', '--rebuild');

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(`${indexedLine(INDEXED_COUNT)}\n`);
    const rebuilt = openIndex();
    expect(conceptRows(rebuilt)).toEqual(concepts);
    expect(sectionRows(rebuilt)).toEqual(sections);
  });

  // A loader error caught as "no memory section" prints the declaration hint for a config
  // that already declares the key; one that escapes as a stack trace exits 1 and may have
  // opened the index first.
  it('exits 2 with the loader message and no index when memory.include is not an array', () => {
    writeConfig({ memory: { include: INCLUDE[0] } });

    const result = pdks('memory', 'ingest');

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr.startsWith('pdks memory: ')).toBe(true);
    expect(existsSync(join(projectRoot, DB_REL))).toBe(false);
  });

  // A loader that still requires `languages` exits 2 on the config the memory docs show
  // and creates no index; a command that catches that as "no memory section" prints the
  // declaration hint for a key the config already declares. With no exclude glob, no file
  // is skipped by its name: `index.md` is the fourth document.
  it('indexes from a config that declares only memory.include, exiting 0', () => {
    writeFileSync(join(projectRoot, CONFIG_REL), JSON.stringify(MEMORY_ONLY_CONFIG, null, 2));

    const result = pdks('memory', 'ingest');

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(`${indexedLine(INDEXED_COUNT + 1)}\n`);
    expect(describeMemoryIndex({ db: openIndex() }).documents).toBe(INDEXED_COUNT + 1);
  });

  // An ingest that treats an empty file list as an error, or prints nothing for it, leaves
  // the user with no way to see that the globs reach no document.
  it('reports zero documents when the include globs reach no file', () => {
    writeConfig({ memory: { include: EMPTY_INCLUDE } });

    const result = pdks('memory', 'ingest');

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(`${indexedLine(0)}\n`);
  });
});

describe('pdks memory without a memory section', () => {
  const NO_CONFIG = 'no config file';
  const NO_SECTION = 'a config without memory';
  const prepare: Record<string, () => void> = {
    [NO_CONFIG]: () => {},
    [NO_SECTION]: () => writeConfig({}),
  };

  // A command that falls through to `openMemoryDb` creates an empty index before it
  // notices there is nothing to index; a hint that names another key, or this
  // repository's own wiki path as its example, sends the user to the wrong declaration.
  // Run from a directory without the config, the hint names that directory; a hint that
  // says the key is undeclared sends the user to add a declaration that already exists.
  const cause: Record<string, string> = {
    [NO_CONFIG]: 'no config in',
    [NO_SECTION]: 'memory.include is not declared',
  };
  it.each([
    { state: NO_CONFIG, args: ['ingest'] },
    { state: NO_CONFIG, args: ['search', 'x'] },
    { state: NO_SECTION, args: ['ingest'] },
    { state: NO_SECTION, args: ['search', 'x'] },
  ])(
    '$state: pdks memory $args exits 2 naming memory.include and its cause, and creates no index',
    ({ state, args }) => {
      prepare[state]?.();

      const result = pdks('memory', ...args);

      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('memory.include');
      expect(result.stderr).toContain(cause[state]);
      expect(result.stderr).not.toContain('_docs');
      expect(existsSync(join(projectRoot, DB_DIR_REL))).toBe(false);
    },
  );
});

describe('pdks memory search', () => {
  // The two shared-body documents order one way unweighted and the other way under the
  // configured weight, so a command that searches without the memory settings, or reads a
  // different database than the one it wrote, answers in the wrong order; a stamp copied
  // from the clock instead of the database drifts from the DB's own value.
  it('--json carries the DB stamp and the results searchMemory returns for the same DB and settings', async () => {
    ingested();
    const db = openIndex();
    const expected = await searchMemory({ db, query: SHARED_QUERY, config: MEMORY });
    expect(expected.length).toBe(2);
    expect(await searchMemory({ db, query: SHARED_QUERY })).not.toEqual(expected);

    const result = pdks('memory', 'search', SHARED_QUERY, '--json');

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      ingestedAt: describeMemoryIndex({ db }).ingestedAt,
      results: expected,
    });
  });

  // A command that searches only the first positional word hits both alpha sections; one
  // that takes `--json` as a query word, or only in the last position, answers the table
  // form or a no-hit list.
  it('joins the positional words into one query and takes --json in any position', async () => {
    ingested();
    const db = openIndex();
    const expected = await searchMemory({ db, query: JOINED_QUERY.join(' '), config: MEMORY });
    expect(expected.map((r) => r.id)).toEqual([SECTION_ID]);
    expect(
      await searchMemory({ db, query: JOINED_QUERY[0] as string, config: MEMORY }),
    ).toHaveLength(2);
    const [first, second] = JOINED_QUERY as [string, string];

    const trailing = pdks('memory', 'search', first, second, '--json');
    const leading = pdks('memory', 'search', '--json', first, second);
    const between = pdks('memory', 'search', first, '--json', second);

    expect(trailing.status, trailing.stderr).toBe(0);
    expect(leading.status, leading.stderr).toBe(0);
    expect(between.status, between.stderr).toBe(0);
    expect(JSON.parse(trailing.stdout).results).toEqual(expected);
    expect(JSON.parse(leading.stdout).results).toEqual(expected);
    expect(JSON.parse(between.stdout)).toEqual(JSON.parse(trailing.stdout));
  });

  // A header that prints the clock instead of the DB stamp, a table that folds two results
  // onto one line or drops the identifier a `show` needs next, a line missing the match
  // path or trust grade, and a stale marker printed on every line or on none all pass an
  // exit-code-only check. The stale document's `stale_after` is in the past.
  it('prints the stamp header and one line per result in the table form, marking the stale hit', async () => {
    writeFileSync(join(projectRoot, STALE_DOC_REL), STALE_DOC_TEXT);
    ingested();
    const db = openIndex();
    const expected = await searchMemory({ db, query: SHARED_QUERY, config: MEMORY });
    expect(expected.filter((hit) => hit.stale).map((hit) => hit.id)).toEqual([STALE_SECTION_ID]);
    const stamp = describeMemoryIndex({ db }).ingestedAt;

    const result = pdks('memory', 'search', SHARED_QUERY);

    expect(result.status, result.stderr).toBe(0);
    const lines = result.stdout.trimEnd().split('\n');
    expect(lines[0]).toBe(`# ingested at ${stamp}`);
    expect(lines).toHaveLength(expected.length + 1);
    expected.forEach((hit, i) => {
      const line = lines[i + 1] as string;
      expect(line).toBe(
        [
          hit.id,
          hit.matchPath,
          hit.stale ? `${hit.status}${STALE_MARK}` : hit.status,
          hit.trust,
          `${hit.docTitle} › ${hit.sectionTitle}`,
        ].join(TABLE_SEPARATOR),
      );
    });
  });

  // A section id or title carrying a space cannot be split on runs of spaces, so a table
  // joined with two spaces hands `cut -f1` a truncated id; a renderer that pads columns to
  // width joins them with more than one tab, and one that escapes the space in the id
  // hands `show` an identifier the index does not hold.
  it('separates the five columns with one tab so an id containing a space survives cut -f1', async () => {
    mkdirSync(join(projectRoot, dirname(SPACED_DOC_REL)), { recursive: true });
    writeFileSync(join(projectRoot, SPACED_DOC_REL), SPACED_DOC_TEXT);
    ingested();
    const db = openIndex();
    const expected = await searchMemory({ db, query: SPACED_QUERY, config: MEMORY });
    expect(expected.map((hit) => hit.id)).toEqual([SPACED_SECTION_ID]);

    const result = pdks('memory', 'search', SPACED_QUERY);

    expect(result.status, result.stderr).toBe(0);
    const lines = result.stdout.trimEnd().split('\n').slice(1);
    expect(lines).toHaveLength(1);
    const fields = (lines[0] as string).split(TABLE_SEPARATOR);
    expect(fields).toHaveLength(5);
    expect(fields[0]).toBe(SPACED_SECTION_ID);
    expect(SPACED_SECTION_ID).toContain(' ');
  });

  // No stored column holds any of the question's words as written, so a command that reads
  // the section text for them literally answers an empty list; one whose analyzer load lets
  // the loader's deprecation line through prints it on stderr, where a script reading the
  // table sees a failure.
  it('answers a Korean question with particles through the normalized path, with an empty stderr', async () => {
    writeFileSync(join(projectRoot, KOREAN_DOC_REL), KOREAN_DOC_TEXT);
    ingested();
    const db = openIndex();
    const question = KOREAN_QUESTION.join(' ');
    const expected = await searchMemory({ db, query: question, config: MEMORY });
    expect(expected.map((hit) => [hit.id, hit.matchPath])).toEqual([[KOREAN_SECTION_ID, 'like']]);
    const literal = db.prepare(
      'SELECT count(*) AS n FROM section WHERE doc_title LIKE ? OR title LIKE ? OR body LIKE ?',
    );
    for (const word of KOREAN_QUESTION) {
      const pattern = `%${word}%`;
      expect((literal.get(pattern, pattern, pattern) as { n: number }).n, word).toBe(0);
    }

    const json = pdks('memory', 'search', ...KOREAN_QUESTION, '--json');
    const table = pdks('memory', 'search', ...KOREAN_QUESTION);

    expect(json.status, json.stderr).toBe(0);
    expect(json.stderr).toBe('');
    expect(JSON.parse(json.stdout).results).toEqual(expected);
    expect(table.status, table.stderr).toBe(0);
    expect(table.stderr).toBe('');
    expect(table.stdout.trimEnd().split('\n').slice(1)).toHaveLength(1);
    expect(table.stdout).toContain(`${KOREAN_SECTION_ID}${TABLE_SEPARATOR}like`);
  });

  // A no-hit query answered with exit 2, or with a stdout that is not the documented
  // shape, reads as a failed command rather than an empty answer.
  it('answers a query with no hit with exit 0, the stamp, and an empty results list', () => {
    ingested();
    const stamp = describeMemoryIndex({ db: openIndex() }).ingestedAt;

    const json = pdks('memory', 'search', NO_HIT_QUERY, '--json');
    const table = pdks('memory', 'search', NO_HIT_QUERY);

    expect(json.status, json.stderr).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual({ ingestedAt: stamp, results: [] });
    expect(table.status, table.stderr).toBe(0);
    expect(table.stdout).toBe(`# ingested at ${stamp}\n`);
  });
});

describe('pdks memory show', () => {
  // A document rendered with the section identifier heading, sections out of stored
  // order, or a JSON shape reshaped by the command diverges from what `showMemory` returns.
  it('renders a document as its title heading with one H2 per section, and --json as the showMemory value', () => {
    ingested();
    const expected = showMemory({ db: openIndex(), id: DOC_ID });

    const table = pdks('memory', 'show', DOC_ID);
    const json = pdks('memory', 'show', DOC_ID, '--json');

    expect(table.status, table.stderr).toBe(0);
    const lines = table.stdout.split('\n');
    expect(lines[0]).toBe('# Alpha');
    expect(lines.indexOf('## One')).toBeGreaterThan(0);
    expect(lines.indexOf('## Two')).toBeGreaterThan(lines.indexOf('## One'));
    expect(table.stdout.indexOf(SHARED_BODY)).toBeGreaterThan(table.stdout.indexOf('## One'));
    expect(table.stdout.indexOf('alpha only.')).toBeGreaterThan(table.stdout.indexOf('## Two'));
    expect(json.status, json.stderr).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual(expected);
  });

  // A section rendered under the document form prints every section; a heading missing the
  // document title loses the context a reader needs to open the right file.
  it('renders a section as document › section with its body, and --json as the showMemory value', () => {
    ingested();
    const expected = showMemory({ db: openIndex(), id: SECTION_ID });

    const table = pdks('memory', 'show', SECTION_ID);
    const json = pdks('memory', 'show', SECTION_ID, '--json');

    expect(table.status, table.stderr).toBe(0);
    const lines = table.stdout.split('\n');
    expect(lines[0]).toBe('# Alpha › Two');
    expect(table.stdout).toContain('alpha only.');
    expect(table.stdout).not.toContain(SHARED_BODY);
    expect(table.stdout).not.toContain('## One');
    expect(json.status, json.stderr).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual(expected);
  });

  // An unknown identifier answered with exit 0 and `null`, or with a partial document on
  // stdout, is read by an agent as the document it asked for.
  it.each([{ args: [UNKNOWN_ID] }, { args: [UNKNOWN_ID, '--json'] }])(
    'refuses an unknown identifier $args with exit 2 and an empty stdout',
    ({ args }) => {
      ingested();

      const result = pdks('memory', 'show', ...args);

      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain(UNKNOWN_ID);
    },
  );

  // A document titled by its H1 keeps that line in the text before the first H2; rendered
  // under its own `# <title>` heading it would print the title twice. A different H1 stays.
  it('prints a title H1 once, for the document and for its preamble row', () => {
    writeFileSync(
      join(projectRoot, 'notes/delta.md'),
      '# Delta\n\nintro text.\n\n## Topic\n\ntopic text.\n',
    );
    writeFileSync(
      join(projectRoot, 'notes/epsilon.md'),
      '---\ntitle: Epsilon\n---\n# Another heading\n\nlead.\n\n## Topic\n\nbody.\n',
    );
    ingested();

    const document = pdks('memory', 'show', 'notes/delta');
    const preamble = pdks('memory', 'show', 'notes/delta#');
    const other = pdks('memory', 'show', 'notes/epsilon');

    expect(document.status, document.stderr).toBe(0);
    expect(document.stdout).toBe('# Delta\n\nintro text.\n\n## Topic\n\ntopic text.\n');
    expect(preamble.status, preamble.stderr).toBe(0);
    expect(preamble.stdout).toBe('# Delta\n\nintro text.\n');
    expect(other.stdout).toContain('# Another heading\n\nlead.');
  });

  // `show` needs the index alone; a command that loads the config first refuses a lookup
  // in a tree whose config is gone while the index it asks about is still there.
  it('answers without a config file once the index exists', () => {
    ingested();
    rmSync(join(projectRoot, CONFIG_REL));

    const result = pdks('memory', 'show', DOC_ID, '--json');

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ id: DOC_ID });
  });

  // A renderer that prints the block for a link-free document changes the bytes every
  // existing reader of `show` parses; one that prints `null` for an unresolved target, drops
  // the `in` lines on the target document, or orders the lines by target document rather
  // than by from and target diverges from the pinned form; a `--json` that reshapes the
  // links diverges from `showMemory`.
  it('appends a links block for a document with edges and keeps the link-free form byte-identical', () => {
    writeFileSync(join(projectRoot, LINKED_DOC_REL), LINKED_DOC_TEXT);
    ingested();
    const db = openIndex();
    const expected = showMemory({ db, id: LINKED_DOC_ID });
    expect(expected?.links.out).toHaveLength(3);

    const linked = pdks('memory', 'show', LINKED_DOC_ID);
    const target = pdks('memory', 'show', LINKED_TARGET_ID);
    const linkFree = pdks('memory', 'show', DOC_ID);
    const json = pdks('memory', 'show', LINKED_DOC_ID, '--json');

    expect(linked.status, linked.stderr).toBe(0);
    expect(linked.stdout).toBe(
      [
        `# Hub\n\n## One\n\n${LINKED_BODY}\n`,
        '\n## links\n',
        `out  ${LINKED_DOC_ID}#one  [[gamma]]  → ${LINKED_TARGET_ID}\n`,
        `out  ${LINKED_DOC_ID}#one  [[nowhere]]  → unresolved\n`,
        `out  ${LINKED_DOC_ID}#one  gamma.md#one  → ${LINKED_TARGET_ID}#one\n`,
      ].join(''),
    );
    expect(target.status, target.stderr).toBe(0);
    expect(target.stdout).toBe(
      [
        '# Gamma\n\n## One\n\ngamma text.\n',
        '\n## links\n',
        `in  ${LINKED_DOC_ID}#one  → ${LINKED_TARGET_ID}\n`,
        `in  ${LINKED_DOC_ID}#one  → ${LINKED_TARGET_ID}#one\n`,
      ].join(''),
    );
    expect(linkFree.status, linkFree.stderr).toBe(0);
    expect(linkFree.stdout).toBe(`# Alpha\n\n## One\n\n${SHARED_BODY}\n\n## Two\n\nalpha only.\n`);
    expect(json.status, json.stderr).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual(expected);
  });

  // A renderer that prints the related block before the links block, prints it for a
  // document with no ticket partner, or prints it on a section reshapes the bytes every
  // reader of `show` parses; a renderer that joins the ids on one line differs once there
  // are two; a `--json` that drops or reshapes `related` diverges from `showMemory`.
  it('appends a related block after the links block for a document sharing a ticket, and omits it otherwise', () => {
    writeFileSync(join(projectRoot, PAIR_A_REL), PAIR_A_TEXT);
    writeFileSync(join(projectRoot, PAIR_B_REL), PAIR_B_TEXT);
    writeFileSync(join(projectRoot, PAIR_C_REL), PAIR_C_TEXT);
    writeConfig({ memory: TICKET_MEMORY });
    const ingest = pdks('memory', 'ingest');
    expect(ingest.status, ingest.stderr).toBe(0);
    const db = openIndex();
    const expectedA = showMemory({ db, id: PAIR_A_ID });
    const expectedSection = showMemory({ db, id: `${PAIR_A_ID}#one` });

    const withLinks = pdks('memory', 'show', PAIR_A_ID);
    const linkFree = pdks('memory', 'show', PAIR_B_ID);
    const section = pdks('memory', 'show', `${PAIR_A_ID}#one`);
    const json = pdks('memory', 'show', PAIR_A_ID, '--json');
    const sectionJson = pdks('memory', 'show', `${PAIR_A_ID}#one`, '--json');

    expect(withLinks.status, withLinks.stderr).toBe(0);
    expect(withLinks.stdout).toBe(
      [
        `# Pair A RQ-7\n\n## One\n\n${PAIR_A_BODY}\n`,
        '\n## links\n',
        `out  ${PAIR_A_ID}#one  [[gamma]]  → ${LINKED_TARGET_ID}\n`,
        '\n## related\n',
        `${PAIR_B_ID}\n`,
        `${PAIR_C_ID}\n`,
      ].join(''),
    );
    expect(linkFree.status, linkFree.stderr).toBe(0);
    expect(linkFree.stdout).toBe(
      [
        '# Pair B RQ-7\n\n## One\n\npair b text.\n',
        '\n## related\n',
        `${PAIR_A_ID}\n`,
        `${PAIR_C_ID}\n`,
      ].join(''),
    );
    expect(section.status, section.stderr).toBe(0);
    expect(section.stdout).toContain(PAIR_A_BODY);
    expect(section.stdout).not.toContain('## related');
    expect(json.status, json.stderr).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual(expectedA);
    expect(JSON.parse(json.stdout).related).toEqual([PAIR_B_ID, PAIR_C_ID]);
    expect(sectionJson.status, sectionJson.stderr).toBe(0);
    expect(JSON.parse(sectionJson.stdout)).toEqual(expectedSection);
    expect(JSON.parse(sectionJson.stdout)).not.toHaveProperty('related');
  });
});

describe('pdks memory stats', () => {
  // Four documents' worth of arithmetic is pinned by value, so a count wired to the wrong
  // field — `links` printed where `unresolved` belongs, `isolated` printed as a bare number
  // or over the section count, a sixth line or a stamp header — fails on the bytes; a
  // `--json` that copies the clock or reshapes the keys diverges from `describeMemoryIndex`.
  it('prints the five count lines with isolated over the document count, and --json as the describeMemoryIndex value', () => {
    writeFileSync(join(projectRoot, LINKED_DOC_REL), LINKED_DOC_TEXT);
    ingested();
    const state = describeMemoryIndex({ db: openIndex() });
    expect(state).toMatchObject({
      documents: 4,
      sections: 5,
      links: 3,
      unresolved: 1,
      isolated: 2,
    });

    const table = pdks('memory', 'stats');
    const json = pdks('memory', 'stats', '--json');

    expect(table.status, table.stderr).toBe(0);
    expect(table.stderr).toBe('');
    expect(table.stdout).toBe(
      'documents  4\nsections  5\nlinks  3\nunresolved  1\nisolated  2/4\n',
    );
    expect(json.status, json.stderr).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual({
      ingestedAt: state.ingestedAt,
      documents: 4,
      sections: 5,
      links: 3,
      unresolved: 1,
      isolated: 2,
    });
  });

  // `stats` and `lint` need the index alone; a command that loads the config first refuses
  // in a tree whose config is gone while the index it asks about is still there.
  it.each([{ args: ['stats', '--json'] }, { args: ['lint'] }])(
    'pdks memory $args answers without a config file once the index exists',
    ({ args }) => {
      ingested();
      rmSync(join(projectRoot, CONFIG_REL));

      const result = pdks('memory', ...args);

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).not.toBe('');
    },
  );
});

describe('pdks memory lint', () => {
  // A violation answered with exit 0 lets a script read a broken index as clean; exit 2
  // makes it indistinguishable from a usage error; a report on stderr, a missing stamp
  // header, or a line that folds the three fields with one space diverges from the pinned
  // form; a `--json` that reshapes or reorders the list diverges from `lintMemory`.
  it('exits 1 with the stamp header and one line per violation, and --json as the lintMemory value', () => {
    writeFileSync(join(projectRoot, LINKED_DOC_REL), LINKED_DOC_TEXT);
    writeFileSync(join(projectRoot, UNTYPED_DOC_REL), UNTYPED_DOC_TEXT);
    ingested();
    const db = openIndex();
    const expected = lintMemory({ db });
    expect(expected.violations.map((v) => v.rule)).toEqual(['unresolved', 'untyped']);
    const stamp = describeMemoryIndex({ db }).ingestedAt;

    const table = pdks('memory', 'lint');
    const json = pdks('memory', 'lint', '--json');

    expect(table.status).toBe(1);
    expect(table.stderr).toBe('');
    const lines = table.stdout.split('\n');
    expect(lines[0]).toBe(`# ingested at ${stamp}`);
    expect(lines[1]).toBe(`unresolved  ${LINKED_DOC_ID}#one  [[nowhere]]`);
    expect(lines[2]).toBe('untyped  notes/untyped');
    expect(lines.slice(3)).toEqual(['']);
    expect(json.status).toBe(1);
    expect(JSON.parse(json.stdout)).toEqual({ ingestedAt: stamp, violations: expected.violations });
  });

  // A clean index answered with exit 1, or with any line after the header, reads as a
  // violation to the script that gates on it.
  it('exits 0 with the stamp header alone when nothing is violated', () => {
    ingested();
    const stamp = describeMemoryIndex({ db: openIndex() }).ingestedAt;

    const table = pdks('memory', 'lint');
    const json = pdks('memory', 'lint', '--json');

    expect(table.status, table.stderr).toBe(0);
    expect(table.stdout).toBe(`# ingested at ${stamp}\n`);
    expect(table.stderr).toBe('');
    expect(json.status, json.stderr).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual({ ingestedAt: stamp, violations: [] });
  });
});

describe('pdks memory before any ingest', () => {
  // `openMemoryDb` creates an empty database at a missing path: a `search` or `show` that
  // opens first answers 0 hits from an index nobody built and leaves the file behind, so
  // every later run reads the empty index as a real one.
  it.each([
    { args: ['search', 'x'] },
    { args: ['show', DOC_ID] },
    { args: ['lint'] },
    { args: ['stats'] },
  ])(
    'pdks memory $args exits 2 with the ingest hint and creates neither the index nor its directory',
    ({ args }) => {
      writeConfig({ memory: MEMORY });

      const result = pdks('memory', ...args);

      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr.trim()).toBe(NO_INDEX_LINE);
      expect(existsSync(join(projectRoot, DB_DIR_REL))).toBe(false);
    },
  );

  // The telemetry log already put `.polydeukes/` in place; a check on the directory rather
  // than the file reads that as an index and opens one.
  it('with .polydeukes/ present but no memory.db, search exits 2 with the ingest hint and creates no file', () => {
    writeConfig({ memory: MEMORY });
    mkdirSync(join(projectRoot, DB_DIR_REL));
    writeFileSync(join(projectRoot, DB_DIR_REL, 'roi.log'), '');

    const result = pdks('memory', 'search', 'x');

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr.trim()).toBe(NO_INDEX_LINE);
    expect(existsSync(join(projectRoot, DB_REL))).toBe(false);
  });

  // A file that is empty, or that another tool created, is not an index this command built;
  // a reader that opens it with the creating opener writes the schema into it before it
  // refuses, so the refusal changes the file it refused.
  it('with an empty memory.db, search exits 2 with the ingest hint and leaves the file empty', () => {
    writeConfig({ memory: MEMORY });
    mkdirSync(join(projectRoot, DB_DIR_REL));
    writeFileSync(join(projectRoot, DB_REL), '');

    const result = pdks('memory', 'search', 'x');

    expect(result.status).toBe(2);
    expect(result.stderr.trim()).toBe(NO_INDEX_LINE);
    expect(statSync(join(projectRoot, DB_REL)).size).toBe(0);
  });

  // A first ingest that failed leaves a database file with the schema and no stamp; a
  // check on the file alone reads it as an index and answers 0 hits or "not found".
  it.each([
    { args: ['search', 'x'] },
    { args: ['show', DOC_ID] },
    { args: ['lint'] },
    { args: ['stats'] },
  ])(
    'with a memory.db no ingest has committed, pdks memory $args exits 2 with the ingest hint',
    ({ args }) => {
      writeConfig({ memory: MEMORY });
      openMemoryDb({ path: join(projectRoot, DB_REL) }).close();
      expect(existsSync(join(projectRoot, DB_REL))).toBe(true);

      const result = pdks('memory', ...args);

      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr.trim()).toBe(NO_INDEX_LINE);
    },
  );
});

describe('pdks memory obligations', () => {
  /**
   * The rules are fixture values: a checkbox line rule and a section rule. The document
   * carries the key as its ticket and on one checkbox line inside the matching section, so
   * the key has one row from each rule form in the same section; the other checkbox line
   * carries a second key so a query that ignores the key answers three rows. The section
   * body has more than one line, so a table that prints the whole text shows.
   */
  const OBLIGATION_KEY = 'AB-1';
  const OTHER_KEY = 'AB-2';
  const NO_ROW_KEY = 'AB-3';
  const OBLIGATION_MEMORY: MemoryConfig = {
    ...MEMORY,
    ticket: [{ from: 'frontmatter', key: 'issue' }],
    obligations: [
      { line: '^\\s*[-*] \\[ \\]', key: '[A-Z]+-[0-9]+' },
      { section: '^Unresolved questions$' },
    ],
  };
  const OBLIGATION_DOC_REL = 'notes/duty.md';
  const OBLIGATION_SECTION_ID = 'notes/duty#unresolved-questions';
  const SECTION_FIRST_LINE = 'first line of the section.';
  const CHECKBOX_LINE = `- [ ] ${OBLIGATION_KEY} pending`;
  const OBLIGATION_DOC_TEXT = `---\ntitle: Duty\ntype: note\nissue: ${OBLIGATION_KEY}\n---\n## Unresolved questions\n\n  ${SECTION_FIRST_LINE}\nsecond line.\n${CHECKBOX_LINE}\n- [ ] ${OTHER_KEY} other\n`;

  function ingestedWithRules(): void {
    writeFileSync(join(projectRoot, OBLIGATION_DOC_REL), OBLIGATION_DOC_TEXT);
    writeConfig({ memory: OBLIGATION_MEMORY });
    const result = pdks('memory', 'ingest');
    if (result.status !== 0) throw new Error(`fixture ingest failed: ${result.stderr}`);
  }

  // A command that answers every row regardless of the key carries `AB-2`; one that
  // reshapes the rows, cuts them at a limit, or copies the clock instead of the DB stamp
  // diverges from `listObligations` on the same database.
  it('--json carries the DB stamp and the rows listObligations returns for the same DB', () => {
    ingestedWithRules();
    const db = openIndex();
    const expected = listObligations({ db, key: OBLIGATION_KEY });
    expect(expected.map((row) => [row.sectionId, row.text.trim().split('\n')[0]])).toEqual([
      [OBLIGATION_SECTION_ID, SECTION_FIRST_LINE],
      [OBLIGATION_SECTION_ID, CHECKBOX_LINE],
    ]);
    expect(listObligations({ db, key: OTHER_KEY })).toHaveLength(1);

    const result = pdks('memory', 'obligations', OBLIGATION_KEY, '--json');

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      ingestedAt: describeMemoryIndex({ db }).ingestedAt,
      obligations: expected,
    });
  });

  // The section body starts with the blank line under its heading and an indented line, as
  // rfcs writes it: a table that prints the first line as stored shows an empty column.
  // A table that prints the whole section body spreads one row over three lines; one that
  // folds the columns with spaces hands `cut -f1` a truncated id; one that prints the
  // other key's row, or the clock instead of the DB stamp, diverges from the pinned bytes.
  it('prints the stamp header and one line per row as the section id, a tab, and the first line of the text', () => {
    ingestedWithRules();
    const stamp = describeMemoryIndex({ db: openIndex() }).ingestedAt;

    const result = pdks('memory', 'obligations', OBLIGATION_KEY);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(
      [
        `# ingested at ${stamp}`,
        `${OBLIGATION_SECTION_ID}${TABLE_SEPARATOR}${SECTION_FIRST_LINE}`,
        `${OBLIGATION_SECTION_ID}${TABLE_SEPARATOR}${CHECKBOX_LINE}`,
        '',
      ].join('\n'),
    );
  });

  // A tab inside the text is read by `cut -f2` as a third column; the table keeps two.
  it('prints a tab inside the text as a space, so each line keeps two tab-separated columns', () => {
    writeFileSync(join(projectRoot, 'notes/tabbed.md'), `## Tabbed\n- [ ] ${NO_ROW_KEY}\tsplit\n`);
    ingestedWithRules();

    const result = pdks('memory', 'obligations', NO_ROW_KEY);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trimEnd().split('\n').slice(1)).toEqual([
      `notes/tabbed#tabbed${TABLE_SEPARATOR}- [ ] ${NO_ROW_KEY} split`,
    ]);
  });

  // A key with no row answered with exit 2, or with a stdout that is not the documented
  // shape, reads as a failed command rather than an empty answer.
  it('answers a key with no row with exit 0, the header alone, and an empty list', () => {
    ingestedWithRules();
    const stamp = describeMemoryIndex({ db: openIndex() }).ingestedAt;

    const table = pdks('memory', 'obligations', NO_ROW_KEY);
    const json = pdks('memory', 'obligations', NO_ROW_KEY, '--json');

    expect(table.status, table.stderr).toBe(0);
    expect(table.stdout).toBe(`# ingested at ${stamp}\n`);
    expect(json.status, json.stderr).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual({ ingestedAt: stamp, obligations: [] });
  });

  // Without rules, zero rows and "no obligation" are the same answer, so the command must
  // refuse: one that answers the header and exit 0 reads as a clean sweep; one that treats
  // an empty list as declared rules does the same; a refusal shaped as usage, or as more
  // than one line, hides the key the user has to declare. The index exists here, so the
  // only reason left to refuse is the rules.
  it.each([
    { state: 'absent', memory: MEMORY },
    { state: 'an empty list', memory: { ...MEMORY, obligations: [] } },
  ])(
    'exits 2 with one stderr line naming memory.obligations when the rules are $state',
    ({ memory }) => {
      ingestedWithRules();
      writeConfig({ memory });

      const table = pdks('memory', 'obligations', OBLIGATION_KEY);
      const json = pdks('memory', 'obligations', OBLIGATION_KEY, '--json');

      for (const result of [table, json]) {
        expect(result.status).toBe(2);
        expect(result.stdout).toBe('');
        expect(result.stderr.trimEnd().split('\n')).toHaveLength(1);
        expect(result.stderr).toContain('memory.obligations');
        expect(result.stderr).not.toMatch(/usage/i);
      }
    },
  );

  // A verb that answers with no key, or reads only the first of two keys, exits 0 on a
  // shape the table never promised.
  it.each([{ args: ['obligations'] }, { args: ['obligations', OBLIGATION_KEY, OTHER_KEY] }])(
    'pdks memory $args exits 2 with usage and an empty stdout',
    ({ args }) => {
      ingestedWithRules();

      const result = pdks('memory', ...args);

      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toMatch(/usage/i);
    },
  );

  // A first ingest that failed leaves a database file with the schema and no stamp; a
  // check on the file alone answers `# ingested at null` and exit 0.
  it('exits 2 with the ingest hint over a memory.db no ingest has committed', () => {
    writeConfig({ memory: OBLIGATION_MEMORY });
    openMemoryDb({ path: join(projectRoot, DB_REL) }).close();

    const result = pdks('memory', 'obligations', OBLIGATION_KEY);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr.trim()).toBe(NO_INDEX_LINE);
  });

  // `openMemoryDb` creates an empty database at a missing path: a verb that opens before
  // it checks answers zero rows from an index nobody built and leaves the file behind.
  it('exits 2 with the ingest hint before any ingest and creates neither the index nor its directory', () => {
    writeConfig({ memory: OBLIGATION_MEMORY });

    const result = pdks('memory', 'obligations', OBLIGATION_KEY);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr.trim()).toBe(NO_INDEX_LINE);
    expect(existsSync(join(projectRoot, DB_DIR_REL))).toBe(false);
  });
});

describe('argument shapes outside the command table', () => {
  // Each shape is run against a prepared index so the only reason left to refuse is the
  // argument list: a bare `memory` that lists the index, an `ingest` that swallows an extra
  // word or `--json`, a `show` that answers with no identifier, a `lint` or `stats` that
  // ignores a trailing word, all exit 0 on something the table never promised.
  it.each([
    { args: [] },
    { args: ['lint', 'extra'] },
    { args: ['stats', 'extra'] },
    { args: ['ingest', 'extra'] },
    { args: ['ingest', '--json'] },
    { args: ['show'] },
    { args: ['search'] },
    { args: ['search', 'x', '--limit', '5'] },
    { args: ['show', DOC_ID, '--rebuild'] },
  ])('pdks memory $args exits 2 with usage and an empty stdout', ({ args }) => {
    ingested();

    const result = pdks('memory', ...args);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/usage/i);
  });

  // The root usage line is where a user learns the command and its verbs exist. The line
  // itself starts with `usage:`, so the verb is looked for inside the memory group's
  // parentheses, where a bare `toContain('usage')` would match the prefix.
  it('the root usage line names pdks memory with lint, stats, obligations, and usage', () => {
    const result = pdks();

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('pdks memory');
    const group = /pdks memory \(([^)]*)\)/.exec(result.stderr)?.[1] ?? '';
    for (const verb of ['lint', 'stats', 'obligations', 'usage']) {
      expect(group, verb).toMatch(new RegExp(`\\b${verb}\\b`));
    }
  });

  // The memory usage line is where a user learns which verbs the area answers; one that
  // still lists only the first three sends them to `--help` for a verb that exists.
  it('the memory usage line names lint, stats, obligations, and usage', () => {
    const result = pdks('memory');

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('pdks memory lint');
    expect(result.stderr).toContain('pdks memory stats');
    expect(result.stderr).toContain('pdks memory obligations');
    expect(result.stderr).toContain('pdks memory usage');
  });
});

describe('pdks memory usage and the memory log', () => {
  /**
   * Three checkbox lines under one key: two in the first section, one in the second. The
   * obligations answer orders rows by section id, so the second section's row comes first,
   * and the first section's id appears twice. The rules and the key are fixture values.
   */
  const LOG_KEY = 'LG-1';
  const LOG_OBLIGATION_MEMORY: MemoryConfig = {
    ...MEMORY,
    obligations: [{ line: '^\\s*[-*] \\[ \\]', key: '[A-Z]+-[0-9]+' }],
  };
  const LOG_DUTY_REL = 'notes/log-duty.md';
  const LOG_DUTY_TODO_ID = 'notes/log-duty#todo';
  const LOG_DUTY_LATER_ID = 'notes/log-duty#later';
  const LOG_DUTY_TEXT = `---\ntitle: Log duty\ntype: note\n---\n## Todo\n\n- [ ] ${LOG_KEY} pending\n- [ ] ${LOG_KEY} again\n\n## Later\n\n- [ ] ${LOG_KEY} afterwards\n`;
  const LOG_DUTY_ROW_IDS = [LOG_DUTY_LATER_ID, LOG_DUTY_TODO_ID, LOG_DUTY_TODO_ID];
  /** A line cut off mid-write, as a reader sees while the writer's process is still running. */
  const TRUNCATED_LINE = '{"at":"2026-09-28T00:00';
  const NO_LOG_PREFIX = `pdks memory: no memory log at ${LOG_REL}`;

  const logPath = () => join(projectRoot, LOG_REL);
  const logLines = (): string[] => readFileSync(logPath(), 'utf-8').split('\n').filter(Boolean);
  const logEntries = (): unknown[] => logLines().map((line) => JSON.parse(line));

  // A line written only under `--json`, one whose `query` is the first word or the argument
  // list, one whose results are ids alone, or one that drops the match path a miss count
  // reads diverges from the `--json` answer the same call printed; a line with no `at`, or
  // one in local time, cannot bound the summary's span.
  it('search appends one line per successful call, table or --json, with the answered ids and match paths in output order', async () => {
    ingested();
    const db = openIndex();
    const shared = await searchMemory({ db, query: SHARED_QUERY, config: MEMORY });
    const joined = await searchMemory({ db, query: JOINED_QUERY.join(' '), config: MEMORY });
    expect(shared).toHaveLength(2);
    expect(joined.map((r) => r.id)).toEqual([SECTION_ID]);
    const asLogged = (hits: typeof shared) =>
      hits.map((r) => ({ id: r.id, matchPath: r.matchPath }));

    const json = pdks('memory', 'search', SHARED_QUERY, '--json');
    const table = pdks('memory', 'search', SHARED_QUERY);
    const words = pdks('memory', 'search', ...JOINED_QUERY);

    expect(json.status, json.stderr).toBe(0);
    expect(table.status, table.stderr).toBe(0);
    expect(words.status, words.stderr).toBe(0);
    expect(JSON.parse(json.stdout).results).toEqual(shared);
    expect(logEntries()).toEqual([
      {
        at: expect.stringMatching(ISO_UTC),
        command: 'search',
        query: SHARED_QUERY,
        results: asLogged(shared),
      },
      {
        at: expect.stringMatching(ISO_UTC),
        command: 'search',
        query: SHARED_QUERY,
        results: asLogged(shared),
      },
      {
        at: expect.stringMatching(ISO_UTC),
        command: 'search',
        query: JOINED_QUERY.join(' '),
        results: asLogged(joined),
      },
    ]);
  });

  // A `show` line that names every section of the document, or the document of a requested
  // section, counts documents the caller never opened; a `matchPath` on a show or obligations
  // result reads as a search to the miss count; an obligations line carrying the key rather
  // than the section id is one the summary cannot map to a document; one that folds the two
  // rows of one section into one id, or lists the sections in file order, diverges from
  // the rows the command printed.
  it('show and obligations append one line each: the requested id, or one section id per row answered in output order, without a match path', () => {
    writeFileSync(join(projectRoot, LOG_DUTY_REL), LOG_DUTY_TEXT);
    writeConfig({ memory: LOG_OBLIGATION_MEMORY });
    const ingest = pdks('memory', 'ingest');
    expect(ingest.status, ingest.stderr).toBe(0);
    expect(listObligations({ db: openIndex(), key: LOG_KEY }).map((r) => r.sectionId)).toEqual(
      LOG_DUTY_ROW_IDS,
    );

    const document = pdks('memory', 'show', DOC_ID);
    const section = pdks('memory', 'show', SECTION_ID, '--json');
    const obligations = pdks('memory', 'obligations', LOG_KEY);

    expect(document.status, document.stderr).toBe(0);
    expect(section.status, section.stderr).toBe(0);
    expect(obligations.status, obligations.stderr).toBe(0);
    expect(logEntries()).toEqual([
      {
        at: expect.stringMatching(ISO_UTC),
        command: 'show',
        query: DOC_ID,
        results: [{ id: DOC_ID }],
      },
      {
        at: expect.stringMatching(ISO_UTC),
        command: 'show',
        query: SECTION_ID,
        results: [{ id: SECTION_ID }],
      },
      {
        at: expect.stringMatching(ISO_UTC),
        command: 'obligations',
        query: LOG_KEY,
        results: LOG_DUTY_ROW_IDS.map((id) => ({ id })),
      },
    ]);
  });

  // A line appended before the command has its answer records a failed `show` as a hit on
  // the id it refused; a line from `ingest`, `lint`, `stats`, or `usage` carries no returned
  // id and pads the entry count the header reports; a `--rebuild` that clears `.polydeukes/`
  // state with the index throws away the only record of past queries.
  it('appends nothing from ingest, lint, stats, usage, or a refused show, and keeps the log across ingest --rebuild', () => {
    ingested();
    for (const args of [['lint'], ['stats'], ['show', UNKNOWN_ID]]) {
      pdks('memory', ...args);
    }
    expect(existsSync(logPath())).toBe(false);
    const first = pdks('memory', 'search', SHARED_QUERY);
    expect(first.status, first.stderr).toBe(0);
    const written = logLines();
    expect(written).toHaveLength(1);

    const rebuild = pdks('memory', 'ingest', '--rebuild');
    const usage = pdks('memory', 'usage');
    const refused = pdks('memory', 'show', UNKNOWN_ID);
    pdks('memory', 'lint');
    pdks('memory', 'stats');

    expect(rebuild.status, rebuild.stderr).toBe(0);
    expect(usage.status, usage.stderr).toBe(0);
    expect(refused.status).toBe(2);
    expect(logLines()).toEqual(written);
  });

  // A search refused for a missing index that still appends a line records a query nobody
  // answered, under a `.polydeukes/` directory the refusal itself created.
  it('a search with no index appends nothing and creates no log', () => {
    writeConfig({ memory: MEMORY });

    const result = pdks('memory', 'search', SHARED_QUERY);

    expect(result.status).toBe(2);
    expect(existsSync(logPath())).toBe(false);
  });

  // A summary that answers an empty header or `0 entries` with exit 0 over a log nobody
  // wrote reads as "every document is dead"; a refusal on exit 1 is indistinguishable from
  // a violation; a refusal that names the index sends the user to an ingest that will not
  // help. The index is present, so the log is the only thing missing.
  it.each([{ args: ['usage'] }, { args: ['usage', '--json'] }])(
    'pdks memory $args exits 2 with one stderr line naming the log path and an empty stdout when no log exists',
    ({ args }) => {
      ingested();
      expect(existsSync(logPath())).toBe(false);

      const result = pdks('memory', ...args);

      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr.trimEnd().split('\n')).toHaveLength(1);
      expect(result.stderr.startsWith(NO_LOG_PREFIX)).toBe(true);
    },
  );

  // A log whose only line is cut off parses to zero entries: a summary that answers it
  // reports every document dead over a record that holds no query, with exit 0 and a
  // header reading `null .. null`. The index is present, so the log is what is refused.
  it('exits 2 with the no-log line and an empty stdout over a log with no parseable line', () => {
    ingested();
    writeFileSync(logPath(), TRUNCATED_LINE);

    const result = pdks('memory', 'usage');

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr.startsWith(NO_LOG_PREFIX)).toBe(true);
  });

  // With neither index nor log, a refusal that names the log sends the user to a `search`
  // that the missing index refuses in turn; the ingest hint is the one step that unblocks.
  it('exits 2 with the ingest hint when neither the index nor the log exists', () => {
    writeConfig({ memory: MEMORY });
    expect(existsSync(join(projectRoot, DB_DIR_REL))).toBe(false);

    const result = pdks('memory', 'usage');

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr.trim()).toBe(NO_INDEX_LINE);
  });

  // With a log but no committed index, every logged id maps to no document: a summary that
  // answers it lists nothing as dead and nothing as hot with exit 0. The log is present, so
  // the index is the only thing missing.
  it('exits 2 with the ingest hint over a log whose index no ingest has committed', () => {
    writeConfig({ memory: MEMORY });
    openMemoryDb({ path: join(projectRoot, DB_REL) }).close();
    writeFileSync(
      logPath(),
      `${JSON.stringify({ at: '2026-09-28T00:00:00.000Z', command: 'show', query: DOC_ID, results: [{ id: DOC_ID }] })}\n`,
    );

    const result = pdks('memory', 'usage');

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr.trim()).toBe(NO_INDEX_LINE);
  });

  // The table is pinned by value over four logged calls and one cut-off line: a header
  // counting the cut-off line says 5, a hot count over sections rather than documents
  // gives `alpha` a different number than the two calls that named it, a dead line for
  // `zeta` or none for `gamma` misreads the log, a miss counted once folds the repeated
  // no-hit search, and a column joined with spaces hands `cut -f` the wrong field. Two
  // rows of every kind are not needed here; the ordering rules have their own unit tests.
  // The config is removed before `usage` runs, so a summary that loads it refuses.
  it('prints the log span header, then hot, dead, and miss lines tab-separated, and --json the same summary under the DB stamp', async () => {
    ingested();
    const db = openIndex();
    const shared = await searchMemory({ db, query: SHARED_QUERY, config: MEMORY });
    expect(shared.map((r) => r.conceptId).sort()).toEqual([DOC_ID, 'notes/guides/zeta']);
    expect(shared.some((r) => r.matchPath !== 'or')).toBe(true);
    for (const args of [
      ['search', SHARED_QUERY],
      ['search', NO_HIT_QUERY],
      ['show', DOC_ID],
      ['search', NO_HIT_QUERY, '--json'],
    ]) {
      const result = pdks('memory', ...args);
      expect(result.status, result.stderr).toBe(0);
    }
    const entries = logEntries() as { at: string }[];
    expect(entries).toHaveLength(4);
    appendFileSync(logPath(), TRUNCATED_LINE);
    const from = entries[0]?.at;
    const to = entries[3]?.at;
    rmSync(join(projectRoot, CONFIG_REL));

    const table = pdks('memory', 'usage');
    const json = pdks('memory', 'usage', '--json');

    expect(table.status, table.stderr).toBe(0);
    expect(table.stderr).toBe('');
    expect(table.stdout).toBe(
      [
        `# log ${from} .. ${to} · 4 entries`,
        `hot${TABLE_SEPARATOR}2${TABLE_SEPARATOR}${DOC_ID}`,
        `hot${TABLE_SEPARATOR}1${TABLE_SEPARATOR}notes/guides/zeta`,
        `dead${TABLE_SEPARATOR}notes/gamma`,
        `miss${TABLE_SEPARATOR}2${TABLE_SEPARATOR}${NO_HIT_QUERY}`,
        '',
      ].join('\n'),
    );
    expect(json.status, json.stderr).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual({
      ingestedAt: describeMemoryIndex({ db }).ingestedAt,
      from,
      to,
      entries: 4,
      hot: [
        { id: DOC_ID, count: 2 },
        { id: 'notes/guides/zeta', count: 1 },
      ],
      dead: ['notes/gamma'],
      misses: [{ query: NO_HIT_QUERY, count: 2 }],
    });
  });

  // A `usage` that ignores a trailing word exits 0 on a shape the table never promised.
  it('pdks memory usage extra exits 2 with usage and an empty stdout', () => {
    ingested();

    const result = pdks('memory', 'usage', 'extra');

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/usage/i);
  });

  // A log path that cannot be appended to (here a directory, as a read-only or full
  // `.polydeukes/` would also refuse) must not turn an answered query into exit 2.
  it('answers a search with exit 0 and the same stdout when the log cannot be written', async () => {
    ingested();
    const expected = await searchMemory({ db: openIndex(), query: SHARED_QUERY, config: MEMORY });
    mkdirSync(logPath());

    const result = pdks('memory', 'search', SHARED_QUERY, '--json');

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).results).toEqual(expected);
  });

  // A tab left in the missed query adds a fourth column to the table line; the JSON form
  // keeps the query as it was run.
  it('prints a tab inside a missed query as a space in the table and keeps it in --json', () => {
    ingested();
    const query = 'zz-no\tsuch-491';
    expect(pdks('memory', 'search', query).status).toBe(0);

    const table = pdks('memory', 'usage');
    const json = pdks('memory', 'usage', '--json');

    expect(table.stdout.split('\n')).toContain(
      `miss${TABLE_SEPARATOR}1${TABLE_SEPARATOR}zz-no such-491`,
    );
    expect(JSON.parse(json.stdout).misses).toEqual([{ query, count: 1 }]);
  });
});

describe('pdks memory supersession and the superseded search results', () => {
  /**
   * The line marker and key pattern are fixture values. Three chained documents share one
   * matched body: `chain-new` supersedes `chain-old` and `chain-oldest`, `chain-old`
   * supersedes `chain-oldest` and is also stale, so one line carries both markers and one
   * carries two newer ids. The oldest sorts first by id, so a search that ignores supersession
   * answers it first. A fourth document declares a target no document resolves.
   */
  const CHAIN_QUERY = 'chain-term';
  const CHAIN_BODY = `${CHAIN_QUERY} here.`;
  const SUPERSESSION_MEMORY: MemoryConfig = {
    ...MEMORY,
    supersedes: [{ line: 'Supersedes:', key: '(?<=doc:)[a-z-]+', direction: 'supersedes' }],
  };
  const NEW_ID = 'notes/chain-new';
  const OLD_ID = 'notes/chain-old';
  const OLDEST_ID = 'notes/chain-oldest';
  const ORPHAN_ID = 'notes/chain-orphan';
  const MISSING_TARGET = 'nowhere-doc';
  const CHAIN_DOCS: [string, string][] = [
    [
      'notes/chain-new.md',
      `---\ntitle: Chain new\ntype: note\n---\n## Topic\n\n${CHAIN_BODY}\n\n## Notes\n\nSupersedes: doc:chain-old and doc:chain-oldest\n`,
    ],
    [
      'notes/chain-old.md',
      `---\ntitle: Chain old\ntype: note\nstale_after: 2000-01-01T00:00:00Z\n---\n## Topic\n\n${CHAIN_BODY}\n\n## Notes\n\nSupersedes: doc:chain-oldest\n`,
    ],
    [
      'notes/chain-oldest.md',
      `---\ntitle: Chain oldest\ntype: note\n---\n## Topic\n\n${CHAIN_BODY}\n`,
    ],
    [
      'notes/chain-orphan.md',
      `---\ntitle: Chain orphan\ntype: note\n---\n## Topic\n\nSupersedes: doc:${MISSING_TARGET}\n`,
    ],
  ];
  const SUPERSEDED_MARK = ', superseded by ';

  function ingestedChain(): void {
    for (const [relative, text] of CHAIN_DOCS) writeFileSync(join(projectRoot, relative), text);
    writeConfig({ memory: SUPERSESSION_MEMORY });
    const result = pdks('memory', 'ingest');
    if (result.status !== 0) throw new Error(`fixture ingest failed: ${result.stderr}`);
  }

  // A status column that never prints the marker, prints it before `, stale`, joins two ids
  // with a comma, or prints it on the newer document passes an exit-code check; a `--json`
  // that drops `supersededBy` diverges from `searchMemory`. The oracle is checked first so a
  // search that ranks the superseded sections first fails here rather than in the table.
  it('search appends ", superseded by <id> <id>" after the stale marker in the status column and --json carries supersededBy', async () => {
    ingestedChain();
    const db = openIndex();
    const expected = await searchMemory({ db, query: CHAIN_QUERY, config: SUPERSESSION_MEMORY });
    expect(expected.map((hit) => [hit.id, hit.stale, hit.supersededBy])).toEqual([
      [`${NEW_ID}#topic`, false, []],
      [`${OLD_ID}#topic`, true, [NEW_ID]],
      [`${OLDEST_ID}#topic`, false, [NEW_ID, OLD_ID]],
    ]);

    const table = pdks('memory', 'search', CHAIN_QUERY);
    const json = pdks('memory', 'search', CHAIN_QUERY, '--json');

    expect(table.status, table.stderr).toBe(0);
    const statusColumn = table.stdout
      .trimEnd()
      .split('\n')
      .slice(1)
      .map((line) => line.split(TABLE_SEPARATOR)[2]);
    expect(statusColumn).toEqual([
      'stable',
      `stable${STALE_MARK}${SUPERSEDED_MARK}${NEW_ID}`,
      `stable${SUPERSEDED_MARK}${NEW_ID} ${OLD_ID}`,
    ]);
    expect(json.status, json.stderr).toBe(0);
    expect(JSON.parse(json.stdout).results).toEqual(expected);
  });

  // A table that prints the pairs older-first, joins them with spaces, drops the stamp header,
  // or includes the sibling pair (new, oldest) that the chain through `chain-old` never passes
  // diverges from the pinned bytes; a `--json` keyed `pairs` or lacking the stamp diverges from
  // `listSupersession` under the same stamp.
  it('prints the stamp header and one <newer>\\t<older> line per pair of the chain, and --json as { ingestedAt, supersession }', () => {
    ingestedChain();
    const db = openIndex();
    const expected = listSupersession({ db, id: OLD_ID });
    expect(expected).toEqual([
      { newer: NEW_ID, older: OLD_ID },
      { newer: OLD_ID, older: OLDEST_ID },
    ]);
    const stamp = describeMemoryIndex({ db }).ingestedAt;

    const table = pdks('memory', 'supersession', OLD_ID);
    const json = pdks('memory', 'supersession', OLD_ID, '--json');

    expect(table.status, table.stderr).toBe(0);
    expect(table.stderr).toBe('');
    expect(table.stdout).toBe(
      [
        `# ingested at ${stamp}`,
        `${NEW_ID}${TABLE_SEPARATOR}${OLD_ID}`,
        `${OLD_ID}${TABLE_SEPARATOR}${OLDEST_ID}`,
        '',
      ].join('\n'),
    );
    expect(json.status, json.stderr).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual({ ingestedAt: stamp, supersession: expected });
  });

  // A document with no pair answered with exit 2, or with a stdout that is not the header,
  // reads as a failed command rather than an empty chain.
  it('answers a document with no pair with exit 0, the header alone, and an empty list', () => {
    ingestedChain();
    const stamp = describeMemoryIndex({ db: openIndex() }).ingestedAt;

    const table = pdks('memory', 'supersession', DOC_ID);
    const json = pdks('memory', 'supersession', DOC_ID, '--json');

    expect(table.status, table.stderr).toBe(0);
    expect(table.stdout).toBe(`# ingested at ${stamp}\n`);
    expect(json.status, json.stderr).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual({ ingestedAt: stamp, supersession: [] });
  });

  // An unknown document answered with the header and exit 0 is indistinguishable from a
  // document with no pair; `show` refuses the same identifier with exit 2 and an empty stdout.
  it.each([{ args: [UNKNOWN_ID] }, { args: [UNKNOWN_ID, '--json'] }])(
    'refuses an unknown document $args as show does: exit 2, empty stdout, the id on stderr',
    ({ args }) => {
      ingestedChain();

      const result = pdks('memory', 'supersession', ...args);

      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain(UNKNOWN_ID);
    },
  );

  // A verb that answers with no document, or reads only the first of two, exits 0 on a shape
  // the table never promised.
  it.each([{ args: ['supersession'] }, { args: ['supersession', OLD_ID, NEW_ID] }])(
    'pdks memory $args exits 2 with usage and an empty stdout',
    ({ args }) => {
      ingestedChain();

      const result = pdks('memory', ...args);

      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toMatch(/usage/i);
    },
  );

  // `supersession` needs the index alone; a verb that loads the config first refuses in a tree
  // whose config is gone while the index it asks about is still there.
  it('answers without a config file once the index exists', () => {
    ingestedChain();
    rmSync(join(projectRoot, CONFIG_REL));

    const result = pdks('memory', 'supersession', OLD_ID, '--json');

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).supersession).toHaveLength(2);
  });

  // `openMemoryDb` creates an empty database at a missing path: a verb that opens before it
  // checks answers "unknown document" from an index nobody built and leaves the file behind.
  it('exits 2 with the ingest hint before any ingest and creates neither the index nor its directory', () => {
    writeConfig({ memory: SUPERSESSION_MEMORY });

    const result = pdks('memory', 'supersession', OLD_ID);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr.trim()).toBe(NO_INDEX_LINE);
    expect(existsSync(join(projectRoot, DB_DIR_REL))).toBe(false);
  });

  // A lint that stays at exit 0 over an unresolved or unquoted supersession lets a script
  // read the index as clean; a line that folds the direction and the raw target, or names
  // the older document as the id of the unquoted row, diverges from the pinned form; the
  // two new rules come after `untyped` and `unresolved-supersession` before `unquoted`.
  it('lint exits 1 with an unresolved-supersession line and an unquoted line per pair, and --json as the lintMemory value', () => {
    writeFileSync(join(projectRoot, UNTYPED_DOC_REL), UNTYPED_DOC_TEXT);
    ingestedChain();
    const db = openIndex();
    const expected = lintMemory({ db });
    expect(expected.violations.map((v) => v.rule)).toEqual([
      'untyped',
      'unresolved-supersession',
      'unquoted',
      'unquoted',
      'unquoted',
    ]);
    const stamp = describeMemoryIndex({ db }).ingestedAt;

    const table = pdks('memory', 'lint');
    const json = pdks('memory', 'lint', '--json');

    expect(table.status).toBe(1);
    expect(table.stderr).toBe('');
    expect(table.stdout).toBe(
      [
        `# ingested at ${stamp}`,
        'untyped  notes/untyped',
        `unresolved-supersession  ${ORPHAN_ID}  supersedes ${MISSING_TARGET}`,
        `unquoted  ${NEW_ID}  ${OLD_ID}`,
        `unquoted  ${NEW_ID}  ${OLDEST_ID}`,
        `unquoted  ${OLD_ID}  ${OLDEST_ID}`,
        '',
      ].join('\n'),
    );
    expect(json.status).toBe(1);
    expect(JSON.parse(json.stdout)).toEqual({ ingestedAt: stamp, violations: expected.violations });
  });

  // The usage lines are where a user learns the verb exists; one that still lists the verbs
  // before this one sends them to `--help` for a verb that answers.
  it('the root and memory usage lines name supersession', () => {
    const rootUsage = pdks();
    const memoryUsage = pdks('memory');

    expect(rootUsage.status).toBe(2);
    const group = /pdks memory \(([^)]*)\)/.exec(rootUsage.stderr)?.[1] ?? '';
    expect(group).toMatch(/\bsupersession\b/);
    expect(memoryUsage.status).toBe(2);
    expect(memoryUsage.stderr).toContain('pdks memory supersession');
  });
});
