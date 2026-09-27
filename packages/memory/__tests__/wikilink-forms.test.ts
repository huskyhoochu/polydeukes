import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ingestMemory } from '../src/ingest-memory.ts';
import { lintMemory } from '../src/lint-memory.ts';
import type { MemoryConfig } from '../src/memory-config.ts';
import { openMemoryDb } from '../src/schema.ts';

// A wikilink target may carry an alias (`|`), a heading or block fragment (`#`), surrounding
// spaces, a different letter case, or a folder prefix, and the text inside the brackets is
// stored as written while resolution strips the decorations. Attachments in Obsidian's
// accepted formats and the footnote spelling `[[n]](url)` are not links at all. `untyped` is
// reported only in an index where at least one document declares a type.

// Globs are fixture values: nothing in the functions knows this repository's layout.
const INCLUDE = ['notes/**/*.md'];
const BASE_CONFIG: MemoryConfig = { include: INCLUDE };

let tmp: string;
let root: string;
const opened: DatabaseSync[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pdks-memory-wikilink-forms-'));
  root = join(tmp, 'tree');
  mkdirSync(root);
});

afterEach(() => {
  for (const db of opened.splice(0)) {
    try {
      db.close();
    } catch {
      // already closed by the test
    }
  }
  rmSync(tmp, { recursive: true, force: true });
});

function open(name: string): DatabaseSync {
  const db = openMemoryDb({ path: join(tmp, 'db', name) });
  opened.push(db);
  return db;
}

function writeDoc(relative: string, text: string): void {
  const path = join(root, relative);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

/** A document whose sections are given as `[heading text, body]` pairs — anchors come from the slug. */
const page = (title: string, ...sections: [string, string][]): string =>
  `---\ntitle: ${title}\n---\n${sections
    .map(([heading, body]) => `## ${heading}\n${body}\n`)
    .join('')}`;

type EdgeRow = {
  src_section: string;
  form: string;
  raw_target: string;
  dst_concept: string | null;
  dst_section: string | null;
};

const row = (
  src_section: string,
  form: string,
  raw_target: string,
  dst_concept: string | null,
  dst_section: string | null,
): EdgeRow => ({ src_section, form, raw_target, dst_concept, dst_section });

const key = (r: EdgeRow): string => `${r.src_section}\u0000${r.form}\u0000${r.raw_target}`;
/** Rows in one code-unit order on both sides, so neither the SQL collation nor rowids decide a comparison. */
const sorted = (rows: EdgeRow[]): EdgeRow[] =>
  [...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
const edgeRows = (db: DatabaseSync): EdgeRow[] =>
  sorted(
    db
      .prepare('SELECT src_section, form, raw_target, dst_concept, dst_section FROM edge')
      .all() as EdgeRow[],
  );

describe('ingestMemory — wikilink aliases and fragments', () => {
  // A resolver that compares the whole bracket text leaves every decorated row NULL; one
  // that cuts only at `|` and not at `\|` leaves the table-row alias NULL; one that matches
  // the fragment against the anchor alone loses `Section Title`, against the slug alone
  // loses `section-title`; one that takes the first fragment of `a#Section Title` loses the
  // section; one that fills a section for `^blk` or for the H3 heading invents a row that
  // does not exist; one that reads an empty name as "no document" leaves `#Src Own`
  // unresolved instead of pointing at the source's own section; one that stores a cleaned
  // target changes the `raw_target` primary key and the text `show` prints. B carries a
  // `blk` section so a resolver that drops the `^` and matches the rest fills a section for
  // the block link; its `{#MEMORY-05}` anchor differs from the slug of its own text, so a
  // resolver that slugs every fragment before comparing loses it; `own|a` names no document,
  // so a fallback that runs on the undecorated text never reaches the source's `own` section.
  it('strips alias, heading, and block fragments for resolution while storing the bracket text as written', () => {
    writeDoc(
      'notes/A.md',
      page(
        'A',
        [
          'Src',
          [
            '[[B|alias]] [[B#Section Title]] [[B#section-title]] [[B#a#Section Title]] [[B#^blk]] [[B#H3 Title]] [[#Src Own]] [[B#MEMORY-05]] [[own|a]]',
            '',
            '| cell |',
            '|---|',
            '| [[B\\|alias]] |',
          ].join('\n'),
        ],
        ['Src Own', 'own text.'],
        ['own', 'more own text.'],
      ),
    );
    writeDoc(
      'notes/B.md',
      page(
        'B',
        ['Section Title', 'section text.\n### H3 Title\nh3 text.'],
        ['blk', 'block text.'],
        ['T {#MEMORY-05}', 'explicit anchor.'],
      ),
    );
    const db = open('fragments.db');
    ingestMemory({ db, root, config: BASE_CONFIG });

    expect(edgeRows(db)).toEqual(
      sorted([
        row('notes/A#src', 'wiki', 'B|alias', 'notes/B', null),
        row('notes/A#src', 'wiki', 'B\\|alias', 'notes/B', null),
        row('notes/A#src', 'wiki', 'B#Section Title', 'notes/B', 'notes/B#section-title'),
        row('notes/A#src', 'wiki', 'B#section-title', 'notes/B', 'notes/B#section-title'),
        row('notes/A#src', 'wiki', 'B#a#Section Title', 'notes/B', 'notes/B#section-title'),
        row('notes/A#src', 'wiki', 'B#^blk', 'notes/B', null),
        row('notes/A#src', 'wiki', 'B#H3 Title', 'notes/B', null),
        row('notes/A#src', 'wiki', 'B#MEMORY-05', 'notes/B', 'notes/B#MEMORY-05'),
        row('notes/A#src', 'wiki', '#Src Own', 'notes/A', 'notes/A#src-own'),
        row('notes/A#src', 'wiki', 'own|a', 'notes/A', 'notes/A#own'),
      ]),
    );
  });
});

