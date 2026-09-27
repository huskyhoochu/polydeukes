import type { DatabaseSync } from 'node:sqlite';
import { SUPERSESSION_PAIRS } from './list-supersession.ts';
import type { MemoryConfig } from './memory-config.ts';
import { normalizeQuery } from './normalize-query.ts';

/** The index, query, result limit, freshness clock, and optional type weights. */
export type SearchMemorySpec = {
  db: DatabaseSync;
  query: string;
  limit?: number;
  now?: Date;
  config?: MemoryConfig;
};

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
  /** the documents that directly replace this section's document, sorted; empty when none */
  supersededBy: string[];
};

// `chunks` holds the term's score in each chunk of the section it matched; a section matched
// only by its id prefix has none.
type Match = { chunks: Map<number, number>; like: boolean };
type ChunkHit = { rowid: number; section_rowid: number; score: number };
type ResultRow = {
  rowid: number;
  id: string;
  concept_id: string;
  doc_title: string;
  title: string;
  status: string;
  stale_after: string | null;
  metadata: string;
  doc_type: string | null;
};

const K1 = 1.2;
const B = 0.75;
// A chunk's trigram count over the three columns its index row holds: both titles and its own
// span, whose length is the difference of its stored offsets.
const TOKENS =
  'max(length(s.doc_title) - 2, 0) + max(length(s.title) - 2, 0) + max(c.end - c.start - 2, 0)';
const CHUNK_BODY = 'substr(s.body, c.start + 1, c.end - c.start)';

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
  const add = ({ rowid, section_rowid, score }: ChunkHit, like: boolean): void => {
    const match = found.get(section_rowid) ?? { chunks: new Map<number, number>(), like };
    match.chunks.set(rowid, score);
    found.set(section_rowid, match);
  };

  if ([...term].length >= 3) {
    const phrase = `"${term.replaceAll('"', '""')}"`;
    const rows = db
      .prepare(
        `SELECT c.rowid, c.section_rowid, bm25(chunk_fts) AS score
         FROM chunk_fts JOIN chunk AS c ON c.rowid = chunk_fts.rowid
         WHERE chunk_fts MATCH ?`,
      )
      .all(phrase) as ChunkHit[];
    // The LIKE check keeps the match set equal to a substring scan (trigram folds case beyond
    // ASCII, LIKE does not). It reads each matched section once; a term holds no whitespace, so
    // it matches a section exactly when it matches one of the section's chunks.
    const confirmed = new Set(
      (
        db
          .prepare(
            `SELECT rowid FROM section
             WHERE rowid IN (SELECT value FROM json_each(?))
               AND (doc_title LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\'
                    OR body LIKE ? ESCAPE '\\')`,
          )
          .all(
            JSON.stringify([...new Set(rows.map((row) => row.section_rowid))]),
            pattern,
            pattern,
            pattern,
          ) as { rowid: number }[]
      ).map((row) => row.rowid),
    );
    for (const row of rows) if (confirmed.has(row.section_rowid)) add(row, false);
  } else {
    // FTS5's bm25 formula over chunks with their trigram token count as length, so these scores
    // share one scale with the bm25() scores of longer terms. The totals ride in the same
    // statement as the matches so both come from one snapshot and the match count never
    // exceeds N.
    const rows = db
      .prepare(
        `WITH piece AS MATERIALIZED (
           SELECT c.rowid, c.section_rowid, ${TOKENS} AS len, s.doc_title, s.title,
                  ${CHUNK_BODY} AS body
           FROM chunk AS c JOIN section AS s ON s.rowid = c.section_rowid
           WHERE c.section_rowid IN (
             SELECT rowid FROM section WHERE doc_title LIKE ?2 ESCAPE '\\'
             OR title LIKE ?2 ESCAPE '\\' OR body LIKE ?2 ESCAPE '\\'))
         SELECT rowid, section_rowid, len,
                (length(doc_title) + length(title) + length(body)
                 - length(replace(lower(doc_title), lower(?1), ''))
                 - length(replace(lower(title), lower(?1), ''))
                 - length(replace(lower(body), lower(?1), ''))) / length(?1) AS tf,
                (SELECT count(*) FROM chunk) AS N,
                (SELECT avg(${TOKENS}) FROM chunk AS c
                 JOIN section AS s ON s.rowid = c.section_rowid) AS avglen
         FROM piece WHERE doc_title LIKE ?2 ESCAPE '\\' OR title LIKE ?2 ESCAPE '\\'
            OR body LIKE ?2 ESCAPE '\\'`,
      )
      .all(term, pattern) as {
      rowid: number;
      section_rowid: number;
      len: number;
      tf: number;
      N: number;
      avglen: number;
    }[];
    const N = rows[0]?.N ?? 0;
    const rawIdf = Math.log((N - rows.length + 0.5) / (rows.length + 0.5));
    const idf = rawIdf <= 0 ? 1e-6 : rawIdf;
    for (const { rowid, section_rowid, len, tf, avglen } of rows) {
      // With no chunk long enough for a trigram every length is 0; a 0/0 ratio would make
      // the score NaN and discard the type weight.
      const ratio = avglen > 0 ? len / avglen : 0;
      const score = (-idf * tf * (K1 + 1)) / (tf + K1 * (1 - B + B * ratio));
      add({ rowid, section_rowid, score }, true);
    }
  }

  const idRows = db
    .prepare(
      `SELECT s.rowid FROM section AS s
       WHERE s.id LIKE ? ESCAPE '\\' OR s.concept_id LIKE ? ESCAPE '\\'`,
    )
    .all(prefix, prefix) as { rowid: number }[];
  for (const row of idRows) {
    const previous = found.get(row.rowid);
    found.set(row.rowid, { chunks: previous?.chunks ?? new Map(), like: true });
  }
  return found;
}

