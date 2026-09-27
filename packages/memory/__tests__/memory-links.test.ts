import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { describeMemoryIndex } from '../src/describe-memory-index.ts';
import { ingestMemory } from '../src/ingest-memory.ts';
import type { MemoryConfig } from '../src/memory-config.ts';
import { openMemoryDb } from '../src/schema.ts';
import { showMemory } from '../src/show-memory.ts';

// Links in a section body become `edge` rows at ingest, and every edge is resolved against
// the whole document set once the reconciliation is done. The rows are read back here
// through the table itself, through `showMemory`'s links, and through the index counts.

// Globs are fixture values: nothing in the functions knows this repository's layout.
const INCLUDE = ['notes/**/*.md'];
const BASE_CONFIG: MemoryConfig = { include: INCLUDE };

let tmp: string;
let root: string;
const opened: DatabaseSync[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pdks-memory-links-'));
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

/** A document with no preamble row whose sections are given as `[anchor, body]` pairs. */
const page = (title: string, ...sections: [string, string][]): string =>
  `---\ntitle: ${title}\n---\n${sections
    .map(([anchor, body]) => `## ${anchor} {#${anchor}}\n${body}\n`)
    .join('')}`;

type EdgeRow = {
  src_section: string;
  form: string;
  raw_target: string;
  dst_concept: string | null;
  dst_section: string | null;
};
type Row = Record<string, unknown>;

/** Edge rows by their declared columns, so a rebuild's new rowids never enter a comparison. */
const edgeRows = (db: DatabaseSync): EdgeRow[] =>
  db
    .prepare(
      'SELECT src_section, form, raw_target, dst_concept, dst_section FROM edge ORDER BY src_section, form, raw_target',
    )
    .all() as EdgeRow[];
const conceptRows = (db: DatabaseSync): Row[] =>
  db.prepare('SELECT * FROM concept ORDER BY id').all() as Row[];
const sectionRows = (db: DatabaseSync): Row[] =>
  db
    .prepare('SELECT id, concept_id, ord, doc_title, title, body FROM section ORDER BY id')
    .all() as Row[];

describe('ingestMemory — which link forms become edge rows', () => {
  // A scanner that reads inside backtick or tilde fences or code spans (one that runs over a
  // line break included), or matches the `[…](…)` tail of an image, adds rows for `fenced`,
  // `tilde`, `inline`, `spanned`, and `gamma.md`; one that lets an unclosed backtick run past a
  // blank line loses `kept`; one that reads an unclosed run of backticks as a shorter one
  // pairs every later backtick wrongly and exposes `coded`; one that reads link text on one
  // line loses `wrapped.md`; one that keeps a scheme or a
  // non-.md target adds rows for the URL, `data.json`, or `data.txt#one`; one that reads the
  // frontmatter adds `frontmatter-only`; one keyed on the target alone folds the two
  // sections' `[[beta]]` into one row; one that skips the text before the first H2 loses
  // `pre`. Deleting the source file must take its rows with it and leave the other document's.
  it('stores one row per section, form, and target outside code, images, schemes, and frontmatter, and drops them with the source document', () => {
    writeDoc(
      'notes/alpha.md',
      [
        '---',
        'title: Alpha',
        'see: "[[frontmatter-only]]"',
        '---',
        'Lead with [[pre]].',
        '',
        '## One',
        '[[beta]] and again [[beta]] and [text](beta.md) and [anchored](beta.md#one) and [same](#one).',
        '`[[inline]]` and `[code](inline.md)` stay out.',
        'A span `opens on this line and',
        'closes [[spanned]] on the next` one.',
        'A lone ` backtick never closes.',
        '',
        'The next paragraph keeps [[kept]].',
        '',
        'A run ``` of three with no closing run stays text,',
        'so `[[coded]]` is code and [[real]] is a link.',
        '',
        'A paragraph wrapped inside [the link',
        'text](wrapped.md) still links.',
        '![shot](gamma.md) [site](https://example.com/x.md) [file](data.json) [txt](data.txt#one)',
        '```md',
        '[[fenced]] [f](fenced.md)',
        '```',
        '~~~',
        '[[tilde]] [t](tilde.md)',
        '~~~',
        '## Two',
        '[[beta]]',
        '',
      ].join('\n'),
    );
    writeDoc('notes/beta.md', page('Beta', ['one', 'back to [[alpha]].']));
    const db = open('forms.db');
    ingestMemory({ db, root, config: BASE_CONFIG });

    const stored = (rows: EdgeRow[]) => rows.map((r) => [r.src_section, r.form, r.raw_target]);
    expect(stored(edgeRows(db))).toEqual([
      ['notes/alpha#', 'wiki', 'pre'],
      ['notes/alpha#one', 'markdown', '#one'],
      ['notes/alpha#one', 'markdown', 'beta.md'],
      ['notes/alpha#one', 'markdown', 'beta.md#one'],
      ['notes/alpha#one', 'markdown', 'wrapped.md'],
      ['notes/alpha#one', 'wiki', 'beta'],
      ['notes/alpha#one', 'wiki', 'kept'],
      ['notes/alpha#one', 'wiki', 'real'],
      ['notes/alpha#two', 'wiki', 'beta'],
      ['notes/beta#one', 'wiki', 'alpha'],
    ]);

    rmSync(join(root, 'notes/alpha.md'));
    ingestMemory({ db, root, config: BASE_CONFIG });
    expect(stored(edgeRows(db))).toEqual([['notes/beta#one', 'wiki', 'alpha']]);
  });
});

