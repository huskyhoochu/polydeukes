import type { DatabaseSync } from 'node:sqlite';

/** An exact document or section identifier to look up. */
export type ShowMemorySpec = { db: DatabaseSync; id: string };

/**
 * One link: the section it is written in, its text as written (`[[x]]` for a wikilink, the
 * parenthesised target for a markdown link), and the section or document it resolved to.
 */
export type MemoryLink = { from: string; target: string; to: string | null };
/** The links leaving and the links arriving at a document or section. */
export type MemoryLinks = { out: MemoryLink[]; in: MemoryLink[] };

/** A stored section in source order. */
export type MemorySection = { id: string; ord: number; title: string; body: string };
/** A stored document and all of its sections. */
export type MemoryDocument = {
  id: string;
  title: string;
  metadata: Record<string, unknown>;
  sections: MemorySection[];
  links: MemoryLinks;
};
/** One stored section selected by its exact identifier. */
export type MemoryShownSection = {
  id: string;
  conceptId: string;
  docTitle: string;
  sectionTitle: string;
  body: string;
  ord: number;
  links: MemoryLinks;
};

/** SQL for an `edge` row's link as written: `[[x]]` for a wikilink, the target otherwise. */
export const LINK_AS_WRITTEN =
  "CASE form WHEN 'wiki' THEN '[[' || raw_target || ']]' ELSE raw_target END";

const LINK_SELECT = `SELECT e.src_section AS "from", ${LINK_AS_WRITTEN} AS target,
  coalesce(e.dst_section, e.dst_concept) AS "to"
FROM edge e`;
const LINK_ORDER = 'ORDER BY "from", target';

function links(db: DatabaseSync, id: string, out: string, into: string): MemoryLinks {
  return {
    out: db.prepare(`${LINK_SELECT} ${out} ${LINK_ORDER}`).all(id) as MemoryLink[],
    in: db.prepare(`${LINK_SELECT} ${into} ${LINK_ORDER}`).all(id) as MemoryLink[],
  };
}

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
      links: links(
        db,
        id,
        'JOIN section s ON s.id = e.src_section WHERE s.concept_id = ?',
        'WHERE e.dst_concept = ?',
      ),
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
        links: links(db, id, 'WHERE e.src_section = ?', 'WHERE e.dst_section = ?'),
      }
    : undefined;
}
