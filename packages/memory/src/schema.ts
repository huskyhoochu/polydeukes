import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Where the memory database file lives, and whether to open an existing file for reading only
 * — without creating it, changing its pragmas, or writing the schema.
 */
export type OpenMemoryDbSpec = { path: string; readOnly?: boolean };

/** An open memory database connection. */
export type OptimizeMemoryDbSpec = { db: DatabaseSync };

// `chunk_fts` stores no text, so the writer inserts each chunk's columns itself; a deleted
// chunk, including one removed by its section's cascade, is taken out of the index by rowid.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS concept (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  metadata    TEXT NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'stable',
  stale_after TEXT,
  doc_type    TEXT,
  ticket      TEXT,
  content_hash TEXT NOT NULL DEFAULT ''
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

CREATE TABLE IF NOT EXISTS edge (
  src_section TEXT NOT NULL REFERENCES section(id) ON DELETE CASCADE,
  form        TEXT NOT NULL,
  raw_target  TEXT NOT NULL,
  dst_concept TEXT,
  dst_section TEXT,
  PRIMARY KEY (src_section, form, raw_target)
) STRICT;

CREATE TABLE IF NOT EXISTS obligation (
  section_id TEXT NOT NULL REFERENCES section(id) ON DELETE CASCADE,
  ord        INTEGER NOT NULL,
  key        TEXT NOT NULL,
  text       TEXT NOT NULL,
  PRIMARY KEY (section_id, ord, key)
) STRICT;

-- start and end count characters as SQLite's substr does, not JavaScript string offsets.
CREATE TABLE IF NOT EXISTS chunk (
  rowid         INTEGER PRIMARY KEY,
  section_rowid INTEGER NOT NULL REFERENCES section(rowid) ON DELETE CASCADE,
  start         INTEGER NOT NULL,
  end           INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS chunk_section ON chunk(section_rowid);

CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
  doc_title, title, body,
  content='', contentless_delete=1, tokenize='trigram'
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TRIGGER IF NOT EXISTS chunk_ad AFTER DELETE ON chunk BEGIN
  DELETE FROM chunk_fts WHERE rowid = OLD.rowid;
END;
`;

/**
 * Opens (creating if absent) the memory database at `path` with its pragmas and schema, or,
 * under `readOnly`, opens the existing file as it is.
 */
export function openMemoryDb({ path, readOnly = false }: OpenMemoryDbSpec): DatabaseSync {
  if (readOnly) {
    const db = new DatabaseSync(path, { readOnly: true });
    db.exec('PRAGMA busy_timeout = 5000');
    return db;
  }
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout = 5000');
  // auto_vacuum changes the file header only while the database has no tables, and setting it
  // on an existing file takes the write lock an ingest may be holding.
  const { page_count } = db.prepare('PRAGMA page_count').get() as { page_count: number };
  if (page_count === 0) db.exec('PRAGMA auto_vacuum = FULL');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  // A file an earlier version wrote indexes whole sections in section_fts and has no chunk rows.
  // Its ingest stamp goes with that index, so until an ingest fills the chunks the commands
  // report that no ingest has completed instead of answering every query with no hit.
  const earlier = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'section_fts'")
    .get();
  if (!earlier) {
    db.exec(SCHEMA);
    return db;
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('DROP TRIGGER IF EXISTS section_ai');
    db.exec('DROP TRIGGER IF EXISTS section_ad');
    db.exec('DROP TABLE section_fts');
    db.exec(SCHEMA);
    db.exec("DELETE FROM meta WHERE key = 'ingested_at'");
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
  return db;
}

/** Merges the FTS index segments so delete markers from replaced rows do not accumulate. */
export function optimizeMemoryDb({ db }: OptimizeMemoryDbSpec): void {
  db.exec("INSERT INTO chunk_fts(chunk_fts) VALUES ('optimize')");
}
