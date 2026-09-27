import { createHash } from 'node:crypto';
import { globSync, readFileSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
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

/**
 * Changes whenever the rows derived from one text change for the same text and settings, such
 * as a new link form being read, so the first ingest after an upgrade reprocesses every document
 * instead of keeping rows the previous version derived.
 */
const DERIVATION = 1;

// The stored rows of one text depend on `typeMap` and `ticket` besides the text itself, so a
// settings change reprocesses the documents it can affect.
function contentHash(config: MemoryConfig, text: string): string {
  return createHash('sha256')
    .update(
      JSON.stringify({ derivation: DERIVATION, typeMap: config.typeMap, ticket: config.ticket }),
    )
    .update(text)
    .digest('hex');
}

type Target = [dstConcept: string | null, dstSection: string | null];

/**
 * Rewrites every edge's target from the stored documents and sections, so the result depends
 * on the stored rows alone and not on which documents this run reprocessed. The tables are
 * read whole and matched in memory.
 */
function resolveEdges(db: DatabaseSync): void {
  const documents = new Set(
    (db.prepare('SELECT id FROM concept').all() as { id: string }[]).map((row) => row.id),
  );
  const sections = db.prepare('SELECT id, concept_id FROM section').all() as {
    id: string;
    concept_id: string;
  }[];
  const sectionIds = new Set(sections.map((row) => row.id));
  const byAnchor = new Map<string, { id: string; concept_id: string }[]>();
  for (const row of sections) {
    const anchor = row.id.slice(row.concept_id.length + 1);
    const rows = byAnchor.get(anchor) ?? [];
    rows.push(row);
    byAnchor.set(anchor, rows);
  }
  const byLastSegment = new Map<string, string[]>();
  for (const id of documents) {
    const segment = id.slice(id.lastIndexOf('/') + 1);
    const ids = byLastSegment.get(segment) ?? [];
    ids.push(id);
    byLastSegment.set(segment, ids);
  }

  const markdownTarget = (source: string, raw: string): Target => {
    const hash = raw.indexOf('#');
    const path = hash === -1 ? raw : raw.slice(0, hash);
    const anchor = hash === -1 ? undefined : raw.slice(hash + 1);
    let document = source;
    if (path !== '') {
      if (path.startsWith('/')) return [null, null];
      const joined = posix.normalize(posix.join(posix.dirname(source), path));
      // A path that climbs above the root names no stored document; it is never clamped.
      if (joined === '..' || joined.startsWith('../')) return [null, null];
      document = joined.slice(0, -'.md'.length);
    }
    if (!documents.has(document)) return [null, null];
    const section = anchor === undefined ? undefined : `${document}#${anchor}`;
    return [document, section !== undefined && sectionIds.has(section) ? section : null];
  };

  // A document named by its last path segment first, then a section of the source, then the
  // one section anywhere with that anchor; an ambiguous match falls through to the next.
  const wikiTarget = (source: string, raw: string): Target => {
    const named = byLastSegment.get(raw);
    if (named?.length === 1) return [named[0] as string, null];
    if (sectionIds.has(`${source}#${raw}`)) return [source, `${source}#${raw}`];
    const anchored = byAnchor.get(raw);
    const only = anchored?.length === 1 ? anchored[0] : undefined;
    return only ? [only.concept_id, only.id] : [null, null];
  };

  const edges = db
    .prepare(
      'SELECT e.src_section, e.form, e.raw_target, s.concept_id FROM edge e JOIN section s ON s.id = e.src_section',
    )
    .all() as { src_section: string; form: string; raw_target: string; concept_id: string }[];
  const update = db.prepare(
    'UPDATE edge SET dst_concept = ?, dst_section = ? WHERE src_section = ? AND form = ? AND raw_target = ?',
  );
  for (const edge of edges) {
    const [dstConcept, dstSection] =
      edge.form === 'wiki'
        ? wikiTarget(edge.concept_id, edge.raw_target)
        : markdownTarget(edge.concept_id, edge.raw_target);
    update.run(dstConcept, dstSection, edge.src_section, edge.form, edge.raw_target);
  }
}

/**
 * Brings the stored documents in line with the files `config.include` reaches under `root` in
 * one write transaction: adds new ones, replaces changed ones (every one under `rebuild`),
 * deletes those whose file is gone, resolves every link against the result, and stamps the
 * time of the run. On any error the database is left as it was.
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
    resolveEdges(db);
    optimizeMemoryDb({ db });
    // Written on every run, unchanged documents included: the stamp dates the comparison
    // with the files, and it rolls back with the rows it describes.
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('ingested_at', ?)").run(
      new Date().toISOString(),
    );
    db.exec('COMMIT');
  } catch (error) {
    // SQLite ends the transaction itself on some errors (a full disk); a second ROLLBACK
    // would replace the original error with "no transaction is active".
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}
