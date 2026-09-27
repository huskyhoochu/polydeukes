import { createHash } from 'node:crypto';
import { globSync, readFileSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { MemoryConfig } from './memory-config.ts';
import { parseDocument, slug, splitWikiTarget } from './parse-document.ts';
import { replaceDocument } from './replace-document.ts';
import { optimizeMemoryDb } from './schema.ts';

/** A connection, the directory the include globs and document ids are relative to, and settings. */
export type IngestMemorySpec = {
  db: DatabaseSync;
  root: string;
  config: MemoryConfig;
  rebuild?: boolean;
};

function listDocuments(root: string, { include, exclude }: MemoryConfig): Map<string, string> {
  const paths = new Map<string, string>();
  for (const entry of globSync(include, { cwd: root, exclude, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
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
const DERIVATION = 3;

// The stored rows of one text depend on `typeMap`, `ticket`, and `obligations` besides the text
// itself, so a settings change reprocesses the documents it can affect.
function contentHash(config: MemoryConfig, text: string): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        derivation: DERIVATION,
        typeMap: config.typeMap,
        ticket: config.ticket,
        obligations: config.obligations,
      }),
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
    const segment = id.slice(id.lastIndexOf('/') + 1).toLowerCase();
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

  // The document whose id equals the name or ends in `/<name>`, ignoring case; among several,
  // the one in the source's directory. Undefined when none or more than one remains.
  const namedDocument = (source: string, name: string): string | undefined => {
    const lower = name.toLowerCase();
    const candidates = (byLastSegment.get(lower.slice(lower.lastIndexOf('/') + 1)) ?? []).filter(
      (id) => {
        const lowerId = id.toLowerCase();
        return lowerId === lower || lowerId.endsWith(`/${lower}`);
      },
    );
    const near =
      candidates.length > 1
        ? candidates.filter((id) => posix.dirname(id) === posix.dirname(source))
        : candidates;
    return near.length === 1 ? near[0] : undefined;
  };

  // The name before the alias and the first `#` names a document (empty: the source), and the
  // text after the last `#` a section of it by anchor, then by slug; a block fragment (`^`)
  // names no section. With no document and no fragment, a section of the source named by the
  // name comes next, then the one section anywhere with that anchor; an ambiguous match falls
  // through to the next.
  const wikiTarget = (source: string, raw: string): Target => {
    const { name, heading } = splitWikiTarget(raw);
    const document = name === '' ? source : namedDocument(source, name);
    if (document !== undefined) {
      if (heading === undefined || heading.startsWith('^')) return [document, null];
      for (const section of [`${document}#${heading}`, `${document}#${slug(heading)}`]) {
        if (sectionIds.has(section)) return [document, section];
      }
      return [document, null];
    }
    if (heading !== undefined) return [null, null];
    if (sectionIds.has(`${source}#${name}`)) return [source, `${source}#${name}`];
    const anchored = byAnchor.get(name);
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
 * Brings the stored documents in line with the files `config.include` reaches under `root`,
 * minus those `config.exclude` matches, in one write transaction: adds new ones, replaces
 * changed ones (every one under `rebuild`), deletes those whose file is gone or excluded,
 * resolves every link against the result, and stamps the time of the run. On any error the
 * database is left as it was.
 */
export function ingestMemory({ db, root, config, rebuild = false }: IngestMemorySpec): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    // List both sides after taking the lock: files and rows may change while this one waits.
    const documents = listDocuments(root, config);
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
