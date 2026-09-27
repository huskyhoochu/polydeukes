import type { DatabaseSync } from 'node:sqlite';
import { LINK_AS_WRITTEN, SAME_TICKET } from './show-memory.ts';

/** An open memory database connection. */
export type LintMemorySpec = { db: DatabaseSync };

/**
 * One broken rule: `unresolved` names the section and the link as written, `unlinked` the
 * document and the ticket it shares, `untyped` the document with an empty detail,
 * `unresolved-supersession` the declaring document and `<direction> <target as written>`,
 * `unquoted` the newer document and the older one it declares it replaces without quoting it.
 */
export type MemoryViolation = {
  rule: 'unresolved' | 'unlinked' | 'untyped' | 'unresolved-supersession' | 'unquoted';
  id: string;
  detail: string;
};

/**
 * Every violation, ordered by rule (`unresolved`, `unlinked`, `untyped`,
 * `unresolved-supersession`, `unquoted`), id, and detail.
 */
export type MemoryLintResult = { violations: MemoryViolation[] };

const UNRESOLVED = `SELECT 'unresolved' AS rule, src_section AS id, ${LINK_AS_WRITTEN} AS detail
FROM edge WHERE dst_concept IS NULL ORDER BY id, detail`;

// Any outgoing link counts, resolved or not: an unresolved link is reported by its own rule.
const UNLINKED = `SELECT 'unlinked' AS rule, c.id, c.ticket AS detail FROM concept c
WHERE c.ticket IS NOT NULL
  AND EXISTS (SELECT 1 FROM concept o WHERE ${SAME_TICKET})
  AND NOT EXISTS (SELECT 1 FROM edge e JOIN section s ON s.id = e.src_section WHERE s.concept_id = c.id)
ORDER BY c.id, detail`;

const UNRESOLVED_SUPERSESSION = `SELECT 'unresolved-supersession' AS rule, concept_id AS id,
direction || ' ' || raw_target AS detail
FROM supersession WHERE dst_concept IS NULL ORDER BY id, detail`;

// Only the newer document's own declaration asks it to quote; an older document's
// `superseded-by` line does not.
const DECLARED_PAIRS = `SELECT DISTINCT concept_id AS newer, dst_concept AS older FROM supersession
WHERE direction = 'supersedes' AND dst_concept IS NOT NULL ORDER BY newer, older`;

/**
 * The visible text: blockquote markers, link and wikilink syntax, and emphasis, code, and
 * strikethrough markers removed, whitespace runs collapsed to one space, and the ends trimmed.
 */
function normalize(text: string): string {
  return text
    .replace(/^[ \t]*(?:>[ \t]*)+/gm, '')
    .replace(
      /\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g,
      (_, name: string, alias?: string) => alias ?? name,
    )
    .replace(/!?\[([^\]]*)\](?:\([^)]*\)|\[[^\]]*\])/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The text of every 「…」 and “…” in a section, and of every blockquote line outside the text
 * before the first H2, whose blockquotes are the document's head: documents written from one
 * template share those lines word for word without quoting each other.
 */
function quotations({ id, body }: { id: string; body: string }): string[] {
  return [
    ...(id.endsWith('#')
      ? []
      : body.split('\n').filter((line) => line.trimStart().startsWith('>'))),
    ...[...body.matchAll(/「([^」]*)」|“([^”]*)”/g)].map((match) => match[1] ?? match[2] ?? ''),
  ];
}

/**
 * Reports links that resolved to no document, documents that share a ticket with another
 * document and link to nothing, the documents whose stored metadata has no `type` (only once
 * some document's metadata has a non-empty string `type`), supersession targets that name no
 * document, and declared supersessions whose newer document quotes nothing of the older one.
 */
export function lintMemory({ db }: LintMemorySpec): MemoryLintResult {
  const documents = db.prepare('SELECT id, metadata FROM concept ORDER BY id').all() as {
    id: string;
    metadata: string;
  }[];
  const untypedDocuments = documents.filter(({ metadata }) => {
    const type: unknown = JSON.parse(metadata).type;
    return typeof type !== 'string' || type === '';
  });
  const untyped = (untypedDocuments.length === documents.length ? [] : untypedDocuments).map(
    ({ id }): MemoryViolation => ({ rule: 'untyped', id, detail: '' }),
  );
  const sections = db.prepare('SELECT id, body FROM section WHERE concept_id = ? ORDER BY ord');
  const sectionsOf = (id: string): { id: string; body: string }[] =>
    sections.all(id) as { id: string; body: string }[];
  const pairs = db.prepare(DECLARED_PAIRS).all() as { newer: string; older: string }[];
  const unquoted = pairs
    .filter(({ newer, older }) => {
      const olderText = normalize(
        sectionsOf(older)
          .map(({ body }) => body)
          .join('\n'),
      );
      return !sectionsOf(newer)
        .flatMap(quotations)
        .some((quotation) => {
          const text = normalize(quotation);
          return text !== '' && olderText.includes(text);
        });
    })
    .map(({ newer, older }): MemoryViolation => ({ rule: 'unquoted', id: newer, detail: older }));
  return {
    violations: [
      ...(db.prepare(UNRESOLVED).all() as MemoryViolation[]),
      ...(db.prepare(UNLINKED).all() as MemoryViolation[]),
      ...untyped,
      ...(db.prepare(UNRESOLVED_SUPERSESSION).all() as MemoryViolation[]),
      ...unquoted,
    ],
  };
}
