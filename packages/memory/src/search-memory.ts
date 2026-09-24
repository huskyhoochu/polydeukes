import type { DatabaseSync } from 'node:sqlite';

/** The index, literal query, optional result limit, and clock used for freshness. */
export type SearchMemorySpec = { db: DatabaseSync; query: string; limit?: number; now?: Date };

/** One section found in the memory index. */
export type MemorySearchResult = {
  id: string;
  conceptId: string;
  docTitle: string;
  sectionTitle: string;
  status: string;
  trust: 'human-reviewed' | 'machine-verified' | 'unverified';
  stale: boolean;
  matchPath: 'and' | 'or' | 'like';
};

type Match = { score: number; like: boolean };
type Candidate = { rowid: number; score?: number };
type ResultRow = {
  rowid: number;
  id: string;
  concept_id: string;
  doc_title: string;
  title: string;
  status: string;
  stale_after: string | null;
  metadata: string;
};

const escapeLike = (term: string): string =>
  term.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');

function trustOf(metadata: Record<string, unknown>): MemorySearchResult['trust'] {
  const verified = metadata.verified;
  const entries = Array.isArray(verified) ? verified : verified ? [verified] : [];
  let machine = false;
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue;
    const by = (entry as Record<string, unknown>).by;
    if (typeof by !== 'string' || by.trim() === '') continue;
    if (by.startsWith('human:')) return 'human-reviewed';
    machine = true;
  }
  return machine ? 'machine-verified' : 'unverified';
}

function termMatches(db: DatabaseSync, term: string): Map<number, Match> {
  const found = new Map<number, Match>();
  const pattern = `%${escapeLike(term)}%`;
  const prefix = `${escapeLike(term)}%`;

  if ([...term].length >= 3) {
    const phrase = `"${term.replaceAll('"', '""')}"`;
    const rows = db
      .prepare(
        `SELECT s.rowid, bm25(section_fts) AS score
         FROM section_fts JOIN section AS s ON s.rowid = section_fts.rowid
         WHERE section_fts MATCH ?
           AND (s.doc_title LIKE ? ESCAPE '\\' OR s.title LIKE ? ESCAPE '\\'
                OR s.body LIKE ? ESCAPE '\\')`,
      )
      .all(phrase, pattern, pattern, pattern) as Candidate[];
    for (const row of rows) found.set(row.rowid, { score: row.score ?? 0, like: false });
  } else {
    const rows = db
      .prepare(
        `SELECT rowid FROM section WHERE doc_title LIKE ? ESCAPE '\\'
         OR title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\'`,
      )
      .all(pattern, pattern, pattern) as Candidate[];
    for (const row of rows) found.set(row.rowid, { score: 0, like: true });
  }

  const idRows = db
    .prepare(
      `SELECT s.rowid FROM section AS s
       WHERE s.id LIKE ? ESCAPE '\\' OR s.concept_id LIKE ? ESCAPE '\\'`,
    )
    .all(prefix, prefix) as Candidate[];
  for (const row of idRows) {
    const previous = found.get(row.rowid);
    found.set(row.rowid, { score: previous?.score ?? 0, like: true });
  }
  return found;
}

/** Finds sections by literal terms, widening to any term only when all terms match no section. */
export function searchMemory({
  db,
  query,
  limit = 20,
  now = new Date(),
}: SearchMemorySpec): MemorySearchResult[] {
  const terms = query.trim().split(/\s+/u).filter(Boolean);
  if (terms.length === 0 || !Number.isInteger(limit) || limit <= 0) return [];

  const matches = terms.map((term) => termMatches(db, term));
  const allIds = new Set(matches.flatMap((set) => [...set.keys()]));
  const andIds = [...allIds].filter((id) => matches.every((set) => set.has(id)));
  const fallback = andIds.length === 0;
  const ids = fallback ? [...allIds] : andIds;
  if (ids.length === 0) return [];

  const rows = db
    .prepare(
      `SELECT s.rowid, s.id, s.concept_id, s.doc_title, s.title,
              c.status, c.stale_after, c.metadata
       FROM section AS s JOIN concept AS c ON c.id = s.concept_id
       WHERE s.rowid IN (SELECT value FROM json_each(?))`,
    )
    .all(JSON.stringify(ids)) as ResultRow[];

  return rows
    .map((row) => {
      const hits = matches.map((set) => set.get(row.rowid)).filter((hit) => hit !== undefined);
      const score = hits.reduce((sum, hit) => sum + hit.score, 0);
      const metadata = JSON.parse(row.metadata) as Record<string, unknown>;
      const staleTime = row.stale_after === null ? NaN : Date.parse(row.stale_after);
      const result: MemorySearchResult = {
        id: row.id,
        conceptId: row.concept_id,
        docTitle: row.doc_title,
        sectionTitle: row.title,
        status: row.status,
        trust: trustOf(metadata),
        stale: Number.isFinite(staleTime) && staleTime <= now.getTime(),
        matchPath: fallback ? 'or' : hits.some((hit) => hit.like) ? 'like' : 'and',
      };
      return { result, score };
    })
    .sort((a, b) => {
      const status =
        Number(a.result.status === 'deprecated') - Number(b.result.status === 'deprecated');
      return (
        status ||
        a.score - b.score ||
        (a.result.id < b.result.id ? -1 : a.result.id > b.result.id ? 1 : 0)
      );
    })
    .slice(0, limit)
    .map(({ result }) => result);
}
