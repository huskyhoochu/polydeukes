import type { DatabaseSync } from 'node:sqlite';
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
    const raw = rule.from === 'title' ? document.title : document.metadata?.[rule.key];
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
  db.prepare(
    'INSERT INTO concept (id, title, metadata, status, stale_after, doc_type, ticket) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    document.id,
    document.title,
    JSON.stringify(metadata),
    status,
    staleAfter,
    docType,
    ticketFor(document, config),
  );
  const insert = db.prepare(
    'INSERT INTO section (id, concept_id, ord, doc_title, title, body) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const section of document.sections) {
    insert.run(
      `${document.id}#${section.anchor}`,
      document.id,
      section.ord,
      document.title,
      section.title,
      section.body,
    );
  }
}
