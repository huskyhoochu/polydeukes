import type { DatabaseSync } from 'node:sqlite';
import type { MemorySearchResult } from './search-memory.ts';

/**
 * One line of the memory log: when a query command answered (ISO 8601 UTC), which command,
 * its query (the search words, the shown id, or the obligations key), and the ids it returned
 * in output order. A search result also carries the path that matched it.
 */
export type MemoryLogEntry = {
  at: string;
  command: 'search' | 'show' | 'obligations';
  query: string;
  results: { id: string; matchPath?: MemorySearchResult['matchPath'] }[];
};

/** An open memory database connection and the log lines to lay against its documents. */
export type SummarizeMemoryUsageSpec = { db: DatabaseSync; entries: MemoryLogEntry[] };

/**
 * The log's first and last `at` (`null` over no entries), how many entries were read, each
 * indexed document returned by at least one entry with the number of entries that returned it,
 * the indexed documents no entry returned, and the searches that found nothing or only
 * `or`-matched rows, counted per query.
 */
export type MemoryUsage = {
  from: string | null;
  to: string | null;
  entries: number;
  hot: { id: string; count: number }[];
  dead: string[];
  misses: { query: string; count: number }[];
};

/**
 * Counts, per document the index holds now, the entries that returned it — an id's document is
 * the part before `#`, and ids of documents no longer indexed are left out — and counts the
 * searches that missed, whatever their result ids.
 */
export function summarizeMemoryUsage({ db, entries }: SummarizeMemoryUsageSpec): MemoryUsage {
  const indexed = (db.prepare('SELECT id FROM concept ORDER BY id').all() as { id: string }[]).map(
    (row) => row.id,
  );
  const counts = new Map(indexed.map((id) => [id, 0]));
  const misses = new Map<string, number>();
  for (const entry of entries) {
    const documents = new Set(entry.results.map((result) => result.id.split('#')[0] as string));
    for (const id of documents) {
      const count = counts.get(id);
      if (count !== undefined) counts.set(id, count + 1);
    }
    if (entry.command === 'search' && entry.results.every((result) => result.matchPath === 'or')) {
      misses.set(entry.query, (misses.get(entry.query) ?? 0) + 1);
    }
  }
  return {
    from: entries[0]?.at ?? null,
    to: entries.at(-1)?.at ?? null,
    entries: entries.length,
    hot: [...counts]
      .filter(([, count]) => count > 0)
      .map(([id, count]) => ({ id, count }))
      // `counts` keeps the index's id order and the sort is stable, so ties stay in the order
      // `dead` uses.
      .sort((a, b) => b.count - a.count),
    dead: indexed.filter((id) => counts.get(id) === 0),
    misses: [...misses]
      .map(([query, count]) => ({ query, count }))
      .sort((a, b) => b.count - a.count || (a.query < b.query ? -1 : a.query > b.query ? 1 : 0)),
  };
}
