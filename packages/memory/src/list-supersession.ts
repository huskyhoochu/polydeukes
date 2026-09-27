import type { DatabaseSync } from 'node:sqlite';

/** The document whose supersession chain to list. */
export type ListSupersessionSpec = { db: DatabaseSync; id: string };

/** One resolved supersession: `newer` replaces `older`. */
export type MemorySupersession = { newer: string; older: string };

/**
 * Every resolved supersession row as a (newer, older) pair: a `supersedes` row's declaring
 * document is the newer side, a `superseded-by` row's the older side.
 */
export const SUPERSESSION_PAIRS = `SELECT concept_id AS newer, dst_concept AS older FROM supersession
WHERE direction = 'supersedes' AND dst_concept IS NOT NULL
UNION
SELECT dst_concept AS newer, concept_id AS older FROM supersession
WHERE direction = 'superseded-by' AND dst_concept IS NOT NULL`;

/**
 * Returns the pairs met walking from the document to the documents that replaced it, and those
 * that replaced them, and separately to the documents it replaced, and those they replaced;
 * sorted by newer, then older. Undefined when no document has the id.
 */
export function listSupersession({
  db,
  id,
}: ListSupersessionSpec): MemorySupersession[] | undefined {
  if (!db.prepare('SELECT 1 FROM concept WHERE id = ?').get(id)) return undefined;
  const pairs = db.prepare(SUPERSESSION_PAIRS).all() as MemorySupersession[];
  const found = new Map<string, MemorySupersession>();
  const walk = (from: keyof MemorySupersession, to: keyof MemorySupersession): void => {
    const visited = new Set([id]);
    const pending = [id];
    for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
      for (const pair of pairs) {
        if (pair[from] !== current) continue;
        found.set(`${pair.newer}\n${pair.older}`, pair);
        if (visited.has(pair[to])) continue;
        visited.add(pair[to]);
        pending.push(pair[to]);
      }
    }
  };
  walk('older', 'newer');
  walk('newer', 'older');
  return [...found.values()].sort(
    (a, b) =>
      (a.newer < b.newer ? -1 : a.newer > b.newer ? 1 : 0) ||
      (a.older < b.older ? -1 : a.older > b.older ? 1 : 0),
  );
}