describe('ingestMemory — resolving each link form', () => {
  // Every row of the resolution table has one fixture edge. A resolver that joins the raw
  // path to the root instead of the source's directory misses `sub/leaf.md` from `notes/top`
  // and `../top.md` from `notes/sub/leaf`; one that keeps `./` unnormalised misses that row;
  // one that clamps `../../notes/twin.md` at the root instead of leaving it above it resolves
  // `notes/twin`; one that stores the excluded `index.md` and `log.md` anyway resolves
  // `index.md`, `log.md`, and `[[index]]`; one that resolves the out-of-include `outside.md`
  // from disk fills a concept for a document the index never stored; one
  // that leaves `dst_concept` NULL when a same-document anchor is missing (`#nope`) loses the
  // document half of the table; one that fills `dst_section` for the H3
  // anchor `deep` invents a section row; `twin` exists twice, so a resolver that reports
  // every duplicate as ambiguous leaves `notes/wiki`'s link NULL instead of taking the
  // same-directory `notes/twin`, and one that takes any duplicate from `notes/other/far`
  // never reaches the unique `twin` anchor at rule three; one that
  // runs rule two before rule one sends `[[leaf]]` to the source's own `#leaf` section; one
  // that runs rule three before rule two sends `[[own]]` nowhere (two documents carry `own`);
  // one that picks any `one` anchor when two exist resolves a link the table leaves NULL.
  it('fills dst_concept and dst_section exactly as the resolution table says for markdown paths and wikilinks', () => {
    writeDoc('outside.md', page('Outside', ['one', 'not indexed.']));
    writeDoc('notes/index.md', page('Index', ['one', 'excluded by config.']));
    writeDoc('notes/log.md', page('Log', ['one', 'excluded by config.']));
    writeDoc(
      'notes/top.md',
      page(
        'Top',
        [
          'one',
          '[a](sub/leaf.md) [b](sub/leaf.md#here) [c](sub/leaf.md#deep) [d](#two) [e](../outside.md) [f](index.md) [g](sub/missing.md#one) [h](./sub/leaf.md) [i](../../notes/twin.md) [j](#nope) [k](log.md)',
        ],
        ['two', 'body.'],
      ),
    );
    writeDoc(
      'notes/sub/leaf.md',
      page(
        'Leaf',
        ['here', '[up](../top.md#one)\n### Deep {#deep}\ndeep text.'],
        ['twin', 'twin text.'],
      ),
    );
    writeDoc('notes/twin.md', page('Twin', ['one', 'x'], ['own', 'x']));
    writeDoc('notes/sub/twin.md', page('Other twin', ['alone', 'x']));
    writeDoc('notes/other/far.md', page('Far', ['one', '[[twin]]']));
    writeDoc(
      'notes/wiki.md',
      page(
        'Wiki',
        ['own', '[[leaf]] [[own]] [[here]] [[twin]] [[one]] [[nowhere]] [[index]]'],
        ['leaf', 'x'],
      ),
    );
    const db = open('resolve.db');
    ingestMemory({ db, root, config: { include: INCLUDE, exclude: ['**/index.md', '**/log.md'] } });

    const row = (
      src_section: string,
      form: string,
      raw_target: string,
      dst_concept: string | null,
      dst_section: string | null,
    ): EdgeRow => ({ src_section, form, raw_target, dst_concept, dst_section });
    expect(edgeRows(db)).toEqual([
      row('notes/other/far#one', 'wiki', 'twin', 'notes/sub/leaf', 'notes/sub/leaf#twin'),
      row('notes/sub/leaf#here', 'markdown', '../top.md#one', 'notes/top', 'notes/top#one'),
      row('notes/top#one', 'markdown', '#nope', 'notes/top', null),
      row('notes/top#one', 'markdown', '#two', 'notes/top', 'notes/top#two'),
      row('notes/top#one', 'markdown', '../../notes/twin.md', null, null),
      row('notes/top#one', 'markdown', '../outside.md', null, null),
      row('notes/top#one', 'markdown', './sub/leaf.md', 'notes/sub/leaf', null),
      row('notes/top#one', 'markdown', 'index.md', null, null),
      row('notes/top#one', 'markdown', 'log.md', null, null),
      row('notes/top#one', 'markdown', 'sub/leaf.md', 'notes/sub/leaf', null),
      row('notes/top#one', 'markdown', 'sub/leaf.md#deep', 'notes/sub/leaf', null),
      row('notes/top#one', 'markdown', 'sub/leaf.md#here', 'notes/sub/leaf', 'notes/sub/leaf#here'),
      row('notes/top#one', 'markdown', 'sub/missing.md#one', null, null),
      row('notes/wiki#own', 'wiki', 'here', 'notes/sub/leaf', 'notes/sub/leaf#here'),
      row('notes/wiki#own', 'wiki', 'index', null, null),
      row('notes/wiki#own', 'wiki', 'leaf', 'notes/sub/leaf', null),
      row('notes/wiki#own', 'wiki', 'nowhere', null, null),
      row('notes/wiki#own', 'wiki', 'one', null, null),
      row('notes/wiki#own', 'wiki', 'own', 'notes/wiki', 'notes/wiki#own'),
      row('notes/wiki#own', 'wiki', 'twin', 'notes/twin', null),
    ]);
  });
});

