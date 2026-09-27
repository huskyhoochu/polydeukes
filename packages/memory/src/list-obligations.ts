import type { DatabaseSync } from 'node:sqlite';

/** The key whose obligations to list. */
export type ListObligationsSpec = { db: DatabaseSync; key: string };

/**
 * One obligation: the key it is filed under, the section it was found in, and its text — the
 * trimmed line for a line rule, the whole section body for a section rule.
 */
export type MemoryObligation = {
  key: string;
  sectionId: string;
  docTitle: string;
  sectionTitle: string;
  text: string;
};

/** Returns every obligation filed under `key`, in section id order and then source order. */
export function listObligations({ db, key }: ListObligationsSpec): MemoryObligation[] {
  return db
    .prepare(
      `SELECT o.key, o.section_id AS sectionId, s.doc_title AS docTitle, s.title AS sectionTitle, o.text
FROM obligation o JOIN section s ON s.id = o.section_id
WHERE o.key = ?
ORDER BY o.section_id, o.ord`,
    )
    .all(key) as MemoryObligation[];
}
