import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseDocument } from '../src/parse-document.ts';
import { replaceDocument } from '../src/replace-document.ts';
import { openMemoryDb, optimizeMemoryDb } from '../src/schema.ts';

// Document identifiers are fixture values: nothing in the store derives them from text.
const DOC_ID = 'memory/prd/sample';
const CORPUS_PREFIX = 'corpus/doc';

let tmpRoot: string;
const opened: DatabaseSync[] = [];

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'pdks-memory-'));
});

afterEach(() => {
  for (const db of opened.splice(0)) {
    try {
      db.close();
    } catch {
      // already closed by the test
    }
  }
  rmSync(tmpRoot, { recursive: true, force: true });
});

function open(name: string): DatabaseSync {
  const db = openMemoryDb({ path: join(tmpRoot, name) });
  opened.push(db);
  return db;
}

type Source = { id: string; text: string };

/** One write transaction around a list of documents, closed by an FTS merge — the boundary the caller owns. */
function ingest(db: DatabaseSync, sources: Source[]): void {
  db.exec('BEGIN');
  for (const source of sources) replaceDocument({ db, document: parseDocument(source) });
  optimizeMemoryDb({ db });
  db.exec('COMMIT');
}

/**
 * FTS5's own consistency command over the external-content table. It raises when the index
 * and the `section` rows disagree, which SQLite's `integrity_check` never sees.
 */
function expectFtsConsistent(db: DatabaseSync): void {
  expect(() =>
    db.exec("INSERT INTO section_fts(section_fts, rank) VALUES ('integrity-check', 1)"),
  ).not.toThrow();
}

type SectionRow = { id: string; ord: number; title: string; doc_title: string };

function sectionRows(db: DatabaseSync, conceptId: string): SectionRow[] {
  return db
    .prepare('SELECT id, ord, title, doc_title FROM section WHERE concept_id = ? ORDER BY ord')
    .all(conceptId) as SectionRow[];
}

/**
 * Section identifiers matched by one term, sorted. The term goes in as a phrase so FTS5
 * neither splits it on whitespace nor reads punctuation as query syntax; every term a test
 * passes is at least three characters, the trigram tokenizer's floor.
 */
function matchIds(db: DatabaseSync, term: string): string[] {
  const rows = db
    .prepare(
      'SELECT section.id AS id FROM section_fts JOIN section ON section.rowid = section_fts.rowid WHERE section_fts MATCH ?',
    )
    .all(`"${term}"`) as { id: string }[];
  return rows.map((r) => r.id).sort();
}

function corpusText(n: number, variant: 'base' | 'edited' | 'added' | 'removed' = 'base'): string {
  const sectionCount = variant === 'added' ? 8 : variant === 'removed' ? 6 : 7;
  const lines = [
    `---\ntitle: 문서 ${n} 제목 corpus-title\n---`,
    `문서 ${n}의 머리말이다. 워크트리 ${n}.`,
    '',
  ];
  for (let s = 1; s <= sectionCount; s++) {
    const body =
      variant === 'edited' && s === 3
        ? `edited-body 문서 ${n} 절 ${s}. 스냅샷 재작성 rewritten paragraph.`
        : `section-body 문서 ${n} 절 ${s}. 수용 기준 스냅샷 paragraph number ${(n * 7 + s) % 11}.`;
    lines.push(`## 절 ${s} 제목 {#sec-${s}}`, '', body, '');
  }
  return lines.join('\n');
}

function corpus(
  size: number,
  variantOf: (n: number) => 'base' | 'edited' | 'added' | 'removed' = () => 'base',
): Source[] {
  return Array.from({ length: size }, (_, i) => ({
    id: `${CORPUS_PREFIX}-${i}`,
    text: corpusText(i, variantOf(i)),
  }));
}

describe('openMemoryDb', () => {
  // A connection without WAL blocks readers during ingest; without foreign_keys the CASCADE
  // never fires and old sections outlive their concept; synchronous FULL is the wrong durability.
  // auto_vacuum set after the tables exist does not change the header and reads back 0.
  it('creates the parent directory and sets auto_vacuum FULL, WAL, synchronous NORMAL, foreign_keys ON', () => {
    const path = join(tmpRoot, 'nested', 'deeper', 'memory.db');
    const db = openMemoryDb({ path });
    opened.push(db);
    expect(existsSync(path)).toBe(true);
    expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    expect(db.prepare('PRAGMA synchronous').get()).toEqual({ synchronous: 1 });
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    expect(db.prepare('PRAGMA auto_vacuum').get()).toEqual({ auto_vacuum: 1 });
  });

  // A document with no sections is still a document: a replace that writes the concept row
  // from inside the section loop, or refuses an empty parse, drops it from the index.
  it('stores a concept row with zero section rows for an empty document', () => {
    const db = open('empty.db');
    ingest(db, [{ id: DOC_ID, text: '' }]);
    expect(db.prepare('SELECT id, title FROM concept').all()).toEqual([
      { id: DOC_ID, title: DOC_ID },
    ]);
    expect(sectionRows(db, DOC_ID)).toEqual([]);
    expectFtsConsistent(db);
  });
});