/**
 * Finds sections by the query's normalized terms, any of them matching. A query that
 * normalization leaves unchanged or empties runs its words as written, widening to any word
 * only when all words match no section.
 */
export async function searchMemory({
  db,
  query,
  limit = 20,
  now = new Date(),
  config,
}: SearchMemorySpec): Promise<MemorySearchResult[]> {
  const raw = query.trim().split(/\s+/u).filter(Boolean);
  if (raw.length === 0 || !Number.isInteger(limit) || limit <= 0) return [];

  const normalized = await normalizeQuery(query);
  // An identifier query comes back from normalization unchanged; comparing with the whitespace
  // split keeps it on the AND path, where a section must hold every word.
  const literal =
    normalized.length === 0 ||
    (normalized.length === raw.length && normalized.every((term, i) => term === raw[i]));
  const terms = literal ? raw : normalized;
  // Every read below comes from one snapshot, so a chunk's hit and its section's row agree even
  // while an ingest commits in another connection.
  const own = !db.isTransaction;
  if (own) db.exec('BEGIN');
  let matches: Map<number, Match>[];
  let rows: ResultRow[];
  const supersededBy = new Map<string, string[]>();
  try {
    matches = terms.map((term) => termMatches(db, term));
    const allIds = new Set(matches.flatMap((set) => [...set.keys()]));
    const andIds = [...allIds].filter((id) => matches.every((set) => set.has(id)));
    const ids = literal && andIds.length > 0 ? andIds : [...allIds];
    rows =
      ids.length === 0
        ? []
        : (db
            .prepare(
              `SELECT s.rowid, s.id, s.concept_id, s.doc_title, s.title,
                      c.status, c.stale_after, c.metadata, c.doc_type
               FROM section AS s JOIN concept AS c ON c.id = s.concept_id
               WHERE s.rowid IN (SELECT value FROM json_each(?))`,
            )
            .all(JSON.stringify(ids)) as ResultRow[]);
    const pairs = db
      .prepare(
        `SELECT newer, older FROM (${SUPERSESSION_PAIRS})
         WHERE older IN (SELECT value FROM json_each(?)) ORDER BY newer`,
      )
      .all(JSON.stringify([...new Set(rows.map((row) => row.concept_id))])) as {
      newer: string;
      older: string;
    }[];
    for (const { newer, older } of pairs)
      supersededBy.set(older, [...(supersededBy.get(older) ?? []), newer]);
  } finally {
    if (own) db.exec('COMMIT');
  }
  if (rows.length === 0) return [];

  return rows
    .map((row) => {
      const hits = matches.map((set) => set.get(row.rowid)).filter((hit) => hit !== undefined);
      // A section scores as its best chunk, each chunk the sum of the terms it matched.
      const chunkScores = new Map<number, number>();
      for (const hit of hits)
        for (const [chunk, score] of hit.chunks)
          chunkScores.set(chunk, (chunkScores.get(chunk) ?? 0) + score);
      const score = chunkScores.size === 0 ? 0 : Math.min(...chunkScores.values());
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
        matchPath:
          hits.length < matches.length ? 'or' : hits.some((hit) => hit.like) ? 'like' : 'and',
        supersededBy: supersededBy.get(row.concept_id) ?? [],
      };
      return {
        result,
        score:
          score -
          (row.doc_type !== null && config?.weights && Object.hasOwn(config.weights, row.doc_type)
            ? (config.weights[row.doc_type] ?? 0)
            : 0),
      };
    })
    .sort((a, b) => {
      // A superseded document sorts with the deprecated ones, behind every other result.
      const retired = ({ result }: typeof a): number =>
        Number(result.status === 'deprecated' || result.supersededBy.length > 0);
      const status = retired(a) - retired(b);
      return (
        status ||
        a.score - b.score ||
        (a.result.id < b.result.id ? -1 : a.result.id > b.result.id ? 1 : 0)
      );
    })
    .slice(0, limit)
    .map(({ result }) => result);
}