describe('ingestMemory — finding the document a wikilink names', () => {
  // A resolver that compares names case-sensitively leaves `b` NULL; one that matches only
  // the last path segment leaves `dir/D` and the full `notes/B` NULL; one that tests a bare
  // string suffix instead of a `/`-bounded one resolves `ir/D`; one that trims only one
  // side leaves `B ` or ` B` NULL.
  it('matches a document name ignoring case, by trailing path, and after trimming spaces', () => {
    writeDoc(
      'notes/A.md',
      page('A', ['Src', '[[b]] [[dir/D]] [[B ]] [[notes/B]] [[ir/D]] [[ B]]']),
    );
    writeDoc('notes/B.md', page('B', ['One', 'b text.']));
    writeDoc('notes/dir/D.md', page('D', ['One', 'd text.']));
    const db = open('names.db');
    ingestMemory({ db, root, config: BASE_CONFIG });

    expect(edgeRows(db)).toEqual(
      sorted([
        row('notes/A#src', 'wiki', 'b', 'notes/B', null),
        row('notes/A#src', 'wiki', 'dir/D', 'notes/dir/D', null),
        row('notes/A#src', 'wiki', 'B ', 'notes/B', null),
        row('notes/A#src', 'wiki', 'notes/B', 'notes/B', null),
        row('notes/A#src', 'wiki', 'ir/D', null, null),
        row('notes/A#src', 'wiki', ' B', 'notes/B', null),
      ]),
    );
  });

  // A resolver that reports every duplicate name as ambiguous leaves `x/Src` NULL; one that
  // picks the first or the shortest-path candidate resolves `z/Src` to some `B` the source
  // never sat beside.
  it('prefers the same-directory document among duplicates and reports an ambiguous name from elsewhere as unresolved', () => {
    writeDoc('notes/x/B.md', page('B x', ['One', 'x text.']));
    writeDoc('notes/y/B.md', page('B y', ['One', 'y text.']));
    writeDoc('notes/x/Src.md', page('Src x', ['Src', '[[B]]']));
    writeDoc('notes/z/Src.md', page('Src z', ['Src', '[[B]]']));
    const db = open('same-dir.db');
    ingestMemory({ db, root, config: BASE_CONFIG });

    expect(edgeRows(db)).toEqual(
      sorted([
        row('notes/x/Src#src', 'wiki', 'B', 'notes/x/B', null),
        row('notes/z/Src#src', 'wiki', 'B', null, null),
      ]),
    );
  });
});

describe('ingestMemory — attachments and footnotes are not wikilinks', () => {
  // A scanner that stores every `[[…]]` adds six unresolved rows for the attachments; one
  // that compares the extension case-sensitively keeps `a.PNG|100`; one that reads the
  // extension before cutting the alias or fragment keeps `a.PNG|100`, `a.png\|100`, and
  // `icon.svg#icon`; one that reads the extension off the whole name rather than its last
  // path segment keeps `img/a.png`; one that treats any dotted name as an attachment drops
  // the two document links; one that drops every `![[…]]` loses the embedded document `B`.
  it('stores no edge for an attachment in an Obsidian format but keeps a dotted document name and an embedded document', () => {
    writeDoc(
      'notes/A.md',
      page('A', [
        'Src',
        '![[a.png]] [[a.PNG|100]] [[a.png\\|100]] [[img/a.png]] [[icon.svg#icon]] ![[doc.pdf#page=3]] [[memory.adr.graph]] [[1011-process.exit]] ![[B]]',
      ]),
    );
    writeDoc('notes/B.md', page('B', ['One', 'b text.']));
    writeDoc('notes/memory.adr.graph.md', page('Graph', ['One', 'graph text.']));
    writeDoc('notes/1011-process.exit.md', page('Exit', ['One', 'exit text.']));
    const db = open('attachments.db');
    ingestMemory({ db, root, config: BASE_CONFIG });

    expect(edgeRows(db)).toEqual(
      sorted([
        row('notes/A#src', 'wiki', 'memory.adr.graph', 'notes/memory.adr.graph', null),
        row('notes/A#src', 'wiki', '1011-process.exit', 'notes/1011-process.exit', null),
        row('notes/A#src', 'wiki', 'B', 'notes/B', null),
      ]),
    );
  });

  // The footnotes sit in one section and the spaced form in another, so a scanner that
  // stores `[[1]](url)` as a wikilink cannot fold into the row the spaced form makes. Such a
  // scanner adds `1` and `전문` under `#one`; one that refuses any `[[…]]` followed by
  // whitespace and `(` loses the row under `#two`. A parenthesis holding prose, with or without
  // spaces, is no URL, so the wikilink before it stays (`#three`).
  it('stores no edge for [[n]](url) but a wiki edge when a space separates the brackets from the parenthesis', () => {
    writeDoc(
      'notes/A.md',
      page(
        'A',
        ['One', '[[1]](https://x) [[전문]](https://x)'],
        ['Two', '[[1]] (https://x)'],
        ['Three', '[[B]](→ `b` 슬러그로 바뀜) [[2단계 인증]](2FA)'],
      ),
    );
    writeDoc('notes/B.md', page('B', ['One', 'text']));
    const db = open('footnotes.db');
    ingestMemory({ db, root, config: BASE_CONFIG });

    expect(edgeRows(db)).toEqual([
      row('notes/A#three', 'wiki', '2단계 인증', null, null),
      row('notes/A#three', 'wiki', 'B', 'notes/B', null),
      row('notes/A#two', 'wiki', '1', null, null),
    ]);
  });
});

