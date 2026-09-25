import { createHash } from 'node:crypto';
import { globSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { MemoryConfig } from './memory-config.ts';
import { parseDocument } from './parse-document.ts';
import { replaceDocument } from './replace-document.ts';
import { optimizeMemoryDb } from './schema.ts';

/** A connection, the directory the include globs and document ids are relative to, and settings. */
export type IngestMemorySpec = {
  db: DatabaseSync;
  root: string;
  config: MemoryConfig;
  rebuild?: boolean;
};

const RESERVED_NAMES = new Set(['index.md', 'log.md']);

function listDocuments(root: string, include: string[]): Map<string, string> {
  const paths = new Map<string, string>();
  for (const entry of globSync(include, { cwd: root, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || RESERVED_NAMES.has(entry.name)) continue;
    const path = join(entry.parentPath, entry.name);
    const id = relative(root, path).split(sep).join('/').slice(0, -'.md'.length);
    paths.set(id, path);
  }
  return paths;
}

// The stored rows of one text depend on `typeMap` and `ticket` besides the text itself, so a
// settings change reprocesses the documents it can affect.
function contentHash(config: MemoryConfig, text: string): string {
  return createHash('sha256')
    .update(JSON.stringify({ typeMap: config.typeMap, ticket: config.ticket }))
    .update(text)
    .digest('hex');
}

/**
 * Brings the stored documents in line with the files `config.include` reaches under `root` in
 * one write transaction: adds new ones, replaces changed ones (every one under `rebuild`), and
 * deletes those whose file is gone. On any error the database is left as it was.
 */
export function ingestMemory({ db, root, config, rebuild = false }: IngestMemorySpec): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    // List both sides after taking the lock: files and rows may change while this one waits.
    const documents = listDocuments(root, config.include);
    const stored = new Map(
      (
        db.prepare('SELECT id, content_hash FROM concept').all() as {
          id: string;
          content_hash: string;
        }[]
      ).map((row) => [row.id, row.content_hash]),
    );
    const setHash = db.prepare('UPDATE concept SET content_hash = ? WHERE id = ?');
    for (const [id, path] of documents) {
      const text = readFileSync(path, 'utf8');
      const hash = contentHash(config, text);
      if (!rebuild && stored.get(id) === hash) continue;
      replaceDocument({ db, document: parseDocument({ id, text }), config });
      setHash.run(hash, id);
    }
    const remove = db.prepare('DELETE FROM concept WHERE id = ?');
    for (const id of stored.keys()) if (!documents.has(id)) remove.run(id);
    optimizeMemoryDb({ db });
    db.exec('COMMIT');
  } catch (error) {
    // SQLite ends the transaction itself on some errors (a full disk); a second ROLLBACK
    // would replace the original error with "no transaction is active".
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}