describe('ingestMemory — resolution does not depend on ingest order', () => {
  const alpha = () =>
    writeDoc('notes/alpha.md', page('Alpha', ['one', '[[beta]] [b](beta.md#one)']));
  const beta = () => writeDoc('notes/beta.md', page('Beta', ['one', 'beta text.']));
  const freshBuild = (name: string): DatabaseSync => {
    const db = open(name);
    ingestMemory({ db, root, config: BASE_CONFIG, rebuild: true });
    return db;
  };
  const expectSameIndex = (a: DatabaseSync, b: DatabaseSync): void => {
    expect(edgeRows(a)).toEqual(edgeRows(b));
    expect(conceptRows(a)).toEqual(conceptRows(b));
    expect(sectionRows(a)).toEqual(sectionRows(b));
  };
  const targets = (db: DatabaseSync) => edgeRows(db).map((r) => [r.dst_concept, r.dst_section]);

  // A resolver that runs per document while the unchanged `alpha` is skipped by its hash
  // never revisits alpha's rows: they stay NULL after beta arrives and stay resolved after
  // beta is removed, while the rebuilt database says otherwise at both steps. A replace
  // that appends edges instead of replacing them keeps `beta.md#one` after alpha's edit,
  // and keeps both rows after alpha's links are removed.
  it("resolves an unchanged document's edge when its target arrives, clears it when the target goes, follows the source's own edits, and matches a rebuild at every step", () => {
    alpha();
    const db = open('order.db');
    ingestMemory({ db, root, config: BASE_CONFIG });
    expect(targets(db)).toEqual([
      [null, null],
      [null, null],
    ]);
    expectSameIndex(db, freshBuild('fresh-1.db'));

    beta();
    ingestMemory({ db, root, config: BASE_CONFIG });
    expect(targets(db)).toEqual([
      ['notes/beta', 'notes/beta#one'],
      ['notes/beta', null],
    ]);
    expectSameIndex(db, freshBuild('fresh-2.db'));

    rmSync(join(root, 'notes/beta.md'));
    ingestMemory({ db, root, config: BASE_CONFIG });
    expect(targets(db)).toEqual([
      [null, null],
      [null, null],
    ]);
    expectSameIndex(db, freshBuild('fresh-3.db'));

    beta();
    writeDoc('notes/alpha.md', page('Alpha', ['one', '[[beta]] [c](beta.md)']));
    ingestMemory({ db, root, config: BASE_CONFIG });
    expect(edgeRows(db).map((r) => [r.raw_target, r.dst_concept, r.dst_section])).toEqual([
      ['beta.md', 'notes/beta', null],
      ['beta', 'notes/beta', null],
    ]);
    expectSameIndex(db, freshBuild('fresh-4.db'));

    writeDoc('notes/alpha.md', page('Alpha', ['one', 'no links.']));
    ingestMemory({ db, root, config: BASE_CONFIG });
    expect(edgeRows(db)).toEqual([]);
    expectSameIndex(db, freshBuild('fresh-5.db'));
  });
});

