import type { DatabaseSync } from 'node:sqlite';
import { SAME_TICKET } from './show-memory.ts';

/** An open memory database connection. */
export type DescribeMemoryIndexSpec = { db: DatabaseSync };

/**
 * How many documents the index holds, the ISO 8601 UTC time of the last committed ingest
 * (`null` when no ingest has committed), how many sections and links it holds, how many links
 * resolved to no document, and how many documents have neither a resolved link to or from
 * another document nor another document with the same stored ticket.
 */
export type MemoryIndexState = {
  documents: number;
  ingestedAt: string | null;
  sections: number;
  links: number;
  unresolved: number;
  isolated: number;
};

// A link between two sections of one document does not connect it to another document.
const CONNECTED = `SELECT count(*) AS n FROM (
  SELECT s.concept_id AS id FROM edge e JOIN section s ON s.id = e.src_section
    WHERE e.dst_concept IS NOT NULL AND e.dst_concept != s.concept_id
  UNION
  SELECT e.dst_concept FROM edge e JOIN section s ON s.id = e.src_section
    WHERE e.dst_concept IS NOT NULL AND e.dst_concept != s.concept_id
  UNION
  SELECT c.id FROM concept c WHERE EXISTS (SELECT 1 FROM concept o WHERE ${SAME_TICKET})
)`;

/**
 * Reads the counts and the last ingest's stamp from the index. A file opened read-only
 * may carry no schema at all (an empty file), which is an index no ingest has written.
 */
export function describeMemoryIndex({ db }: DescribeMemoryIndexSpec): MemoryIndexState {
  const tables = new Set(
    (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((row) => row.name),
  );
  // An index without the `edge` table was written before links were stored; reading it as
  // unbuilt sends the reader to an ingest, which brings it up to date.
  if (!tables.has('concept') || !tables.has('meta') || !tables.has('edge')) {
    return { documents: 0, ingestedAt: null, sections: 0, links: 0, unresolved: 0, isolated: 0 };
  }
  const { documents } = db.prepare('SELECT count(*) AS documents FROM concept').get() as {
    documents: number;
  };
  const stamp = db.prepare("SELECT value FROM meta WHERE key = 'ingested_at'").get() as
    | { value: string }
    | undefined;
  const ingestedAt = stamp?.value ?? null;
  const count = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;
  return {
    documents,
    ingestedAt,
    sections: count('SELECT count(*) AS n FROM section'),
    links: count('SELECT count(*) AS n FROM edge'),
    unresolved: count('SELECT count(*) AS n FROM edge WHERE dst_concept IS NULL'),
    isolated: documents - count(CONNECTED),
  };
}
