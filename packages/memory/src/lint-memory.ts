import type { DatabaseSync } from 'node:sqlite';
import { LINK_AS_WRITTEN } from './show-memory.ts';

/** An open memory database connection. */
export type LintMemorySpec = { db: DatabaseSync };

/**
 * One broken rule: `unresolved` names the section and the link as written, `unlinked` the
 * document and the ticket it shares, `untyped` the document with an empty detail.
 */
export type MemoryViolation = {
  rule: 'unresolved' | 'unlinked' | 'untyped';
  id: string;
  detail: string;
};

/** Every violation, ordered by rule (`unresolved`, `unlinked`, `untyped`), id, and detail. */
export type MemoryLintResult = { violations: MemoryViolation[] };

const UNRESOLVED = `SELECT 'unresolved' AS rule, src_section AS id, ${LINK_AS_WRITTEN} AS detail
FROM edge WHERE dst_concept IS NULL ORDER BY id, detail`;

// Any outgoing link counts, resolved or not: an unresolved link is reported by its own rule.
const UNLINKED = `SELECT 'unlinked' AS rule, c.id, c.ticket AS detail FROM concept c
WHERE c.ticket IS NOT NULL
  AND EXISTS (SELECT 1 FROM concept o WHERE o.ticket = c.ticket AND o.id != c.id)
  AND NOT EXISTS (SELECT 1 FROM edge e JOIN section s ON s.id = e.src_section WHERE s.concept_id = c.id)
ORDER BY c.id, detail`;

/**
 * Reports links that resolved to no document, documents that share a ticket with another
 * document and link to nothing, and documents whose stored metadata has no non-empty string
 * `type`.
 */
export function lintMemory({ db }: LintMemorySpec): MemoryLintResult {
  const documents = db.prepare('SELECT id, metadata FROM concept ORDER BY id').all() as {
    id: string;
    metadata: string;
  }[];
  const untyped = documents
    .filter(({ metadata }) => {
      const type: unknown = JSON.parse(metadata).type;
      return typeof type !== 'string' || type === '';
    })
    .map(({ id }): MemoryViolation => ({ rule: 'untyped', id, detail: '' }));
  return {
    violations: [
      ...(db.prepare(UNRESOLVED).all() as MemoryViolation[]),
      ...(db.prepare(UNLINKED).all() as MemoryViolation[]),
      ...untyped,
    ],
  };
}
