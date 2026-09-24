import type { DatabaseSync } from 'node:sqlite';
import type { ParsedDocument } from './parse-document.ts';

/** A connection and the parsed document whose rows replace that document's current rows. */
export type ReplaceDocumentSpec = { db: DatabaseSync; document: ParsedDocument };

/** Deletes the document's rows and inserts its current ones, inside the caller's transaction. */
export function replaceDocument({ db, document }: ReplaceDocumentSpec): void {
  db.prepare('DELETE FROM concept WHERE id = ?').run(document.id);
  const metadata = document.metadata ?? {};
  const status = typeof metadata.status === 'string' ? metadata.status : 'stable';
  const staleAfter = typeof metadata.stale_after === 'string' ? metadata.stale_after : null;
  db.prepare(
    'INSERT INTO concept (id, title, metadata, status, stale_after) VALUES (?, ?, ?, ?, ?)',
  ).run(document.id, document.title, JSON.stringify(metadata), status, staleAfter);
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