describe('ingestMemory — links to a document an exclude glob covers', () => {
  const EXCLUDED: MemoryConfig = { include: INCLUDE, exclude: ['**/index.md'] };
  const tree = () => {
    writeDoc('notes/alpha.md', page('Alpha', ['one', '[i](index.md#one) [[log]]']));
    writeDoc('notes/index.md', page('Index', ['one', 'index text.']));
    writeDoc('notes/log.md', page('Log', ['one', 'log text.']));
  };
  const freshBuild = (name: string, config: MemoryConfig): DatabaseSync => {
    const db = open(name);
    ingestMemory({ db, root, config, rebuild: true });
    return db;
  };
  const expectSameIndex = (a: DatabaseSync, b: DatabaseSync): void => {
    expect(edgeRows(a)).toEqual(edgeRows(b));
    expect(conceptRows(a)).toEqual(conceptRows(b));
    expect(sectionRows(a)).toEqual(sectionRows(b));
  };
  const targets = (db: DatabaseSync) => edgeRows(db).map((r) => [r.dst_concept, r.dst_section]);

  // A list that still skips `index.md` by name leaves the first step unresolved; an ingest
  // that deletes only documents whose file is gone keeps `notes/index` and its edge target
  // after the glob arrives; a resolver that runs per changed document never revisits the
  // unchanged `alpha`, so its edge stays resolved after the exclusion and stays NULL after
  // the glob goes, while the rebuilt database says otherwise at both steps.
  it('resolves a link to index.md while no exclude glob covers it, clears it to an unresolved edge when one does, and resolves it again when the glob goes, matching a rebuild at every step', () => {
    tree();
    const db = open('excluded-links.db');
    ingestMemory({ db, root, config: BASE_CONFIG });
    expect(targets(db)).toEqual([
      ['notes/index', 'notes/index#one'],
      ['notes/log', null],
    ]);
    expectSameIndex(db, freshBuild('excluded-fresh-1.db', BASE_CONFIG));

    ingestMemory({ db, root, config: EXCLUDED });
    expect(targets(db)).toEqual([
      [null, null],
      ['notes/log', null],
    ]);
    expect(conceptRows(db).map((r) => r.id)).toEqual(['notes/alpha', 'notes/log']);
    expectSameIndex(db, freshBuild('excluded-fresh-2.db', EXCLUDED));

    ingestMemory({ db, root, config: BASE_CONFIG });
    expect(targets(db)).toEqual([
      ['notes/index', 'notes/index#one'],
      ['notes/log', null],
    ]);
    expectSameIndex(db, freshBuild('excluded-fresh-3.db', BASE_CONFIG));
  });
});

