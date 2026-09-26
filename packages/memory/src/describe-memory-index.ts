import type { DatabaseSync } from 'node:sqlite';

/** An open memory database connection. */
export type DescribeMemoryIndexSpec = { db: DatabaseSync };

/**
 * How many documents the index holds, and the ISO 8601 UTC time of the last committed ingest
 * (`null` when no ingest has committed).
 */
export type MemoryIndexState = { documents: number; ingestedAt: string | null };

/**
 * Reads the document count and the last ingest's stamp from the index. A file opened read-only
 * may carry no schema at all (an empty file), which is an index no ingest has written.
 */
export function describeMemoryIndex({ db }: DescribeMemoryIndexSpec): MemoryIndexState {
  const tables = db
    .prepare(
      "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('concept', 'meta')",
    )
    .get() as { n: number };
  if (tables.n < 2) return { documents: 0, ingestedAt: null };
  const { documents } = db.prepare('SELECT count(*) AS documents FROM concept').get() as {
    documents: number;
  };
  const stamp = db.prepare("SELECT value FROM meta WHERE key = 'ingested_at'").get() as
    | { value: string }
    | undefined;
  return { documents, ingestedAt: stamp?.value ?? null };
}