describe('replaceDocument — one document rewritten five times', () => {
  const versions: { text: string; ids: string[] }[] = [
    {
      text: '---\ntitle: Sample\n---\nPreamble.\n\n## Overview {#overview}\n\nfirst-body overview.\n\n## Details\n\noriginal-detail text.\n\n## Notes {#notes}\n\nnotes.\n',
      ids: [`${DOC_ID}#`, `${DOC_ID}#overview`, `${DOC_ID}#details`, `${DOC_ID}#notes`],
    },
    {
      // body edit
      text: '---\ntitle: Sample\n---\nPreamble.\n\n## Overview {#overview}\n\nfirst-body overview.\n\n## Details\n\nrevised-detail text.\n\n## Notes {#notes}\n\nnotes.\n',
      ids: [`${DOC_ID}#`, `${DOC_ID}#overview`, `${DOC_ID}#details`, `${DOC_ID}#notes`],
    },
    {
      // section added
      text: '---\ntitle: Sample\n---\nPreamble.\n\n## Overview {#overview}\n\nfirst-body overview.\n\n## Details\n\nrevised-detail text.\n\n## Extra\n\nextra.\n\n## Notes {#notes}\n\nnotes.\n',
      ids: [
        `${DOC_ID}#`,
        `${DOC_ID}#overview`,
        `${DOC_ID}#details`,
        `${DOC_ID}#extra`,
        `${DOC_ID}#notes`,
      ],
    },
    {
      // section removed
      text: '---\ntitle: Sample\n---\nPreamble.\n\n## Overview {#overview}\n\nfirst-body overview.\n\n## Details\n\nrevised-detail text.\n\n## Notes {#notes}\n\nnotes.\n',
      ids: [`${DOC_ID}#`, `${DOC_ID}#overview`, `${DOC_ID}#details`, `${DOC_ID}#notes`],
    },
    {
      // heading text changed, no explicit anchor: the slug moves with it
      text: '---\ntitle: Sample\n---\nPreamble.\n\n## Overview {#overview}\n\nfirst-body overview.\n\n## Detail list\n\nrevised-detail text.\n\n## Notes {#notes}\n\nnotes.\n',
      ids: [`${DOC_ID}#`, `${DOC_ID}#overview`, `${DOC_ID}#detail-list`, `${DOC_ID}#notes`],
    },
    {
      // heading text changed, explicit anchor kept: the identifier stays
      text: '---\ntitle: Sample\n---\nPreamble.\n\n## Summary {#overview}\n\nfirst-body overview.\n\n## Detail list\n\nrevised-detail text.\n\n## Notes {#notes}\n\nnotes.\n',
      ids: [`${DOC_ID}#`, `${DOC_ID}#overview`, `${DOC_ID}#detail-list`, `${DOC_ID}#notes`],
    },
  ];

  // An insert-only replace accumulates one row set per version (the content-hash failure);
  // a replace that misses the CASCADE or the delete trigger leaves old rows or stale FTS entries.
  it("leaves exactly that version's rows after each replace, and the explicit-anchor row keeps its identifier", () => {
    const db = open('rewrite.db');
    versions.forEach((version, i) => {
      ingest(db, [{ id: DOC_ID, text: version.text }]);
      const rows = sectionRows(db, DOC_ID);
      expect(
        rows.map((r) => r.id),
        `version ${i}`,
      ).toEqual(version.ids);
      expect(
        rows.map((r) => r.ord),
        `version ${i}`,
      ).toEqual(version.ids.map((_, ord) => ord));
      expect(
        rows.every((r) => r.doc_title === 'Sample'),
        `version ${i}`,
      ).toBe(true);
      expect(db.prepare('SELECT id, title FROM concept').all()).toEqual([
        { id: DOC_ID, title: 'Sample' },
      ]);
    });
    expect(matchIds(db, 'original-detail')).toEqual([]);
    expect(matchIds(db, 'revised-detail')).toEqual([`${DOC_ID}#detail-list`]);
    expect(sectionRows(db, DOC_ID).find((r) => r.id === `${DOC_ID}#overview`)?.title).toBe(
      'Summary',
    );
    expectFtsConsistent(db);
  });
});