describe('showMemory — links in and out', () => {
  const tree = () => {
    writeDoc(
      'notes/alpha.md',
      page('Alpha', ['one', '[[beta]] [x](beta.md#two) [[nowhere]]'], ['two', '[self](#one)']),
    );
    writeDoc('notes/beta.md', page('Beta', ['one', '[a](alpha.md#one)'], ['two', '[a](alpha.md)']));
  };

  // A document `in` built over `dst_section` drops beta's document-level `alpha.md` edge;
  // one that excludes the source document's own edge drops `#one`; a `to` read from
  // `dst_concept` alone says `notes/beta` for `beta.md#two`; a `target` stored without the
  // wikilink brackets makes `[[beta]]` and a markdown `beta` indistinguishable; a sort by
  // `to` or by insertion puts `beta.md#two` before `[[nowhere]]`.
  it("lists a document's outgoing edges from every section and the incoming edges whose target document it is, sorted by from then target", () => {
    tree();
    const db = open('show-doc.db');
    ingestMemory({ db, root, config: BASE_CONFIG });

    expect(showMemory({ db, id: 'notes/alpha' })).toMatchObject({ id: 'notes/alpha' });
    expect(showMemory({ db, id: 'notes/alpha' })?.links).toEqual({
      out: [
        { from: 'notes/alpha#one', target: '[[beta]]', to: 'notes/beta' },
        { from: 'notes/alpha#one', target: '[[nowhere]]', to: null },
        { from: 'notes/alpha#one', target: 'beta.md#two', to: 'notes/beta#two' },
        { from: 'notes/alpha#two', target: '#one', to: 'notes/alpha#one' },
      ],
      in: [
        { from: 'notes/alpha#two', target: '#one', to: 'notes/alpha#one' },
        { from: 'notes/beta#one', target: 'alpha.md#one', to: 'notes/alpha#one' },
        { from: 'notes/beta#two', target: 'alpha.md', to: 'notes/alpha' },
      ],
    });
  });

  // A section `in` built over `dst_concept` also lists beta's document-level `alpha.md`
  // edge; a section `out` that reads the whole document's edges adds `#one` from `#two`.
  it("lists a section's own outgoing edges and only the incoming edges whose target section it is", () => {
    tree();
    const db = open('show-section.db');
    ingestMemory({ db, root, config: BASE_CONFIG });

    expect(showMemory({ db, id: 'notes/alpha#one' })).toMatchObject({ id: 'notes/alpha#one' });
    expect(showMemory({ db, id: 'notes/alpha#one' })?.links).toEqual({
      out: [
        { from: 'notes/alpha#one', target: '[[beta]]', to: 'notes/beta' },
        { from: 'notes/alpha#one', target: '[[nowhere]]', to: null },
        { from: 'notes/alpha#one', target: 'beta.md#two', to: 'notes/beta#two' },
      ],
      in: [
        { from: 'notes/alpha#two', target: '#one', to: 'notes/alpha#one' },
        { from: 'notes/beta#one', target: 'alpha.md#one', to: 'notes/alpha#one' },
      ],
    });
  });
});

describe('describeMemoryIndex — link counts and isolation', () => {
  // A count that treats any edge as a connection clears `selfish` (its only edge stays in
  // its own document) and `broken` (its only edge is unresolved); one that counts outgoing
  // edges alone marks `sink` isolated, incoming alone marks `source`; one that never counts
  // a link-free document misses `lonely`. `links` over resolved edges alone reports 2.
  it('counts sections, links, unresolved edges, and the documents no resolved edge connects to another document', () => {
    writeDoc('notes/selfish.md', page('Selfish', ['one', '[me](#one)']));
    writeDoc('notes/broken.md', page('Broken', ['one', '[[nowhere]]']));
    writeDoc('notes/source.md', page('Source', ['one', '[s](sink.md)']));
    writeDoc('notes/sink.md', page('Sink', ['one', 'sink text.']));
    writeDoc('notes/lonely.md', page('Lonely', ['one', 'lonely text.']));
    const db = open('isolated.db');
    ingestMemory({ db, root, config: BASE_CONFIG });

    expect(describeMemoryIndex({ db })).toMatchObject({
      documents: 5,
      sections: 5,
      links: 3,
      unresolved: 1,
      isolated: 3,
    });
  });
});
