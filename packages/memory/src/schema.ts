import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** Where the memory database file lives. */
export type OpenMemoryDbSpec = { path: string };

/** An open memory database connection. */
export type OptimizeMemoryDbSpec = { db: DatabaseSync };

// The FTS triggers read only NEW and OLD: a subquery on `concept` inside the delete trigger
// would see the concept already removed by the cascade and hand FTS a NULL title.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS concept (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  metadata    TEXT NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'stable',
  stale_after TEXT,
  doc_type    TEXT,
  ticket      TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS section (
  rowid      INTEGER PRIMARY KEY,
  id         TEXT NOT NULL UNIQUE,
  concept_id TEXT NOT NULL REFERENCES concept(id) ON DELETE CASCADE,
  ord        INTEGER NOT NULL,
  doc_title  TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS section_concept ON section(concept_id);

CREATE VIRTUAL TABLE IF NOT EXISTS section_fts USING fts5(
  doc_title, title, body,
  content='section', content_rowid='rowid', tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS section_ai AFTER INSERT ON section BEGIN
  INSERT INTO section_fts(rowid, doc_title, title, body)
  VALUES (NEW.rowid, NEW.doc_title, NEW.title, NEW.body);
END;

CREATE TRIGGER IF NOT EXISTS section_ad AFTER DELETE ON section BEGIN
  INSERT INTO section_fts(section_fts, rowid, doc_title, title, body)
  VALUES ('delete', OLD.rowid, OLD.doc_title, OLD.title, OLD.body);
END;
`;

/** Opens (creating if absent) the memory database at `path` with its pragmas and schema. */
export function openMemoryDb({ path }: OpenMemoryDbSpec): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  // auto_vacuum changes the file header only while the database has no tables, and setting it
  // on an existing file takes the write lock an ingest may be holding.
  const { page_count } = db.prepare('PRAGMA page_count').get() as { page_count: number };
  if (page_count === 0) db.exec('PRAGMA auto_vacuum = FULL');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

/** Merges the FTS index segments so delete markers from replaced rows do not accumulate. */
export function optimizeMemoryDb({ db }: OptimizeMemoryDbSpec): void {
  db.exec("INSERT INTO section_fts(section_fts) VALUES ('optimize')");
}
