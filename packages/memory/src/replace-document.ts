import type { DatabaseSync } from 'node:sqlite';
import { chunkSpans } from './chunk-body.ts';
import type { MemoryConfig } from './memory-config.ts';
import type { ParsedDocument } from './parse-document.ts';

/** A connection, parsed document, and optional settings for derived columns. */
export type ReplaceDocumentSpec = {
  db: DatabaseSync;
  document: ParsedDocument;
  config?: MemoryConfig;
};

function ticketFor(document: ParsedDocument, config?: MemoryConfig): string | null {
  const sourceType = document.metadata?.type;
  for (const rule of config?.ticket ?? []) {
    if (rule.type !== undefined && rule.type !== sourceType) continue;
    const raw =
      rule.from === 'title'
        ? document.title
        : rule.from === 'path'
          ? document.id
          : document.metadata?.[rule.key];
    if (typeof raw !== 'string' || raw.trim() === '') continue;
    const ticket = rule.pattern === undefined ? raw : new RegExp(rule.pattern).exec(raw)?.[0];
    if (ticket?.trim()) return ticket;
  }
  return null;
}

/** Deletes the document's rows and inserts its current ones, inside the caller's transaction. */
export function replaceDocument({ db, document, config }: ReplaceDocumentSpec): void {
  db.prepare('DELETE FROM concept WHERE id = ?').run(document.id);
  const metadata = document.metadata ?? {};
  const status = typeof metadata.status === 'string' ? metadata.status : 'stable';
  const staleAfter = typeof metadata.stale_after === 'string' ? metadata.stale_after : null;
  const sourceType = typeof metadata.type === 'string' ? metadata.type : null;
  const docType =
    sourceType === null
      ? null
      : config?.typeMap && Object.hasOwn(config.typeMap, sourceType)
        ? config.typeMap[sourceType]
        : sourceType;
  const ticket = ticketFor(document, config);
  db.prepare(
    'INSERT INTO concept (id, title, metadata, status, stale_after, doc_type, ticket) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(document.id, document.title, JSON.stringify(metadata), status, staleAfter, docType, ticket);
  const insert = db.prepare(
    'INSERT INTO section (id, concept_id, ord, doc_title, title, body) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const insertChunk = db.prepare('INSERT INTO chunk (section_rowid, start, end) VALUES (?, ?, ?)');
  const indexChunk = db.prepare(
    'INSERT INTO chunk_fts (rowid, doc_title, title, body) VALUES (?, ?, ?, ?)',
  );
  const insertEdge = db.prepare(
    'INSERT INTO edge (src_section, form, raw_target) VALUES (?, ?, ?)',
  );
  // Rules that admit the same line, section, and key write one row between them.
  const insertObligation = db.prepare(
    'INSERT OR IGNORE INTO obligation (section_id, ord, key, text) VALUES (?, ?, ?, ?)',
  );
  const rules = config?.obligations ?? [];
  for (const section of document.sections) {
    const id = `${document.id}#${section.anchor}`;
    const { lastInsertRowid: sectionRowid } = insert.run(
      id,
      document.id,
      section.ord,
      document.title,
      section.title,
      section.body,
    );
    // The spans are contiguous from 0, so a running count converts them to characters.
    let characters = 0;
    for (const { start, end } of chunkSpans(section.body)) {
      const text = section.body.slice(start, end);
      const length = [...text].length;
      const { lastInsertRowid } = insertChunk.run(sectionRowid, characters, characters + length);
      characters += length;
      indexChunk.run(lastInsertRowid, document.title, section.title, text);
    }
    for (const link of section.links) insertEdge.run(id, link.form, link.target);
    const lines = section.body.split('\n');
    for (const rule of rules) {
      if ('section' in rule) {
        // The preamble, the one row whose anchor is empty, has no title, so no section rule reads it.
        if (
          section.anchor !== '' &&
          ticket !== null &&
          new RegExp(rule.section).test(section.title)
        )
          insertObligation.run(id, -1, ticket, section.body);
        continue;
      }
      const marker = new RegExp(rule.line);
      lines.forEach((line, ord) => {
        if (!marker.test(line)) return;
        for (const [key] of line.matchAll(new RegExp(rule.key, 'g')))
          insertObligation.run(id, ord, key, line.trim());
      });
    }
  }
}
