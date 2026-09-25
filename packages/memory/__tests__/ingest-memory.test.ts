import { spawn } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ingestMemory } from '../src/ingest-memory.ts';
import type { MemoryConfig } from '../src/memory-config.ts';
import { openMemoryDb } from '../src/schema.ts';
import { searchMemory } from '../src/search-memory.ts';

// Globs and ticket forms are fixture values: the function learns every path from `root` and
// `include`, and nothing in it knows this repository's wiki layout or ticket identifiers.
const INCLUDE = ['notes/**/*.md'];
const OVERLAPPING_INCLUDE = ['notes/**', 'notes/guides/*.md'];
const BASE_CONFIG: MemoryConfig = { include: INCLUDE };

let tmp: string;
let root: string;
const opened: DatabaseSync[] = [];
const unreadable: string[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pdks-ingest-memory-'));
  root = join(tmp, 'tree');
  mkdirSync(root);
});

afterEach(() => {
  for (const path of unreadable.splice(0)) chmodSync(path, 0o644);
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

/** A one-section document with no preamble row; the body is stored verbatim. */
const page = (title: string, body: string): string => `---\ntitle: ${title}\n---\n## One\n${body}`;

function expectFtsConsistent(db: DatabaseSync): void {
  expect(() =>
    db.exec("INSERT INTO section_fts(section_fts, rank) VALUES ('integrity-check', 1)"),
  ).not.toThrow();
}

type ConceptRow = Record<string, unknown> & { id: string };
type SectionRow = {
  id: string;
  concept_id: string;
  ord: number;
  doc_title: string;
  title: string;
  body: string;
};
type RowidRow = { rowid: number; id: string };

const conceptIds = (db: DatabaseSync): string[] =>
  (db.prepare('SELECT id FROM concept ORDER BY id').all() as { id: string }[]).map((r) => r.id);
const conceptRows = (db: DatabaseSync): ConceptRow[] =>
  db.prepare('SELECT * FROM concept ORDER BY id').all() as ConceptRow[];
const sectionRows = (db: DatabaseSync): SectionRow[] =>
  db
    .prepare('SELECT id, concept_id, ord, doc_title, title, body FROM section ORDER BY id')
    .all() as SectionRow[];
const sectionRowids = (db: DatabaseSync): RowidRow[] =>
  db.prepare('SELECT rowid, id FROM section ORDER BY id').all() as RowidRow[];
const rowidById = (rows: RowidRow[]): Map<string, number> =>
  new Map(rows.map((r) => [r.id, r.rowid]));

function expectSameRows(a: DatabaseSync, b: DatabaseSync): void {
  expect(conceptRows(a)).toEqual(conceptRows(b));
  expect(sectionRows(a)).toEqual(sectionRows(b));
}

function corpusText(n: number, variant: 'base' | 'edited' = 'base'): string {
  const lines = [
    `---\ntitle: Note ${n} corpus-title\ntype: note\n---`,
    `Preamble of note ${n}.`,
    '',
  ];
  for (let s = 1; s <= 7; s++) {
    const body =
      variant === 'edited' && s === 3
        ? `edited-body note ${n} part ${s}. rewritten paragraph.`
        : `section-body note ${n} part ${s}. paragraph number ${(n * 7 + s) % 11}.`;
    lines.push(`## Part ${s} {#part-${s}}`, '', body, '');
  }
  return lines.join('\n');
}

function writeCorpus(size: number): void {
  for (let n = 0; n < size; n++) writeDoc(`notes/doc-${n}.md`, corpusText(n));
}

describe('ingestMemory — the document list', () => {
  // A list that walks `root` instead of `include` picks up `outside/`; one that keeps every
  // glob hit reads the `folder.md` directory or a `.txt`; one that matches `index`/`log` by
  // prefix drops `index-notes`, by suffix drops `changelog`; one that cuts the id at the first
  // dot turns `v1.2` into `v1`; one that refuses a parse failure drops `broken`; a raw insert
  // over the file both globs return throws on the primary key.
  it('indexes exactly the .md regular files any include glob reaches, minus index.md and log.md, as slash-separated ids without the extension', () => {
    writeDoc('notes/alpha.md', page('Alpha', 'alpha text.'));
    writeDoc('notes/guides/beta.md', page('Beta', 'beta text.'));
    writeDoc('notes/guides/deep/gamma.md', page('Gamma', 'gamma text.'));
    writeDoc('notes/index-notes.md', page('Index notes', 'not reserved.'));
    writeDoc('notes/changelog.md', page('Changelog', 'not reserved.'));
    writeDoc('notes/v1.2.md', page('Version', 'dotted name.'));
    writeDoc('notes/index.md', page('Reserved', 'excluded.'));
    writeDoc('notes/log.md', page('Reserved', 'excluded.'));
    writeDoc('notes/folder.md/inner.md', page('Inner', 'inside a directory named .md.'));
    writeDoc('notes/broken.md', '---\n: [\n---\n## One\nunparseable frontmatter.');
    writeDoc('notes/guides/index.md', page('Reserved', 'excluded.'));
    writeDoc('notes/guides/deep/log.md', page('Reserved', 'excluded.'));
    writeDoc('notes/readme.txt', page('Not markdown', 'excluded.'));
    writeDoc('notes/guides/draft.md.bak', page('Not markdown', 'excluded.'));
    writeDoc('outside/omega.md', page('Omega', 'excluded.'));

    const db = open('list.db');
    ingestMemory({ db, root, config: { include: OVERLAPPING_INCLUDE } });

    expect(conceptIds(db)).toEqual([
      'notes/alpha',
      'notes/broken',
      'notes/changelog',
      'notes/folder.md/inner',
      'notes/guides/beta',
      'notes/guides/deep/gamma',
      'notes/index-notes',
      'notes/v1.2',
    ]);
    expect(sectionRows(db).map((r) => r.id)).toEqual([
      'notes/alpha#one',
      'notes/broken#one',
      'notes/changelog#one',
      'notes/folder.md/inner#one',
      'notes/guides/beta#one',
      'notes/guides/deep/gamma#one',
      'notes/index-notes#one',
      'notes/v1.2#one',
    ]);
    expectFtsConsistent(db);
  });
});

describe('ingestMemory — skipping unchanged documents', () => {
  const tree = () => {
    writeDoc('notes/alpha.md', `${page('Alpha', 'alpha one.')}\n## Two\nalpha two.`);
    writeDoc('notes/beta.md', page('Beta', 'beta one.'));
    writeDoc('notes/gamma.md', page('Gamma', 'gamma one.'));
  };

  // A hash that is never stored, or compared with the wrong operator, rewrites every
  // document on every run and the rowids move; a hash that ignores the text never notices
  // the edit and the old body stays.
  it('keeps every section rowid and concept row across a second ingest of the same tree, and rewrites only the edited document', () => {
    tree();
    const db = open('skip.db');
    ingestMemory({ db, root, config: BASE_CONFIG });
    const firstRowids = sectionRowids(db);
    const firstConcepts = conceptRows(db);
    expect(firstRowids).toHaveLength(4);
    for (const row of firstConcepts) {
      expect(typeof row.content_hash, row.id).toBe('string');
      expect(row.content_hash, row.id).not.toBe('');
    }

    ingestMemory({ db, root, config: BASE_CONFIG });
    expect(sectionRowids(db)).toEqual(firstRowids);
    expect(conceptRows(db)).toEqual(firstConcepts);

    writeDoc('notes/alpha.md', `${page('Alpha', 'alpha one changed.')}\n## Two\nalpha two.`);
    ingestMemory({ db, root, config: BASE_CONFIG });
    const before = rowidById(firstRowids);
    const after = rowidById(sectionRowids(db));
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [id, rowid] of after) {
      if (!id.startsWith('notes/alpha#')) expect(rowid, id).toBe(before.get(id));
    }
    expect(sectionRows(db).find((r) => r.id === 'notes/alpha#one')?.body).toBe(
      'alpha one changed.',
    );
    const alphaBefore = firstConcepts.find((r) => r.id === 'notes/alpha');
    const alphaAfter = conceptRows(db).find((r) => r.id === 'notes/alpha');
    expect(alphaAfter?.content_hash).not.toBe(alphaBefore?.content_hash);
    expect(conceptRows(db).filter((r) => r.id !== 'notes/alpha')).toEqual(
      firstConcepts.filter((r) => r.id !== 'notes/alpha'),
    );
  });

  // A hash over the whole config rewrites every document when a search weight or a
  // redundant glob is added, even though no row's content depends on either.
  it('keeps every row in place when only weights or a redundant include glob changes', () => {
    tree();
    const db = open('weights.db');
    ingestMemory({ db, root, config: BASE_CONFIG });
    const firstRowids = sectionRowids(db);
    const firstConcepts = conceptRows(db);

    ingestMemory({
      db,
      root,
      config: { include: [...INCLUDE, 'notes/*.md'], weights: { note: 2 } },
    });
    expect(sectionRowids(db)).toEqual(firstRowids);
    expect(conceptRows(db)).toEqual(firstConcepts);
  });
});

describe('ingestMemory — replace, delete, rename, add in one step', () => {
  const SIZE = 12;

  // Skipping the delete transition leaves the removed document and the pre-rename id in
  // `concept`; a replace that appends instead of replacing keeps the edited body twice; a
  // stale FTS entry makes the search lists differ while the row sets still agree.
  it('yields the same concept rows, section rows, FTS integrity, and search results as a DB built once from the final tree', () => {
    writeCorpus(SIZE);
    const a = open('history.db');
    ingestMemory({ db: a, root, config: BASE_CONFIG });
    expect(conceptIds(a)).toHaveLength(SIZE);

    writeDoc('notes/doc-3.md', corpusText(3, 'edited'));
    rmSync(join(root, 'notes/doc-6.md'));
    renameSync(join(root, 'notes/doc-9.md'), join(root, 'notes/renamed-doc-9.md'));
    writeDoc('notes/doc-12.md', corpusText(12));
    ingestMemory({ db: a, root, config: BASE_CONFIG });

    const b = open('fresh.db');
    ingestMemory({ db: b, root, config: BASE_CONFIG });

    const ids = conceptIds(a);
    expect(ids).toHaveLength(SIZE);
    expect(ids).not.toContain('notes/doc-6');
    expect(ids).not.toContain('notes/doc-9');
    expect(ids).toContain('notes/renamed-doc-9');
    expect(ids).toContain('notes/doc-12');
    expect(sectionRows(a)).toHaveLength(SIZE * 8);
    expectSameRows(a, b);
    expectFtsConsistent(a);
    expectFtsConsistent(b);

    // `notes/renamed` reaches the moved document through its id prefix, since its text is
    // the same as before the rename.
    for (const query of ['corpus-title', 'edited-body', 'notes/renamed', 'section-body part 3']) {
      const found = searchMemory({ db: a, query }).map((r) => r.id);
      expect(found.length, query).toBeGreaterThan(0);
      expect(found, query).toEqual(searchMemory({ db: b, query }).map((r) => r.id));
    }
    expect(searchMemory({ db: a, query: 'notes/doc-6' })).toEqual([]);
    expect(searchMemory({ db: a, query: 'notes/doc-9' })).toEqual([]);
  }, 60_000);

  // A DB-side list built from `section` never sees an empty document, so it is never deleted;
  // an ingest that returns early on an empty file list leaves every row behind.
  it('deletes an empty document when its file goes, and every document when the globs match nothing', () => {
    writeDoc('notes/alpha.md', page('Alpha', 'alpha one.'));
    writeDoc('notes/empty.md', '');
    const db = open('empty.db');
    ingestMemory({ db, root, config: BASE_CONFIG });
    expect(conceptIds(db)).toEqual(['notes/alpha', 'notes/empty']);

    rmSync(join(root, 'notes/empty.md'));
    ingestMemory({ db, root, config: BASE_CONFIG });
    expect(conceptIds(db)).toEqual(['notes/alpha']);

    ingestMemory({ db, root, config: { include: ['nothing/**/*.md'] } });
    expect(conceptIds(db)).toEqual([]);
    expect(sectionRows(db)).toEqual([]);
    expectFtsConsistent(db);
  });
});

describe('ingestMemory — derived-column settings and rebuild', () => {
  const decisionTree = () => {
    writeDoc(
      'notes/choice.md',
      '---\ntitle: Choice 7 (see RQ-7)\ntype: decision\nissue: TK-77\n---\n## Topic\n\nchoice text.\n',
    );
    writeDoc('notes/plain.md', '---\ntitle: Plain\ntype: note\n---\n## Topic\n\nplain text.\n');
  };
  const initial: MemoryConfig = {
    include: INCLUDE,
    typeMap: { decision: 'reference' },
    ticket: [{ from: 'title', pattern: 'RQ-[0-9]+' }],
  };
  const concept = (db: DatabaseSync, id: string) =>
    db.prepare('SELECT doc_type, ticket FROM concept WHERE id = ?').get(id) as {
      doc_type: string | null;
      ticket: string | null;
    };

  // A hash over the text alone skips every document when only `typeMap` changes, so
  // `doc_type` keeps the mapping the previous ingest wrote.
  it('re-derives doc_type when only typeMap changes and matches a fresh build under the new settings', () => {
    decisionTree();
    const db = open('typemap.db');
    ingestMemory({ db, root, config: initial });
    expect(concept(db, 'notes/choice')).toEqual({ doc_type: 'reference', ticket: 'RQ-7' });

    const changed: MemoryConfig = { ...initial, typeMap: { decision: 'record' } };
    ingestMemory({ db, root, config: changed });
    expect(concept(db, 'notes/choice')).toEqual({ doc_type: 'record', ticket: 'RQ-7' });

    const fresh = open('typemap-fresh.db');
    ingestMemory({ db: fresh, root, config: changed });
    expectSameRows(db, fresh);
  });

  // A hash that serialises `typeMap` but not `ticket` skips every document when a ticket
  // rule changes, so `ticket` keeps the value the old rule extracted.
  it('re-derives ticket when only a ticket rule changes and matches a fresh build under the new settings', () => {
    decisionTree();
    const db = open('ticket.db');
    ingestMemory({ db, root, config: initial });
    expect(concept(db, 'notes/choice')).toEqual({ doc_type: 'reference', ticket: 'RQ-7' });

    const changed: MemoryConfig = { ...initial, ticket: [{ from: 'frontmatter', key: 'issue' }] };
    ingestMemory({ db, root, config: changed });
    expect(concept(db, 'notes/choice')).toEqual({ doc_type: 'reference', ticket: 'TK-77' });

    const fresh = open('ticket-fresh.db');
    ingestMemory({ db: fresh, root, config: changed });
    expectSameRows(db, fresh);
  });

  // A row changed behind the hash's back stands for any change the hash cannot see: a plain
  // ingest keeps it, a rebuild that still consults the hash keeps it too. A rebuild written
  // as its own loop over the file list forgets the delete transition.
  it('restores rows the hash cannot see under rebuild and still deletes documents whose file is gone', () => {
    decisionTree();
    writeDoc('notes/third.md', page('Third', 'third text.'));
    const db = open('rebuild.db');
    ingestMemory({ db, root, config: initial });
    const expected = conceptRows(db).filter((r) => r.id !== 'notes/third');
    const expectedSections = sectionRows(db).filter((r) => r.concept_id !== 'notes/third');

    db.exec("UPDATE concept SET title = 'tampered' WHERE id = 'notes/choice'");
    ingestMemory({ db, root, config: initial });
    expect(conceptRows(db).find((r) => r.id === 'notes/choice')?.title).toBe('tampered');

    rmSync(join(root, 'notes/third.md'));
    ingestMemory({ db, root, config: initial, rebuild: true });
    expect(conceptRows(db)).toEqual(expected);
    expect(sectionRows(db)).toEqual(expectedSections);
    expectFtsConsistent(db);
  });
});

describe('ingestMemory — a file that cannot be read', () => {
  // The readable edit sorts before the unreadable one, so an ingest that writes as it reads
  // has already replaced `alpha` when `omega` fails; without ROLLBACK that replacement
  // survives, a delete run outside the transaction has already removed `middle`, and without
  // ending the transaction the next ingest cannot begin one.
  it.skipIf(process.getuid?.() === 0)(
    'throws, leaves every row as it was before the ingest, and lets the next ingest proceed',
    () => {
      writeDoc('notes/alpha.md', page('Alpha', 'alpha one.'));
      writeDoc('notes/middle.md', page('Middle', 'middle one.'));
      writeDoc('notes/omega.md', page('Omega', 'omega one.'));
      const db = open('atomic.db');
      ingestMemory({ db, root, config: BASE_CONFIG });
      const rowidsBefore = sectionRowids(db);
      const conceptsBefore = conceptRows(db);
      const sectionsBefore = sectionRows(db);

      writeDoc('notes/alpha.md', page('Alpha', 'alpha one changed.'));
      writeDoc('notes/omega.md', page('Omega', 'omega one changed.'));
      rmSync(join(root, 'notes/middle.md'));
      const omega = join(root, 'notes/omega.md');
      chmodSync(omega, 0o000);
      unreadable.push(omega);

      expect(() => ingestMemory({ db, root, config: BASE_CONFIG })).toThrow(/EACCES/);
      expect(sectionRowids(db)).toEqual(rowidsBefore);
      expect(conceptRows(db)).toEqual(conceptsBefore);
      expect(sectionRows(db)).toEqual(sectionsBefore);
      expectFtsConsistent(db);

      chmodSync(omega, 0o644);
      unreadable.splice(0);
      expect(() => ingestMemory({ db, root, config: BASE_CONFIG })).not.toThrow();
      expect(sectionRows(db).map((r) => [r.id, r.body])).toEqual([
        ['notes/alpha#one', 'alpha one changed.'],
        ['notes/omega#one', 'omega one changed.'],
      ]);
    },
  );
});

describe('ingestMemory — an error SQLite already rolled back', () => {
  // A full database ends the transaction inside SQLite; an unconditional ROLLBACK then
  // raises "no transaction is active" and the caller never learns the disk was full.
  it('rethrows the original error and leaves the stored rows as they were', () => {
    writeDoc('notes/alpha.md', page('Alpha', 'alpha one.'));
    const db = open('full.db');
    ingestMemory({ db, root, config: BASE_CONFIG });
    const before = sectionRows(db);

    writeCorpus(300);
    const { page_count } = db.prepare('PRAGMA page_count').get() as { page_count: number };
    db.exec(`PRAGMA max_page_count = ${page_count + 2}`);
    expect(() => ingestMemory({ db, root, config: BASE_CONFIG })).toThrow(/full/);
    expect(db.isTransaction).toBe(false);
    expect(sectionRows(db)).toEqual(before);
  });
});

describe('ingestMemory — file size across repeated rebuilds', () => {
  // Without the FTS merge before COMMIT the delete markers from each rebuild accumulate:
  // measured at 400 documents, the third rebuild lands at 2.3x the first without the merge
  // and 1.01x with it. At 200 documents FTS5's own automerge happened to keep the unmerged
  // index at 1.47x, so the corpus is sized where the bound discriminates.
  it('keeps the checkpointed file at most 1.5x its size after the first rebuild', () => {
    writeCorpus(400);
    const path = join(tmp, 'db', 'size.db');
    const db = openMemoryDb({ path });
    opened.push(db);
    const sizeAfter = (): number => {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      return statSync(path).size;
    };

    ingestMemory({ db, root, config: BASE_CONFIG, rebuild: true });
    const first = sizeAfter();
    ingestMemory({ db, root, config: BASE_CONFIG, rebuild: true });
    sizeAfter();
    ingestMemory({ db, root, config: BASE_CONFIG, rebuild: true });
    const third = sizeAfter();

    expect(db.prepare('SELECT count(*) AS n FROM section').get()).toEqual({ n: 400 * 8 });
    expect(third).toBeLessThanOrEqual(first * 1.5);
    expectFtsConsistent(db);
  }, 120_000);
});

describe('ingestMemory — another process holds the write lock', () => {
  const HOLD_MS = 500;
  // The holder is a separate process because `DatabaseSync` blocks this event loop while
  // it waits: a timer in the same process could never release the lock. It commits a concept
  // with no source file, so the ingest must read the stored list after it takes the lock.
  const HOLDER = `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(process.env.MEMORY_DB_PATH);
    db.exec('BEGIN IMMEDIATE');
    db.exec("INSERT INTO concept (id, title, content_hash) VALUES ('notes/ghost', 'Ghost', 'x')");
    process.stdout.write('locked\\n');
    setTimeout(() => {
      db.exec('COMMIT');
      process.stdout.write('committed ' + Date.now() + '\\n');
      db.close();
    }, Number(process.env.HOLD_MS));
  `;

  // A connection without a busy timeout raises SQLITE_BUSY the moment BEGIN IMMEDIATE meets
  // the holder's lock; one that gives up before the hold ends raises the same error; one that
  // lists stored documents before the lock never sees the holder's row and leaves it.
  it('waits for the other transaction to commit instead of failing, then writes its rows', async () => {
    writeDoc('notes/alpha.md', page('Alpha', 'alpha one.'));
    writeDoc('notes/beta.md', page('Beta', 'beta one.'));
    const path = join(tmp, 'db', 'busy.db');
    const db = openMemoryDb({ path });
    opened.push(db);

    const child = spawn(process.execPath, ['-e', HOLDER], {
      env: { ...process.env, MEMORY_DB_PATH: path, HOLD_MS: String(HOLD_MS) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let stdout = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    const exited = new Promise<number | null>((resolve) => child.on('exit', resolve));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('lock holder never signalled')), 10_000);
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
        if (stdout.includes('locked')) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`lock holder exited early (${code}): ${stderr}`));
      });
    });

    expect(() => ingestMemory({ db, root, config: BASE_CONFIG })).not.toThrow();
    const finished = Date.now();

    expect(await exited, stderr).toBe(0);
    const committedAt = Number(stdout.match(/committed (\d+)/)?.[1]);
    expect(finished).toBeGreaterThanOrEqual(committedAt);
    expect(conceptIds(db)).toEqual(['notes/alpha', 'notes/beta']);
    expect(sectionRows(db).map((r) => r.id)).toEqual(['notes/alpha#one', 'notes/beta#one']);
  }, 20_000);
});
