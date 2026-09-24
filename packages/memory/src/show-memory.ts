import type { DatabaseSync } from 'node:sqlite';

/** An exact document or section identifier to look up. */
export type ShowMemorySpec = { db: DatabaseSync; id: string };

/** A stored section in source order. */
export type MemorySection = { id: string; ord: number; title: string; body: string };
/** A stored document and all of its sections. */
export type MemoryDocument = {
  id: string;
  title: string;
  metadata: Record<string, unknown>;
  sections: MemorySection[];
};
/** One stored section selected by its exact identifier. */
export type MemoryShownSection = {
  id: string;
  conceptId: string;
  docTitle: string;
  sectionTitle: string;
  body: string;
  ord: number;
};

/** Returns the stored document or section selected by an exact identifier. */
export function showMemory({
  db,
  id,
}: ShowMemorySpec): MemoryDocument | MemoryShownSection | undefined {
  const document = db.prepare('SELECT id, title, metadata FROM concept WHERE id = ?').get(id) as
    | { id: string; title: string; metadata: string }
    | undefined;
  if (document) {
    const sections = db
      .prepare('SELECT id, ord, title, body FROM section WHERE concept_id = ? ORDER BY ord')
      .all(id) as MemorySection[];
    return {
      id: document.id,
      title: document.title,
      metadata: JSON.parse(document.metadata),
      sections,
    };
  }

  const section = db
    .prepare(`SELECT id, concept_id, doc_title, title, body, ord FROM section WHERE id = ?`)
    .get(id) as
    | {
        id: string;
        concept_id: string;
        doc_title: string;
        title: string;
        body: string;
        ord: number;
      }
    | undefined;
  return section
    ? {
        id: section.id,
        conceptId: section.concept_id,
        docTitle: section.doc_title,
        sectionTitle: section.title,
        body: section.body,
        ord: section.ord,
      }
    : undefined;
}