describe('replaceDocument — re-ingesting a corpus three times', () => {
  // Rows or FTS delete markers that accumulate per ingest grow the file linearly (3x); the
  // 1.5x bound separates a real replace from an append.
  it('keeps the checkpointed file at most 1.5x the size after the first ingest', () => {
    const path = join(tmpRoot, 'size.db');
    const db = openMemoryDb({ path });
    opened.push(db);
    const sources = corpus(300);

    const sizeAfter = (): number => {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      return statSync(path).size;
    };

    ingest(db, sources);
    const first = sizeAfter();
    ingest(db, sources);
    sizeAfter();
    ingest(db, sources);
    const third = sizeAfter();

    expect(db.prepare('SELECT count(*) AS n FROM section').get()).toEqual({ n: 300 * 8 });
    expect(third).toBeLessThanOrEqual(first * 1.5);
    expectFtsConsistent(db);
  }, 120_000);
});

describe('replaceDocument — a reader during an open write transaction', () => {
  // With a replace that commits early the reader sees the new rows before COMMIT; with a
  // missing insert trigger it never sees them.
  it('serves the old version until COMMIT and the new version after it', () => {
    const path = join(tmpRoot, 'wal.db');
    const writer = openMemoryDb({ path });
    opened.push(writer);
    ingest(writer, [{ id: DOC_ID, text: '# Doc\n\n## First\n\n옛판본 ancient-text.\n' }]);

    const reader = new DatabaseSync(path);
    opened.push(reader);

    writer.exec('BEGIN IMMEDIATE');
    replaceDocument({
      db: writer,
      document: parseDocument({ id: DOC_ID, text: '# Doc\n\n## First\n\n새판본 modern-text.\n' }),
    });
    expect(matchIds(reader, '옛판본')).toEqual([`${DOC_ID}#first`]);
    expect(matchIds(reader, '새판본')).toEqual([]);

    writer.exec('COMMIT');
    expect(matchIds(reader, '새판본')).toEqual([`${DOC_ID}#first`]);
    expect(matchIds(reader, '옛판본')).toEqual([]);
    expectFtsConsistent(writer);
  });

  // Setting auto_vacuum on an existing file needs the write lock, so a second open during an
  // ingest would fail with "database is locked".
  it('opens an existing database while another connection holds the write lock', () => {
    const path = join(tmpRoot, 'busy.db');
    const writer = openMemoryDb({ path });
    opened.push(writer);
    ingest(writer, [{ id: DOC_ID, text: '# Doc\n\n## First\n\nstable-text.\n' }]);
    writer.exec('BEGIN IMMEDIATE');
    replaceDocument({
      db: writer,
      document: parseDocument({ id: DOC_ID, text: '# Doc\n\n## First\n\nnext-text.\n' }),
    });
    const reader = openMemoryDb({ path });
    opened.push(reader);
    expect(matchIds(reader, 'stable-text')).toEqual([`${DOC_ID}#first`]);
    writer.exec('COMMIT');
  });
});

describe('replaceDocument — rebuild equivalence', () => {
  const SIZE = 60;
  const variantOf = (n: number): 'base' | 'edited' | 'added' | 'removed' => {
    if (n % 10 === 3) return 'edited';
    if (n % 10 === 6) return 'added';
    if (n % 10 === 9) return 'removed';
    return 'base';
  };

  type FullRow = {
    id: string;
    concept_id: string;
    ord: number;
    doc_title: string;
    title: string;
    body: string;
  };
  const conceptSet = (db: DatabaseSync) =>
    db.prepare('SELECT id, title FROM concept ORDER BY id').all() as {
      id: string;
      title: string;
    }[];
  const sectionSet = (db: DatabaseSync) =>
    db
      .prepare('SELECT id, concept_id, ord, doc_title, title, body FROM section ORDER BY id')
      .all() as FullRow[];

  // A DB that went through edits and a DB built once from the final texts must be the same
  // row set; leftover rows from an earlier version, or an ord that depends on insert order, differ here.
  it('yields the same concept, section, and FTS match sets as a fresh DB built from the final texts', () => {
    const a = open('history.db');
    ingest(a, corpus(SIZE));
    const final = corpus(SIZE, variantOf);
    ingest(
      a,
      final.filter((_, n) => variantOf(n) !== 'base'),
    );

    const b = open('fresh.db');
    ingest(b, [...final].reverse());

    expect(conceptSet(a)).toHaveLength(SIZE);
    expect(conceptSet(a)).toEqual(conceptSet(b));
    // preamble + 7 per document; one 'added' (+1) and one 'removed' (-1) per ten documents cancel
    expect(sectionSet(a)).toHaveLength(SIZE * 8);
    expect(sectionSet(a)).toEqual(sectionSet(b));
    for (const term of ['수용 기준', '워크트리', 'edited-body', 'corpus-title', 'section-body']) {
      const matched = matchIds(a, term);
      expect(matched.length, term).toBeGreaterThan(0);
      expect(matched, term).toEqual(matchIds(b, term));
    }
    expectFtsConsistent(a);
    expectFtsConsistent(b);
  }, 60_000);
});