describe('lintMemory — untyped only where a type is in use', () => {
  const untyped = (name: string, title: string): void =>
    writeDoc(`notes/${name}.md`, `---\ntitle: ${title}\n---\n## One\n${title} text.\n`);

  // A rule keyed on the presence of the `type` key rather than a non-empty string counts
  // `type: ""` as a type in use.
  it('reports nothing when the only type in the index is an empty string', () => {
    writeDoc('notes/a.md', '---\ntitle: A\ntype: ""\n---\n## One\na text.\n');
    untyped('b', 'B');
    const db = open('empty-type.db');
    ingestMemory({ db, root, config: BASE_CONFIG });

    expect(lintMemory({ db })).toEqual({ violations: [] });
  });

  // A rule that silences `untyped` altogether never reports `b` and `c`; one that reports
  // whenever a type exists anywhere also reports the typed `a`.
  it('reports every document without a type once one document declares one', () => {
    writeDoc('notes/a.md', '---\ntitle: A\ntype: note\n---\n## One\na text.\n');
    untyped('b', 'B');
    untyped('c', 'C');
    const db = open('one-type.db');
    ingestMemory({ db, root, config: BASE_CONFIG });

    expect(lintMemory({ db })).toEqual({
      violations: [
        { rule: 'untyped', id: 'notes/b', detail: '' },
        { rule: 'untyped', id: 'notes/c', detail: '' },
      ],
    });
  });
});

describe('ingestMemory — an incremental ingest over rows the first derivation wrote', () => {
  /** The stored hash of the first derivation: its settings and version as JSON, then the text. */
  const firstDerivationHash = (config: MemoryConfig, text: string): string =>
    createHash('sha256')
      .update(JSON.stringify({ derivation: 1, typeMap: config.typeMap, ticket: config.ticket }))
      .update(text)
      .digest('hex');

  // The database is put into the state the first derivation left it in: a footnote row and
  // an attachment row for the unchanged `A` (OR IGNORE, so the fixture holds whether or not
  // the current parse writes them too), and `A`'s hash as that derivation computed it. An
  // ingest whose derivation number is still 1 sees the file unchanged, skips it, and leaves
  // `1` and `a.png` in the table while a rebuild has neither; one that appends a re-parsed
  // document's edges beside the old ones leaves them too.
  it('re-parses a document whose file is unchanged since the first derivation so the edge set equals a rebuild', () => {
    const text = page('A', ['Src', '[[B]] [[1]](https://x) ![[a.png]]']);
    writeDoc('notes/A.md', text);
    writeDoc('notes/B.md', page('B', ['One', 'b text.']));
    const db = open('stale.db');
    ingestMemory({ db, root, config: BASE_CONFIG });
    db.prepare(
      "INSERT OR IGNORE INTO edge (src_section, form, raw_target, dst_concept, dst_section) VALUES ('notes/A#src', 'wiki', '1', NULL, NULL), ('notes/A#src', 'wiki', 'a.png', NULL, NULL)",
    ).run();
    db.prepare("UPDATE concept SET content_hash = ? WHERE id = 'notes/A'").run(
      firstDerivationHash(BASE_CONFIG, text),
    );

    ingestMemory({ db, root, config: BASE_CONFIG });
    const fresh = open('fresh.db');
    ingestMemory({ db: fresh, root, config: BASE_CONFIG, rebuild: true });

    expect(edgeRows(db)).toEqual(edgeRows(fresh));
    expect(edgeRows(db)).toEqual([row('notes/A#src', 'wiki', 'B', 'notes/B', null)]);
  });
});
